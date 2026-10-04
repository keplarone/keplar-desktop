import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  ERROR_TEXT,
  SignInFlow,
  challengeOf,
  isAuthDeepLink,
  newVerifier,
  parseAuthDeepLink,
  signInIntent,
  viewFor,
  type FlowState,
} from "../src/main/desktop-auth.ts";

const ORIGIN = "https://keplar.one";
const b64 = (n: number, c = "A") => c.repeat(n);
const RID = "R".repeat(32);
const CODE = "C".repeat(43);
const TICKET = "T".repeat(43);

describe("which pages start the browser sign-in", () => {
  it("sign in, sign up and add account do; everything else does not", () => {
    assert.equal(signInIntent("https://keplar.one/signin"), "signin");
    assert.equal(signInIntent("https://keplar.one/signin/"), "signin");
    assert.equal(signInIntent("https://keplar.one/signin?next=%2Fapp"), "signin");
    assert.equal(signInIntent("https://keplar.one/signup"), "signup");
    assert.equal(signInIntent("https://keplar.one/signin?next=%2Fapp&add=1"), "add");
    assert.equal(signInIntent("https://keplar.one/app"), null);
    assert.equal(signInIntent("https://keplar.one/signin/verify?token=x"), null, "the e-mail link page is not a sign-in start");
    assert.equal(signInIntent("https://keplar.one/signin?error=desktop_link_used"), null, "a failure page is shown, not answered with another window");
    assert.equal(signInIntent("https://keplar.one/desktop/connect?rid=x"), null);
    assert.equal(signInIntent("https://evil.example/signin"), null);
    assert.equal(signInIntent("https://keplar.one.evil.example/signin"), null);
    assert.equal(signInIntent("not a url"), null);
  });
});

describe("keplar://auth links", () => {
  it("parses only well-formed auth links", () => {
    assert.deepEqual(parseAuthDeepLink(`keplar://auth?code=${CODE}&rid=${RID}`), { code: CODE, rid: RID });
    assert.equal(parseAuthDeepLink(`keplar://auth?code=short&rid=${RID}`), null);
    assert.equal(parseAuthDeepLink(`keplar://auth?code=${CODE}`), null);
    assert.equal(parseAuthDeepLink(`keplar://app?code=${CODE}&rid=${RID}`), null);
    assert.equal(parseAuthDeepLink(`https://keplar.one/?code=${CODE}&rid=${RID}`), null);
    assert.equal(parseAuthDeepLink(`keplar://u:p@auth?code=${CODE}&rid=${RID}`), null);
    assert.equal(isAuthDeepLink("keplar://auth?code=1"), true);
    assert.equal(isAuthDeepLink("keplar://app/chat"), false);
  });
});

describe("PKCE", () => {
  it("the challenge is base64url(sha256(verifier)) and verifiers are unique and 43 characters", () => {
    const v = newVerifier();
    assert.equal(v.length, 43);
    assert.match(v, /^[A-Za-z0-9_-]+$/);
    assert.equal(challengeOf(v), createHash("sha256").update(v).digest("base64url"));
    assert.equal(challengeOf(v).length, 43);
    assert.notEqual(newVerifier(), newVerifier());
  });
});

/* A fake of the server's /api/auth/desktop/* endpoints, enough to run the flow. */
function fakeServer(opts: { pollStatuses?: string[]; exchange?: "ok" | "400-EXPIRED" | "400-USED" | "network-once" } = {}) {
  const calls: { path: string; body: Record<string, unknown>; origin: string | null }[] = [];
  let challenge = "";
  const polls = [...(opts.pollStatuses ?? ["pending"])];
  let exchangedNetwork = false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = (async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/auth/desktop/", "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ path, body, origin: new Headers(init?.headers).get("origin") });
    if (path === "start") {
      challenge = String(body.challenge);
      return json({ rid: RID, code: "K7F-2QM", url: `${ORIGIN}/desktop/connect?rid=${RID}`, expiresIn: 600 });
    }
    if (path === "poll") {
      assert.equal(challengeOf(String(body.verifier)), challenge, "poll carries the verifier of this request");
      const status = polls.length > 1 ? polls.shift()! : polls[0];
      return json(status === "approved" ? { status, code: CODE } : { status });
    }
    if (path === "exchange") {
      assert.equal(challengeOf(String(body.verifier)), challenge);
      if (opts.exchange === "400-EXPIRED") return json({ code: "EXCHANGE_EXPIRED" }, 400);
      if (opts.exchange === "400-USED") return json({ code: "EXCHANGE_USED" }, 400);
      if (opts.exchange === "network-once" && !exchangedNetwork) { exchangedNetwork = true; throw new TypeError("fetch failed"); }
      return json({ ticket: TICKET });
    }
    if (path === "cancel") return json({ ok: true });
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

