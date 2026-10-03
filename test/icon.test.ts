import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";

test("packaged icon is a transparent black mark with a white rim", async () => {
  const { data, info } = await sharp("build/icon.png")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1024);
  assert.equal(data[3], 0);

  let black = 0;
  let white = 0;
  let clear = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0;
    if (alpha < 16) {
      clear++;
      continue;
    }
    const red = data[i] ?? 0;
    const green = data[i + 1] ?? 0;
    const blue = data[i + 2] ?? 0;
    if (red < 40 && green < 40 && blue < 40) black++;
    else if (red > 220 && green > 220 && blue > 220) white++;
  }
  assert.ok(black > 10000);
  assert.ok(white > 10000);
  assert.ok(clear > 10000);
});
