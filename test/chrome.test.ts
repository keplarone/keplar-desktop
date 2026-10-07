import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHROME_COLOR,
  LIGHT_CHROME_COLOR,
  LIGHT_CHROME_SYMBOL,
  LIGHT_INK,
  LIGHT_INK_2,
  LIGHT_INK_3,
  chromePalette,
  fullscreenHideCss,
  lightAuraCss,
  mainWindowChrome,
  parseAppTheme,
  titleBarOverlay,
  windowDragCss,
} from "../src/main/chrome.ts";

test("hidden title bar uses a dark overlay and a drag strip", () => {
  const win = mainWindowChrome("win32");
  assert.equal(win.title, "Keplar One");
  assert.equal(win.titleBarStyle, "hidden");
  assert.equal(win.titleBarOverlay.color, CHROME_COLOR);
  assert.equal(win.titleBarOverlay.symbolColor, "#f4f4f5");
  assert.equal(win.autoHideMenuBar, false);
  assert.equal(win.trafficLightPosition, undefined);

  const mac = mainWindowChrome("darwin");
  assert.deepEqual(mac.trafficLightPosition, { x: 16, y: 10 });
  assert.equal(titleBarOverlay(true).height, 0);
  assert.equal(titleBarOverlay(false).height, 36);

  const css = windowDragCss();
  assert.match(css, /env\(titlebar-area-x,/);
  assert.match(css, /env\(titlebar-area-width,/);
  assert.match(css, /env\(titlebar-area-height,/);
  assert.match(css, /-webkit-app-region:\s*drag/);
  assert.match(css, /-webkit-app-region:\s*no-drag/);
  assert.doesNotMatch(css, /#main/);
  assert.match(css, new RegExp(CHROME_COLOR));
  assert.match(css, /background-color:\s*var\(--c-canvas,/);
  assert.doesNotMatch(css, /html\s*\{\s*background:\s*#0b0b0d/);
});

test("light mode keeps dark text on a warm canvas and paints a corner aura", () => {
  assert.equal(parseAppTheme("light"), "light");
  assert.equal(parseAppTheme("dark"), "dark");
  assert.equal(parseAppTheme("blue"), null);
  assert.deepEqual(chromePalette("light"), { background: LIGHT_CHROME_COLOR, symbol: LIGHT_CHROME_SYMBOL });
  assert.equal(chromePalette("dark").background, CHROME_COLOR);

  const win = mainWindowChrome("darwin", "light");
  assert.equal(win.backgroundColor, LIGHT_CHROME_COLOR);
  assert.equal(win.titleBarOverlay.color, LIGHT_CHROME_COLOR);
  assert.equal(win.titleBarOverlay.symbolColor, LIGHT_CHROME_SYMBOL);
  assert.equal(titleBarOverlay(true, "light").height, 0);
  assert.equal(titleBarOverlay(false, "light").symbolColor, LIGHT_CHROME_SYMBOL);

  const css = lightAuraCss();
  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, new RegExp(LIGHT_CHROME_COLOR));
  assert.match(css, new RegExp(LIGHT_INK));
  assert.match(css, new RegExp(LIGHT_INK_2));
  assert.match(css, new RegExp(LIGHT_INK_3));
  assert.match(css, /radial-gradient\(46vmax/);
  assert.match(css, /rgba\(168, 146, 255/);
  assert.match(css, /rgba\(98, 198, 214/);
  assert.match(css, /\.ambient i:nth-child\(2\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /prefers-contrast:\s*more/);
  assert.match(css, /will-change:\s*auto/);
  assert.doesNotMatch(css, /keplar-light-aura/);
  assert.doesNotMatch(css, /filter:\s*blur/);
  assert.doesNotMatch(css, /background-attachment:\s*fixed/);
  assert.doesNotMatch(css, /#0b0b0d/);
  assert.doesNotMatch(css, /data-theme="dark"/);
});

test("controls are raised with zero specificity so a site's own position (for example a floating button) wins", () => {
  const css = windowDragCss();
  assert.match(css, /:where\(a, button[^)]*\)\s*\{\s*position: relative;\s*z-index: 2;/);
  // the no-drag rule itself must not carry position
  const noDrag = css.match(/:is\(a, button[^{]*\{([^}]*)\}/);
  assert.ok(noDrag);
  assert.doesNotMatch(noDrag[1], /position/);
});

test("titlebar insets use the real env() names so window controls do not cover the page", () => {
  const css = windowDragCss();
  assert.match(css, /header\[data-keplar-drag\]/);
  assert.match(css, /env\(titlebar-area-x, 0px\)/);
  assert.match(css, /env\(titlebar-area-width, 100vw\)/);
  assert.match(css, /env\(titlebar-area-height, 0px\)/);
  assert.match(css, /pointer-events:\s*auto/);
  assert.doesNotMatch(css, /env\([^)]*titlebar-area-x__/);
  assert.match(fullscreenHideCss(), /\[data-keplar-drag\][\s\S]*-webkit-app-region:\s*no-drag !important/);
});
