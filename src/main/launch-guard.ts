const DEBUGGER_FLAG =
  /^(--inspect(?:-brk|-port|-publish-uid)?|--remote-debugging-(?:port|pipe)|--disable-web-security|--allow-running-insecure-content|--ignore-certificate-errors(?:-spki-list)?)(?:=.*)?$/;

/**
 * A packaged app must not open a debugger port or turn off Chromium's security
 * checks. A debugger port can read the signed-in page.
 */
export function hasDebuggerFlag(argv: readonly string[]): boolean {
  return argv.some((arg) => DEBUGGER_FLAG.test(arg));
}

/** Argv, Node's execArgv, and NODE_OPTIONS, which can carry `--inspect` outside argv. */
export function debuggerLaunchArgs(
  argv: readonly string[],
  execArgv: readonly string[] = [],
  nodeOptions = "",
): string[] {
  return [...argv, ...execArgv, ...nodeOptions.split(/\s+/).filter(Boolean)];
}
