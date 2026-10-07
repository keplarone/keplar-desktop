/**
 * Navigation policy for the Keplar shell.
 *
 * The hosted app at https://keplar.one is the only site the main window may
 * show. Google, Microsoft, and Whop are allowed so sign-in and checkout can
 * finish. Everything else stays out of the app window.
 *
 * This module does not import Electron so the rules can be tested directly.
 */
import { BlockList, isIP } from "node:net";

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

const SAFE_DATA_IMAGE = /^image\/(png|jpeg|gif|webp|avif|bmp)(;|$)/i;

/** Subframe navigations that are not the app itself. */
export function isAllowedSubframeUrl(raw: string): boolean {
  if (raw === "about:blank" || raw === "about:srcdoc") return true;
  const url = parseUrl(raw);
  if (!url) return false;
  if (url.protocol === "data:") {
    const mime = url.pathname.split(",")[0] ?? "";
    return SAFE_DATA_IMAGE.test(mime);
  }
  if (url.protocol === "blob:") {
    const source = parseUrl(url.pathname);
    return Boolean(source && (isKeplarAppUrl(source) || isAuthProviderUrl(source)));
  }
  return isKeplarAppUrl(url) || isAuthProviderUrl(url);
}

const BLOCKED_NETWORK = new BlockList();
BLOCKED_NETWORK.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED_NETWORK.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED_NETWORK.addSubnet("100.64.0.0", 10, "ipv4");
BLOCKED_NETWORK.addSubnet("127.0.0.0", 8, "ipv4");
BLOCKED_NETWORK.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED_NETWORK.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED_NETWORK.addSubnet("192.0.2.0", 24, "ipv4");
BLOCKED_NETWORK.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED_NETWORK.addSubnet("198.18.0.0", 15, "ipv4");
BLOCKED_NETWORK.addSubnet("198.51.100.0", 24, "ipv4");
BLOCKED_NETWORK.addSubnet("203.0.113.0", 24, "ipv4");
BLOCKED_NETWORK.addSubnet("224.0.0.0", 4, "ipv4");
BLOCKED_NETWORK.addSubnet("240.0.0.0", 4, "ipv4");
BLOCKED_NETWORK.addAddress("::", "ipv6");
BLOCKED_NETWORK.addAddress("::1", "ipv6");
BLOCKED_NETWORK.addSubnet("fc00::", 7, "ipv6");
BLOCKED_NETWORK.addSubnet("fe80::", 10, "ipv6");
BLOCKED_NETWORK.addSubnet("ff00::", 8, "ipv6");

/**
 * Links the system browser may open. Plain http and local or private addresses
 * stay closed so a page cannot poke services on this computer.
 */
export function isSafeExternalUrl(raw: string): boolean {
  const url = parseUrl(raw);
  if (!url || url.username || url.password) return false;
  if (url.protocol === "mailto:") {
    if (raw.length > 2000 || hasControlChar(raw)) return false;
    return url.pathname.includes("@");
  }
  if (url.protocol !== "https:") return false;
  return !isLocalHost(url.hostname);
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 32) return true;
  }
  return false;
}

/**
 * Requests the page must not make to this computer. Public https stays open
 * so the site can still load its own assets.
 */
export function isLocalNetworkUrl(raw: string): boolean {
  const url = parseUrl(raw);
  if (!url) return false;
  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:" &&
    url.protocol !== "ws:" &&
    url.protocol !== "wss:"
  ) {
    return false;
  }
  return isLocalHost(url.hostname);
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const kind = isIP(host);
  if (kind === 4) return BLOCKED_NETWORK.check(host, "ipv4");
  if (kind === 6) {
    const mapped = host.startsWith("::ffff:") ? host.slice("::ffff:".length) : "";
    if (mapped && isIP(mapped) === 4) return BLOCKED_NETWORK.check(mapped, "ipv4");
    return BLOCKED_NETWORK.check(host, "ipv6");
  }
  return false;
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** A download name with the directory removed, so the save dialog cannot be pointed at another path. */
export function safeDownloadName(name: string): string {
  const leaf = name.replaceAll("\\", "/").split("/").pop() ?? "";
  const base = leaf.replace(/[^\w.\- ()[\]]+/g, "_").replace(/[. ]+$/g, "");
  if (!base || base === "." || base === ".." || WINDOWS_DEVICE.test(base)) return "download";
  return base.slice(0, 180);
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
