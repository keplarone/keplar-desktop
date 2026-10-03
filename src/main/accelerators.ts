/**
 * Keyboard shortcuts that stay available after the visible menu bar is removed.
 * Copy, paste, and undo are left to the macOS Edit menu or to Chromium.
 */

export interface AcceleratorInput {
  type: string;
  key: string;
  code: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  isAutoRepeat?: boolean;
}

export type AcceleratorAction =
  | "reload"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "fullscreen"
  | "exitFullscreen"
  | "devtools";

export function acceleratorAction(
  input: AcceleratorInput,
  platform: NodeJS.Platform,
  devTools: boolean,
  fullscreen = false,
): AcceleratorAction | "blocked" | null {
  if (input.type !== "keyDown") return null;

  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const primary = platform === "darwin" ? input.meta : input.control && !input.meta;
  const devtoolsChord =
    key === "F12" ||
    (primary && input.shift && !input.alt && key === "i") ||
    (platform === "darwin" && input.meta && input.alt && !input.shift && key === "i");

  if (devtoolsChord) {
    if (!devTools || input.isAutoRepeat) return "blocked";
    return "devtools";
  }

  if (key === "Escape" && !input.alt && !input.control && !input.meta && !input.shift) {
    return fullscreen && !input.isAutoRepeat ? "exitFullscreen" : null;
  }

  if (input.isAutoRepeat) {
    if (isZoom(input, key, primary)) return zoomAction(input, key, primary);
    return null;
  }

  if (!input.alt && !input.control && !input.meta && !input.shift && key === "F5") {
    return "reload";
  }
  if (primary && !input.alt && key === "r") return "reload";

  if (platform === "darwin" && input.meta && input.control && !input.alt && key === "f") {
    return "fullscreen";
  }
  if (platform !== "darwin" && key === "F11" && !input.control && !input.meta && !input.alt) {
    return "fullscreen";
  }

  return zoomAction(input, key, primary);
}

function isZoom(input: AcceleratorInput, key: string, primary: boolean): boolean {
  return zoomAction(input, key, primary) !== null;
}

function zoomAction(
  input: AcceleratorInput,
  key: string,
  primary = input.control || input.meta,
): AcceleratorAction | null {
  if (!primary || input.alt) return null;
  if (key === "0" || input.code === "Digit0" || input.code === "Numpad0") {
    if (input.shift) return null;
    return "resetZoom";
  }
  if (
    key === "+" ||
    key === "=" ||
    input.code === "Equal" ||
    input.code === "NumpadAdd"
  ) {
    return "zoomIn";
  }
  if (
    key === "-" ||
    key === "_" ||
    input.code === "Minus" ||
    input.code === "NumpadSubtract"
  ) {
    return "zoomOut";
  }
  return null;
}
