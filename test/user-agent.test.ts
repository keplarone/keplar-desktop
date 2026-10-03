import assert from "node:assert/strict";
import { test } from "node:test";
import { DESKTOP_MARKER, desktopUserAgent } from "../src/main/user-agent.ts";

test("user agent carries the keplar-desktop token once", () => {
  assert.equal(DESKTOP_MARKER, "keplar-desktop");
  const marked = desktopUserAgent("Mozilla/5.0 Chrome/120.0.0.0");
  assert.equal(marked, "Mozilla/5.0 Chrome/120.0.0.0 keplar-desktop");
  assert.equal(desktopUserAgent(marked), marked);
});
