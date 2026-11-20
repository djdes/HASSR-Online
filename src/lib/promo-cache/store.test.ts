import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  inspectPromoSnapshots,
  readOrBuildPromoSnapshot,
  readPromoSnapshotFile,
  resolvePromoCacheDir,
  writePromoSnapshotFile,
} from "./store";

describe("promo-cache atomic JSON file store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wesetup-promo-cache-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves PROMO_CACHE_DIR when provided and falls back to .cache/promo-cache locally", () => {
    const custom = resolvePromoCacheDir({ PROMO_CACHE_DIR: tmpDir } as unknown as NodeJS.ProcessEnv);
    assert.equal(custom, path.resolve(tmpDir));

    const localDefault = resolvePromoCacheDir({} as unknown as NodeJS.ProcessEnv, () => false);
    assert.equal(localDefault, path.resolve(process.cwd(), ".cache", "promo-cache"));

    const prodDefault = resolvePromoCacheDir({} as unknown as NodeJS.ProcessEnv, (p) => p === "/var/www/wesetupru/data");
    assert.equal(prodDefault, "/var/www/wesetupru/data/promo-cache");
  });

  it("writes human-readable JSON atomically without leaving .tmp files behind", async () => {
    const payload = { plans: [{ key: "standard:month", priceRub: 1990 }] };
    const written = await writePromoSnapshotFile("tariffs", payload, {
      dir: tmpDir,
      now: new Date("2026-11-20T08:00:00.000Z"),
    });

    assert.equal(written.dataset, "tariffs");
    assert.equal(written.generatedAt, "2026-11-20T08:00:00.000Z");

    const files = fs.readdirSync(tmpDir);
    assert.deepEqual(files, ["tariffs.json"]);

    const raw = fs.readFileSync(path.join(tmpDir, "tariffs.json"), "utf8");
    assert.ok(raw.includes('\n  "dataset": "tariffs"'), "JSON must be formatted for easy CLI inspection");

    const readBack = await readPromoSnapshotFile<typeof payload>("tariffs", { dir: tmpDir });
    assert.ok(readBack);
    assert.deepEqual(readBack.data, payload);
    assert.equal(readBack.generatedAt, "2026-11-20T08:00:00.000Z");
  });

  it("rejects unsafe dataset names to prevent path traversal", async () => {
    await assert.rejects(
      () => writePromoSnapshotFile("../escape", { ok: false }, { dir: tmpDir }),
      /Invalid promo cache dataset/,
    );
  });

  it("never calls build() when a valid JSON snapshot exists on disk (0 DB SELECT guarantee)", async () => {
    await writePromoSnapshotFile("reviews", [{ id: "r1", quote: "Супер" }], { dir: tmpDir });

    let dbCalls = 0;
    const result = await readOrBuildPromoSnapshot({
      dataset: "reviews",
      dir: tmpDir,
      build: async () => {
        dbCalls += 1;
        return [{ id: "r2", quote: "From DB" }];
      },
      fallback: () => [],
    });

    assert.equal(dbCalls, 0);
    assert.deepEqual(result, [{ id: "r1", quote: "Супер" }]);
  });

  it("coalesces concurrent cold reads into a single build() call and persists snapshot", async () => {
    let dbCalls = 0;
    const build = async () => {
      dbCalls += 1;
      await new Promise((r) => setTimeout(r, 25));
      return { count: 42 };
    };

    const [a, b, c] = await Promise.all([
      readOrBuildPromoSnapshot({ dataset: "journal-usage", dir: tmpDir, build, fallback: () => ({ count: 0 }) }),
      readOrBuildPromoSnapshot({ dataset: "journal-usage", dir: tmpDir, build, fallback: () => ({ count: 0 }) }),
      readOrBuildPromoSnapshot({ dataset: "journal-usage", dir: tmpDir, build, fallback: () => ({ count: 0 }) }),
    ]);

    assert.equal(dbCalls, 1);
    assert.deepEqual(a, { count: 42 });
    assert.deepEqual(b, { count: 42 });
    assert.deepEqual(c, { count: 42 });

    // Subsequent read hits disk with 0 DB calls
    const d = await readOrBuildPromoSnapshot({
      dataset: "journal-usage",
      dir: tmpDir,
      build: async () => {
        dbCalls += 1;
        return { count: 99 };
      },
      fallback: () => ({ count: 0 }),
    });
    assert.equal(dbCalls, 1);
    assert.deepEqual(d, { count: 42 });
  });

  it("recovers gracefully from corrupt JSON or failed cold build via fallback without crashing", async () => {
    fs.writeFileSync(path.join(tmpDir, "broken.json"), "{not-valid-json", "utf8");

    const fallbackUsed = await readOrBuildPromoSnapshot({
      dataset: "broken",
      dir: tmpDir,
      build: async () => {
        throw new Error("DB offline");
      },
      fallback: () => ["safe-default"],
    });

    assert.deepEqual(fallbackUsed, ["safe-default"]);
  });

  it("inspects snapshot files on disk without touching DB", async () => {
    await writePromoSnapshotFile("tariffs", [1, 2, 3], {
      dir: tmpDir,
      now: new Date("2026-11-20T08:10:00.000Z"),
    });

    const statuses = await inspectPromoSnapshots(["tariffs", "missing-set"], { dir: tmpDir });
    assert.equal(statuses.length, 2);
    assert.equal(statuses[0].dataset, "tariffs");
    assert.equal(statuses[0].exists, true);
    assert.equal(statuses[0].generatedAt, "2026-11-20T08:10:00.000Z");
    assert.ok((statuses[0].sizeBytes ?? 0) > 20);
    assert.equal(statuses[1].dataset, "missing-set");
    assert.equal(statuses[1].exists, false);
  });
});
