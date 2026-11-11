import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("neutral-palette.css matches the indigo classes in src/ (npm run palette:neutral)", () => {
  const run = spawnSync(process.execPath, ["scripts/gen-neutral-palette.mjs", "--check"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
