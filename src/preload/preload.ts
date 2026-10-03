/**
 * Isolated preload for the Keplar window.
 *
 * contextIsolation is on, nodeIntegration is off, and the sandbox is on.
 * This file exposes no Node.js, filesystem, shell, or IPC bridge. It only
 * marks the document so keplar.one can match `html.keplar-desktop` and
 * `[data-keplar-desktop]`. Sign-in and product data stay on https://keplar.one.
 */

const MARKER = "keplar-desktop";

interface MarkerRoot {
  classList: { add(token: string): void };
  setAttribute(name: string, value: string): void;
}

interface MarkerDocument {
  documentElement: MarkerRoot | null;
  addEventListener(type: string, listener: () => void): void;
}

function markDesktop(): void {
  const root = desktopDocument()?.documentElement;
  if (!root) return;
  root.classList.add(MARKER);
  root.setAttribute("data-keplar-desktop", "");
}

function desktopDocument(): MarkerDocument | undefined {
  return (globalThis as { document?: MarkerDocument }).document;
}

markDesktop();
desktopDocument()?.addEventListener("DOMContentLoaded", markDesktop);

export {};
