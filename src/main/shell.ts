import {
  app,
  BrowserWindow,
  dialog,
  session,
  shell,
  type BrowserWindowConstructorOptions,
  type WebContents,
  type WebPreferences,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { APP_TITLE, mainWindowChrome, windowDragCss } from "./chrome";
import { bindAccelerators } from "./menu";
import {
  APP_URL,
  classifyNavigation,
  deepLinkToAppUrl,
  isAllowedSubframeUrl,
  isKeplarAppUrl,
  isSafeExternalUrl,
  urlForLog,
} from "./policy";
import { loadWindowState, trackWindowState, windowMinimums } from "./window-state";

let mainWindow: BrowserWindow | null = null;
let mainWebContentsId: number | null = null;
let authWindow: BrowserWindow | null = null;
let guardsInstalled = false;
let showingOffline = false;
let currentTarget = APP_URL;
let pendingDeepLink: string | null = null;
let lastExternal = { url: "", at: 0 };
let handoffGeneration = 0;

export function getMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return mainWindow;
}

export function rememberDeepLink(raw: string): void {
  const target = deepLinkToAppUrl(raw);
  if (!target) {
    console.warn("Ignored deep link", urlForLog(raw));
    return;
  }
  pendingDeepLink = target;
}

export function takeInitialUrl(argv: readonly string[]): string {
  const fromArgv = argv.find((arg) => arg.startsWith("keplar://"));
  const fromArgvUrl = fromArgv ? deepLinkToAppUrl(fromArgv) : null;
  const initial = pendingDeepLink ?? fromArgvUrl ?? APP_URL;
  pendingDeepLink = null;
  return initial;
}

export function focusMain(): void {
  const win = getMainWindow();
  if (!win) {
    void createMainWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function reloadMain(): void {
  const win = getMainWindow();
  if (!win) return;
  const current = win.webContents.getURL();
  if (classifyNavigation(current) === "app" && current.startsWith("https:")) {
    win.webContents.reload();
    return;
  }
  void loadApp(currentTarget);
}

export function openDeepLink(raw: string): void {
  const target = deepLinkToAppUrl(raw);
  if (!target) {
    console.warn("Ignored deep link", urlForLog(raw));
    return;
  }
  if (!getMainWindow()) {
    pendingDeepLink = target;
    return;
  }
  focusMain();
  void loadApp(target);
}

export async function createMainWindow(initialUrl = APP_URL): Promise<void> {
  installGuards();
  const existing = getMainWindow();
  if (existing) {
    focusMain();
    return;
  }

  const state = loadWindowState();
  const icon = iconPath();
  const options: BrowserWindowConstructorOptions = {
    width: state.width,
    height: state.height,
    minWidth: windowMinimums.minWidth,
    minHeight: windowMinimums.minHeight,
    show: false,
    ...mainWindowChrome(process.platform),
    webPreferences: hardenedWebPreferences(),
  };
  if (state.x !== undefined && state.y !== undefined) {
    options.x = state.x;
    options.y = state.y;
  }
  if (icon) options.icon = icon;

  const win = new BrowserWindow(options);
  mainWindow = win;
  mainWebContentsId = win.webContents.id;
  trackWindowState(win);
  bindAccelerators(win, { reload: reloadMain });
  win.setTitle(APP_TITLE);
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    if (!win.isDestroyed()) win.setTitle(APP_TITLE);
  });
  win.webContents.on("dom-ready", () => {
    if (win.isDestroyed()) return;
    void win.webContents.insertCSS(windowDragCss(process.platform));
    win.setTitle(APP_TITLE);
  });

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
      mainWebContentsId = null;
    }
  });

  const showNow = (): void => {
    if (win.isDestroyed() || win.isVisible()) return;
    if (state.isMaximized) win.maximize();
    win.show();
  };
  win.once("ready-to-show", showNow);
  setTimeout(showNow, 1500);

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      console.warn(
        "Page failed to load",
        errorCode,
        errorDescription,
        urlForLog(validatedURL),
      );
      void showOffline();
    },
  );

  win.webContents.on("did-finish-load", () => {
    if (win.isDestroyed()) return;
    const current = win.webContents.getURL();
    if (classifyNavigation(current) === "app") showingOffline = false;
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    console.error("Renderer stopped", details.reason);
    void showOffline();
  });

  currentTarget = initialUrl;
  await win.loadFile(loadingFile());
  if (win.isDestroyed()) return;
  void loadApp(initialUrl);
}

