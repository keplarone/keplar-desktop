/**
 * Isolated preload for the Keplar window.
 *
 * contextIsolation is on, nodeIntegration is off, and the sandbox is on.
 * This file exposes nothing to the page: no Node.js, filesystem, shell, or
 * bridge the site can call. It marks the document so keplar.one can match
 * `html.keplar-desktop` and `[data-keplar-desktop]`, and it tells the shell
 * when `data-theme` changes so the title bar can follow light and dark.
 * Sign-in and product data stay on https://keplar.one.
 */
import { ipcRenderer } from "electron";
import { parseAppTheme, type AppTheme } from "../main/chrome";

const MARKER = "keplar-desktop";

interface MarkerRoot {
  classList: { add(token: string): void };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

interface MarkerDocument {
  documentElement: MarkerRoot | null;
  addEventListener(type: string, listener: () => void): void;
}

interface ThemeQuery {
  matches: boolean;
  addEventListener?(type: string, listener: () => void): void;
}

let watching = false;

function markDesktop(): void {
  const root = desktopDocument()?.documentElement;
  if (!root) return;
  root.classList.add(MARKER);
  root.setAttribute("data-keplar-desktop", "");
}

function desktopDocument(): MarkerDocument | undefined {
  return (globalThis as { document?: MarkerDocument }).document;
}

function isTopFrame(): boolean {
  try {
    const g = globalThis as { window?: object; top?: object };
    return g.window === g.top;
  } catch {
    return false;
  }
}

function pageProtocol(): string {
  return (globalThis as { location?: { protocol?: string } }).location?.protocol ?? "";
}

function systemTheme(): AppTheme {
  const match = (globalThis as { matchMedia?: (query: string) => ThemeQuery }).matchMedia?.(
    "(prefers-color-scheme: light)",
  );
  return match?.matches ? "light" : "dark";
}

function publishTheme(): void {
  if (!isTopFrame()) return;
  const root = desktopDocument()?.documentElement;
  if (!root) return;
  // Local shell pages have no theme of their own. Follow the operating system
  // so the loading, offline, and sign-in screens match the title bar.
  if (pageProtocol() === "file:" && root.getAttribute("data-theme") !== "light" && root.getAttribute("data-theme") !== "dark") {
    root.setAttribute("data-theme", systemTheme());
  }
  const theme = parseAppTheme(root.getAttribute("data-theme"));
  if (!theme) return;
  ipcRenderer.send("keplar:theme", theme);
}

function watchTheme(): void {
  publishTheme();
  if (watching) return;
  const root = desktopDocument()?.documentElement;
  const Observer = (
    globalThis as {
      MutationObserver?: new (callback: () => void) => {
        observe(target: object, options: { attributes: boolean; attributeFilter: string[] }): void;
      };
    }
  ).MutationObserver;
  if (!root || !Observer) return;
  watching = true;
  new Observer(() => publishTheme()).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  const media = (globalThis as { matchMedia?: (query: string) => ThemeQuery }).matchMedia?.(
    "(prefers-color-scheme: light)",
  );
  media?.addEventListener?.("change", () => {
    if (pageProtocol() !== "file:") return;
    const current = desktopDocument()?.documentElement;
    if (!current) return;
    current.setAttribute("data-theme", media.matches ? "light" : "dark");
  });
}

markDesktop();
watchTheme();
desktopDocument()?.addEventListener("DOMContentLoaded", () => {
  markDesktop();
  watchTheme();
});

export {};
