import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

const DEFAULT_STATE: WindowState = {
  width: 1200,
  height: 800,
  isMaximized: false,
};

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
    const isMaximized = win.isMaximized();
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
    const next: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized,
    };
    try {
      fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
      fs.writeFileSync(windowStatePath(), JSON.stringify(next));
    } catch (error) {
      console.error("Could not save window size", error);
    }
  };

  let timer: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 250);
  };

  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
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
  };

  const x = typeof record.x === "number" ? record.x : undefined;
  const y = typeof record.y === "number" ? record.y : undefined;
  if (x === undefined || y === undefined) return state;
  if (!onSomeDisplay({ x, y, width, height })) return state;

  state.x = x;
  state.y = y;
  return state;
}

function finiteInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return Math.round(value);
}

function onSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const centerX = bounds.x + Math.min(bounds.width, 80);
    const centerY = bounds.y + 20;
    return (
      centerX >= area.x &&
      centerX < area.x + area.width &&
      centerY >= area.y &&
      centerY < area.y + area.height
    );
  });
}
