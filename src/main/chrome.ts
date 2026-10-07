/** Window chrome for a hidden title bar. Dark matches the app; light is a warm paper so the aura stays readable. */

export const APP_TITLE = "Keplar One";
export const CHROME_COLOR = "#0b0b0d";
export const CHROME_SYMBOL = "#f4f4f5";
export const LIGHT_CHROME_COLOR = "#f7f6f3";
export const LIGHT_CHROME_SYMBOL = "#1c1d22";
export const LIGHT_INK = "#141518";
export const LIGHT_INK_2 = "#3a3d44";
export const LIGHT_INK_3 = "#4a4d55";
export const TITLEBAR_HEIGHT = 36;

export type AppTheme = "light" | "dark";

export function parseAppTheme(value: unknown): AppTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function chromePalette(theme: AppTheme): { background: string; symbol: string } {
  if (theme === "light") return { background: LIGHT_CHROME_COLOR, symbol: LIGHT_CHROME_SYMBOL };
  return { background: CHROME_COLOR, symbol: CHROME_SYMBOL };
}

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

export function mainWindowChrome(platform: NodeJS.Platform, theme: AppTheme = "dark"): MainWindowChrome {
  const palette = chromePalette(theme);
  const chrome: MainWindowChrome = {
    title: APP_TITLE,
    backgroundColor: palette.background,
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarOverlay(false, theme),
    autoHideMenuBar: false,
    fullscreenable: true,
  };
  if (platform === "darwin") {
    chrome.trafficLightPosition = { x: 16, y: 10 };
  }
  return chrome;
}