export function configureSession(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(allowsPermission(permission, details));
  });

  ses.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    return allowsPermission(permission, details);
  });

  ses.setDevicePermissionHandler(() => false);

  ses.on("will-download", (_event, item, webContents) => {
    const owner = BrowserWindow.fromWebContents(webContents);
    const dialogOptions = { defaultPath: safeDownloadName(item.getFilename()) };
    const chosen =
      owner && !owner.isDestroyed()
        ? dialog.showSaveDialogSync(owner, dialogOptions)
        : dialog.showSaveDialogSync(dialogOptions);
    if (!chosen) {
      item.cancel();
      return;
    }
    item.setSavePath(chosen);
  });
}

async function loadApp(url: string): Promise<void> {
  const win = getMainWindow();
  if (!win) return;
  currentTarget = url;
  showingOffline = false;
  try {
    await win.loadURL(url);
  } catch (error) {
    console.error("Load failed", urlForLog(url), error);
    await showOffline();
  }
}

async function showOffline(): Promise<void> {
  const win = getMainWindow();
  if (!win || showingOffline) return;
  showingOffline = true;
  const retry =
    classifyNavigation(currentTarget) === "app" && currentTarget.startsWith("https:")
      ? currentTarget
      : APP_URL;
  const template = fs.readFileSync(offlineTemplateFile(), "utf8");
  const html = template.replaceAll("{{RETRY_URL}}", escapeAttribute(retry));
  const file = path.join(app.getPath("temp"), "keplar-offline.html");
  await fs.promises.writeFile(file, html, "utf8");
  if (win.isDestroyed()) return;
  await win.loadFile(file);
}

function installGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;

  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url === "about:blank") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: authWindowOptions(),
        };
      }
      const kind = classifyNavigation(url);
      if (kind === "auth") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: authWindowOptions(),
        };
      }
      if (kind === "app") {
        const resolved = resolveAppUrl(url);
        if (resolved) {
          focusMain();
          void loadApp(resolved);
        }
        return { action: "deny" };
      }
      if (kind === "external") void openExternalUrl(url);
      console.warn("Blocked new window", urlForLog(url));
      return { action: "deny" };
    });

    contents.on("will-frame-navigate", (event) => {
      handleNavigation(contents, event, event.url, event.isMainFrame);
    });

    contents.on("will-redirect", (event) => {
      handleNavigation(contents, event, event.url, event.isMainFrame);
    });

    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });

    // OAuth and checkout finish in the child window so a one-time code is not
    // sent twice. Once the child is back on Keplar, the shared session cookie
    // is enough for the main window.
    contents.on("did-finish-load", () => {
      if (contents.id === mainWebContentsId || contents.isDestroyed()) return;
      const url = contents.getURL();
      if (classifyNavigation(url) !== "app") return;
      const settled = isSettledAppUrl(url);
      const generation = ++handoffGeneration;
      setTimeout(() => {
        if (generation !== handoffGeneration || contents.isDestroyed()) return;
        const latest = contents.getURL();
        if (classifyNavigation(latest) !== "app") return;
        const destination = isSettledAppUrl(latest) ? latest : APP_URL;
        const win = getMainWindow();
        if (win) void loadApp(destination);
        BrowserWindow.fromWebContents(contents)?.close();
      }, settled ? 0 : 2000);
    });
  });
}

