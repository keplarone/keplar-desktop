import {
  app,
  dialog,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import {
  acceleratorAction,
  type AcceleratorAction,
  type AcceleratorInput,
} from "./accelerators";
import { APP_TITLE } from "./chrome";
import { exitMainFullscreen, toggleMainFullscreen } from "./shell";

const ZOOM_MIN = -3.8;
const ZOOM_MAX = 6;

export function installMenu(): void {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate(macTemplate()));
    return;
  }
  Menu.setApplicationMenu(null);
}

export function bindAccelerators(
  win: BrowserWindow,
  actions: { reload: () => void },
): void {
  win.setMenuBarVisibility(false);
  if (process.platform !== "darwin") win.setMenu(null);

  win.webContents.on("before-input-event", (event, input) => {
    const action = acceleratorAction(
      input as AcceleratorInput,
      process.platform,
      !app.isPackaged,
      win.isFullScreen(),
    );
    if (!action) return;
    event.preventDefault();
    if (action === "blocked") return;
    runAccelerator(win, action, actions.reload);
  });
}

function runAccelerator(
  win: BrowserWindow,
  action: AcceleratorAction,
  reload: () => void,
): void {
  if (win.isDestroyed()) return;
  const contents = win.webContents;
  if (action === "reload") {
    reload();
    return;
  }
  if (action === "zoomIn") {
    contents.setZoomLevel(clampZoom(contents.getZoomLevel() + 1));
    return;
  }
  if (action === "zoomOut") {
    contents.setZoomLevel(clampZoom(contents.getZoomLevel() - 1));
    return;
  }
  if (action === "resetZoom") {
    contents.setZoomLevel(0);
    return;
  }
  if (action === "fullscreen") {
    toggleMainFullscreen();
    return;
  }
  if (action === "exitFullscreen") {
    exitMainFullscreen();
    return;
  }
  if (action === "devtools" && !app.isPackaged) {
    contents.toggleDevTools();
  }
}

function clampZoom(level: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
}

function macTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: app.name,
      submenu: [
        { label: `About ${APP_TITLE}`, click: () => showAbout() },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
  ];
}

function showAbout(): void {
  void dialog.showMessageBox({
    type: "info",
    title: `About ${APP_TITLE}`,
    message: APP_TITLE,
    detail: [
      `Version ${app.getVersion()}`,
      "",
      "One question. Multiple intelligences. One answer.",
      "",
      "This desktop app is a window onto https://keplar.one.",
      "Questions and answers stay on Keplar's servers.",
    ].join("\n"),
    buttons: ["OK"],
  });
}
