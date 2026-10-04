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
  fullscreenable: true;
  trafficLightPosition?: { x: number; y: number };
}

export function mainWindowChrome(platform: NodeJS.Platform): MainWindowChrome {
  const chrome: MainWindowChrome = {
    title: APP_TITLE,
    backgroundColor: CHROME_COLOR,
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarOverlay(false),
    autoHideMenuBar: false,
    fullscreenable: true,
  };
  if (platform === "darwin") {
    chrome.trafficLightPosition = { x: 16, y: 10 };
  }
  return chrome;
}

export function titleBarOverlay(fullscreen: boolean): TitleBarOverlayOptions {
  if (fullscreen) {
    return { color: "#00000000", symbolColor: "#00000000", height: 0 };
  }
  return { color: CHROME_COLOR, symbolColor: CHROME_SYMBOL, height: TITLEBAR_HEIGHT };
}

/**
 * The Window Controls Overlay exposes env(titlebar-area-x/y/width/height).
 * The drag layer covers only that band. Links and buttons sit above it, so
 * the site nav stays clickable and empty space in the band still drags.
 */
export function windowDragCss(): string {
  return `
    :root {
      --titlebar-area-x: env(titlebar-area-x, 0px);
      --titlebar-area-y: env(titlebar-area-y, 0px);
      --titlebar-area-width: env(titlebar-area-width, 100%);
      --titlebar-area-height: env(titlebar-area-height, 0px);
    }
    html { background: ${CHROME_COLOR}; }
    html::before {
      content: "";
      position: fixed;
      z-index: 1;
      top: var(--titlebar-area-y);
      left: var(--titlebar-area-x);
      width: var(--titlebar-area-width);
      height: var(--titlebar-area-height);
      -webkit-app-region: drag;
      background: transparent;
    }
    :is(a, button, input, textarea, select, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"]) {
      -webkit-app-region: no-drag;
    }
    /* Raise controls above the drag layer, but with zero specificity (:where): a site rule such as .jump { position: absolute }
       must win. Before 0.1.5 this forced position: relative onto every button and link and broke floating buttons. */
    :where(a, button, input, textarea, select, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"]) {
      position: relative;
      z-index: 2;
    }
    [data-keplar-drag] { -webkit-app-region: drag; }
    [data-keplar-drag] :is(a, button, input, textarea, select, label, [role="button"], [role="link"]) {
      -webkit-app-region: no-drag;
    }
  `;
}

export function fullscreenHideCss(): string {
  return `
    html::before, body::before {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
      -webkit-app-region: no-drag !important;
    }
  `;
}
