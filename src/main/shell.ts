import {
  app,
  BrowserWindow,
  dialog,
  screen,
  session,
  shell,
  type BrowserWindowConstructorOptions,
  type WebContents,
  type WebPreferences,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  APP_TITLE,
  fullscreenHideCss,
  mainWindowChrome,
  titleBarOverlay,
  windowDragCss,
} from "./chrome";
import { bindAccelerators } from "./menu";
import {
  APP_URL,
  classifyNavigation,
  deepLinkToAppUrl,
  isAllowedSubframeUrl,
  isKeplarAppUrl,
  isSafeExternalUrl,
  legacyAppFallback,
  urlForLog,
} from "./policy";
import { isAuthDeepLink, signInIntent } from "./desktop-auth";
import { clearFinishing, handleAuthLink, initSignIn, isFinishingSignIn, startSignIn } from "./signin-window";
import { documentCommitted, HEALTH_URL, healthSaysUp, reachabilityAction, type LoadFailure } from "./reachability";
import { desktopUserAgent } from "./user-agent";
import {
  captureFrameForFullscreen,
  ensureFullscreenFrame,
  loadWindowState,
  takeFullscreenRestore,
  trackWindowState,
  windowMinimums,
} from "./window-state";

let mainWindow: BrowserWindow | null = null;
let mainWebContentsId: number | null = null;
let authWindow: BrowserWindow | null = null;
let guardsInstalled = false;
let showingOffline = false;
let currentTarget = APP_URL;
let loadGeneration = 0;
let failureHandledFor = -1;
let recoveryTried = false;
/**
 * True only after `did-navigate` commits a hosted document with an HTTP status.
 * `webContents.getURL()` stays on the requested https URL when DNS fails, so it
 * cannot tell an error document from the app.
 */
let appShown = false;
/** Stops `/app` → 308 → `/app/ask` from bouncing when the ask tab is an HTTP error. */
let usedLegacyAppUrl = false;
let pendingDeepLink: string | null = null;
let lastExternal = { url: "", at: 0 };
let handoffGeneration = 0;

export function getMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return mainWindow;
}

