import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_URL,
  classifyNavigation,
  deepLinkToAppUrl,
  isAllowedSubframeUrl,
  isAuthProviderUrl,
  isKeplarAppUrl,
  isLocalNetworkUrl,
  isSafeExternalUrl,
  safeDownloadName,
  LEGACY_APP_URL,
  legacyAppFallback,
  allowsPagePermission,
} from "../src/main/policy.ts";

describe("keplar app urls", () => {
  it("opens on the ask tab and can fall back to /app", () => {
    assert.equal(APP_URL, "https://keplar.one/app/ask");
    assert.equal(classifyNavigation(APP_URL), "app");
    assert.equal(classifyNavigation(LEGACY_APP_URL), "app");
    assert.equal(legacyAppFallback(APP_URL, 404, false), LEGACY_APP_URL);
    assert.equal(legacyAppFallback("https://keplar.one/app/ask/", 500, false), LEGACY_APP_URL);
    assert.equal(legacyAppFallback(APP_URL, 200, false), null);
    assert.equal(legacyAppFallback(APP_URL, 308, false), null);
    assert.equal(legacyAppFallback(APP_URL, 404, true), null);
    assert.equal(legacyAppFallback(LEGACY_APP_URL, 404, false), null);
    assert.equal(legacyAppFallback("https://keplar.one/app/chat", 404, false), null);
  });

  it("allows https://keplar.one and its subdomains", () => {
    assert.equal(classifyNavigation("https://keplar.one/app"), "app");
    assert.equal(classifyNavigation("https://www.keplar.one/pricing"), "app");
    assert.equal(isKeplarAppUrl(new URL("https://app.keplar.one/")), true);
  });

  it("rejects lookalike hosts and plain http", () => {
    assert.equal(classifyNavigation("https://keplar.one.evil.example/app"), "external");
    assert.equal(classifyNavigation("https://notkeplar.one/app"), "external");
    assert.equal(classifyNavigation("http://keplar.one/app"), "external");
    assert.equal(isKeplarAppUrl(new URL("https://evil.com")), false);
  });

  it("rejects credentials in the url", () => {
    assert.equal(
      isKeplarAppUrl(new URL("https://user:pass@keplar.one/app")),
      false,
    );
  });
});

describe("auth providers", () => {
  it("allows Google, Microsoft, and Whop over https", () => {
    assert.equal(classifyNavigation("https://accounts.google.com/o/oauth2/v2/auth"), "auth");
    assert.equal(classifyNavigation("https://login.microsoftonline.com/common/oauth2/v2.0/authorize"), "auth");
    assert.equal(classifyNavigation("https://login.live.com/oauth20_authorize.srf"), "auth");
    assert.equal(classifyNavigation("https://whop.com/checkout/plan"), "auth");
    assert.equal(classifyNavigation("https://checkout.whop.com/pay"), "auth");
    assert.equal(classifyNavigation("https://cdn.whop.com/embed.js"), "auth");
  });

  it("rejects lookalikes and http", () => {
    assert.equal(isAuthProviderUrl(new URL("https://whop.com.evil.example/checkout")), false);
    assert.equal(isAuthProviderUrl(new URL("https://notwhop.com/")), false);
    assert.equal(isAuthProviderUrl(new URL("http://accounts.google.com/o/oauth2/v2/auth")), false);
    assert.equal(classifyNavigation("https://accounts.google.com.attacker.test/"), "external");
  });
});

describe("everything else", () => {
  it("sends ordinary websites to the system browser category", () => {
    assert.equal(classifyNavigation("https://example.com/docs"), "external");
    assert.equal(classifyNavigation("mailto:team@keplar.one"), "external");
  });

  it("blocks scripts, files, and data urls in the main frame", () => {
    assert.equal(classifyNavigation("javascript:alert(1)"), "blocked");
    assert.equal(classifyNavigation("file:///etc/passwd"), "blocked");
    assert.equal(classifyNavigation("data:text/html,hi"), "blocked");
    assert.equal(classifyNavigation("not a url"), "blocked");
  });
});

describe("deep links", () => {
  it("maps keplar:// paths onto the site", () => {
    assert.equal(deepLinkToAppUrl("keplar://app"), "https://keplar.one/app");
    assert.equal(deepLinkToAppUrl("keplar://app/chat/1"), "https://keplar.one/app/chat/1");
    assert.equal(deepLinkToAppUrl("keplar:///app/chat"), "https://keplar.one/app/chat");
    assert.equal(
      deepLinkToAppUrl("keplar://app/chat?q=1#top"),
      "https://keplar.one/app/chat?q=1#top",
    );
    assert.equal(classifyNavigation("keplar://app/chat"), "app");
  });

  it("rejects smuggled protocols and credentials", () => {
    assert.equal(deepLinkToAppUrl("keplar://user@app/secret"), null);
    assert.equal(deepLinkToAppUrl("https://keplar.one/app"), null);
    assert.equal(deepLinkToAppUrl("keplar://app//evil"), null);
  });
});

