import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHROME_COLOR,
  mainWindowChrome,
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
});

test("controls are raised with zero specificity so a site's own position (for example a floating button) wins", () => {
  const css = windowDragCss();
  assert.match(css, /:where\(a, button[^)]*\)\s*\{\s*position: relative;\s*z-index: 2;/);
  // the no-drag rule itself must not carry position
  const noDrag = css.match(/:is\(a, button[^{]*\{([^}]*)\}/);
  assert.ok(noDrag);
  assert.doesNotMatch(noDrag[1], /position/);
});
