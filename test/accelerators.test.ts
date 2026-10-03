import assert from "node:assert/strict";
import { test } from "node:test";
import { acceleratorAction, type AcceleratorInput } from "../src/main/accelerators.ts";

function press(partial: Partial<AcceleratorInput>): AcceleratorInput {
  return {
    type: "keyDown",
    key: "",
    code: "",
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...partial,
  };
}

test("reload, zoom, and fullscreen shortcuts", () => {
  assert.equal(acceleratorAction(press({ key: "r", code: "KeyR", control: true }), "win32", false), "reload");
  assert.equal(acceleratorAction(press({ key: "r", code: "KeyR", meta: true }), "darwin", false), "reload");
  assert.equal(acceleratorAction(press({ key: "F5", code: "F5" }), "linux", false), "reload");
  assert.equal(acceleratorAction(press({ key: "=", code: "Equal", control: true }), "win32", false), "zoomIn");
  assert.equal(acceleratorAction(press({ key: "+", code: "Equal", control: true, shift: true }), "linux", false), "zoomIn");
  assert.equal(acceleratorAction(press({ key: "-", code: "Minus", meta: true }), "darwin", false), "zoomOut");
  assert.equal(acceleratorAction(press({ key: "0", code: "Digit0", control: true }), "win32", false), "resetZoom");
  assert.equal(acceleratorAction(press({ key: "F11", code: "F11" }), "win32", false), "fullscreen");
  assert.equal(
    acceleratorAction(press({ key: "f", code: "KeyF", meta: true, control: true }), "darwin", false),
    "fullscreen",
  );
});

test("copy and paste are not intercepted", () => {
  assert.equal(acceleratorAction(press({ key: "c", code: "KeyC", control: true }), "win32", false), null);
  assert.equal(acceleratorAction(press({ key: "v", code: "KeyV", meta: true }), "darwin", false), null);
  assert.equal(acceleratorAction(press({ key: "z", code: "KeyZ", control: true }), "linux", false), null);
});

test("devtools stay off unless the build allows them", () => {
  const f12 = press({ key: "F12", code: "F12" });
  assert.equal(acceleratorAction(f12, "win32", false), "blocked");
  assert.equal(acceleratorAction(f12, "win32", true), "devtools");
  const chord = press({ key: "i", code: "KeyI", control: true, shift: true });
  assert.equal(acceleratorAction(chord, "linux", false), "blocked");
  assert.equal(acceleratorAction(chord, "linux", true), "devtools");
});

test("find and repeated reload are left alone", () => {
  assert.equal(acceleratorAction(press({ key: "f", code: "KeyF", control: true }), "win32", false), null);
  assert.equal(
    acceleratorAction(press({ key: "r", code: "KeyR", control: true, isAutoRepeat: true }), "win32", false),
    null,
  );
});
