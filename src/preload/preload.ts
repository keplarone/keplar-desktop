/**
 * Isolated preload for the Keplar window.
 *
 * contextIsolation is on, nodeIntegration is off, and the sandbox is on.
 * This file deliberately exposes nothing: no Node.js, no filesystem, no shell,
 * and no IPC bridge. Sign-in and product data stay on https://keplar.one.
 */
export {};
