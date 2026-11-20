import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { articleSourceHash } from "@/lib/article-localization";
import { db } from "@/lib/db";
import { planTariffKey } from "@/lib/tariff-plans";
import { PLAN_TARIFF_DEFAULTS } from "@/lib/tariffs";
import {
  PROMO_DATASETS,
  type CachedBlogArticleRecord,
  type CachedPromotionRecord,
  readPromoActivePromotion,
  readPromoActiveServices,
  readPromoBlogArticleDetail,
  readPromoJournalUsageCount,
  readPromoPartnerRewardRule,
  readPromoPlanPricing,
  readPromoPublicReviews,
  readPromoPublishedArticles,
  readPromoSitemapArticles,
  readPromoTranslationOverrides,
} from "./datasets";
import { writePromoSnapshotFile } from "./store";

describe("promo-cache datasets (0 SELECT guarantee & time-window evaluation)", () => {
  let tmpDir: string;
  const restorers: Array<() => void> = [];

  function forbidDbModel(modelName: keyof typeof db) {
    const target = db[modelName] as Record<string, unknown> | undefined;
    if (!target || typeof target !== "object") return;
    for (const method of ["findMany", "findUnique", "findFirst", "count", "groupBy", "create", "createMany", "update", "updateMany"]) {
      if (typeof target[method] === "function") {
        const orig = target[method];
        target[method] = () => {
          throw new Error(`DB query forbidden on warm promo cache: db.${String(modelName)}.${method}()`);
        };
        restorers.push(() => {
          target[method] = orig;
        });
      }
    }
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wesetup-promo-datasets-"));
  });

  afterEach(() => {
    while (restorers.length > 0) {
      restorers.pop()?.();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves all 8 promo datasets from JSON files with 0 database queries", async () => {
    await writePromoSnapshotFile(
      "tariffs",
      PLAN_TARIFF_DEFAULTS.map((t) =>
        t.key === planTariffKey("standard", "month") ? { ...t, priceRub: 2490 } : t,
      ),
      { dir: tmpDir },
    );

    const promos: CachedPromotionRecord[] = [
      {
        id: "promo_1",
        title: "Осенняя скидка",
        percent: 20,
        startsAt: "2026-11-15T00:00:00.000Z",
        endsAt: "2026-11-25T00:00:00.000Z",
        active: true,
      },
    ];
    await writePromoSnapshotFile("promotions", promos, { dir: tmpDir });

    await writePromoSnapshotFile(
      "public-reviews",
      [
        {
          id: "rev_1",
          quote: "Отлично закрыли проверку РПН",
          author: "Мария",
          place: "Кафе Уют",
          rating: 5,
          mediaUrl: null,
          mediaKind: null,
          anonymous: false,
          stats: null,
        },
        {
          id: "rev_2",
          quote: "Экономим по 30 минут в смену",
          author: "Олег",
          place: "Пекарня Хлеб",
          rating: 5,
          mediaUrl: null,
          mediaKind: null,
          anonymous: false,
          stats: null,
        },
      ],
      { dir: tmpDir },
    );

    await writePromoSnapshotFile(
      "journal-usage",
      { hygiene: 148, cold_equipment_control: 215 },
      { dir: tmpDir },
    );

    await writePromoSnapshotFile(
      "partner-reward-rule",
      {
        version: 3,
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
          key: "haccp-audit",
          title: "Аудит перед проверкой",
          summary: "Разбор рисков",
          description: "Полный аудит",
          priceRub: null,
          priceFrom: true,
          unit: null,
          category: "audit",
          active: true,
          sort: 1,
        },
        {
          key: "hidden-svc",
          title: "Скрытая услуга",
          summary: "Нет",
          description: "Нет",
          priceRub: 1000,
          priceFrom: false,
          unit: null,
          category: "consult",
          active: false,
          sort: 2,
        },
      ],
      { dir: tmpDir },
    );

    const art1Base = {
      title: "Гигиенический журнал по СанПиН",
      excerpt: "Как заполнять журнал здоровья смены.",
      body: [{ type: "p", text: "Текст статьи на русском." }],
      tags: ["СанПиН", "Гигиена"],
    };
    const art1EnHash = articleSourceHash(art1Base);
    const blogRecords: CachedBlogArticleRecord[] = [
      {
        id: "art_1",
        slug: "gigienicheskiy-zhurnal",
        ...art1Base,
        coverIcon: "ClipboardList",
        readMinutes: 5,
        publishedAt: "2026-11-01T09:00:00.000Z",
        updatedAt: "2026-11-02T10:00:00.000Z",
        translations: [
          {
            locale: "en",
            sourceHash: art1EnHash,
            title: "Hygiene Log Under SanPiN",
            excerpt: "How to fill out the shift health log.",
            body: [{ type: "p", text: "Article body in English." }],
            tags: ["SanPiN", "Hygiene"],
          },
        ],
      },
      {
        id: "art_2",
        slug: "kontrol-holodilnikov",
        title: "Температура холодильников",
        excerpt: "Нормы хранения и контроль.",
        body: [{ type: "p", text: "Вторая статья." }],
        coverIcon: null,
        tags: ["СанПиН", "Холодильники"],
        readMinutes: 4,
        publishedAt: "2026-10-20T09:00:00.000Z",
        updatedAt: "2026-10-20T09:00:00.000Z",
        translations: [],
      },
      {
        id: "art_future",
        slug: "budushchaya-statya",
        title: "Выйдет в декабре",
        excerpt: "Отложенная публикация.",
        body: [{ type: "p", text: "Ещё не опубликована." }],
        coverIcon: null,
        tags: ["СанПиН"],
        readMinutes: 3,
        publishedAt: "2026-12-15T09:00:00.000Z",
        updatedAt: "2026-11-19T09:00:00.000Z",
        translations: [],
      },
    ];
    await writePromoSnapshotFile("blog-articles", blogRecords, { dir: tmpDir });

    await writePromoSnapshotFile(
      "translation-overrides",
      [{ locale: "ru", key: "common.search", value: "Найти" }],
      { dir: tmpDir },
    );

    // Poison every relevant Prisma model so ANY accidental SELECT throws immediately
    forbidDbModel("platformTariff");
    forbidDbModel("pricePromotion");
    forbidDbModel("customerReview");
    forbidDbModel("organization");
    forbidDbModel("journalDocument");
    forbidDbModel("journalTemplate");
    forbidDbModel("partnerRewardRule");
    forbidDbModel("platformService");
    forbidDbModel("article");
    forbidDbModel("articleTranslation");
    forbidDbModel("translationOverride");

    assert.equal(PROMO_DATASETS.length, 8);

    const pricing = await readPromoPlanPricing({ dir: tmpDir });
    assert.equal(pricing.rates.standard.month, 2490);

    const activePromo = await readPromoActivePromotion(new Date("2026-11-20T12:00:00.000Z"), { dir: tmpDir });
    assert.equal(activePromo?.percent, 20);

    const expiredPromo = await readPromoActivePromotion(new Date("2026-11-26T00:00:00.000Z"), { dir: tmpDir });
    assert.equal(expiredPromo, null);

    const reviews = await readPromoPublicReviews(1, { dir: tmpDir });
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].id, "rev_1");

    assert.equal(await readPromoJournalUsageCount("hygiene", { dir: tmpDir }), 148);
    assert.equal(await readPromoJournalUsageCount("unknown_code", { dir: tmpDir }), 0);

    const rule = await readPromoPartnerRewardRule({ dir: tmpDir });
    assert.equal(rule.subscriptionPercent, 30);

    const services = await readPromoActiveServices({ dir: tmpDir });
    assert.equal(services.length, 1);
    assert.equal(services[0].key, "haccp-audit");

    const nowNov = new Date("2026-11-20T12:00:00.000Z");
    const ruList = await readPromoPublishedArticles("ru", nowNov, { dir: tmpDir });
    assert.deepEqual(ruList.map((a) => a.slug), ["gigienicheskiy-zhurnal", "kontrol-holodilnikov"]);

    const enDetail = await readPromoBlogArticleDetail("gigienicheskiy-zhurnal", "en", nowNov, { dir: tmpDir });
    assert.ok(enDetail);
    assert.equal(enDetail.article.title, "Hygiene Log Under SanPiN");
    assert.equal(enDetail.article.contentLocale, "en");
    assert.equal(enDetail.related.length, 1);
    assert.equal(enDetail.related[0].slug, "kontrol-holodilnikov");

    // Future scheduled article is hidden in November, visible in December without any DB rebuild
    const futureHidden = await readPromoBlogArticleDetail("budushchaya-statya", "ru", nowNov, { dir: tmpDir });
    assert.equal(futureHidden, null);

    const nowDec = new Date("2026-12-20T12:00:00.000Z");
    const futureVisible = await readPromoBlogArticleDetail("budushchaya-statya", "ru", nowDec, { dir: tmpDir });
    assert.equal(futureVisible?.article.title, "Выйдет в декабре");

    const sitemapNov = await readPromoSitemapArticles(nowNov, { dir: tmpDir });
    assert.equal(sitemapNov.length, 2);

    const overrides = await readPromoTranslationOverrides({ dir: tmpDir });
    assert.deepEqual(overrides, [{ locale: "ru", key: "common.search", value: "Найти" }]);
  });
});
