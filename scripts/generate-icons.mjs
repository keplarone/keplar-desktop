import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import png2icons from "png2icons";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = fs.readFileSync(path.join(root, "assets", "icon.svg"));
const buildDir = path.join(root, "build");
fs.mkdirSync(buildDir, { recursive: true });

const pngPath = path.join(buildDir, "icon.png");
await sharp(svg).resize(1024, 1024).png().toFile(pngPath);
const png = fs.readFileSync(pngPath);

const icns = png2icons.createICNS(png, png2icons.BILINEAR, 0);
const ico = png2icons.createICO(png, png2icons.BILINEAR, 0, false);
if (!icns || !ico) {
  throw new Error("Icon conversion failed");
}
fs.writeFileSync(path.join(buildDir, "icon.icns"), icns);
fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);

const linuxDir = path.join(buildDir, "icons");
fs.mkdirSync(linuxDir, { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  await sharp(png).resize(size, size).png().toFile(path.join(linuxDir, `${size}x${size}.png`));
}

console.log("Wrote build/icon.png, build/icon.ico, build/icon.icns, and build/icons/");
