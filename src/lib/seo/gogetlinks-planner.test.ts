import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  computeScheduleDates,
  scoreTargetPages,
  selectAnchorForTarget,
  selectBestDonorAndAlternatives,
} from "@/lib/seo/gogetlinks-planner";
import {
  extractSimilarwebSnapshotFromImages,
  generateGglArticleDraft,
} from "@/lib/seo/gogetlinks-article-ai.server";

const requireCjs = createRequire(import.meta.url);

function loadRouteFixture<T>(file: string, mocks: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(output, {
    module: fixtureModule,
    exports: fixtureModule.exports,
    console,
    process,
    Date,
    Response,
    Request,
    Headers,
    FormData,
    Blob,
    File,
    Uint8Array,
    URL,
    URLSearchParams,
    require: (id: string) => (Object.hasOwn(mocks, id) ? mocks[id] : requireCjs(id)),
  });
  return fixtureModule.exports as T;
}

test("Review Focus #5: scoreTargetPages handles Topvisor '--' without NaN and boosts positions 4-30 with 0 links", () => {
  const ranked = scoreTargetPages({
    clusters: [
      {
        domain: "haccp-online.ru",
        phrase: "бракеражный журнал готовой продукции",
        trafficSharePct: 17.61,
        channel: "paid",
        mappedTargetUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
      },
      {
        domain: "checkoffice.ru",
        phrase: "чек-лист приемки сырья",
        trafficSharePct: 11.26,
        channel: "organic",
        mappedTargetUrl: "/blog/chek-list-priemki-syrya-v-restorane",
      },
    ],
    topvisorRows: [
      {
        phrase: "бракеражный журнал готовой продукции",
        yandexPos: "11",
        googlePos: "--",
        relevantUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
      },
      {
        phrase: "чек-лист приемки сырья",
        yandexPos: "--",
        googlePos: "--",
        relevantUrl: "/blog/old-slug",
      },
    ],
    existingOrders: [],
    candidatePages: [
      {
        url: "/zhurnal-brakerazha-gotovoy-produkcii",
        title: "Бракеражный журнал готовой продукции",
      },
      {
        url: "/blog/chek-list-priemki-syrya-v-restorane",
        title: "Чек-лист приёмки сырья в ресторане",
      },
    ],
  });

  assert.equal(ranked.length, 2);
  assert.ok(ranked.every((r) => Number.isFinite(r.score)));
  assert.equal(ranked[0].targetUrl, "/zhurnal-brakerazha-gotovoy-produkcii");
  assert.equal(ranked[0].yandexPos, 11);
  assert.equal(ranked[0].googlePos, null);
  assert.equal(ranked[1].yandexPos, null);
  assert.match(ranked[0].selectionReason, /17\.61%.*11/);
});

test("Review Focus #5: selectAnchorForTarget prevents exact-anchor over-optimization and enforces >= 50% brand/URL mix", () => {
  const first = selectAnchorForTarget({
    targetUrl: "https://wesetup.ru/zhurnal-brakerazha-gotovoy-produkcii",
    keyword: "бракеражный журнал готовой продукции",
    existingAnchors: [{ anchorKind: "exact" }],
    minBrandPct: 50,
  });
  assert.equal(first.anchorKind, "url_brand");

  // Once brand mix is satisfied (>= 50%) and 1 exact anchor already exists, next non-brand anchor is diluted (not a duplicate exact)
  const nextNonBrand = selectAnchorForTarget({
    targetUrl: "https://wesetup.ru/zhurnal-brakerazha-gotovoy-produkcii",
    keyword: "бракеражный журнал готовой продукции",
    existingAnchors: [
      { anchorKind: "exact" },
      { anchorKind: "url_brand" },
      { anchorKind: "url_brand" },
    ],
    minBrandPct: 50,
  });
  assert.equal(nextNonBrand.anchorKind, "diluted");
  assert.match(nextNonBrand.anchor, /бракеражный журнал готовой продукции/i);
  assert.notEqual(nextNonBrand.anchor, "бракеражный журнал готовой продукции");
});

