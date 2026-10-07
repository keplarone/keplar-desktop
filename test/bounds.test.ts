import assert from "node:assert/strict";
import { test } from "node:test";
import { fitSizeToWorkArea, fitToWorkArea, shouldPersistBounds } from "../src/main/bounds.ts";

// 1920x1080 screen with a 40px taskbar: work area 1920x1040.
const area = { x: 0, y: 0, width: 1920, height: 1040 };

test("a window saved at full screen height is cut to the work area so its bottom (the composer) is not under the taskbar", () => {
  assert.deepEqual(fitToWorkArea({ x: 0, y: 0, width: 1920, height: 1080 }, area), { x: 0, y: 0, width: 1920, height: 1040 });
});

test("a window hanging off the bottom or right edge is moved back inside", () => {
  assert.deepEqual(fitToWorkArea({ x: 900, y: 700, width: 1200, height: 800 }, area), { x: 720, y: 240, width: 1200, height: 800 });
  assert.deepEqual(fitToWorkArea({ x: -50, y: -20, width: 1000, height: 700 }, area), { x: 0, y: 0, width: 1000, height: 700 });
});

test("a window that already fits is untouched, including on a second display with an offset", () => {
  const b = { x: 2000, y: 100, width: 1000, height: 700 };
  const second = { x: 1920, y: 0, width: 2560, height: 1400 };
  assert.deepEqual(fitToWorkArea(b, second), b);
});

test("size only", () => {
  assert.deepEqual(fitSizeToWorkArea({ width: 2400, height: 1300 }, area), { width: 1920, height: 1040 });
});

test("a window stretched to the display before fullscreen flips is not saved", () => {
  assert.equal(shouldPersistBounds(false, true), false);
  assert.equal(shouldPersistBounds(true, true), true);
  assert.equal(shouldPersistBounds(false, false), true);
});
