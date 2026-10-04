/**
 * Sign in through the system browser.
 *
 * The app never shows a login form. When the window is sent to /signin or /signup (or "Add account"), this flow:
 *   1. makes a PKCE verifier (random, never leaves this process) and sends only its SHA-256 challenge to
 *      POST /api/auth/desktop/start, which returns a request id and a short code to show,
 *   2. opens https://keplar.one/desktop/connect?rid=... in the default browser, where Google, Microsoft, email and
 *      magic links all work like on any website,
 *   3. gets back a one-time code in a keplar://auth?code=...&rid=... link (or, if the operating system did not deliver the
 *      link, by polling POST /api/auth/desktop/poll with the verifier),
 *   4. trades code + verifier for a single-use ticket (POST /exchange) and loads /api/auth/desktop/finish?ticket=... in
 *      its own window, which sets the session cookie there.
 *
 * Nothing in this file imports Electron, so the whole state machine is tested with a fake server.
 */
import { createHash, randomBytes } from "node:crypto";

/** Same value as policy.ts APP_ORIGIN (not imported so this file runs alone under the test runner). */
const APP_ORIGIN = "https://keplar.one";

export type SignInKind = "signin" | "signup" | "add";

export const API_PREFIX = "/api/auth/desktop";
export const POLL_MS = 2000;
export const MAX_POLL_FAILURES = 8;
export const REQUEST_TIMEOUT_MS = 10_000;

const B64URL = /^[A-Za-z0-9_-]+$/;
const isRid = (v: unknown): v is string => typeof v === "string" && v.length === 32 && B64URL.test(v);
const isCode = (v: unknown): v is string => typeof v === "string" && v.length === 43 && B64URL.test(v);

/* ───────────────────────────── recognising the page and the link ───────────────────────────── */

/**
 * Does this URL ask for the sign-in or sign-up page of the app? "Add account" is /signin?add=1.
 * Returns null for anything else, for the e-mail link landing pages (/signin/verify), and for the page that reports a
 * failed sign-in (/signin?error=...), which must be shown, not answered with another browser window.
 */
export function signInIntent(raw: string, origin: string = APP_ORIGIN): SignInKind | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/signin" && path !== "/signup") return null;
  if (url.searchParams.has("error")) return null;
  if (url.searchParams.get("add") === "1") return "add";
  return path === "/signup" ? "signup" : "signin";
}

/** keplar://auth?code=&rid= . Anything else (including keplar://app/...) is not an auth link. */
export function parseAuthDeepLink(raw: string): { code: string; rid: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "keplar:" || url.hostname !== "auth" || url.username || url.password) return null;
  const code = url.searchParams.get("code");
  const rid = url.searchParams.get("rid");
  return isCode(code) && isRid(rid) ? { code, rid } : null;
}