export function rememberDeepLink(raw: string): void {
  // A sign-in handoff that arrives before any sign-in was started has nothing to finish; the window just opens.
  if (isAuthDeepLink(raw)) return;
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

export function toggleMainFullscreen(): void {
  const win = getMainWindow();
  if (!win) return;
  if (win.isFullScreen()) {
    win.setFullScreen(false);
    return;
  }
  beginFullscreen(win);
}

export function exitMainFullscreen(): void {
  const win = getMainWindow();
  if (win?.isFullScreen()) win.setFullScreen(false);
}

function beginFullscreen(win: BrowserWindow, maximized = win.isMaximized()): void {
  captureFrameForFullscreen(win, maximized);
  if (process.platform !== "darwin") {
    win.setBounds(screen.getDisplayMatching(win.getBounds()).bounds);
  }
  if (process.platform === "win32") win.setAlwaysOnTop(true, "screen-saver");
  win.setFullScreen(true);
  if (process.platform !== "darwin") {
    win.setBounds(screen.getDisplayMatching(win.getBounds()).bounds);
  }
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
  if (isAuthDeepLink(raw)) {
    handleAuthLink(raw);
    return;
  }
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
    void win.webContents.insertCSS(windowDragCss());
    win.setTitle(APP_TITLE);
  });
  bindFullscreenChrome(win);

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
      mainWebContentsId = null;
    }
  });

  win.once("ready-to-show", () => {
    if (win.isDestroyed() || win.isVisible()) return;
    if (state.isFullScreen) beginFullscreen(win, state.isMaximized);
    else if (state.isMaximized) win.maximize();
    win.show();
  });

  win.webContents.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    if (isHostedAppUrl(details.url)) {
      appShown = false;
      showingOffline = false;
      // A new document attempt (including Try again) is not the failure already handled.
      failureHandledFor = -1;
    }
  });

  win.webContents.on("did-navigate", (_event, url, httpResponseCode) => {
    if (documentCommitted(url, httpResponseCode)) {
      appShown = true;
      usedLegacyAppUrl = false;
      return;
    }
    const fallback = legacyAppFallback(url, httpResponseCode, usedLegacyAppUrl);
    if (!fallback) return;
    usedLegacyAppUrl = true;
    console.warn("Ask page was not available", httpResponseCode, urlForLog(url), "loading /app");
    void loadApp(fallback);
  });

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      void onAppLoadFailed(
        loadGeneration,
        { errorCode, isMainFrame, validatedURL },
        `${errorDescription}`,
        appDocumentVisible(),
      );
    },
  );

  win.webContents.on("did-finish-load", () => {
    if (win.isDestroyed()) return;
    const current = win.webContents.getURL();
    if (appShown) {
      showingOffline = false;
      recoveryTried = false;
    }
    if (!current.includes("/api/auth/desktop/finish")) clearFinishing();
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    console.error("Renderer stopped", details.reason);
    // The crashed document's URL can still be keplar.one. That is a dead
    // renderer, not proof the page is on screen, so recover from it.
    appShown = false;
    void onAppLoadFailed(
      loadGeneration,
      { errorCode: -2, isMainFrame: true, validatedURL: currentTarget },
      details.reason,
      false,
    );
  });

  initSignIn({ getMainWindow, loadFinish: (url) => void loadApp(url) });
  currentTarget = initialUrl;
  // The opening screen is local. A failure there (packaged path, sandbox, or
  // Windows reporting the file load as ERR_FAILED when the https load starts)
  // must not be treated as keplar.one being down, and must not skip the load.
  try {
    await win.loadFile(loadingFile());
  } catch (error) {
    console.warn("Could not show the opening screen", error);
  }
  if (win.isDestroyed()) return;
  void loadApp(initialUrl);
}

export function configureSession(): void {
  const ses = session.defaultSession;
  ses.setUserAgent(desktopUserAgent(ses.getUserAgent()));

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
  // Sign in, sign up and Add account happen in the system browser, never in this window.
  const intent = isFinishingSignIn() ? null : signInIntent(url);
  if (intent) {
    startSignIn(intent);
    if (win.webContents.getURL().startsWith("https:")) return;
    url = APP_URL;
  }
  currentTarget = url;
  const generation = ++loadGeneration;
  showingOffline = false;
  if (isHostedAppUrl(url)) appShown = false;
  try {
    await win.loadURL(url);
  } catch (error) {
    await onAppLoadFailed(
      generation,
      { errorCode: errnoOf(error), isMainFrame: true, validatedURL: url },
      error instanceof Error ? error.message : "load failed",
      appDocumentVisible(),
    );
  }
}

async function onAppLoadFailed(
  generation: number,
  failure: LoadFailure,
  description: string,
  appVisible: boolean,
): Promise<void> {
  if (generation !== loadGeneration) return;
  if (
    reachabilityAction({ failure, health: "unknown", retried: recoveryTried, appVisible }) === "ignore"
  ) {
    return;
  }
  if (failureHandledFor === generation) return;
  failureHandledFor = generation;

  const up = await probeHealth();
  if (generation !== loadGeneration) return;
  const visible = appDocumentVisible();
  const win = getMainWindow();
  // A spurious failure (Windows often reports these as ERR_FAILED, not
  // ERR_ABORTED) can arrive while the real document is still loading. Wait
  // for that navigation instead of replacing it.
  if (win && !win.isDestroyed() && win.webContents.isLoadingMainFrame() && !visible) {
    failureHandledFor = -1;
    return;
  }
  const action = reachabilityAction({
    failure,
    health: up ? "up" : "down",
    retried: recoveryTried,
    appVisible: visible,
  });
  if (action === "ignore") {
    failureHandledFor = -1;
    return;
  }
  if (action === "retry") {
    recoveryTried = true;
    console.warn(
      "Page failed to load",
      failure.errorCode,
      description,
      urlForLog(failure.validatedURL),
      "loading again because keplar.one is up",
    );
    void loadApp(currentTarget);
    return;
  }
  if (action === "offline") {
    console.warn("Page failed to load", failure.errorCode, description, urlForLog(failure.validatedURL));
    await showOffline(generation);
  }
}

