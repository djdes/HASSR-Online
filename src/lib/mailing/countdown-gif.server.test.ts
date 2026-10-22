import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeGif } from "@/lib/gif/decoder";
import { renderCountdownGif } from "./countdown-gif.server";

const now = new Date("2026-10-22T10:00:00Z");

test("таймер: 60 кадров, корректный GIF, до 400 КБ, играет один раз", () => {
  const until = new Date(now.getTime() + 3 * 86_400_000 + 5 * 3_600_000 + 7_000);
  for (const theme of ["dark", "light"] as const) {
    const gif = renderCountdownGif(until, theme, now);
    assert.ok(gif.length <= 80 * 1024, `размер ${gif.length}`);
    const d = decodeGif(gif);
    assert.equal(d.version, "GIF89a");
    assert.equal(d.width, 600);
    assert.equal(d.height, 150);
    assert.equal(d.frames.length, 60);
    assert.equal(d.loop, null);
    assert.ok(d.palette.length <= 32);
    assert.notDeepEqual(d.frames[0].full, d.frames[1].full);
    assert.ok(d.frames[1].rect.width < 600 && d.frames[1].rect.height < 150);
    if (process.env.GIF_OUT_DIR) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").writeFileSync(`${process.env.GIF_OUT_DIR}/countdown-${theme}.gif`, gif);
    }
  }
});

test("после окончания — один кадр", () => {
  const gif = renderCountdownGif(new Date(now.getTime() - 1000), "dark", now);
  assert.equal(decodeGif(gif).frames.length, 1);
});
