import { app, dialog, type BrowserWindow } from "electron";
import { autoUpdater, type Logger } from "electron-updater";

const logger: Logger = {
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  debug: (message) => console.debug(message),
};

let checkInFlight = false;

/**
 * Updates are published as GitHub Releases.
 * electron-updater can install them on Windows and on Linux AppImages without
 * a certificate. macOS applies an update only when this app is code-signed.
 */
export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = logger;

  autoUpdater.on("error", (error) => {
    console.error("Auto-update error", error);
  });

  autoUpdater.on("update-downloaded", () => {
    const detail =
      process.platform === "darwin"
        ? "Restart to finish installing it. macOS applies this only for a code-signed app; an unsigned copy has to be updated by downloading the new release."
        : "Restart to finish installing it, or quit later and it will install then.";
    const options = {
      type: "info" as const,
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Keplar One",
      message: "An update to Keplar One has been downloaded.",
      detail,
    };
    const parent = getWindow();
    const pending =
      parent && !parent.isDestroyed()
        ? dialog.showMessageBox(parent, options)
        : dialog.showMessageBox(options);
    void pending.then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  // The first page load should not share the network with a GitHub release check.
  const timer = setTimeout(() => {
    void checkForUpdates(false);
  }, 15_000);
  timer.unref?.();
}

export async function checkForUpdates(interactive: boolean): Promise<void> {
  if (!app.isPackaged) {
    if (interactive) {
      await dialog.showMessageBox({
        type: "info",
        title: "Keplar One",
        message: "Updates are checked from installed builds.",
        detail:
          "This copy is running from source, so there is no published release to compare it with.",
      });
    }
    return;
  }

  if (checkInFlight) return;
  checkInFlight = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (interactive && result && !result.isUpdateAvailable) {
      await dialog.showMessageBox({
        type: "info",
        title: "Keplar One",
        message: "You're up to date.",
        detail: `Keplar One ${app.getVersion()} is the newest release this app could find.`,
      });
    }
  } catch {
    if (interactive) {
      await dialog.showMessageBox({
        type: "warning",
        title: "Keplar One",
        message: "Couldn't check for updates.",
        detail:
          "The app will try again the next time it starts, if it can reach GitHub.",
      });
    }
  } finally {
    checkInFlight = false;
  }
}
