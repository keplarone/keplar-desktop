/**
 * Chromium's ERR_ABORTED. Electron emits it when a navigation is cancelled
 * because a newer one started (the opening screen giving way to keplar.one,
 * a redirect, or a stopped load). It is not a failed origin.
 */
export const ERR_ABORTED = -3;

/** Same host the window loads. A 200 with `ok: true` means the origin is up. */
export const HEALTH_URL = "https://keplar.one/api/health";

export interface LoadFailure {
  errorCode: number;
  isMainFrame: boolean;
  validatedURL: string;
}

export type HealthState = "unknown" | "up" | "down";
export type ReachabilityAction = "ignore" | "probe" | "retry" | "offline";

/**
 * Decide what a main-frame load failure means.
 *
 * The offline screen is only for keplar.one itself being unreachable. A failed
 * local opening screen, a subframe, or a cancelled navigation must not replace
 * the window — on Windows those failures are reported with a generic error
 * code and used to cancel the real https load. When the document fails but
 * `/api/health` is up, load the document again instead of showing offline.
 */
export function reachabilityAction(input: {
  failure: LoadFailure;
  health: HealthState;
  retried: boolean;
  appVisible: boolean;
}): ReachabilityAction {
  if (!isHostedAppFailure(input.failure)) return "ignore";
  if (input.appVisible) return "ignore";
  if (input.health === "unknown") return "probe";
  if (input.health === "up" && !input.retried) return "retry";
  return "offline";
}

export function isHostedAppFailure(failure: LoadFailure): boolean {
  if (!failure.isMainFrame || failure.errorCode === ERR_ABORTED) return false;
  return isHostedAppUrl(failure.validatedURL);
}

/** https://keplar.one and its subdomains, with no embedded credentials. Same rule as policy.ts. */
function isHostedAppUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === "keplar.one" || host.endsWith(".keplar.one");
}

/**
 * True once Chromium has committed a hosted document.
 *
 * `did-navigate` reports the HTTP status of that commit. A DNS or connection
 * failure never emits it: `did-finish-load` still runs and `getURL()` stays on
 * the requested https address, which is an error document, not the app.
 */
export function documentCommitted(url: string, httpResponseCode: number): boolean {
  if (!isHostedAppUrl(url)) return false;
  return httpResponseCode >= 200 && httpResponseCode <= 399;
}

/** True when `/api/health` answered 200 and `{"ok":true,...}`. */
export function healthSaysUp(status: number, body: string): boolean {
  if (status !== 200) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return false;
    return (parsed as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}
