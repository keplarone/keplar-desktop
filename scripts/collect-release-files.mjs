import fs from "node:fs";
import path from "node:path";

const source = "release";
const destination = "ship";
const keep = [
  /\.exe$/,
  /\.dmg$/,
  /\.zip$/,
  /\.AppImage$/,
  /\.deb$/,
  /\.rpm$/,
  /\.blockmap$/,
  /^latest.*\.ya?ml$/,
];

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

for (const name of fs.readdirSync(source)) {
  const from = path.join(source, name);
  if (!fs.statSync(from).isFile()) continue;
  if (!keep.some((pattern) => pattern.test(name))) continue;
  fs.copyFileSync(from, path.join(destination, name));
  console.log(name);
}

if (fs.readdirSync(destination).length === 0) {
  console.error("No release files were produced.");
  process.exit(1);
}
