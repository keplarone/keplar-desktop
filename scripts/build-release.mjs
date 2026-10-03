import { spawnSync } from "node:child_process";

const target = process.argv.find((arg) => arg === "mac" || arg === "win" || arg === "linux");
if (target !== "mac" && target !== "win" && target !== "linux") {
  console.error("Usage: node scripts/build-release.mjs <mac|win|linux>");
  process.exit(1);
}

const env = { ...process.env };
const signingKeys = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];

for (const key of signingKeys) {
  if (!env[key]) delete env[key];
}

const macSigned = Boolean(env.CSC_LINK);
const winSigned = Boolean(env.CSC_LINK || env.WIN_CSC_LINK);

if (target === "mac" && !macSigned) {
  delete env.APPLE_ID;
  delete env.APPLE_APP_SPECIFIC_PASSWORD;
  delete env.APPLE_TEAM_ID;
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  console.log("No macOS certificate in the environment. Building unsigned.");
}

if (target === "win" && !winSigned) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  console.log("No Windows certificate in the environment. Building unsigned.");
}

if (target === "linux") {
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
}

const args = ["electron-builder", "--publish", "never"];
if (target === "mac") args.push("--mac", "--x64", "--arm64");
if (target === "win") args.push("--win", "--x64");
if (target === "linux") args.push("--linux", "--x64");

const result = spawnSync("npx", args, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
process.exit(result.status === null ? 1 : result.status);