async function probeHealth(): Promise<boolean> {
  try {
    const response = await session.defaultSession.fetch(HEALTH_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return healthSaysUp(response.status, await response.text());
  } catch (error) {
    console.warn("Health check failed", error);
    return false;
  }
}

async function showOffline(generation: number): Promise<void> {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  if (generation !== loadGeneration || appDocumentVisible()) return;
  if (showingOffline && win.webContents.getURL().startsWith("file:")) return;
  showingOffline = true;
  const retry =
    classifyNavigation(currentTarget) === "app" && currentTarget.startsWith("https:")
      ? currentTarget
      : APP_URL;
  const template = fs.readFileSync(offlineTemplateFile(), "utf8");
  const html = template.replaceAll("{{RETRY_URL}}", escapeAttribute(retry));
  const file = path.join(app.getPath("temp"), "keplar-offline.html");
  await fs.promises.writeFile(file, html, "utf8");
  if (win.isDestroyed() || generation !== loadGeneration || appDocumentVisible()) {
    showingOffline = false;
    return;
  }
  await win.loadFile(file);
}

function appDocumentVisible(): boolean {
  return appShown;
}

function isHostedAppUrl(raw: string): boolean {
  try {
    return isKeplarAppUrl(new URL(raw));
  } catch {
    return false;
  }
}

function errnoOf(error: unknown): number {
  if (typeof error === "object" && error !== null && "errno" in error) {
    const errno = (error as { errno: unknown }).errno;
    if (typeof errno === "number" && Number.isFinite(errno)) return errno;
  }
  return -2;
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
  if (kind === "app" && contents.id === mainWebContentsId && !isFinishingSignIn()) {
    const intent = signInIntent(rawUrl);
    if (intent) {
      event.preventDefault();
      startSignIn(intent);
      return;
    }
  }
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
    backgroundThrottling: true,
  };
}

function bindFullscreenChrome(win: BrowserWindow): void {
  let hiddenCss: string | null = null;

  let applying = false;
  const apply = (): void => {
    if (applying || win.isDestroyed()) return;
    applying = true;
    try {
      const fullscreen = win.isFullScreen();
      if (fullscreen) ensureFullscreenFrame(win);
      win.setTitleBarOverlay(titleBarOverlay(fullscreen));
      if (process.platform === "darwin") win.setWindowButtonVisibility(!fullscreen);
      if (!fullscreen && process.platform === "win32") win.setAlwaysOnTop(false);
      if (!fullscreen) {
        const restore = takeFullscreenRestore();
        if (restore) {
          win.setBounds(restore.bounds);
          if (restore.maximized) win.maximize();
        }
      }
      void syncFullscreenCss(win, fullscreen, () => hiddenCss, (key) => {
        hiddenCss = key;
      });
    } finally {
      applying = false;
    }
  };

  win.on("enter-full-screen", apply);
  win.on("leave-full-screen", apply);
}

async function syncFullscreenCss(
  win: BrowserWindow,
  fullscreen: boolean,
  getKey: () => string | null,
  setKey: (key: string | null) => void,
): Promise<void> {
  if (win.isDestroyed()) return;
  const key = getKey();
  if (fullscreen) {
    if (key) return;
    const inserted = await win.webContents.insertCSS(fullscreenHideCss());
    if (!win.isDestroyed() && win.isFullScreen()) setKey(inserted);
    else await win.webContents.removeInsertedCSS(inserted);
    return;
  }
  if (!key) return;
  await win.webContents.removeInsertedCSS(key);
  setKey(null);
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
