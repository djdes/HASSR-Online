import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { db } from "@/lib/db";
import { withTranslationOverrides } from "@/lib/translations/overrides.server";
import { writePromoSnapshotFile } from "./store";

const ROOT = process.cwd();

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("promo pages 0-DB-SELECT wiring & semantic HTML5 + AI alternates", () => {
  let tmpDir: string;
  const savedPromoDir = process.env.PROMO_CACHE_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wesetup-zero-db-"));
    process.env.PROMO_CACHE_DIR = tmpDir;
  });

  afterEach(() => {
    if (savedPromoDir === undefined) delete process.env.PROMO_CACHE_DIR;
    else process.env.PROMO_CACHE_DIR = savedPromoDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("public promo pages and PublicHeader use promo-cache & JWT badge instead of direct DB helpers", () => {
    const promoFiles = [
      "src/components/public/public-chrome.tsx",
      "src/app/page.tsx",
      "src/app/pricing/page.tsx",
      "src/app/partners/page.tsx",
      "src/app/uslugi/page.tsx",
      "src/app/blog/page.tsx",
      "src/app/blog/[slug]/page.tsx",
      "src/app/blog/feed.xml/route.ts",
      "src/app/baza-znaniy/page.tsx",
      "src/app/baza-znaniy/[slug]/page.tsx",
      "src/app/journals-info/page.tsx",
      "src/app/journals-info/[code]/page.tsx",
      "src/app/sitemap.ts",
      "src/app/llms.txt/route.ts",
      "src/app/llms-full.txt/route.ts",
      "src/app/promo-md/route.ts",
    ];

    const forbiddenPatterns = [
      { re: /from\s+["']@\/lib\/db["']/, reason: "direct @/lib/db import" },
      { re: /from\s+["']@\/lib\/server-session["']/, reason: "DB-backed getServerSession" },
      { re: /from\s+["']@\/lib\/auth["']/, reason: "authOptions with DB session callback" },
      { re: /\blistPublicReviews\s*\(/, reason: "uncached listPublicReviews()" },
      { re: /\breadPlanPricing\s*\(/, reason: "uncached readPlanPricing()" },
      { re: /\breadActivePromotion\s*\(/, reason: "uncached readActivePromotion()" },
      { re: /\bjournalUsageCount\s*\(/, reason: "uncached journalUsageCount()" },
      { re: /\bgetCurrentRewardRule\s*\(/, reason: "uncached getCurrentRewardRule()" },
      { re: /\breadActiveServices\s*\(/, reason: "uncached readActiveServices()" },
      { re: /\blocalizeArticles\s*\(/, reason: "DB-backed localizeArticles()" },
    ];

    for (const rel of promoFiles) {
      const src = readRepoFile(rel);
      for (const { re, reason } of forbiddenPatterns) {
        assert.doesNotMatch(src, re, `${rel} must not use ${reason}`);
      }
    }
  });

  it("withTranslationOverrides reads translation-overrides.json without querying PostgreSQL", async () => {
    await writePromoSnapshotFile(
      "translation-overrides",
      [{ locale: "en", key: "common.search", value: "Find logs" }],
      { dir: tmpDir },
    );

    const origFindMany = db.translationOverride.findMany;
    db.translationOverride.findMany = (() => {
      throw new Error("DB SELECT forbidden in withTranslationOverrides when snapshot exists");
    }) as typeof origFindMany;

    try {
      const patched = await withTranslationOverrides("en", { common: { search: "Search" } });
      assert.equal(patched.common.search, "Find logs");
    } finally {
      db.translationOverride.findMany = origFindMany;
    }
  });

  it("renders semantic <header>, <main>, <time dateTime>, and text/markdown alternates on promo pages", () => {
    assert.match(readRepoFile("src/components/public/public-chrome.tsx"), /<header\b/);
    assert.match(readRepoFile("src/app/page.tsx"), /<header\b/);

    for (const mainPage of [
      "src/app/page.tsx",
      "src/app/pricing/page.tsx",
      "src/app/uslugi/page.tsx",
      "src/app/blog/page.tsx",
      "src/app/blog/[slug]/page.tsx",
      "src/components/kb/kb-shell.tsx",
      "src/app/journals-info/page.tsx",
      "src/app/journals-info/[code]/page.tsx",
      "src/components/landing/niche-landing.tsx",
      "src/components/landing/seo-journal-landing.tsx",
    ]) {
      assert.match(readRepoFile(mainPage), /<main\b/, `${mainPage} must have semantic <main>`);
    }

    assert.match(readRepoFile("src/app/blog/page.tsx"), /<time\b[^>]*dateTime=/);
    assert.match(readRepoFile("src/app/blog/[slug]/page.tsx"), /<time\b[^>]*dateTime=/);
    assert.match(readRepoFile("src/app/page.tsx"), /text\/markdown/);
    assert.match(readRepoFile("src/app/blog/[slug]/page.tsx"), /text\/markdown/);
    assert.match(readRepoFile("src/app/baza-znaniy/[slug]/page.tsx"), /text\/markdown/);
  });

  it("wires automatic snapshot refresh on admin mutations, deploy prewarm, and poller", () => {
    for (const [rel, expectedDataset] of [
      ["src/app/api/root/tariffs/route.ts", "tariffs"],
      ["src/app/api/root/promotions/route.ts", "promotions"],
      ["src/app/api/root/promotions/[id]/route.ts", "promotions"],
      ["src/lib/balance/reviews.ts", "public-reviews"],
      ["src/lib/partners/accruals.ts", "partner-reward-rule"],
      ["src/app/api/root/services/route.ts", "services"],
      ["src/app/api/root/articles/route.ts", "blog-articles"],
      ["src/app/api/root/articles/[id]/route.ts", "blog-articles"],
      ["src/app/api/root/articles/[id]/translations/[locale]/route.ts", "blog-articles"],
      ["src/lib/translations/editor.server.ts", "translation-overrides"],
      ["prisma/seed-articles.ts", "blog-articles"],
    ] as const) {
      const src = readRepoFile(rel);
      assert.ok(
        src.includes(`"${expectedDataset}"`),
        `${rel} must refresh "${expectedDataset}" promo snapshot`,
      );
    }
    assert.match(readRepoFile("scripts/prewarm-routes.sh"), /refresh-promo-cache\.ts/);
    assert.match(readRepoFile("scripts/telegram-poller.ts"), /refreshAllPromoDatasets/);
  });
});
