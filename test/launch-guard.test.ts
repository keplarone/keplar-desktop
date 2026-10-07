import assert from "node:assert/strict";
import { test } from "node:test";
import { debuggerLaunchArgs, hasDebuggerFlag } from "../src/main/launch-guard.ts";

test("packaged launches reject debugger ports", () => {
  assert.equal(hasDebuggerFlag(["keplar-one", "--remote-debugging-port=9222"]), true);
  assert.equal(hasDebuggerFlag(["keplar-one", "--remote-debugging-port"]), true);
  assert.equal(hasDebuggerFlag(["keplar-one", "--inspect"]), true);
  assert.equal(hasDebuggerFlag(["keplar-one", "--inspect-brk=0"]), true);
  assert.equal(hasDebuggerFlag(["keplar-one", "--inspect-port=9229"]), true);
  assert.equal(hasDebuggerFlag(["keplar-one", "--disable-web-security"]), true);
  assert.equal(hasDebuggerFlag(["keplar-one", "--ignore-certificate-errors"]), true);
  assert.equal(hasDebuggerFlag(["keplar-one"]), false);
  assert.equal(hasDebuggerFlag(["keplar-one", "--inspected"]), false);
  assert.equal(
    hasDebuggerFlag(debuggerLaunchArgs(["keplar-one"], [], "--inspect=9229")),
    true,
  );
  assert.equal(hasDebuggerFlag(debuggerLaunchArgs(["keplar-one"], ["--inspect-brk"])), true);
});
