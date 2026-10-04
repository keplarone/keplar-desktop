import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import png2icons from "png2icons";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = fs.readFileSync(path.join(root, "assets", "icon.svg"));
const buildDir = path.join(root, "build");
fs.mkdirSync(buildDir, { recursive: true });

const size = 1024;
// The mark is black on a light rounded tile, so it reads on dark and light taskbars, docks and
// launchers without any outline or glow. Pass --transparent for the bare black mark with no tile.
const bare = process.argv.includes("--transparent");
const TILE = "#f4f4f6";
// Share of the canvas the tile covers: Windows and Linux icons fill their slot; macOS uses the
// Big Sur template (824 of 1024) so the Dock does not show it larger than its neighbours.
const TILE_SHARE = { plain: 0.94, mac: 824 / 1024 };
// The mark's share of the tile (the svg already has its own margin inside its 512 box).
const MARK_SHARE = 0.72;

async function render(tileShare) {
  const markSize = Math.round(size * (bare ? 1 : tileShare * MARK_SHARE));
  const mark = await sharp(svg).resize(markSize, markSize).png().toBuffer();
  const layers = [];
  if (!bare) {
    const tile = Math.round(size * tileShare);
    const radius = Math.round(tile * 0.2237);
    const plate = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}"><rect width="${tile}" height="${tile}" rx="${radius}" fill="${TILE}"/></svg>`,
    );
    const off = Math.round((size - tile) / 2);
    layers.push({ input: plate, left: off, top: off });
  }
  const off = Math.round((size - markSize) / 2);
  layers.push({ input: mark, left: off, top: off });
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
}

const png = await render(TILE_SHARE.plain);
const macPng = await render(TILE_SHARE.mac);
fs.writeFileSync(path.join(buildDir, "icon.png"), png);

const icns = png2icons.createICNS(macPng, png2icons.BILINEAR, 0);
const ico = png2icons.createICO(png, png2icons.BILINEAR, 0, true, true);
if (!icns || !ico) {
  throw new Error("Icon conversion failed");
}
fs.writeFileSync(path.join(buildDir, "icon.icns"), icns);
fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);

const linuxDir = path.join(buildDir, "icons");
fs.mkdirSync(linuxDir, { recursive: true });
for (const edge of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  await sharp(png).resize(edge, edge).png().toFile(path.join(linuxDir, `${edge}x${edge}.png`));
}

console.log("Wrote build/icon.png, build/icon.ico, build/icon.icns, and build/icons/");
