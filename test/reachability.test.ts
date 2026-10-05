import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isKeplarAppUrl } from "../src/main/policy.ts";
import {
  documentCommitted,
  ERR_ABORTED,
  healthSaysUp,
  isHostedAppFailure,
  reachabilityAction,
  type LoadFailure,
} from "../src/main/reachability.ts";

const APP = "https://keplar.one/app";

function failure(overrides: Partial<LoadFailure> & Pick<LoadFailure, "validatedURL" | "errorCode">): LoadFailure {
  return { isMainFrame: true, ...overrides };
}

function hostedAppUrl(raw: string): boolean {
  try {
    return isKeplarAppUrl(new URL(raw));
  } catch {
    return false;
  }
}

describe("reachability", () => {
  it("ignores the local opening screen, aborts, subframes, and non-https urls", () => {
    const local = failure({
      errorCode: -2,
      validatedURL: "file:///C:/Users/Ada/AppData/Local/Temp/loading.html",
    });
    assert.equal(reachabilityAction({ failure: local, health: "unknown", retried: false, appVisible: false }), "ignore");

    assert.equal(
      reachabilityAction({
        failure: failure({ errorCode: ERR_ABORTED, validatedURL: APP }),
        health: "unknown",
        retried: false,
        appVisible: false,
      }),
      "ignore",
    );

    assert.equal(
      reachabilityAction({
        failure: failure({ errorCode: -105, validatedURL: "https://keplar.one/embed", isMainFrame: false }),
        health: "down",
        retried: true,
        appVisible: false,
      }),
      "ignore",
    );

    assert.equal(
      reachabilityAction({
        failure: failure({ errorCode: -2, validatedURL: "http://keplar.one/app" }),
        health: "down",
        retried: true,
        appVisible: false,
      }),
      "ignore",
    );

    assert.equal(
      reachabilityAction({
        failure: failure({ errorCode: -2, validatedURL: "https://keplar.one.evil.example/app" }),
        health: "down",
        retried: true,
        appVisible: false,
      }),
      "ignore",
    );
  });

  it("probes /api/health when the hosted document fails, then retries once if the origin is up", () => {
    const failed = failure({ errorCode: -105, validatedURL: APP });
    assert.equal(
      reachabilityAction({ failure: failed, health: "unknown", retried: false, appVisible: false }),
      "probe",
    );
    assert.equal(
      reachabilityAction({ failure: failed, health: "up", retried: false, appVisible: false }),
      "retry",
    );
    assert.equal(
      reachabilityAction({ failure: failed, health: "up", retried: true, appVisible: false }),
      "offline",
    );
  });

  it("shows offline when the hosted document and the health check both fail", () => {
    for (const errorCode of [-2, -21, -105, -202]) {
      assert.equal(
        reachabilityAction({
          failure: failure({ errorCode, validatedURL: "https://keplar.one/app?next=%2F" }),
          health: "down",
          retried: false,
          appVisible: false,
        }),
        "offline",
      );
    }
  });

  it("does not replace a document that is already showing keplar.one", () => {
    assert.equal(
      reachabilityAction({
        failure: failure({ errorCode: -2, validatedURL: APP }),
        health: "up",
        retried: false,
        appVisible: true,
      }),
      "ignore",
    );
  });

  it("uses the same host rule as navigation policy", () => {
    const samples = [
      "https://keplar.one/app",
      "https://www.keplar.one/pricing",
      "https://app.keplar.one/",
      "http://keplar.one/app",
      "https://keplar.one.evil.example/app",
      "https://user:pass@keplar.one/app",
      "file:///C:/temp/loading.html",
    ];
    for (const sample of samples) {
      assert.equal(
        isHostedAppFailure({ errorCode: -2, isMainFrame: true, validatedURL: sample }),
        hostedAppUrl(sample),
        sample,
      );
    }
  });

  it("treats only a committed http document as the app being on screen", () => {
    assert.equal(documentCommitted(APP, 200), true);
    assert.equal(documentCommitted("https://does-not-exist.keplar.one/app", 200), true);
    assert.equal(documentCommitted(APP, 304), true);
    assert.equal(documentCommitted(APP, 399), true);
    // A failed lookup does not commit. The status stays the non-HTTP sentinel.
    assert.equal(documentCommitted("https://does-not-exist.keplar.one/app", -1), false);
    assert.equal(documentCommitted(APP, 0), false);
    assert.equal(documentCommitted(APP, 404), false);
    assert.equal(documentCommitted(APP, 500), false);
    assert.equal(documentCommitted("file:///C:/temp/loading.html", 200), false);
    assert.equal(documentCommitted("http://keplar.one/app", 200), false);
  });

  it("reads the live health payload as up only when ok is true", () => {
    assert.equal(healthSaysUp(200, '{"ok":true,"store":"postgres","durable":true,"roundTripMs":21}'), true);
    assert.equal(healthSaysUp(200, '{"ok":true,"store":"postgres"}'), true);
    assert.equal(healthSaysUp(200, '{"ok":false,"store":"postgres"}'), false);
    assert.equal(healthSaysUp(503, '{"ok":true}'), false);
    assert.equal(healthSaysUp(200, ""), false);
    assert.equal(healthSaysUp(200, "<html>offline</html>"), false);
  });
});