export function titleBarOverlay(fullscreen: boolean, theme: AppTheme = "dark"): TitleBarOverlayOptions {
  if (fullscreen) {
    return { color: "#00000000", symbolColor: "#00000000", height: 0 };
  }
  const palette = chromePalette(theme);
  return { color: palette.background, symbolColor: palette.symbol, height: TITLEBAR_HEIGHT };
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
    /* Longhand only. The background shorthand would wipe the light-mode aura image.
       The canvas token follows the page, so light text is not drawn on this dark fallback. */
    html:is(.keplar-desktop, [data-keplar-desktop]) {
      background-color: var(--c-canvas, ${CHROME_COLOR});
    }
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
    /* The top bar is pointer-events: none so clicks fall through it. That also skips
       the drag region, so the window cannot be dragged from the bar. */
    html:is(.keplar-desktop, [data-keplar-desktop]) [data-keplar-drag] {
      pointer-events: auto;
    }
    /* keplar.one's desktop rules call env() with CSS-module-hashed names, so the real
       titlebar-area-* values never apply and the window controls cover the bar. */
    html:is(.keplar-desktop, [data-keplar-desktop]) header[data-keplar-drag] {
      padding-right: max(var(--s-6, 1.5rem), calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + var(--s-3, 0.75rem)));
    }
    html:is(.keplar-desktop, [data-keplar-desktop]) :is(div, aside)[data-keplar-drag] {
      padding-left: max(var(--s-2, 0.5rem), env(titlebar-area-x, 0px));
    }
    html:is(.keplar-desktop, [data-keplar-desktop]) header.m-vt-nav {
      padding-left: calc(env(titlebar-area-x, 0px) + var(--s-3, 0.75rem));
      padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + var(--s-3, 0.75rem));
      top: max(6px, calc((env(titlebar-area-height, 0px) - var(--l-nav-h, 40px)) / 2 + 6px));
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
    [data-keplar-drag] {
      -webkit-app-region: no-drag !important;
    }
  `;
}

/**
 * Light mode on keplar.one is the default token set, but the desktop shell used to
 * paint html dark, so dark text sat on #0b0b0d. The app shell itself is transparent
 * and the ambient orbs are drawn with an empty background, so this sheet restores
 * a warm, high-contrast canvas and a soft corner aura (peach, violet, cyan, gold)
 * behind the page. Dark mode is untouched.
 */
const LIGHT_AURA_IMAGE = [
  "radial-gradient(46vmax 40vmax at 22% -8%, rgba(255, 156, 122, 0.7), transparent 68%)",
  "radial-gradient(44vmax 40vmax at 96% 0%, rgba(168, 146, 255, 0.55), transparent 66%)",
  "radial-gradient(42vmax 36vmax at 70% 108%, rgba(98, 198, 214, 0.5), transparent 70%)",
  "radial-gradient(38vmax 34vmax at 40% 100%, rgba(255, 196, 140, 0.48), transparent 72%)",
].join(", ");

export function lightAuraCss(): string {
  return `
    html[data-theme="light"]:is(.keplar-desktop, [data-keplar-desktop]) {
      color-scheme: light;
      --c-canvas: ${LIGHT_CHROME_COLOR};
      --c-surface-1: #fffcf8;
      --c-surface-2: #f1eee8;
      --c-ink: ${LIGHT_INK};
      --c-ink-2: ${LIGHT_INK_2};
      --c-ink-3: ${LIGHT_INK_3};
      --c-ink-hover: #0c0d10;
      --c-border: #1415182b;
      --c-border-strong: #14151847;
      --c-glass: #fffcf8e0;
      --c-glass-strong: #fffcf8f5;
      --c-glass-border: #14151824;
      --c-accent: #075e6c;
      --c-focus: #075e6c;
      --c-reasoning: #075e6c;
      --lg-fill: #fffcf8e6;
      --lg-fill-strong: #fffcf8f5;
      --lg-card: #fffcf8f0;
      --lg-wash: ${LIGHT_AURA_IMAGE}, ${LIGHT_CHROME_COLOR};
      --nav-link: ${LIGHT_INK_2};
      --nav-link-2: ${LIGHT_INK_3};
    }
    /* Static gradients. An infinite background animation, a fixed attachment, or a
       blur on a viewport-sized orb repaints the whole window while the page scrolls. */
    html[data-theme="light"]:is(.keplar-desktop, [data-keplar-desktop]),
    html[data-theme="light"][data-field]:is(.keplar-desktop, [data-keplar-desktop]) {
      background-color: ${LIGHT_CHROME_COLOR};
      background-image: ${LIGHT_AURA_IMAGE};
      background-repeat: no-repeat;
      background-size: 150% 150%;
    }
    @media (prefers-reduced-motion: reduce), (prefers-contrast: more), (forced-colors: active) {
      html[data-theme="light"]:is(.keplar-desktop, [data-keplar-desktop]),
      html[data-theme="light"][data-field]:is(.keplar-desktop, [data-keplar-desktop]) {
        background-image: none;
        --lg-wash: ${LIGHT_CHROME_COLOR};
      }
    }
    html:is(.keplar-desktop, [data-keplar-desktop]) .ambient,
    html:is(.keplar-desktop, [data-keplar-desktop]) .ambient i {
      will-change: auto;
    }
    /* Marketing orbs exist, but their background is empty, so light mode shows nothing. */
    html[data-theme="light"]:is(.keplar-desktop, [data-keplar-desktop]) .ambient i:first-child {
      background: radial-gradient(circle, rgba(255, 156, 122, 0.9), transparent 68%);
    }
    html[data-theme="light"]:is(.keplar-desktop, [data-keplar-desktop]) .ambient i:nth-child(2) {
      background: radial-gradient(circle, rgba(168, 146, 255, 0.85), transparent 68%);
    }
    html[data-theme="light"]:is(.keplar-desktop, [data-keplar-desktop]) .ambient i:nth-child(3) {
      background: radial-gradient(circle, rgba(98, 198, 214, 0.8), transparent 70%);
    }
    html[data-theme="light"]:is(.keplar-desktop, [data-keplar-desktop]) :is(textarea, [contenteditable="true"]):focus-visible {
      box-shadow:
        0 0 0 1px rgba(20, 21, 24, 0.08),
        0 14px 44px -10px rgba(255, 150, 120, 0.55),
        0 18px 64px -18px rgba(150, 130, 255, 0.42);
    }
    html[data-theme="light"]:is(.keplar-desktop, [data-keplar-desktop]) :is(input, textarea)::placeholder {
      color: ${LIGHT_INK_3};
      opacity: 1;
    }
    html[data-theme="light"]:is(.keplar-desktop, [data-keplar-desktop]) ::selection {
      background: rgba(255, 164, 132, 0.45);
      color: ${LIGHT_INK};
    }
  `;
}
