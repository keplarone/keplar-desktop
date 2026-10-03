/** Window chrome for a hidden title bar. The in-app theme color is #0b0b0d. */

export const APP_TITLE = "Keplar One";
export const CHROME_COLOR = "#0b0b0d";
export const CHROME_SYMBOL = "#f4f4f5";
export const TITLEBAR_HEIGHT = 36;

export interface TitleBarOverlayOptions {
  color: string;
  symbolColor: string;
  height: number;
}

export interface MainWindowChrome {
  title: string;
  backgroundColor: string;
  titleBarStyle: "hidden";
  titleBarOverlay: TitleBarOverlayOptions;
  autoHideMenuBar: false;
  trafficLightPosition?: { x: number; y: number };
}

export function mainWindowChrome(platform: NodeJS.Platform): MainWindowChrome {
  const chrome: MainWindowChrome = {
    title: APP_TITLE,
    backgroundColor: CHROME_COLOR,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: CHROME_COLOR,
      symbolColor: CHROME_SYMBOL,
      height: TITLEBAR_HEIGHT,
    },
    autoHideMenuBar: false,
  };
  if (platform === "darwin") {
    chrome.trafficLightPosition = { x: 16, y: 10 };
  }
  return chrome;
}

/**
 * A drag strip under the hidden title bar. On macOS it starts after the
 * traffic lights. On Windows and Linux it stops before the overlay buttons.
 */
export function windowDragCss(platform: NodeJS.Platform): string {
  const height = `${TITLEBAR_HEIGHT}px`;
  const left = platform === "darwin" ? "env(titlebar-area-x, 76px)" : "env(titlebar-area-x, 0px)";
  const width =
    platform === "darwin"
      ? "env(titlebar-area-width, calc(100% - 76px))"
      : "env(titlebar-area-width, calc(100% - 140px))";
  return `
    :root { --keplar-titlebar: ${height}; }
    html { background: ${CHROME_COLOR}; }
    body::before {
      content: "";
      position: fixed;
      z-index: 2147483646;
      top: env(titlebar-area-y, 0px);
      left: ${left};
      width: ${width};
      height: env(titlebar-area-height, var(--keplar-titlebar));
      -webkit-app-region: drag;
      background: ${CHROME_COLOR};
    }
    #main {
      margin-top: var(--keplar-titlebar) !important;
      height: calc(100vh - var(--keplar-titlebar)) !important;
      box-sizing: border-box !important;
    }
    #keplar-sidebar {
      top: var(--keplar-titlebar) !important;
      height: calc(100vh - var(--keplar-titlebar)) !important;
    }
    [data-placement="top"] {
      top: var(--keplar-titlebar) !important;
    }
  `;
}
