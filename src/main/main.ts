import { app } from "electron";
import { installMenu } from "./menu";
import {
  configureSession,
  createMainWindow,
  focusMain,
  getMainWindow,
  goBack,
  goForward,
  openDeepLink,
  reloadMain,
  rememberDeepLink,
  takeInitialUrl,
} from "./shell";
import { checkForUpdates, setupAutoUpdater } from "./updater";

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith("keplar://"));
    if (link) openDeepLink(link);
    else focusMain();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) openDeepLink(url);
    else rememberDeepLink(url);
  });

  void app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("one.keplar.desktop");
    }
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient("keplar");
    }

    configureSession();
    installMenu({
      getWindow: getMainWindow,
      reload: reloadMain,
      goBack,
      goForward,
      checkForUpdates: () => {
        void checkForUpdates(true);
      },
    });

    const initialUrl = takeInitialUrl(process.argv);
    await createMainWindow(initialUrl);
    setupAutoUpdater(getMainWindow);

    app.on("activate", () => {
      if (!getMainWindow()) void createMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
