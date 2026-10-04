import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import sharp from "sharp";

type Pixel = [number, number, number, number];

async function load(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): Pixel => {
    const i = (y * info.width + x) * 4;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
  };
  return { data, width: info.width, height: info.height, at };
}

test("packaged icon is the black mark on a light tile, with no white outline or glow", async () => {
  const icon = await load("build/icon.png");
  assert.equal(icon.width, 1024);
  assert.equal(icon.height, 1024);
  // Transparent surround and rounded corners.
  assert.equal(icon.at(0, 0)[3], 0);
  assert.equal(icon.at(1023, 1023)[3], 0);

  let black = 0;
  let light = 0;
  let clear = 0;
  let soft = 0;
  for (let i = 0; i < icon.data.length; i += 4) {
    const alpha = icon.data[i + 3] ?? 0;
    const red = icon.data[i] ?? 0;
    if (alpha < 16) clear++;
    else if (alpha < 240) soft++;
    else if (red < 40) black++;
    else if (red > 230) light++;
  }
  assert.ok(black > 100000, "black mark present");
  assert.ok(light > 100000, "light tile present");
  assert.ok(clear > 20000, "transparent surround present");
  // Only anti-aliased edges are partly transparent: a glow or halo would be tens of thousands of pixels.
  assert.ok(soft < 30000, `no glow band (${soft} soft pixels)`);

  // The mark is solid black, and just outside the tile edge it is fully transparent (no halo).
  assert.deepEqual(icon.at(330, 330), [0, 0, 0, 255]);
  assert.equal(icon.at(512, 10)[3], 0);
  assert.deepEqual(icon.at(512, 60), [244, 244, 246, 255]);
});

test("the icon set covers every size the installers use", async () => {
  for (const edge of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    const meta = await sharp(`build/icons/${edge}x${edge}.png`).metadata();
    assert.equal(meta.width, edge);
    assert.equal(meta.height, edge);
    assert.equal(meta.hasAlpha, true);
  }
  const ico = fs.readFileSync("build/icon.ico");
  assert.equal(ico.readUInt16LE(2), 1, "ico type");
  assert.ok(ico.readUInt16LE(4) >= 6, "ico has several frames");
  const icns = fs.readFileSync("build/icon.icns");
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
});