test("selectBestDonorAndAlternatives excludes used domains (1 donor = 1 link) and caps at maxPricePerLinkRub", () => {
  const res = selectBestDonorAndAlternatives(
    [
      {
        siteId: 1,
        domain: "used-horeca.ru",
        priceArticleRub: 700,
        priceNoteRub: 600,
        tf: 20,
        cf: 25,
        trust: 7,
        dailyTraffic: 1500,
        indexedYandex: true,
        indexedGoogle: true,
      },
      {
        siteId: 2,
        domain: "expensive.ru",
        priceArticleRub: 1500,
        priceNoteRub: 1400,
        tf: 30,
        cf: 30,
        trust: 9,
        dailyTraffic: 5000,
        indexedYandex: true,
        indexedGoogle: true,
      },
      {
        siteId: 3,
        domain: "food-safety.ru",
        priceArticleRub: 850,
        priceNoteRub: 750,
        tf: 16,
        cf: 22,
        trust: 6,
        dailyTraffic: 900,
        indexedYandex: true,
        indexedGoogle: true,
      },
      {
        siteId: 4,
        domain: "obshchepit-news.ru",
        priceArticleRub: null,
        priceNoteRub: 800,
        tf: 14,
        cf: 19,
        trust: 5,
        dailyTraffic: 700,
        indexedYandex: true,
        indexedGoogle: true,
      },
    ],
    new Set(["used-horeca.ru"]),
    {
      maxPricePerLinkRub: 1000,
      minTfCf: 10,
      minTrust: 4,
      minDailyTraffic: 100,
      allowedFormats: ["article", "note"],
    },
  );
  assert.equal(res.primary?.domain, "food-safety.ru");
  assert.equal(res.primary?.selectedFormat, "article");
  assert.equal(res.primary?.selectedPriceRub, 850);
  assert.equal(res.alternatives.length, 1);
  assert.equal(res.alternatives[0].domain, "obshchepit-news.ru");
  assert.equal(res.alternatives[0].selectedFormat, "note");
});

test("computeScheduleDates respects 10 000 ₽ one_time cap and startsAt", () => {
  const slots = computeScheduleDates(
    {
      kind: "one_time",
      budgetRub: 10000,
      maxPricePerLinkRub: 1000,
      startsAt: new Date("2026-11-06T00:00:00Z"),
      scheduleDaysOfWeek: [2, 5],
      alreadyCommittedRub: 8000,
    },
    new Set(["2026-11-06"]),
    new Date("2026-11-05T12:00:00Z"),
    30,
  );
  // Remaining budget 2 000 ₽ at max 1 000 ₽/link => at most 2 new slots, skipping already scheduled 2026-11-06:
  assert.equal(slots.length, 2);
  assert.ok(!slots.some((s) => s.scheduledDate === "2026-11-06"));
  assert.deepEqual(
    slots.map((s) => s.scheduledDate),
    ["2026-11-10", "2026-11-13"],
  );
});

test("computeScheduleDates respects 5 000 ₽/мес monthly window cap vs alreadyCommittedRub and resets in next month", () => {
  // Within November only (horizon 15 days from 2026-11-10 => Nov 10..Nov 24):
  // Budget 5 000 ₽/мес, alreadyCommittedRub 3 000 ₽, max 1 000 ₽/link => only 2 slots allowed in November
  const novOnly = computeScheduleDates(
    {
      kind: "monthly",
      budgetRub: 5000,
      maxPricePerLinkRub: 1000,
      startsAt: new Date("2026-11-01T00:00:00Z"),
      scheduleDaysOfWeek: [2, 5],
      alreadyCommittedRub: 3000,
    },
    new Set(),
    new Date("2026-11-10T09:00:00Z"),
    15,
  );
  assert.equal(novOnly.length, 2);
  assert.ok(novOnly.every((s) => s.scheduledDate.startsWith("2026-11-")));
  assert.ok(novOnly.every((s) => s.maxPriceRub === 1000));

  // Cross-month horizon (30 days from 2026-11-20 => Nov 20..Dec 19):
  // alreadyCommittedRub = 4 000 ₽ in Nov => 1 slot in Nov ("2026-11-*") and up to 5 slots in Dec ("2026-12-*")
  const crossMonth = computeScheduleDates(
    {
      kind: "monthly",
      budgetRub: 5000,
      maxPricePerLinkRub: 1000,
      startsAt: new Date("2026-11-01T00:00:00Z"),
      scheduleDaysOfWeek: [2, 5],
      alreadyCommittedRub: 4000,
    },
    new Set(),
    new Date("2026-11-20T09:00:00Z"),
    30,
  );
  const novSlots = crossMonth.filter((s) => s.scheduledDate.startsWith("2026-11-"));
  const decSlots = crossMonth.filter((s) => s.scheduledDate.startsWith("2026-12-"));
  assert.equal(novSlots.length, 1);
  assert.equal(decSlots.length, 5);
});

