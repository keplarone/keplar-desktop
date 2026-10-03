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
// Wide enough that a 16px and 32px icon still shows a light edge on a dark taskbar.
const rim = 56;
const rendered = await sharp(svg).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const halo = dilateAlpha(rendered.data, rendered.info.width, rendered.info.height, rim);
const out = Buffer.alloc(rendered.data.length);
for (let i = 0, pixel = 0; i < rendered.data.length; i += 4, pixel++) {
  const alpha = rendered.data[i + 3];
  if (alpha > 16) {
    out[i] = rendered.data[i];
    out[i + 1] = rendered.data[i + 1];
    out[i + 2] = rendered.data[i + 2];
    out[i + 3] = alpha;
    continue;
  }
  const edge = halo[pixel];
  if (edge > 128) {
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = 255;
  }
}

const pngPath = path.join(buildDir, "icon.png");
await sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toFile(pngPath);
const png = fs.readFileSync(pngPath);

const icns = png2icons.createICNS(png, png2icons.BILINEAR, 0);
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

function dilateAlpha(data, width, height, radius) {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3] ?? 0;
  const horizontal = maxPass(alpha, width, height, radius, true);
  return maxPass(horizontal, width, height, radius, false);
}

function maxPass(source, width, height, radius, horizontal) {
  const out = new Uint8Array(source.length);
  const limit = horizontal ? width : height;
  const lines = horizontal ? height : width;
  for (let line = 0; line < lines; line++) {
    const deque = new Int32Array(limit);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < limit + radius; i++) {
      if (i < limit) {
        const value = source[horizontal ? line * width + i : i * width + line];
        while (tail > head && sourceAt(source, width, horizontal, line, deque[tail - 1]) <= value) tail--;
        deque[tail++] = i;
      }
      const ready = i - radius;
      if (ready < 0) continue;
      while (tail > head && deque[head] < ready - radius) head++;
      out[horizontal ? line * width + ready : ready * width + line] =
        sourceAt(source, width, horizontal, line, deque[head] ?? ready);
    }
  }
  return out;
}

function sourceAt(source, width, horizontal, line, index) {
  return source[horizontal ? line * width + index : index * width + line] ?? 0;
}
