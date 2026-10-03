import {
  app,
  dialog,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";

export interface MenuActions {
  getWindow: () => BrowserWindow | null;
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
  checkForUpdates: () => void;
}

export function installMenu(actions: MenuActions): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { label: "About Keplar", click: () => showAbout(actions.getWindow()) },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push({
    label: "File",
    submenu: [
      isMac ? { role: "close" } : { role: "quit" },
    ],
  });

  template.push({ role: "editMenu" });

  template.push({
    label: "View",
    submenu: [
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        click: () => actions.reload(),
      },
      {
        label: "Back",
        accelerator: isMac ? "Cmd+[" : "Alt+Left",
        click: () => actions.goBack(),
      },
      {
        label: "Forward",
        accelerator: isMac ? "Cmd+]" : "Alt+Right",
        click: () => actions.goForward(),
      },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  });

  template.push({ role: "windowMenu" });

  const helpSubmenu: MenuItemConstructorOptions[] = [
    {
      label: "Keplar on the web",
      click: () => {
        void shell.openExternal("https://keplar.one");
      },
    },
    {
      label: "Check for Updates…",
      click: () => actions.checkForUpdates(),
    },
  ];
  if (!isMac) {
    helpSubmenu.push(
      { type: "separator" },
      { label: "About Keplar", click: () => showAbout(actions.getWindow()) },
    );
  }
  template.push({ label: "Help", submenu: helpSubmenu });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout(parent: BrowserWindow | null): void {
  const options = {
    type: "info" as const,
    title: "About Keplar",
    message: "Keplar",
    detail: [
      `Version ${app.getVersion()}`,
      "",
      "One question. Multiple intelligences. One answer.",
      "",
      "This desktop app is a window onto https://keplar.one.",
      "Questions and answers stay on Keplar's servers.",
    ].join("\n"),
    buttons: ["OK"],
  };
  if (parent && !parent.isDestroyed()) {
    void dialog.showMessageBox(parent, options);
    return;
  }
  void dialog.showMessageBox(options);
}