test("dispatcher/wesetup-worker.ps1 registers wesetup_ggl_article and remains strictly ASCII-only", () => {
  const ps1 = readFileSync("dispatcher/wesetup-worker.ps1", "utf8");
  assert.match(ps1, /'wesetup_ggl_article'/);
  assert.equal(
    /[^\x00-\x7F]/.test(ps1),
    false,
    "wesetup-worker.ps1 must stay ASCII-only for PowerShell 5.1",
  );
});

test("generateGglArticleDraft builds wesetup_ggl_article prompt with <page_context> and SanPiN guardrails, strips fences and enforces exact wesetup.ru anchor", async () => {
  let capturedPrompt = "";
  const draft = await generateGglArticleDraft(
    {
      donorDomain: "food-safety.ru",
      targetUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
      targetPageTitle: "Бракеражный журнал готовой продукции",
      targetPageFacts: [
        "Ведётся по каждой партии приготовленных блюд до начала раздачи",
        "Электронная подпись членов бракеражной комиссии в WeSetup",
      ],
      targetKeyword: "бракеражный журнал готовой продукции",
      anchor: "бракеражный журнал готовой продукции",
      placementFormat: "article",
    },
    {
      enqueue: async (inputText) => {
        capturedPrompt = inputText;
        return {
          ok: true,
          jobId: "job_art_1",
          text: [
            "```json",
            JSON.stringify({
              title: "Как организовать бракераж готовых блюд без бумажной рутины",
              announcement:
                "Разбираем порядок органолептической оценки партий по СанПиН 2.3/2.4.3590-20 и переход на электронный учёт.",
              bodyHtml:
                '<h2>Требования к бракеражной комиссии</h2><p>Перед выдачей блюд комиссия заполняет <a href="https://wesetup.ru/zhurnal-brakerazha-gotovoy-produkcii">бракеражный журнал готовой продукции</a> с указанием времени снятия пробы и разрешения на реализацию.</p>',
              metaTitle: "Бракераж готовых блюд на пищеблоке по СанПиН",
              metaDescription: "Практика ведения бракеражного журнала готовой продукции в общепите.",
              metaKeywords: "бракераж, общепит, ХАССП, СанПиН",
              briefText: "Профильная статья для раздела санитарной безопасности общепита.",
            }),
            "```",
          ].join("\n"),
        };
      },
    },
  );

  assert.match(capturedPrompt, /^type:\s*wesetup_ggl_article\b/);
  assert.match(capturedPrompt, /<page_context>[\s\S]*<\/page_context>/);
  assert.match(capturedPrompt, /2\.3\/2\.4\.3590-20/);
  assert.match(capturedPrompt, /4282-26/);
  assert.equal(draft.title, "Как организовать бракераж готовых блюд без бумажной рутины");
  assert.match(
    draft.bodyHtml,
    /<a href="https:\/\/wesetup\.ru\/zhurnal-brakerazha-gotovoy-produkcii">бракеражный журнал готовой продукции<\/a>/,
  );

  // Missing exact link when placementFormat === "article" must be rejected
  await assert.rejects(
    () =>
      generateGglArticleDraft(
        {
          donorDomain: "food-safety.ru",
          targetUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
          targetPageTitle: "Бракеражный журнал готовой продукции",
          targetPageFacts: ["Факт 1"],
          targetKeyword: "бракеражный журнал готовой продукции",
          anchor: "бракеражный журнал готовой продукции",
          placementFormat: "article",
        },
        {
          enqueue: async () => ({
            ok: true,
            jobId: "job_art_bad",
            text: JSON.stringify({
              title: "Статья без ссылки",
              announcement: "Краткий анонс статьи без нужной анкорной ссылки.",
              bodyHtml: "<p>Обычный абзац без ссылки на посадочную страницу.</p>",
              metaTitle: "Мета",
              metaDescription: "Описание",
              metaKeywords: "хассп",
              briefText: "",
            }),
          }),
        },
      ),
    /ссылк|href|anchor/i,
  );
});

