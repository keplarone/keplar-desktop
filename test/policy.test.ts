import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_URL,
  classifyNavigation,
  deepLinkToAppUrl,
  isAllowedSubframeUrl,
  isAuthProviderUrl,
  isKeplarAppUrl,
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