function harness(server: ReturnType<typeof fakeServer>, extra: { openFails?: boolean; pollMs?: number; now?: () => number } = {}) {
  const states: FlowState[] = [];
  const opened: string[] = [];
  const finished: string[] = [];
  const flow = new SignInFlow({
    fetch: server.fetch,
    openExternal: async (u) => { if (extra.openFails) throw new Error("no browser"); opened.push(u); },
    loadFinish: (u) => finished.push(u),
    onState: (s) => states.push(s),
    label: "Keplar One on Windows",
    pollMs: extra.pollMs ?? 5,
    ...(extra.now ? { now: extra.now } : {}),
  });
  return { flow, states, opened, finished };
}
const until = async (fn: () => boolean, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 5)); } };

describe("the sign-in flow", () => {
  it("start: sends only the challenge, opens exactly our connect page in the browser, and shows the code", async () => {
    const s = fakeServer();
    const h = harness(s);
    await h.flow.begin("signin");
    const start = s.calls.find((c) => c.path === "start")!;
    assert.equal(start.origin, ORIGIN);
    assert.deepEqual(Object.keys(start.body).sort(), ["challenge", "label"]);
    assert.equal(String(start.body.challenge).length, 43);
    assert.deepEqual(h.opened, [`${ORIGIN}/desktop/connect?rid=${RID}`]);
    assert.equal(h.flow.current.phase, "waiting");
    const v = viewFor(h.flow.current)!;
    assert.equal(v.code, "K7F-2QM");
    assert.deepEqual(v.actions.map((a) => a.id), ["reopen", "cancel"]);
    h.flow.dispose();
  });

  it("deep link: exchanges the code with the verifier and loads the finish URL once", async () => {
    const s = fakeServer();
    const h = harness(s);
    await h.flow.begin("signin");
    assert.equal(await h.flow.handleDeepLink(`keplar://auth?code=${CODE}&rid=${RID}`), true);
    assert.deepEqual(h.finished, [`${ORIGIN}/api/auth/desktop/finish?ticket=${TICKET}`]);
    assert.equal(h.flow.current.phase, "done");
    // a replayed link does nothing
    assert.equal(await h.flow.handleDeepLink(`keplar://auth?code=${CODE}&rid=${RID}`), false);
    assert.equal(h.finished.length, 1);
    assert.equal(s.calls.filter((c) => c.path === "exchange").length, 1);
  });

  it("deep link for another request id is ignored", async () => {
    const s = fakeServer();
    const h = harness(s);
    await h.flow.begin("signin");
    assert.equal(await h.flow.handleDeepLink(`keplar://auth?code=${CODE}&rid=${"X".repeat(32)}`), false);
    assert.equal(h.flow.current.phase, "waiting");
    assert.equal(s.calls.some((c) => c.path === "exchange"), false);
    h.flow.dispose();
  });

  it("polling fallback: waits while pending, then exchanges the code the poll hands over", async () => {
    const s = fakeServer({ pollStatuses: ["pending", "pending", "approved"] });
    const h = harness(s);
    await h.flow.begin("signin");
    await until(() => h.finished.length === 1);
    assert.ok(s.calls.filter((c) => c.path === "poll").length >= 3);
    assert.equal(s.calls.find((c) => c.path === "exchange")!.body.code, CODE);
    assert.equal(h.flow.current.phase, "done");
  });

  it("a poll that reports 'used' while the deep link exchange runs is not an error", async () => {
    const s = fakeServer({ pollStatuses: ["used"] });
    const h = harness(s, { pollMs: 1000 });
    await h.flow.begin("signin");
    await h.flow.handleDeepLink(`keplar://auth?code=${CODE}&rid=${RID}`);
    assert.equal(h.flow.current.phase, "done");
  });

  it("cancel: tells the server, stops polling, and goes idle", async () => {
    const s = fakeServer();
    const h = harness(s);
    await h.flow.begin("add");
    h.flow.cancel();
    assert.equal(h.flow.current.phase, "idle");
    await new Promise((r) => setTimeout(r, 40));
    const polls = s.calls.filter((c) => c.path === "poll").length;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(s.calls.filter((c) => c.path === "poll").length, polls, "no polling after cancel");
    const cancel = s.calls.find((c) => c.path === "cancel")!;
    assert.equal(cancel.body.rid, RID);
    assert.equal(String(cancel.body.verifier).length, 43);
    // a keplar:// link after cancel does nothing
    assert.equal(await h.flow.handleDeepLink(`keplar://auth?code=${CODE}&rid=${RID}`), false);
    assert.equal(h.finished.length, 0);
  });

  it("error: cancelled in the browser, expired, used and rejected each show a message and offer Try again", async () => {
    for (const [status, reason] of [["cancelled", "cancelled"], ["denied", "cancelled"], ["expired", "expired"], ["used", "used"], ["invalid", "invalid"]] as const) {
      const h = harness(fakeServer({ pollStatuses: [status] }));
      await h.flow.begin("signin");
      await until(() => h.flow.current.phase === "error");
      const st = h.flow.current as Extract<FlowState, { phase: "error" }>;
      assert.equal(st.reason, reason);
      assert.equal(st.message, ERROR_TEXT[reason]);
      assert.deepEqual(viewFor(st)!.actions.map((a) => a.id), ["retry", "cancel"]);
    }
    for (const [mode, reason] of [["400-EXPIRED", "expired"], ["400-USED", "used"]] as const) {
      const h = harness(fakeServer({ exchange: mode }));
      await h.flow.begin("signin");
      await h.flow.handleDeepLink(`keplar://auth?code=${CODE}&rid=${RID}`);
      assert.equal((h.flow.current as { reason?: string }).reason, reason);
      assert.equal(h.finished.length, 0);
    }
  });

  it("error: server down at start is a network error and Try again starts a fresh request", async () => {
    let up = false;
    const good = fakeServer();
    const states: FlowState[] = [];
    const flow = new SignInFlow({
      fetch: (async (...a: Parameters<typeof fetch>) => { if (!up) throw new TypeError("offline"); return good.fetch(...a); }) as typeof fetch,
      openExternal: async () => undefined,
      loadFinish: () => undefined,
      onState: (s) => states.push(s),
      label: "x",
      pollMs: 1000,
    });
    await flow.begin("signin");
    assert.equal((flow.current as { reason?: string }).reason, "network");
    up = true;
    await flow.retry();
    assert.equal(flow.current.phase, "waiting");
    flow.dispose();
  });

  it("the request expires on its own after its lifetime", async () => {
    let t = 1_000_000;
    const h = harness(fakeServer(), { now: () => t });
    await h.flow.begin("signin");
    t += 11 * 60 * 1000;
    await until(() => h.flow.current.phase === "error");
    assert.equal((h.flow.current as { reason?: string }).reason, "expired");
  });

  it("a network blip while exchanging the deep-link code returns to waiting and the poll finishes the job", async () => {
    const s = fakeServer({ exchange: "network-once", pollStatuses: ["approved"] });
    const h = harness(s);
    await h.flow.begin("signin");
    await h.flow.handleDeepLink(`keplar://auth?code=${CODE}&rid=${RID}`);
    await until(() => h.finished.length === 1);
    assert.equal(h.flow.current.phase, "done");
  });

  it("refuses a server answer that points the browser anywhere but our connect page", async () => {
    const evil = (async () => new Response(JSON.stringify({ rid: RID, code: "AAA-BBB", url: "https://evil.example/desktop/connect?rid=" + RID, expiresIn: 600 }), { status: 200 })) as unknown as typeof fetch;
    const opened: string[] = [];
    const flow = new SignInFlow({ fetch: evil, openExternal: async (u) => { opened.push(u); }, loadFinish: () => undefined, onState: () => undefined, label: "x" });
    await flow.begin("signin");
    assert.deepEqual(opened, []);
    assert.equal(flow.current.phase, "error");
  });

  it("when the browser cannot be opened the window says so and Open browser again works", async () => {
    const h = harness(fakeServer(), { openFails: true });
    await h.flow.begin("signin");
    const st = h.flow.current as Extract<FlowState, { phase: "waiting" }>;
    assert.equal(st.browserOpened, false);
    assert.match(viewFor(st)!.message, /couldn't open your browser/);
    h.flow.dispose();
  });

  it("a second Sign in click while waiting does not start another request (it re-opens the browser)", async () => {
    const s = fakeServer();
    const h = harness(s);
    await h.flow.begin("signin");
    await h.flow.begin("signin");
    assert.equal(s.calls.filter((c) => c.path === "start").length, 1);
    assert.equal(h.opened.length, 2);
    h.flow.dispose();
  });
});

describe("what the waiting window shows", () => {
  it("has a title, a message, the code and a Cancel for every active phase, and nothing when idle", () => {
    assert.equal(viewFor({ phase: "idle" }), null);
    assert.equal(viewFor({ phase: "done", kind: "signin" }), null);
    const add = viewFor({ phase: "waiting", kind: "add", code: "ABC-234", expiresAt: 1, browserOpened: true })!;
    assert.match(add.title, /adding the account/);
    assert.equal(add.code, "ABC-234");
    assert.ok(add.actions.some((a) => a.id === "cancel"));
    const starting = viewFor({ phase: "starting", kind: "signin" })!;
    assert.ok(starting.actions.some((a) => a.id === "cancel"));
    assert.deepEqual(viewFor({ phase: "finishing", kind: "signin" })!.actions, []);
  });
});

void b64;
