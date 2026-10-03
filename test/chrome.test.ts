import assert from "node:assert/strict";
import { test } from "node:test";
import { CHROME_COLOR, mainWindowChrome, windowDragCss } from "../src/main/chrome.ts";

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

  const css = windowDragCss("linux");
  assert.match(css, /-webkit-app-region:\s*drag/);
  assert.match(css, new RegExp(CHROME_COLOR));
  assert.match(windowDragCss("darwin"), /titlebar-area-x, 76px/);
  assert.match(windowDragCss("win32"), /100% - 140px/);
});
