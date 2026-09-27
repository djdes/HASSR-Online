import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  BUILD_CHECK_THROTTLE_MS,
  buildCheckAction,
  normalizeBuildId,
  shouldCheckBuild,
} from "@/lib/build-version";

const OLD = "1c5af39";
const NEW = "82fd8cb";

describe("normalizeBuildId", () => {
  it("первые 7 символов sha, пусто и dev — нет версии", () => {
    assert.equal(normalizeBuildId("82fd8cbe4a1d"), NEW);
    assert.equal(normalizeBuildId("  82fd8cb \n"), NEW);
    assert.equal(normalizeBuildId(""), null);
    assert.equal(normalizeBuildId("dev"), null);
    assert.equal(normalizeBuildId(undefined), null);
  });
});

describe("shouldCheckBuild", () => {
  it("загрузка и опрос — всегда; возврат и переход — не чаще порога", () => {
    assert.equal(shouldCheckBuild("start", 1_000, 999), true);
    assert.equal(shouldCheckBuild("poll", 1_000, 999), true);
    assert.equal(shouldCheckBuild("return", 1_000 + BUILD_CHECK_THROTTLE_MS - 1, 1_000), false);
    assert.equal(shouldCheckBuild("navigation", 1_000 + BUILD_CHECK_THROTTLE_MS, 1_000), true);
  });
});

describe("buildCheckAction", () => {
  const base = { pageBuildId: OLD, serverBuildId: NEW, reloadedFor: null, notified: false };

  it("версии совпадают или неизвестны — ничего", () => {
    assert.equal(buildCheckAction({ ...base, reason: "return", serverBuildId: OLD }), "none");
    assert.equal(buildCheckAction({ ...base, reason: "navigation", serverBuildId: null }), "none");
    assert.equal(buildCheckAction({ ...base, reason: "start", pageBuildId: null }), "none");
  });

  it("вкладку открыли со старой страницей или перешли по сайту — перезагрузка", () => {
    assert.equal(buildCheckAction({ ...base, reason: "start" }), "reload");
    assert.equal(buildCheckAction({ ...base, reason: "navigation" }), "reload");
  });

  it("вернулись во вкладку или сработал опрос — плашка «Обновить», не перезагрузка (там может быть введённое)", () => {
    assert.equal(buildCheckAction({ ...base, reason: "return" }), "notify");
    assert.equal(buildCheckAction({ ...base, reason: "poll" }), "notify");
    assert.equal(buildCheckAction({ ...base, reason: "poll", notified: true }), "none");
  });

  it("уже перезагружались ради этой сборки, а версии всё равно разные — без цикла, только плашка", () => {
    assert.equal(buildCheckAction({ ...base, reason: "navigation", reloadedFor: NEW }), "notify");
    assert.equal(buildCheckAction({ ...base, reason: "start", reloadedFor: NEW, notified: true }), "none");
  });
});

describe("проводка", () => {
  const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

  it("/api/build-info отдаёт запечённую версию сборки, а не только .build-sha", () => {
    const source = read("src/app/api/build-info/route.ts");
    assert.match(source, /normalizeBuildId\(process\.env\.NEXT_PUBLIC_BUILD_ID\)/);
  });

  it("вотчер проверяет сборку при возврате во вкладку и при переходах", () => {
    const source = read("src/components/layout/build-version-watcher.tsx");
    assert.match(source, /visibilitychange/);
    assert.match(source, /pageshow/);
    assert.match(source, /check\("navigation"\)/);
  });
});