describe("subframes", () => {
  it("allows the app, auth providers, and inert frame urls", () => {
    assert.equal(isAllowedSubframeUrl("https://keplar.one/embed"), true);
    assert.equal(isAllowedSubframeUrl("https://cdn.whop.com/frame"), true);
    assert.equal(isAllowedSubframeUrl("about:blank"), true);
    assert.equal(isAllowedSubframeUrl("blob:https://keplar.one/uuid"), true);
  });

  it("blocks other origins inside frames", () => {
    assert.equal(isAllowedSubframeUrl("https://evil.example/phish"), false);
    assert.equal(isAllowedSubframeUrl("javascript:alert(1)"), false);
    assert.equal(isAllowedSubframeUrl("data:text/html,<script>alert(1)</script>"), false);
    assert.equal(isAllowedSubframeUrl("data:image/svg+xml,<svg>"), false);
    assert.equal(isAllowedSubframeUrl("blob:https://evil.example/uuid"), false);
    assert.equal(isAllowedSubframeUrl("data:image/png;base64,aaaa"), true);
  });
});

describe("links opened in the system browser", () => {
  it("allows public https pages and mailto", () => {
    assert.equal(isSafeExternalUrl("https://example.com/docs"), true);
    assert.equal(isSafeExternalUrl("mailto:team@keplar.one"), true);
  });

  it("blocks http, credentials, and addresses on this computer", () => {
    assert.equal(isSafeExternalUrl("http://example.com"), false);
    assert.equal(isSafeExternalUrl("http://keplar.one/app"), false);
    assert.equal(isSafeExternalUrl("https://user:pass@example.com"), false);
    assert.equal(isSafeExternalUrl("https://127.0.0.1/"), false);
    assert.equal(isSafeExternalUrl("https://2130706433/"), false);
    assert.equal(isSafeExternalUrl("https://localhost/"), false);
    assert.equal(isSafeExternalUrl("https://192.168.1.1/"), false);
    assert.equal(isSafeExternalUrl("https://[::1]/"), false);
    assert.equal(isSafeExternalUrl("mailto:team@keplar.one\nBcc:evil@example.com"), false);
  });
});

describe("requests to this computer", () => {
  it("blocks local and private addresses and leaves public https alone", () => {
    assert.equal(isLocalNetworkUrl("https://keplar.one/app/ask"), false);
    assert.equal(isLocalNetworkUrl("https://example.com/image.png"), false);
    assert.equal(isLocalNetworkUrl("https://127.0.0.1/"), true);
    assert.equal(isLocalNetworkUrl("http://user:pass@127.0.0.1/"), true);
    assert.equal(isLocalNetworkUrl("https://2130706433/"), true);
    assert.equal(isLocalNetworkUrl("https://localhost/"), true);
    assert.equal(isLocalNetworkUrl("https://printer.local/"), true);
    assert.equal(isLocalNetworkUrl("https://10.1.2.3/"), true);
    assert.equal(isLocalNetworkUrl("https://169.254.169.254/"), true);
    assert.equal(isLocalNetworkUrl("https://192.168.1.1/"), true);
    assert.equal(isLocalNetworkUrl("wss://127.0.0.1/socket"), true);
    assert.equal(isLocalNetworkUrl("https://[::1]/"), true);
    assert.equal(isLocalNetworkUrl("file:///tmp/offline.html"), false);
  });
});

describe("download names", () => {
  it("drops directories and windows device names", () => {
    assert.equal(safeDownloadName("notes.pdf"), "notes.pdf");
    assert.equal(safeDownloadName("../../etc/passwd"), "passwd");
    assert.equal(safeDownloadName("..\\windows\\system32\\cmd.exe"), "cmd.exe");
    assert.equal(safeDownloadName("CON.txt"), "download");
    assert.equal(safeDownloadName(""), "download");
  });
});

describe("page permissions", () => {
  const ask = { requestingUrl: "https://keplar.one/app/ask" };

  it("allows microphone, notifications, clipboard write, and fullscreen from keplar.one", () => {
    assert.equal(allowsPagePermission("notifications", ask), true);
    assert.equal(allowsPagePermission("clipboard-sanitized-write", ask), true);
    assert.equal(allowsPagePermission("fullscreen", ask), true);
    assert.equal(allowsPagePermission("automatic-fullscreen", ask), true);
    assert.equal(allowsPagePermission("media", { ...ask, mediaTypes: ["audio"] }), true);
    assert.equal(allowsPagePermission("media", { ...ask, mediaType: "audio" }), true);
    assert.equal(allowsPagePermission("notifications", {}, "https://www.keplar.one"), true);
  });

  it("denies camera, clipboard read, and other origins", () => {
    assert.equal(allowsPagePermission("media", { ...ask, mediaTypes: ["video"] }), false);
    assert.equal(allowsPagePermission("media", { ...ask, mediaTypes: ["audio", "video"] }), false);
    assert.equal(allowsPagePermission("media", { ...ask, mediaType: "unknown" }), false);
    assert.equal(allowsPagePermission("clipboard-read", ask), false);
    assert.equal(allowsPagePermission("geolocation", ask), false);
    assert.equal(allowsPagePermission("notifications", { requestingUrl: "https://evil.example" }), false);
    assert.equal(allowsPagePermission("notifications", { requestingUrl: "https://keplar.one.evil.example/app" }), false);
    assert.equal(allowsPagePermission("clipboard-sanitized-write", {}), false);
  });
});

describe("sign-in handoff links", () => {
  it("keplar://auth is never mapped onto a web page", () => {
    assert.equal(deepLinkToAppUrl("keplar://auth?code=x&rid=y"), null);
    assert.equal(deepLinkToAppUrl("keplar://AUTH?code=x&rid=y"), null);
    assert.equal(classifyNavigation("keplar://auth?code=x&rid=y"), "blocked");
    assert.equal(deepLinkToAppUrl("keplar://app/chat"), "https://keplar.one/app/chat");
  });
});
