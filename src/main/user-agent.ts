/** Token keplar.one uses to detect this desktop shell. It is its own user-agent token. */
export const DESKTOP_MARKER = "keplar-desktop";

export function desktopUserAgent(current: string): string {
  const tokens = current.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.includes(DESKTOP_MARKER)) return current.trim();
  return `${current.trim()} ${DESKTOP_MARKER}`.trim();
}
