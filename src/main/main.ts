import path from "node:path";
import { app } from "electron";
import { debuggerLaunchArgs, hasDebuggerFlag } from "./launch-guard";
import { installMenu } from "./menu";
import { desktopUserAgent } from "./user-agent";
import {
  configureSession,
  createMainWindow,
  focusMain,
  getMainWindow,
  openDeepLink,
  rememberDeepLink,
  takeInitialUrl,
} from "./shell";
import { setupAutoUpdater } from "./updater";

// Keep the session folder from before the display name became Keplar One.
app.setPath("userData", path.join(app.getPath("appData"), "Keplar"));
app.userAgentFallback = desktopUserAgent(app.userAgentFallback);
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess");

const refused =
  app.isPackaged &&
  hasDebuggerFlag(debuggerLaunchArgs(process.argv, process.execArgv, process.env.NODE_OPTIONS ?? ""));

if (refused) {
  console.error("Refusing to start with a debugger port");
  app.exit(1);
} else {
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
      installMenu();

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
}
