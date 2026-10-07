import { app, BrowserWindow, ipcMain, nativeTheme, shell, type IpcMainEvent } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignInFlow, viewFor, type FlowState, type SignInKind } from "./desktop-auth";
import { chromePalette, type AppTheme } from "./chrome";
import { APP_ORIGIN, isSafeExternalUrl } from "./policy";

function shellBackground(): string {
  const theme: AppTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  return chromePalette(theme).background;
}

let flow: SignInFlow | null = null;
let win: BrowserWindow | null = null;
let ready = false;
let lastView: ReturnType<typeof viewFor> = null;
let getParent: () => BrowserWindow | null = () => null;
let loadFinish: (url: string) => void = () => undefined;
let ipcBound = false;
let finishing = false;
let finishingTimer: ReturnType<typeof setTimeout> | null = null;
const FINISHING_GUARD_MS = 4000;

export function initSignIn(options: { getMainWindow: () => BrowserWindow | null; loadFinish: (url: string) => void }): void {
  getParent = options.getMainWindow;
  loadFinish = options.loadFinish;
  if (ipcBound) return;
  ipcBound = true;
  ipcMain.on("signin:ready", (event) => {
    if (!fromSignInWindow(event)) return;
    ready = true;
    push();
  });
  ipcMain.on("signin:action", (event, id: unknown) => {
    if (!fromSignInWindow(event)) return;
    if (id === "cancel") cancelSignIn();
    else if (id === "retry") void ensureFlow().retry();
    else if (id === "reopen") void ensureFlow().reopenBrowser();
  });
  nativeTheme.on("updated", () => {
    if (!win || win.isDestroyed()) return;
    win.setBackgroundColor(shellBackground());
  });
}

/** True while the app is loading the finish URL, so the redirect that follows is not mistaken for a new sign-in request. */
export const isFinishingSignIn = (): boolean => finishing;
export const clearFinishing = (): void => {
  if (finishingTimer) clearTimeout(finishingTimer);
  finishingTimer = null;
  finishing = false;
};

/**
 * The finish page stayed on screen. Keep ignoring /signin for a moment so its own
 * redirect is not a second sign-in, then release the guard if nothing navigates away.
 */
export function holdFinishingGuard(): void {
  if (!finishing) return;
  if (finishingTimer) clearTimeout(finishingTimer);
  finishingTimer = setTimeout(() => {
    finishingTimer = null;
    finishing = false;
  }, FINISHING_GUARD_MS);
}

function deviceLabel(): string {
  const os_ = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  return `Keplar One on ${os_}`;
}

function ensureFlow(): SignInFlow {
  if (flow) return flow;
  flow = new SignInFlow({
    fetch: (input, init) => fetch(input, init),
    openExternal: async (url) => {
      if (!url.startsWith(`${APP_ORIGIN}/desktop/connect?rid=`) || !isSafeExternalUrl(url)) throw new Error("refused");
      await shell.openExternal(url);
    },
    loadFinish: (url) => {
      finishing = true;
      loadFinish(url);
    },
    onState: render,
    label: `${deviceLabel()} (${os.hostname().slice(0, 12)})`,
  });
  return flow;
}

export function startSignIn(kind: SignInKind): void {
  void ensureFlow().begin(kind);
}

export function cancelSignIn(): void {
  flow?.cancel();
}

/** A keplar://auth link from the operating system. */
export function handleAuthLink(raw: string): void {
  void ensureFlow()
    .handleDeepLink(raw)
    .then((used) => {
      if (used) return;
      const main = getParent();
      if (main && !main.isDestroyed()) {
        if (main.isMinimized()) main.restore();
        main.focus();
      }
    });
}

function render(state: FlowState): void {
  lastView = viewFor(state);
  if (state.phase === "done") {
    // Give the finish page a moment to start loading, then drop the window.
    setTimeout(closeWindow, 400);
    return;
  }
  if (!lastView) {
    closeWindow();
    return;
  }
  openWindow();
  push();
}

function push(): void {
  if (win && !win.isDestroyed() && ready && lastView) win.webContents.send("signin:view", lastView);
}

function fromSignInWindow(event: IpcMainEvent): boolean {
  return Boolean(win && !win.isDestroyed() && event.sender.id === win.webContents.id);
}

function openWindow(): void {
  if (win && !win.isDestroyed()) {
    win.show();
    return;
  }
  ready = false;
  const parent = getParent();
  const options: Electron.BrowserWindowConstructorOptions = {
    width: 440,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Keplar One",
    backgroundColor: shellBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/signin-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  };
  if (parent && !parent.isDestroyed()) {
    options.parent = parent;
    options.modal = true;
  }
  const icon = [path.join(process.resourcesPath, "icon.png"), path.join(__dirname, "../../build/icon.png")].find((p) => fs.existsSync(p));
  if (icon) options.icon = icon;
  const w = new BrowserWindow(options);
  win = w;
  w.setMenu(null);
  w.once("ready-to-show", () => {
    if (!w.isDestroyed()) w.show();
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (event) => event.preventDefault());
  w.on("closed", () => {
    if (win === w) win = null;
    ready = false;
    // Closing the window is Cancel (unless the sign-in already finished).
    if (flow && flow.active && flow.current.phase !== "finishing") flow.cancel();
  });
  void w.loadFile(path.join(__dirname, "../renderer/signin.html"));
}

function closeWindow(): void {
  if (!win || win.isDestroyed()) return;
  const w = win;
  win = null;
  // close() ends a modal session. destroy() leaves the main window unable to take input.
  w.close();
}
