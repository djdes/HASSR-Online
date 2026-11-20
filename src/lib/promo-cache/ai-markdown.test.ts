import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { db } from "@/lib/db";
import { planTariffKey } from "@/lib/tariff-plans";
import { PLAN_TARIFF_DEFAULTS } from "@/lib/tariffs";
import {
  alternateMarkdownPath,
  prefersMarkdown,
  renderLlmsFullTxt,
  renderLlmsTxt,
  renderPromoMarkdown,
  resolvePromoMarkdownTarget,
} from "./ai-markdown";
import type { CachedBlogArticleRecord } from "./datasets";
import { writePromoSnapshotFile } from "./store";

describe("AI Markdown delivery & llms.txt from promo JSON cache (0 DB SELECT)", () => {
  let tmpDir: string;
  const restorers: Array<() => void> = [];

  function forbidAllDb() {
    for (const key of [
      "platformTariff",
      "pricePromotion",
      "customerReview",
      "organization",
      "journalDocument",
      "journalTemplate",
      "partnerRewardRule",
      "platformService",
      "article",
      "articleTranslation",
      "translationOverride",
    ] as const) {
      const target = db[key] as unknown as Record<string, unknown> | undefined;
      if (!target || typeof target !== "object") continue;
      for (const method of ["findMany", "findUnique", "findFirst", "count", "groupBy"]) {
        if (typeof target[method] === "function") {
          const orig = target[method];
          target[method] = () => {
            throw new Error(`DB call forbidden during AI Markdown render: db.${key}.${method}()`);
          };
          restorers.push(() => {
            target[method] = orig;
          });
        }
      }
    }
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wesetup-ai-md-"));

    await writePromoSnapshotFile(
      "tariffs",
      PLAN_TARIFF_DEFAULTS.map((t) =>
        t.key === planTariffKey("standard", "year") ? { ...t, priceRub: 1590 } : t,
      ),
      { dir: tmpDir },
    );
    await writePromoSnapshotFile("promotions", [], { dir: tmpDir });
    await writePromoSnapshotFile(
      "public-reviews",
      [
        {
          id: "r1",
          quote: "Все журналы в порядке",
          author: "Елена",
          place: "Столовая №1",
          rating: 5,
          mediaUrl: null,
          mediaKind: null,
          anonymous: false,
          stats: null,
        },
      ],
      { dir: tmpDir },
    );
    await writePromoSnapshotFile("journal-usage", { hygiene: 85 }, { dir: tmpDir });
    await writePromoSnapshotFile(
      "partner-reward-rule",
      {
        version: 2,
        subscriptionPercent: 30,
        subscriptionMonths: 12,
        hardwarePercent: 10,
        bonusAmountRub: 5000,
        bonusAfterPayments: 3,
        minPayoutRub: 3000,
      },
      { dir: tmpDir },
    );
    await writePromoSnapshotFile(
      "services",
      [
        {
          key: "audit-rpn",
          title: "Аудит перед проверкой РПН",
          summary: "Полная ревизия",
          description: "Проверяем журналы и маркировку.",
          priceRub: null,
          priceFrom: true,
          unit: null,
          category: "audit",
          active: true,
          sort: 1,
        },
      ],
      { dir: tmpDir },
    );
    const articles: CachedBlogArticleRecord[] = [
      {
        id: "a1",
        slug: "kak-proyti-proverku-rpn",
        title: "Как пройти проверку Роспотребнадзора в 2026 году",
        excerpt: "Пошаговый разбор документов и электронных журналов.",
        body: [
          { type: "p", text: "Инспектор проверяет полноту записей и подписи." },
          { type: "h2", text: "Основные журналы" },
          { type: "ul", items: ["Гигиенический журнал", "Температура холодильников"] },
          { type: "faq", items: [{ q: "Принимают ли электронный вид?", a: "Да, по СанПиН." }] },
        ],
        coverIcon: "ClipboardList",
        tags: ["Проверки", "СанПиН"],
        readMinutes: 6,
        publishedAt: "2026-11-10T09:00:00.000Z",
        updatedAt: "2026-11-10T09:00:00.000Z",
        translations: [],
      },
    ];
    await writePromoSnapshotFile("blog-articles", articles, { dir: tmpDir });
    await writePromoSnapshotFile("translation-overrides", [], { dir: tmpDir });
  });

  afterEach(() => {
    while (restorers.length > 0) restorers.pop()?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("negotiates Accept: text/markdown accurately without false positives on browsers", () => {
    assert.equal(prefersMarkdown("text/markdown"), true);
    assert.equal(prefersMarkdown("text/markdown; charset=utf-8, text/html;q=0.5"), true);
    assert.equal(prefersMarkdown("text/x-markdown, */*;q=0.1"), true);

    assert.equal(
      prefersMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
      false,
    );
    assert.equal(prefersMarkdown("*/*"), false);
    assert.equal(prefersMarkdown("text/markdown;q=0"), false);
    assert.equal(prefersMarkdown(null), false);
  });

  it("maps .md URLs only for public cacheable promo routes", () => {
    assert.equal(resolvePromoMarkdownTarget("/index.md"), "/");
    assert.equal(resolvePromoMarkdownTarget("/en/index.md"), "/en");
    assert.equal(resolvePromoMarkdownTarget("/pricing.md"), "/pricing");
    assert.equal(resolvePromoMarkdownTarget("/blog/kak-proyti-proverku-rpn.md"), "/blog/kak-proyti-proverku-rpn");
    assert.equal(resolvePromoMarkdownTarget("/baza-znaniy/registraciya.md"), "/baza-znaniy/registraciya");
    assert.equal(resolvePromoMarkdownTarget("/journals-info/hygiene.md"), "/journals-info/hygiene");
    assert.equal(resolvePromoMarkdownTarget("/dlya-kafe.md"), "/dlya-kafe");

    assert.equal(resolvePromoMarkdownTarget("/dashboard.md"), null);
    assert.equal(resolvePromoMarkdownTarget("/root.md"), null);
    assert.equal(resolvePromoMarkdownTarget("/login.md"), null);
    assert.equal(resolvePromoMarkdownTarget("/api/status.md"), null);
    assert.equal(resolvePromoMarkdownTarget("/llms.txt"), null);

    assert.equal(alternateMarkdownPath("/"), "/index.md");
    assert.equal(alternateMarkdownPath("/en"), "/en/index.md");
    assert.equal(alternateMarkdownPath("/blog/test"), "/blog/test.md");
  });

  it("renders Markdown for landings, blog, knowledge base, and catalog with 0 DB SELECTs", async () => {
    forbidAllDb();
    const now = new Date("2026-11-20T12:00:00.000Z");

    const home = await renderPromoMarkdown("/", { dir: tmpDir, now });
    assert.ok(home);
    assert.match(home.markdown, /^# /m);
    assert.ok(home.markdown.includes("1 590") || home.markdown.includes("1\u00a0590") || home.markdown.includes("1590"));

    const blogIndex = await renderPromoMarkdown("/blog", { dir: tmpDir, now });
    assert.ok(blogIndex);
    assert.ok(blogIndex.markdown.includes("Как пройти проверку Роспотребнадзора в 2026 году"));

    const blogPost = await renderPromoMarkdown("/blog/kak-proyti-proverku-rpn", { dir: tmpDir, now });
    assert.ok(blogPost);
    assert.ok(blogPost.markdown.includes("# Как пройти проверку Роспотребнадзора в 2026 году"));
    assert.ok(blogPost.markdown.includes("## Основные журналы"));
    assert.ok(blogPost.markdown.includes("Принимают ли электронный вид?"));

    const kbIndex = await renderPromoMarkdown("/baza-znaniy", { dir: tmpDir, now });
    assert.ok(kbIndex);
    assert.ok(kbIndex.markdown.includes("База знаний WeSetup"));

    const kbArticle = await renderPromoMarkdown("/baza-znaniy/registraciya", { dir: tmpDir, now });
    assert.ok(kbArticle);
    assert.ok(kbArticle.markdown.includes("# Регистрация: пошагово"));

    const journal = await renderPromoMarkdown("/journals-info/hygiene", { dir: tmpDir, now });
    assert.ok(journal);
    assert.ok(journal.markdown.includes("85"));

    const niche = await renderPromoMarkdown("/dlya-kafe", { dir: tmpDir, now });
    assert.ok(niche);
    assert.match(niche.markdown, /^# /m);

    const feature = await renderPromoMarkdown("/features/qr", { dir: tmpDir, now });
    assert.ok(feature);
    assert.ok(feature.markdown.includes("QR"));

    // Unknown URLs must return null so the route responds with a true 404
    assert.equal(await renderPromoMarkdown("/blog/missing-slug-404", { dir: tmpDir, now }), null);
    assert.equal(await renderPromoMarkdown("/baza-znaniy/missing-kb-404", { dir: tmpDir, now }), null);
    assert.equal(await renderPromoMarkdown("/journals-info/missing_code_404", { dir: tmpDir, now }), null);
    assert.equal(await renderPromoMarkdown("/non-existent-landing-404", { dir: tmpDir, now }), null);

    const llms = await renderLlmsTxt({ dir: tmpDir, now });
    assert.match(llms, /^# WeSetup/m);
    assert.ok(llms.includes("https://wesetup.ru/baza-znaniy"));
    assert.ok(llms.includes("kak-proyti-proverku-rpn"));
    assert.ok(llms.includes("llms-full.txt"));

    const llmsFull = await renderLlmsFullTxt({ dir: tmpDir, now });
    assert.match(llmsFull, /^# WeSetup/m);
    assert.ok(llmsFull.includes("Регистрация: пошагово"));
    assert.ok(llmsFull.includes("Аудит перед проверкой РПН"));
  });
});
