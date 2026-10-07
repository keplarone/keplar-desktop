/**
 * Navigation policy for the Keplar shell.
 *
 * The hosted app at https://keplar.one is the only site the main window may
 * show. Google, Microsoft, and Whop are allowed so sign-in and checkout can
 * finish. Everything else stays out of the app window.
 *
 * This module does not import Electron so the rules can be tested directly.
 */

export const APP_ORIGIN = "https://keplar.one";
/** First page the window loads. The site permanently redirects `/app` here. */
export const APP_URL = "https://keplar.one/app/ask";
/**
 * Previous entry URL. Still a valid app page: once the ask route is published
 * it 308s to `APP_URL`, and until then it is the page that actually renders.
 */
export const LEGACY_APP_URL = "https://keplar.one/app";

/**
 * Hosts used by Google, Microsoft, and Whop sign-in or checkout.
 * Matching is exact or a subdomain (`accounts.google.com`, `checkout.whop.com`).
 * A lookalike such as `whop.com.evil.example` does not match.
 */
const AUTH_HOSTS = [
  "accounts.google.com",
  "accounts.youtube.com",
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
  "account.live.com",
  "login.windows.net",
  "whop.com",
] as const;

export type NavigationKind = "app" | "auth" | "external" | "blocked";

export function classifyNavigation(raw: string): NavigationKind {
  if (raw.startsWith("keplar:")) {
    return deepLinkToAppUrl(raw) ? "app" : "blocked";
  }

  const url = parseUrl(raw);
  if (!url) return "blocked";
  if (isKeplarAppUrl(url)) return "app";
  if (isAuthProviderUrl(url)) return "auth";
  if (
    url.protocol === "https:" ||
    url.protocol === "http:" ||
    url.protocol === "mailto:"
  ) {
    return "external";
  }
  return "blocked";
}

/**
 * When the ask tab answers with an HTTP error, load `/app` once.
 * A later 308 from `/app` back to the ask tab must not call this again.
 */
export function legacyAppFallback(
  raw: string,
  httpResponseCode: number,
  alreadyFellBack: boolean,
): string | null {
  if (alreadyFellBack || httpResponseCode < 400) return null;
  const url = parseUrl(raw);
  if (!url || !isKeplarAppUrl(url)) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/app/ask") return null;
  return LEGACY_APP_URL;
}

export function isKeplarAppUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return isKeplarHost(url.hostname);
}

export function isAuthProviderUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return AUTH_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * Map a keplar:// link onto https://keplar.one.
 * `keplar://app/chat` and `keplar:///app/chat` both become
 * `https://keplar.one/app/chat`. Returns null if the link is not a safe path.
 */
export function deepLinkToAppUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "keplar:") return null;
  if (url.username || url.password) return null;
  // keplar://auth?code=...&rid=... is the sign-in handoff (desktop-auth.ts), never a page.
  if (url.hostname.toLowerCase() === "auth") return null;

  let path = url.pathname || "/";
  if (url.hostname) {
    path = `/${url.hostname}${path === "/" ? "" : path}`;
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.includes("\\") || path.includes("\0") || path.includes("//")) {
    return null;
  }

  let target: URL;
  try {
    target = new URL(path, APP_ORIGIN);
  } catch {
    return null;
  }
  if (target.origin !== APP_ORIGIN) return null;
  if (target.username || target.password) return null;
  target.search = url.search;
  target.hash = url.hash;
  return target.toString();
}

/** Subframe navigations that are not the app itself. */
export function isAllowedSubframeUrl(raw: string): boolean {
  if (raw === "about:blank" || raw === "about:srcdoc") return true;
  const url = parseUrl(raw);
  if (!url) return false;
  if (url.protocol === "blob:" || url.protocol === "data:") return true;
  return isKeplarAppUrl(url) || isAuthProviderUrl(url);
}

export function isSafeExternalUrl(raw: string): boolean {
  const url = parseUrl(raw);
  if (!url) return false;
  return (
    url.protocol === "https:" ||
    url.protocol === "http:" ||
    url.protocol === "mailto:"
  );
}

/** Origin and path only, so logs do not keep OAuth codes or query strings. */
export function urlForLog(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.origin}${url.pathname}`;
    }
    return url.protocol;
  } catch {
    return "(unparseable url)";
  }
}

function isKeplarHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "keplar.one" || host.endsWith(".keplar.one");
}

export interface PagePermissionDetails {
  requestingUrl?: string;
  securityOrigin?: string;
  mediaTypes?: readonly string[];
  mediaType?: string;
}

const ALLOWED_PAGE_PERMISSIONS = new Set([
  "notifications",
  "clipboard-sanitized-write",
  "fullscreen",
  "automatic-fullscreen",
]);

/**
 * Permissions the page may use. Copy uses the async clipboard API, and presenting
 * slides uses the fullscreen API. Camera, clipboard read, and everything else stay off.
 */
export function allowsPagePermission(
  permission: string,
  details: PagePermissionDetails,
  requestingOrigin = "",
): boolean {
  if (!isPagePermissionOrigin(details, requestingOrigin)) return false;
  if (ALLOWED_PAGE_PERMISSIONS.has(permission)) return true;
  if (permission !== "media") return false;
  const types = details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
  return types.length > 0 && types.every((type) => type === "audio");
}

function isPagePermissionOrigin(details: PagePermissionDetails, requestingOrigin: string): boolean {
  const raw = details.requestingUrl || details.securityOrigin || requestingOrigin;
  if (!raw) return false;
  try {
    return isKeplarAppUrl(new URL(raw));
  } catch {
    return false;
  }
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
