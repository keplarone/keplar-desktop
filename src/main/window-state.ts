import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fitSizeToWorkArea, fitToWorkArea, shouldPersistBounds } from "./bounds";

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
  isFullScreen: boolean;
}

const DEFAULT_STATE: WindowState = {
  width: 1200,
  height: 800,
  isMaximized: false,
  isFullScreen: false,
};

let frameBeforeFullscreen: { bounds: Rectangle; maximized: boolean } | null = null;

export function captureFrameForFullscreen(win: BrowserWindow, maximized = win.isMaximized()): void {
  if (win.isDestroyed() || win.isFullScreen()) return;
  const bounds = maximized ? win.getNormalBounds() : win.getBounds();
  frameBeforeFullscreen = {
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    maximized,
  };
}

export function ensureFullscreenFrame(win: BrowserWindow): void {
  if (frameBeforeFullscreen || win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  frameBeforeFullscreen = {
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    maximized: false,
  };
}

export function takeFullscreenRestore(): { bounds: Rectangle; maximized: boolean } | null {
  const frame = frameBeforeFullscreen;
  frameBeforeFullscreen = null;
  return frame;
}

const MIN_WIDTH = 720;
const MIN_HEIGHT = 560;

export function windowStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

export function loadWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(windowStatePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const state = sanitize(parsed);
    return state ?? { ...DEFAULT_STATE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function trackWindowState(win: BrowserWindow): void {
  const save = (): void => {
    if (win.isDestroyed()) return;
    const isFullScreen = win.isFullScreen();
    if (!shouldPersistBounds(isFullScreen, frameBeforeFullscreen !== null)) return;
    const isMaximized = !isFullScreen && win.isMaximized();
    const bounds = isFullScreen
      ? (frameBeforeFullscreen?.bounds ?? win.getNormalBounds())
      : isMaximized
        ? win.getNormalBounds()
        : win.getBounds();
    writeWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: isFullScreen ? (frameBeforeFullscreen?.maximized ?? false) : isMaximized,
      isFullScreen,
    });
  };

  let timer: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 250);
  };

  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  win.on("enter-full-screen", schedule);
  win.on("leave-full-screen", schedule);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    if (!win.isDestroyed() && frameBeforeFullscreen && !win.isFullScreen()) {
      const frame = frameBeforeFullscreen;
      frameBeforeFullscreen = null;
      writeWindowState({
        width: frame.bounds.width,
        height: frame.bounds.height,
        x: frame.bounds.x,
        y: frame.bounds.y,
        isMaximized: frame.maximized,
        isFullScreen: false,
      });
      return;
    }
    save();
  });
}

function writeWindowState(next: WindowState): void {
  try {
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify(next));
  } catch (error) {
    console.error("Could not save window size", error);
  }
}

export const windowMinimums = { minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT };

function sanitize(value: unknown): WindowState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const width = finiteInRange(record.width, MIN_WIDTH, 10000);
  const height = finiteInRange(record.height, MIN_HEIGHT, 10000);
  if (width === null || height === null) return null;

  const state: WindowState = {
    width,
    height,
    isMaximized: record.isMaximized === true,
    isFullScreen: record.isFullScreen === true,
  };

  const x = typeof record.x === "number" ? record.x : undefined;
  const y = typeof record.y === "number" ? record.y : undefined;
  if (x === undefined || y === undefined) return limitToPrimary(state);
  const area = displayFor({ x, y, width, height });
  if (!area) return limitToPrimary(state);

  // Keep the whole window inside the usable screen (above the taskbar), not just its top-left corner.
  const fitted = fitToWorkArea({ x, y, width, height }, area);
  state.width = Math.max(Math.min(fitted.width, state.width), Math.min(MIN_WIDTH, area.width));
  state.height = Math.max(Math.min(fitted.height, state.height), Math.min(MIN_HEIGHT, area.height));
  state.x = fitted.x;
  state.y = fitted.y;
  return state;
}

function finiteInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return Math.round(value);
}

function limitToPrimary(state: WindowState): WindowState {
  const size = fitSizeToWorkArea(state, screen.getPrimaryDisplay().workArea);
  state.width = size.width;
  state.height = size.height;
  return state;
}

function displayFor(bounds: Rectangle): Rectangle | null {
  for (const display of screen.getAllDisplays()) {
    const area = display.workArea;
    const centerX = bounds.x + Math.min(bounds.width, 80);
    const centerY = bounds.y + 20;
    if (centerX >= area.x && centerX < area.x + area.width && centerY >= area.y && centerY < area.y + area.height) return area;
  }
  return null;
}