export const isAuthDeepLink = (raw: string): boolean => /^keplar:\/\/auth(?:[/?#]|$)/i.test(raw.trim());

/* ───────────────────────────── PKCE ───────────────────────────── */

export const newVerifier = (random: (n: number) => Buffer = randomBytes): string => random(32).toString("base64url");
export const challengeOf = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

/* ───────────────────────────── the state machine ───────────────────────────── */

export type ErrorReason = "network" | "server" | "expired" | "cancelled" | "used" | "rejected" | "invalid";

export type FlowState =
  | { phase: "idle" }
  | { phase: "starting"; kind: SignInKind }
  | { phase: "waiting"; kind: SignInKind; code: string; expiresAt: number; browserOpened: boolean }
  | { phase: "finishing"; kind: SignInKind }
  | { phase: "error"; kind: SignInKind; reason: ErrorReason; message: string }
  | { phase: "done"; kind: SignInKind };

export interface FlowDeps {
  fetch: typeof fetch;
  openExternal(url: string): Promise<void>;
  /** Load the finish URL in the app window. */
  loadFinish(url: string): void;
  onState(state: FlowState): void;
  label: string;
  origin?: string;
  random?: (n: number) => Buffer;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  pollMs?: number;
}

export const ERROR_TEXT: Record<ErrorReason, string> = {
  network: "We couldn't reach Keplar. Check your connection and try again.",
  server: "Keplar couldn't start the sign-in. Try again in a moment.",
  expired: "That sign-in took too long and expired. Start again.",
  cancelled: "The sign-in was cancelled in the browser.",
  used: "That sign-in link was already used. Start again.",
  rejected: "Keplar didn't accept that sign-in. Start again.",
  invalid: "Keplar didn't accept that sign-in. Start again.",
};

type Json = Record<string, unknown>;

export class SignInFlow {
  private state: FlowState = { phase: "idle" };
  private kind: SignInKind = "signin";
  private verifier = "";
  private rid = "";
  private connectUrl = "";
  private display = "";
  private expiresAt = 0;
  private gen = 0;
  private exchanging = false;
  private failures = 0;
  private timer: unknown = null;
  private readonly origin: string;

  private readonly d: FlowDeps;

  constructor(deps: FlowDeps) {
    this.d = deps;
    this.origin = deps.origin ?? APP_ORIGIN;
  }

  get current(): FlowState {
    return this.state;
  }

  /** True while a sign-in is under way (starting, waiting in the browser, or finishing). */
  get active(): boolean {
    return this.state.phase === "starting" || this.state.phase === "waiting" || this.state.phase === "finishing";
  }

  /** Start a sign-in. If one is already running it keeps running (and the browser page is opened again). */
  async begin(kind: SignInKind): Promise<void> {
    if (this.active) {
      if (this.state.phase === "waiting") await this.reopenBrowser();
      return;
    }
    const gen = ++this.gen;
    this.kind = kind;
    this.exchanging = false;
    this.failures = 0;
    this.clear();
    this.set({ phase: "starting", kind });
    this.verifier = newVerifier(this.d.random);
    let res: Json;
    try {
      res = await this.post("start", { challenge: challengeOf(this.verifier), label: this.d.label });
    } catch (e) {
      if (gen === this.gen) this.fail(e instanceof HttpError && e.status > 0 ? "server" : "network");
      return;
    }
    if (gen !== this.gen) return;
    const rid = res.rid;
    const code = res.code;
    const url = res.url;
    const expiresIn = typeof res.expiresIn === "number" ? res.expiresIn : 600;
    // The page we open in the browser must be OUR connect page for THIS request, whatever the server said.
    if (!isRid(rid) || typeof code !== "string" || typeof url !== "string" || url !== `${this.origin}/desktop/connect?rid=${encodeURIComponent(rid)}`) {
      this.fail("server");
      return;
    }
    this.rid = rid;
    this.display = code;
    this.connectUrl = url;
    this.expiresAt = this.now() + expiresIn * 1000;
    let opened = true;
    try {
      await this.d.openExternal(url);
    } catch {
      opened = false;
    }
    if (gen !== this.gen) return;
    this.set({ phase: "waiting", kind, code, expiresAt: this.expiresAt, browserOpened: opened });
    this.schedulePoll(gen);
  }

  /** Open the browser page again (the person closed the tab, or it never opened). */
  async reopenBrowser(): Promise<void> {
    if (this.state.phase !== "waiting") return;
    const gen = this.gen;
    let opened = true;
    try {
      await this.d.openExternal(this.connectUrl);
    } catch {
      opened = false;
    }
    if (gen === this.gen && this.state.phase === "waiting") this.set({ ...this.state, browserOpened: opened });
  }

  /** A keplar://auth link arrived. Returns true when it belonged to the running sign-in. */
  async handleDeepLink(raw: string): Promise<boolean> {
    const link = parseAuthDeepLink(raw);
    if (!link || this.state.phase !== "waiting" || link.rid !== this.rid) return false;
    await this.exchange(this.gen, link.code);
    return true;
  }

  /** Cancel. The server is told (best effort) so the browser page stops working. */
  cancel(): void {
    if (this.state.phase === "idle" || this.state.phase === "done") return;
    const rid = this.rid;
    const verifier = this.verifier;
    this.gen++;
    this.clear();
    this.exchanging = false;
    this.set({ phase: "idle" });
    if (rid && verifier) void this.post("cancel", { rid, verifier }).catch(() => undefined);
  }

  /** After an error: start over with a fresh request. */
  async retry(): Promise<void> {
    if (this.state.phase !== "error") return;
    const kind = this.kind;
    this.set({ phase: "idle" });
    await this.begin(kind);
  }

  dispose(): void {
    this.gen++;
    this.clear();
  }

  /* ───────────── internals ───────────── */

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  private set(s: FlowState): void {
    this.state = s;
    this.d.onState(s);
  }

  private fail(reason: ErrorReason): void {
    this.gen++;
    this.clear();
    this.exchanging = false;
    this.set({ phase: "error", kind: this.kind, reason, message: ERROR_TEXT[reason] });
  }

  private clear(): void {
    if (this.timer !== null) (this.d.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private schedulePoll(gen: number): void {
    const base = this.d.pollMs ?? POLL_MS;
    const wait = Math.min(base * (1 + this.failures), 10_000);
    const set = this.d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = set(() => void this.poll(gen), wait);
  }

  private async poll(gen: number): Promise<void> {
    if (gen !== this.gen || this.state.phase !== "waiting") return;
    if (this.now() >= this.expiresAt) {
      this.fail("expired");
      return;
    }
    let res: Json;
    try {
      res = await this.post("poll", { rid: this.rid, verifier: this.verifier });
    } catch {
      if (gen !== this.gen) return;
      if (++this.failures >= MAX_POLL_FAILURES) this.fail("network");
      else this.schedulePoll(gen);
      return;
    }
    if (gen !== this.gen || this.state.phase !== "waiting") return;
    this.failures = 0;
    switch (res.status) {
      case "pending":
        this.schedulePoll(gen);
        return;
      case "approved":
        if (isCode(res.code)) {
          await this.exchange(gen, res.code);
        } else this.fail("invalid");
        return;
      case "cancelled":
      case "denied":
        this.fail("cancelled");
        return;
      case "expired":
        this.fail("expired");
        return;
      case "used":
        // Someone finished it: normally this very app a moment ago through the keplar:// link. Never an error while that runs.
        if (!this.exchanging) this.fail("used");
        return;
      default:
        this.fail("invalid");
    }
  }

  private async exchange(gen: number, code: string): Promise<void> {
    if (this.exchanging || gen !== this.gen) return;
    this.exchanging = true;
    this.clear();
    this.set({ phase: "finishing", kind: this.kind });
    let res: Json;
    try {
      res = await this.post("exchange", { rid: this.rid, code, verifier: this.verifier });
    } catch (e) {
      if (gen !== this.gen) return;
      this.exchanging = false;
      if (e instanceof HttpError && e.status === 400) {
        const c = typeof e.code === "string" ? e.code : "";
        this.fail(c.endsWith("EXPIRED") ? "expired" : c.endsWith("USED") ? "used" : c.endsWith("CANCELLED") ? "cancelled" : "rejected");
        return;
      }
      // Network trouble: go back to waiting; the poll will hand over a fresh code.
      this.set({ phase: "waiting", kind: this.kind, code: this.display, expiresAt: this.expiresAt, browserOpened: true });
      this.failures++;
      this.schedulePoll(gen);
      return;
    }
    if (gen !== this.gen) return;
    if (!isCode(res.ticket)) {
      this.fail("invalid");
      return;
    }
    this.gen++;
    this.clear();
    this.set({ phase: "done", kind: this.kind });
    this.d.loadFinish(`${this.origin}${API_PREFIX}/finish?ticket=${encodeURIComponent(res.ticket)}`);
  }

  private async post(action: "start" | "poll" | "exchange" | "cancel", body: Json): Promise<Json> {
    let res: Response;
    try {
      res = await this.d.fetch(`${this.origin}${API_PREFIX}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: this.origin },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      throw new HttpError(0, "network");
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    const obj = json && typeof json === "object" ? (json as Json) : {};
    if (!res.ok) throw new HttpError(res.status, typeof obj.code === "string" ? obj.code : "");
    return obj;
  }
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`http ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

/* ───────────────────────────── what the waiting window shows ───────────────────────────── */

export interface ViewAction {
  id: "cancel" | "retry" | "reopen";
  label: string;
  primary?: boolean;
}

export interface SignInView {
  phase: "starting" | "waiting" | "finishing" | "error";
  title: string;
  message: string;
  /** The short code to compare with the one in the browser. */
  code?: string;
  actions: ViewAction[];
}

/** Null when there is nothing to show (idle or done). Pure: the preload only renders this. */
export function viewFor(state: FlowState): SignInView | null {
  switch (state.phase) {
    case "idle":
    case "done":
      return null;
    case "starting":
      return { phase: "starting", title: state.kind === "add" ? "Add an account" : "Sign in", message: "Opening your browser…", actions: [{ id: "cancel", label: "Cancel" }] };
    case "waiting":
      return {
        phase: "waiting",
        title: state.kind === "add" ? "Finish adding the account in your browser" : "Finish signing in with your browser",
        message: state.browserOpened
          ? "Sign in there, then choose Open Keplar One. This window updates by itself. Check that the code matches:"
          : "We couldn't open your browser. Choose Open browser again, then sign in there. Check that the code matches:",
        code: state.code,
        actions: [
          { id: "reopen", label: "Open browser again" },
          { id: "cancel", label: "Cancel", primary: false },
        ],
      };
    case "finishing":
      return { phase: "finishing", title: "Signing you in", message: "One moment…", actions: [] };
    case "error":
      return {
        phase: "error",
        title: "Sign-in didn't finish",
        message: state.message,
        actions: [
          { id: "retry", label: "Try again", primary: true },
          { id: "cancel", label: "Close" },
        ],
      };
  }
}