function handleNavigation(
  contents: WebContents,
  event: Electron.Event,
  rawUrl: string,
  isMainFrame: boolean,
): void {
  if (!isMainFrame) {
    if (!isAllowedSubframeUrl(rawUrl)) {
      event.preventDefault();
      console.warn("Blocked frame navigation", urlForLog(rawUrl));
    }
    return;
  }

  const kind = classifyNavigation(rawUrl);
  if (kind === "app") {
    const resolved = resolveAppUrl(rawUrl);
    if (!resolved) {
      event.preventDefault();
      return;
    }
    if (rawUrl.startsWith("keplar:")) {
      event.preventDefault();
      if (contents.id === mainWebContentsId) void loadApp(resolved);
      return;
    }
    return;
  }

  if (kind === "auth") {
    if (contents.id === mainWebContentsId) {
      event.preventDefault();
      openAuthWindow(rawUrl);
    }
    return;
  }

  event.preventDefault();
  if (kind === "external") void openExternalUrl(rawUrl);
  else console.warn("Blocked navigation", urlForLog(rawUrl));
}

function openAuthWindow(url: string): void {
  if (!authWindow || authWindow.isDestroyed()) {
    authWindow = new BrowserWindow(authWindowOptions());
    authWindow.setMenu(null);
    authWindow.setMenuBarVisibility(false);
    authWindow.on("closed", () => {
      authWindow = null;
    });
  }
  void authWindow.loadURL(url);
  authWindow.show();
  authWindow.focus();
}

function authWindowOptions(): BrowserWindowConstructorOptions {
  const parent = getMainWindow();
  const icon = iconPath();
  const options: BrowserWindowConstructorOptions = {
    width: 480,
    height: 720,
    show: true,
    autoHideMenuBar: false,
    title: `Sign in — ${APP_TITLE}`,
    backgroundColor: "#ffffff",
    webPreferences: hardenedWebPreferences(),
  };
  if (parent) options.parent = parent;
  if (icon) options.icon = icon;
  return options;
}

function hardenedWebPreferences(): WebPreferences {
  return {
    preload: path.join(__dirname, "../preload/preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    devTools: !app.isPackaged,
  };
}

function allowsPermission(
  permission: string,
  details: { requestingUrl?: string; securityOrigin?: string; mediaTypes?: string[]; mediaType?: string },
): boolean {
  if (!isKeplarPermission(details)) return false;
  if (permission === "notifications") return true;
  if (permission === "media") {
    const types =
      details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
    return types.length > 0 && types.every((type) => type === "audio");
  }
  return false;
}

function isKeplarPermission(details: {
  requestingUrl?: string;
  securityOrigin?: string;
}): boolean {
  const raw = details.requestingUrl || details.securityOrigin;
  if (!raw) return false;
  try {
    return isKeplarAppUrl(new URL(raw));
  } catch {
    return false;
  }
}

async function openExternalUrl(raw: string): Promise<void> {
  if (!isSafeExternalUrl(raw)) return;
  const now = Date.now();
  if (lastExternal.url === raw && now - lastExternal.at < 1000) return;
  lastExternal = { url: raw, at: now };
  try {
    await shell.openExternal(raw);
  } catch (error) {
    console.error("Could not open a link in the browser", urlForLog(raw), error);
  }
}

function isSettledAppUrl(raw: string): boolean {
  if (classifyNavigation(raw) !== "app" || !raw.startsWith("https:")) return false;
  try {
    const url = new URL(raw);
    for (const key of ["code", "token", "id_token", "access_token"]) {
      if (url.searchParams.has(key)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveAppUrl(raw: string): string | null {
  if (raw.startsWith("keplar:")) return deepLinkToAppUrl(raw);
  return classifyNavigation(raw) === "app" ? raw : null;
}

function iconPath(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath, "icon.png"),
    path.join(__dirname, "../../build/icon.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function loadingFile(): string {
  return path.join(__dirname, "../renderer/loading.html");
}

function offlineTemplateFile(): string {
  return path.join(__dirname, "../renderer/offline.html");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeDownloadName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()[\]]+/g, "_");
  return base || "download";
}