test("extractSimilarwebSnapshotFromImages runs wesetup_vision_extract pipeline and deletes temp images in finally even on error", async () => {
  const deletedBatches: string[][] = [];
  let capturedVisionJob = "";

  const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  const parsed = await extractSimilarwebSnapshotFromImages(
    {
      images: [fakePng],
      user: { id: "u_root", name: "Олег" },
    },
    {
      sweepExpired: async () => 0,
      saveImage: async () => ({
        id: "0123456789abcdef0123456789abcdef-png",
        mime: "image/png",
        path: "/tmp/0123456789abcdef0123456789abcdef-png",
      }),
      deleteImages: async (ids) => {
        deletedBatches.push([...ids]);
        return ids.length;
      },
      resolveBaseUrl: async () => "https://wesetup.ru",
      signImageUrl: (baseUrl, id) => `${baseUrl}/api/ai/vision-image/${id}?exp=9999999999999&sig=abc`,
      enqueue: async (jobText) => {
        capturedVisionJob = jobText;
        return {
          ok: true,
          jobId: "job_vis_1",
          text: "```json\n" +
            JSON.stringify({
              domain: "https://www.haccp-online.ru/",
              periodLabel: "Oct–Dec 2026",
              visitsMonthly: 16400,
              organicSharePct: 14.2,
              paidSharePct: 21.5,
              bouncePct: 38.4,
              pagesPerVisit: 2.1,
              clusters: [
                {
                  phrase: "бракеражный журнал готовой продукции",
                  trafficSharePct: 19.4,
                  channel: "paid",
                  mappedTargetUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
                  notes: "Рост платного трафика",
                },
              ],
            }) +
            "\n```",
        };
      },
    },
  );

  assert.match(capturedVisionJob, /^type:\s*wesetup_vision_extract\b/);
  assert.equal(parsed.domain, "haccp-online.ru");
  assert.equal(parsed.visitsMonthly, 16400);
  assert.equal(parsed.clusters.length, 1);
  assert.deepEqual(deletedBatches, [["0123456789abcdef0123456789abcdef-png"]]);

  // Verify cleanup still happens if enqueue fails
  await assert.rejects(
    () =>
      extractSimilarwebSnapshotFromImages(
        {
          images: [fakePng],
          user: { id: "u_root", name: "Олег" },
        },
        {
          sweepExpired: async () => 0,
          saveImage: async () => ({
            id: "fedcba9876543210fedcba9876543210-png",
            mime: "image/png",
            path: "/tmp/fedcba9876543210fedcba9876543210-png",
          }),
          deleteImages: async (ids) => {
            deletedBatches.push([...ids]);
            return ids.length;
          },
          resolveBaseUrl: async () => "https://wesetup.ru",
          signImageUrl: (baseUrl, id) => `${baseUrl}/api/ai/vision-image/${id}?exp=9999999999999&sig=abc`,
          enqueue: async () => ({
            ok: false,
            code: "timeout",
            error: "ИИ не ответил вовремя",
          }),
        },
      ),
    /не ответил|timeout/i,
  );
  assert.deepEqual(deletedBatches[1], ["fedcba9876543210fedcba9876543210-png"]);
});

