/** Pure window-bounds maths (no Electron import) so it can be tested. */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fit a restored window inside the usable area of a display (the work area: the screen minus the taskbar or dock).
 * A window saved at 1920x1080 on a 1920x1080 screen reaches under the Windows taskbar: its bottom edge, and the chat
 * composer on it, is hidden and the page cannot be scrolled "lower" because the window itself extends past the screen.
 * The size is reduced to the work area and the position moved so all four edges are visible.
 */
export function fitToWorkArea(box: Box, area: Box): Box {
  const width = Math.min(box.width, area.width);
  const height = Math.min(box.height, area.height);
  const x = Math.min(Math.max(box.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(box.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

/** Same for a size with no saved position: only the size is limited. */
export function fitSizeToWorkArea(size: { width: number; height: number }, area: Box): { width: number; height: number } {
  return { width: Math.min(size.width, area.width), height: Math.min(size.height, area.height) };
}