test("GET and POST /api/root/gogetlinks/similarweb upsert snapshot, log ggl.similarweb.import and return scoreTargetPages matrix", async () => {
  const auditEvents: Array<Record<string, unknown>> = [];
  const snapshotStore = new Map<string, Record<string, unknown>>();

  const mockDb = {
    seoCompetitorSnapshot: {
      findMany: async () => [...snapshotStore.values()],
      upsert: async (args: {
        where: { domain_periodLabel: { domain: string; periodLabel: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = `${args.where.domain_periodLabel.domain}::${args.where.domain_periodLabel.periodLabel}`;
        const existing = snapshotStore.get(key);
        const row = existing
          ? { ...existing, ...args.update }
          : {
              id: `snap_${snapshotStore.size + 1}`,
              createdAt: new Date("2026-11-05T12:00:00Z"),
              ...args.create,
            };
        snapshotStore.set(key, row);
        return row;
      },
    },
    gglOrder: {
      findMany: async () => [],
    },
    article: {
      findMany: async () => [
        {
          slug: "chek-list-priemki-syrya-v-restorane",
          title: "Чек-лист приёмки сырья в ресторане",
          excerpt: "Входной контроль продуктов по СанПиН",
          tags: ["ХАССП"],
        },
      ],
    },
  };

  const routeModule = loadRouteFixture<{
    runtime: string;
    dynamic: string;
    maxDuration: number;
    GET: (req: Request) => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/similarweb/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({
        user: { id: "u_seo", name: "Анна SEO", email: "seo@wesetup.ru", isRoot: false },
      }),
    },
    "@/lib/db": { db: mockDb },
    "@/lib/audit-helper": {
      audit: async (args: Record<string, unknown>) => {
        auditEvents.push(args);
      },
    },
    "@/lib/seo/similarweb-seed": {
      ensureDefaultSimilarwebSnapshots: async () => 0,
    },
    "@/lib/topvisor": {
      isTopvisorConfigured: () => true,
      getPositionsHistory: async ({ regionIndex }: { regionIndex: number }) => ({
        dates: ["2026-11-05"],
        existsDates: ["2026-11-05"],
        rows:
          regionIndex === 1
            ? [
                {
                  phrase: "бракеражный журнал готовой продукции",
                  latestUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
                  latest: 9,
                  delta: 2,
                  byDate: {
                    "2026-11-05": {
                      position: 9,
                      url: "/zhurnal-brakerazha-gotovoy-produkcii",
                    },
                  },
                },
              ]
            : [],
      }),
    },
    "@/lib/seo/gogetlinks-planner": requireCjs("./gogetlinks-planner.ts"),
    "@/lib/seo/gogetlinks-article-ai.server": {
      ...requireCjs("./gogetlinks-article-ai.server.ts"),
      extractSimilarwebSnapshotFromImages: async () => ({
        domain: "checkoffice.ru",
        periodLabel: "Oct–Dec 2026",
        visitsMonthly: 38100,
        organicSharePct: 64.2,
        paidSharePct: 3.1,
        bouncePct: 41.0,
        pagesPerVisit: 2.3,
        clusters: [
          {
            phrase: "чек-лист приемки сырья",
            trafficSharePct: 12.1,
            channel: "organic",
            mappedTargetUrl: "/blog/chek-list-priemki-syrya-v-restorane",
            notes: "OCR скриншота",
          },
        ],
      }),
    },
  });

  // Ensure route exports ONLY valid Next.js App Router fields
  assert.deepEqual(
    Object.keys(routeModule).sort(),
    ["GET", "POST", "dynamic", "maxDuration", "runtime"],
  );

  const postRes = await routeModule.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/similarweb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        domain: "haccp-online.ru",
        periodLabel: "Oct–Dec 2026",
        visitsMonthly: 15800,
        organicSharePct: 12.4,
        paidSharePct: 24.1,
        bouncePct: null,
        pagesPerVisit: null,
        sourceKind: "agent_import",
        clusters: [
          {
            phrase: "бракеражный журнал готовой продукции",
            trafficSharePct: 18.5,
            channel: "paid",
            mappedTargetUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
            notes: "Свежий срез",
          },
        ],
      }),
    }),
  );
  assert.equal(postRes.status, 200);
  const postJson = await postRes.json();
  assert.equal(postJson.snapshot.domain, "haccp-online.ru");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "ggl.similarweb.import");
  assert.equal(auditEvents[0].entity, "SeoCompetitorSnapshot");

  const getRes = await routeModule.GET(
    new Request("https://wesetup.ru/api/root/gogetlinks/similarweb"),
  );
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.equal(getJson.snapshots.length, 1);
  assert.ok(Array.isArray(getJson.priorityMatrix));
  assert.ok(getJson.priorityMatrix.length > 0);
  assert.equal(getJson.priorityMatrix[0].targetUrl, "/zhurnal-brakerazha-gotovoy-produkcii");
  assert.equal(getJson.priorityMatrix[0].yandexPos, 9);
  assert.match(getJson.priorityMatrix[0].selectionReason, /18\.5%.*9/);

  // Multipart screenshot upload branch
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const form = new FormData();
  form.append("photo", new File([pngBytes], "similarweb.png", { type: "image/png" }));
  const multipartRes = await routeModule.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/similarweb", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(multipartRes.status, 200);
  const multipartJson = await multipartRes.json();
  assert.equal(multipartJson.snapshot.domain, "checkoffice.ru");
  assert.equal(multipartJson.snapshot.sourceKind, "screenshot_ocr");
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[1].action, "ggl.similarweb.import");
});
