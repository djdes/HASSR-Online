import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import { GglCallError, GglIsolationError } from "@/lib/seo/gogetlinks-client.server";
import {
  approvePlannedSlot,
  createManualGglOrder,
  GglOrderError,
  materializePlanSlots,
  mutatePlannedSlot,
  prepareUpcomingPlannedSlots,
  recycleRejectedSlotOrders,
  upsertSchedulePlan,
} from "@/lib/seo/gogetlinks-orders.server";

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
    URL,
    URLSearchParams,
    require: (id: string) => (Object.hasOwn(mocks, id) ? mocks[id] : requireCjs(id)),
  });
  return fixtureModule.exports as T;
}

function createFakeDecimal(val: number) {
  return {
    toNumber: () => val,
    toString: () => val.toFixed(2),
    valueOf: () => val,
  };
}

const adminActor = {
  id: "u_root",
  name: "Олег",
  isRoot: true,
  platformSections: [...PLATFORM_SECTION_KEYS],
};

const seoActor = {
  id: "u_seo",
  name: "Анна SEO",
  isRoot: false,
  platformSections: ["seo"],
};

test("Review Focus #3: concurrent approvePlannedSlot rejects second click with 409 and timeout stays approved_sending", async () => {
  let slotStatus = "pending_approval";
  let submitCalls = 0;
  const deps = {
    getAccountConfig: async () => ({ allowSeoApproveWithinPlan: false, availableRub: 8936.06 }),
    claimSlotForSend: async () => {
      if (slotStatus !== "pending_approval") return null;
      slotStatus = "approved_sending";
      return {
        id: "slot_1",
        maxPriceRub: 900,
        donorSiteId: 404,
        donorDomain: "food-safety.ru",
        placementFormat: "note" as const,
        targetUrl: "/zhurnal-generalnyh-uborok",
        anchor: "wesetup.ru",
        briefText: "Заметка про СанПиН",
        campaign: { id: "c_ws", gglCampaignId: 200001, isWesetup: true },
        article: null,
      };
    },
    fetchLiveDonorPrice: async () => 850,
    ensureTargetAnchorInGgl: async () => {},
    uploadArticleIfNeeded: async () => null,
    submitRemoteOrder: async () => {
      submitCalls += 1;
      return { status: "may_have_applied" as const, gglReviewId: null };
    },
    finalizeSlotOrder: async (_slotId: string, nextSlotStatus: string) => {
      slotStatus = nextSlotStatus;
      return "ord_new";
    },
    revertSlotToPending: async () => {
      slotStatus = "pending_approval";
    },
    writeAudit: async () => {},
  };

  const [first, second] = await Promise.allSettled([
    approvePlannedSlot({ slotId: "slot_1", idempotencyKey: "ap-1", actor: adminActor }, deps),
    approvePlannedSlot({ slotId: "slot_1", idempotencyKey: "ap-2", actor: adminActor }, deps),
  ]);

  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.match(String((second as PromiseRejectedResult).reason), /409|уже отправляется/i);
  assert.equal(submitCalls, 1);
  assert.equal(slotStatus, "approved_sending", "uncertain network write must stay approved_sending until sync");
});

test("Review Focus #3 (timeout throw): mid-flight network timeout keeps GglOrder sending & slot approved_sending", async () => {
  let slotStatus = "pending_approval";
  let finalizedOrderStatus: string | null = null;
  let reverted = false;

  await assert.rejects(
    () =>
      approvePlannedSlot(
        { slotId: "slot_net_err", idempotencyKey: "ap-net-err", actor: adminActor },
        {
          getAccountConfig: async () => ({ allowSeoApproveWithinPlan: false, availableRub: 5000 }),
          claimSlotForSend: async () => {
            slotStatus = "approved_sending";
            return {
              id: "slot_net_err",
              maxPriceRub: 900,
              donorSiteId: 404,
              donorDomain: "food-safety.ru",
              placementFormat: "note" as const,
              targetUrl: "/zhurnal-generalnyh-uborok",
              anchor: "wesetup.ru",
              briefText: "Заметка",
              campaign: { id: "c_ws", gglCampaignId: 200001, isWesetup: true },
              article: null,
            };
          },
          fetchLiveDonorPrice: async () => 800,
          ensureTargetAnchorInGgl: async () => {},
          uploadArticleIfNeeded: async () => null,
          submitRemoteOrder: async () => {
            throw new GglCallError("Socket hang up mid-flight", "error");
          },
          finalizeSlotOrder: async (_slotId, nextSlotStatus, meta) => {
            slotStatus = nextSlotStatus;
            finalizedOrderStatus = meta.orderStatus;
            return "ord_sending_1";
          },
          revertSlotToPending: async () => {
            reverted = true;
            slotStatus = "pending_approval";
          },
          writeAudit: async () => {},
        },
      ),
    GglCallError,
  );

  assert.equal(reverted, false, "must NOT revert slot on ambiguous network timeout");
  assert.equal(slotStatus, "approved_sending");
  assert.equal(finalizedOrderStatus, "sending");
});

test("Review Focus #4: approvePlannedSlot aborts with 0 spend on donor price hike, low balance, or non-wesetup campaign", async () => {
  let submitCalled = false;
  let reverted = false;
  await assert.rejects(
    () =>
      approvePlannedSlot(
        { slotId: "slot_hike", idempotencyKey: "ap-hike", actor: adminActor },
        {
          getAccountConfig: async () => ({ allowSeoApproveWithinPlan: false, availableRub: 8936.06 }),
          claimSlotForSend: async () => ({
            id: "slot_hike",
            maxPriceRub: 900,
            donorSiteId: 404,
            donorDomain: "food-safety.ru",
            placementFormat: "article" as const,
            targetUrl: "/zhurnal-generalnyh-uborok",
            anchor: "журнал генеральных уборок",
            briefText: null,
            campaign: { id: "c_ws", gglCampaignId: 200001, isWesetup: true },
            article: { id: "art_1", gglArticleId: null, title: "T", announcement: "A", bodyHtml: "<p>B</p>" },
          }),
          fetchLiveDonorPrice: async () => 1200, // hiked above 900 ₽!
          ensureTargetAnchorInGgl: async () => {},
          uploadArticleIfNeeded: async () => null,
          submitRemoteOrder: async () => {
            submitCalled = true;
            return { status: "applied" as const, gglReviewId: 1 };
          },
          finalizeSlotOrder: async () => "ord_x",
          revertSlotToPending: async () => {
            reverted = true;
          },
          writeAudit: async () => {},
        },
      ),
    /цена донора выросла.*1200.*900/i,
  );
  assert.equal(submitCalled, false);
  assert.equal(reverted, true, "pre-send guard failure safely returns slot to pending_approval");

  // Low balance check (< livePrice)
  let lowBalSubmitCalled = false;
  let lowBalReverted = false;
  await assert.rejects(
    () =>
      approvePlannedSlot(
        { slotId: "slot_low_bal", idempotencyKey: "ap-low-bal", actor: adminActor },
        {
          getAccountConfig: async () => ({ allowSeoApproveWithinPlan: false, availableRub: 500 }),
          claimSlotForSend: async () => ({
            id: "slot_low_bal",
            maxPriceRub: 900,
            donorSiteId: 404,
            donorDomain: "food-safety.ru",
            placementFormat: "note" as const,
            targetUrl: "/zhurnal-generalnyh-uborok",
            anchor: "wesetup.ru",
            briefText: "ТЗ",
            campaign: { id: "c_ws", gglCampaignId: 200001, isWesetup: true },
            article: null,
          }),
          fetchLiveDonorPrice: async () => 850,
          ensureTargetAnchorInGgl: async () => {},
          uploadArticleIfNeeded: async () => null,
          submitRemoteOrder: async () => {
            lowBalSubmitCalled = true;
            return { status: "applied" as const, gglReviewId: 2 };
          },
          finalizeSlotOrder: async () => "ord_y",
          revertSlotToPending: async () => {
            lowBalReverted = true;
          },
          writeAudit: async () => {},
        },
      ),
    (err: unknown) =>
      err instanceof GglOrderError && err.status === 422 && /недостаточно.*средств|баланс/i.test(err.message),
  );
  assert.equal(lowBalSubmitCalled, false);
  assert.equal(lowBalReverted, true);

  // Non-wesetup campaign check (isWesetup: false)
  let nonWsSubmitCalled = false;
  let nonWsReverted = false;
  await assert.rejects(
    () =>
      approvePlannedSlot(
        { slotId: "slot_yb", idempotencyKey: "ap-yb", actor: adminActor },
        {
          getAccountConfig: async () => ({ allowSeoApproveWithinPlan: false, availableRub: 9000 }),
          claimSlotForSend: async () => ({
            id: "slot_yb",
            maxPriceRub: 900,
            donorSiteId: 404,
            donorDomain: "music-blog.ru",
            placementFormat: "note" as const,
            targetUrl: "https://yesbeat.ru",
            anchor: "yesbeat",
            briefText: null,
            campaign: { id: "c_yb", gglCampaignId: 149699, isWesetup: false },
            article: null,
          }),
          fetchLiveDonorPrice: async () => 500,
          ensureTargetAnchorInGgl: async () => {},
          uploadArticleIfNeeded: async () => null,
          submitRemoteOrder: async () => {
            nonWsSubmitCalled = true;
            return { status: "applied" as const, gglReviewId: 3 };
          },
          finalizeSlotOrder: async () => "ord_z",
          revertSlotToPending: async () => {
            nonWsReverted = true;
          },
          writeAudit: async () => {},
        },
      ),
    GglIsolationError,
  );
  assert.equal(nonWsSubmitCalled, false);
  assert.equal(nonWsReverted, true);
});

test("canApproveGglSpend gates: SEO user blocked on upsertSchedulePlan & createManualGglOrder, and gated by allowSeoApproveWithinPlan on approvePlannedSlot", async () => {
  // 1. SEO user rejected (403) on upsertSchedulePlan even if allowSeoApproveWithinPlan is true
  await assert.rejects(
    () =>
      upsertSchedulePlan(
        {
          name: "План ноябрь",
          campaignId: "c_ws",
          kind: "monthly",
          budgetRub: 5000,
          maxPricePerLinkRub: 1000,
        },
        seoActor,
        {
          getAccountConfig: async () => ({ allowSeoApproveWithinPlan: true, availableRub: 8000 }),
        },
      ),
    (err: unknown) => err instanceof GglOrderError && err.status === 403,
  );

  // 2. SEO user rejected (403) on createManualGglOrder even if allowSeoApproveWithinPlan is true
  await assert.rejects(
    () =>
      createManualGglOrder(
        {
          campaignId: "c_ws",
          donorSiteId: 501,
          donorDomain: "horeca-journal.ru",
          placementFormat: "note",
          maxPriceRub: 900,
          targetUrl: "/zhurnal-haccp",
          anchor: "wesetup.ru",
          idempotencyKey: "manual-seo-1",
        },
        seoActor,
        {
          getAccountConfig: async () => ({ allowSeoApproveWithinPlan: true, availableRub: 8000 }),
        },
      ),
    (err: unknown) => err instanceof GglOrderError && err.status === 403,
  );

  // 3. SEO user rejected (403) on approvePlannedSlot when allowSeoApproveWithinPlan === false
  let claimedWhenForbidden = false;
  await assert.rejects(
    () =>
      approvePlannedSlot(
        { slotId: "slot_seo_1", idempotencyKey: "ap-seo-deny", actor: seoActor },
        {
          getAccountConfig: async () => ({ allowSeoApproveWithinPlan: false, availableRub: 8000 }),
          claimSlotForSend: async () => {
            claimedWhenForbidden = true;
            return null;
          },
        },
      ),
    (err: unknown) => err instanceof GglOrderError && err.status === 403,
  );
  assert.equal(claimedWhenForbidden, false, "must reject 403 before claiming slot");

  // 4. SEO user permitted on approvePlannedSlot when allowSeoApproveWithinPlan === true
  const seoApproved = await approvePlannedSlot(
    { slotId: "slot_seo_1", idempotencyKey: "ap-seo-allow", actor: seoActor },
    {
      getAccountConfig: async () => ({ allowSeoApproveWithinPlan: true, availableRub: 8000 }),
      claimSlotForSend: async () => ({
        id: "slot_seo_1",
        maxPriceRub: 900,
        donorSiteId: 404,
        donorDomain: "food-safety.ru",
        placementFormat: "article" as const,
        targetUrl: "/zhurnal-generalnyh-uborok",
        anchor: "журнал генеральных уборок",
        briefText: "Комментарий вебмастеру",
        campaign: { id: "c_ws", gglCampaignId: 200001, isWesetup: true },
        article: {
          id: "art_seo",
          gglArticleId: null,
          title: "Статья по СанПиН",
          announcement: "Анонс",
          bodyHtml: '<p><a href="https://wesetup.ru/zhurnal-generalnyh-uborok">журнал генеральных уборок</a></p>',
        },
      }),
      fetchLiveDonorPrice: async () => 840,
      ensureTargetAnchorInGgl: async () => {},
      uploadArticleIfNeeded: async () => 9912,
      submitRemoteOrder: async () => ({ status: "applied" as const, gglReviewId: 7001 }),
      finalizeSlotOrder: async () => "ord_seo_ok",
      revertSlotToPending: async () => {},
      writeAudit: async () => {},
    },
  );
  assert.equal(seoApproved.slotStatus, "ordered");
  assert.equal(seoApproved.orderId, "ord_seo_ok");
});

test("materializePlanSlots & prepareUpcomingPlannedSlots stop strictly at pending_approval with zero submitLinkOrder calls", async () => {
  const createdSlots: Array<{ id: string; planId: string; scheduledDate: string; maxPriceRub: number; status: string }> = [];
  const matResult = await materializePlanSlots(new Date("2026-11-05T10:00:00Z"), {
    loadActivePlans: async () => [
      {
        id: "plan_ws",
        campaignId: "c_ws",
        isWesetup: true,
        kind: "monthly",
        budgetRub: 2000,
        maxPricePerLinkRub: 900,
        startsAt: new Date("2026-11-05T00:00:00Z"),
        scheduleDaysOfWeek: [2, 5],
        existingSlots: [],
      },
      {
        id: "plan_foreign",
        campaignId: "c_yb",
        isWesetup: false,
        kind: "monthly",
        budgetRub: 5000,
        maxPricePerLinkRub: 900,
        startsAt: new Date("2026-11-05T00:00:00Z"),
        scheduleDaysOfWeek: [2, 5],
        existingSlots: [],
      },
    ],
    createSlot: async (data) => {
      createdSlots.push({
        id: `slot_${createdSlots.length + 1}`,
        planId: data.planId,
        scheduledDate: data.scheduledDate,
        maxPriceRub: data.maxPriceRub,
        status: data.status,
      });
      return true;
    },
  });

  // 2000 RUB monthly budget with 900 RUB max per link allows 2 slots in 2026-11 + 2 slots in 2026-12 (within 30-day window), strictly for wesetup.ru
  assert.equal(matResult.created, 4);
  assert.equal(createdSlots.filter((s) => s.scheduledDate.startsWith("2026-11")).length, 2);
  assert.equal(createdSlots.filter((s) => s.scheduledDate.startsWith("2026-12")).length, 2);
  assert.ok(createdSlots.every((s) => s.planId === "plan_ws" && s.status === "planned"));

  // Now prepare upcoming slots — verify ZERO submitLinkOrder calls and final status === "pending_approval"
  const finalizedSlotHolder: { payload: Record<string, unknown> | null } = { payload: null };

  const prepResult = await prepareUpcomingPlannedSlots(new Date("2026-11-05T10:00:00Z"), 7, {
    findUpcomingPlannedSlots: async () => [
      {
        id: "slot_prep_1",
        planId: "plan_ws",
        scheduledDate: "2026-11-06",
        maxPriceRub: 900,
        plan: {
          id: "plan_ws",
          campaignId: "c_ws",
          minTfCf: 10,
          minTrust: 4,
          minDailyTraffic: 100,
          allowedFormats: ["article", "note"],
          anchorMixBrandPct: 50,
          campaign: { id: "c_ws", gglCampaignId: 200001, isWesetup: true },
        },
      },
    ],
    claimSlotPreparing: async () => true,
    loadScoringContext: async () => ({
      clusters: [
        {
          snapshotId: "snap_1",
          domain: "haccp-online.ru",
          phrase: "бракеражный журнал",
          trafficSharePct: 17.6,
          channel: "paid" as const,
          mappedTargetUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
        },
      ],
      topvisorRows: [
        {
          phrase: "бракеражный журнал",
          yandexPos: 11,
          googlePos: 14,
          relevantUrl: "https://wesetup.ru/zhurnal-brakerazha-gotovoy-produkcii",
        },
      ],
      existingOrders: [],
      usedDonorDomains: new Set(["already-bought.ru"]),
      candidatePages: [
        {
          url: "/zhurnal-brakerazha-gotovoy-produkcii",
          title: "Бракеражный журнал готовой продукции",
          facts: ["Электронный журнал бракеража по СанПиН в WeSetup"],
          keywords: ["бракеражный журнал"],
        },
      ],
    }),
    searchCatalogDonors: async () => [
      {
        siteId: 111,
        domain: "already-bought.ru",
        priceArticleRub: 700,
        priceNoteRub: 600,
        tf: 20,
        cf: 25,
        trust: 8,
        dailyTraffic: 1500,
        indexedYandex: true,
        indexedGoogle: true,
      },
      {
        siteId: 222,
        domain: "horeca-expert.ru",
        priceArticleRub: 850,
        priceNoteRub: 750,
        tf: 18,
        cf: 22,
        trust: 7,
        dailyTraffic: 1200,
        indexedYandex: true,
        indexedGoogle: true,
      },
      {
        siteId: 333,
        domain: "sanpin-news.ru",
        priceArticleRub: 880,
        priceNoteRub: 780,
        tf: 14,
        cf: 19,
        trust: 6,
        dailyTraffic: 900,
        indexedYandex: true,
        indexedGoogle: true,
      },
    ],
    generateDraft: async (draftInput) => ({
      title: `Контроль качества блюд на ${draftInput.donorDomain}`,
      announcement: "Разбор бракеража готовой продукции в общепите",
      bodyHtml: `<p>Вести журнал удобно на <a href="https://wesetup.ru${draftInput.targetUrl}">${draftInput.anchor}</a>.</p>`,
      metaTitle: "Бракераж блюд",
      metaDescription: "Инструкция по журналу бракеража",
      metaKeywords: "бракеражный журнал, хассп",
      briefText: "Просьба разместить статью без изменений ссылки.",
    }),
    savePreparedSlot: async (_slotId, payload) => {
      finalizedSlotHolder.payload = payload as unknown as Record<string, unknown>;
    },
    revertPreparingSlot: async () => {},
  });

  assert.equal(prepResult.prepared, 1);
  assert.equal(prepResult.skipped, 0);
  const finalizedSlotPayload = finalizedSlotHolder.payload;
  assert.ok(finalizedSlotPayload);
  assert.equal(finalizedSlotPayload.status, "pending_approval");
  assert.equal(finalizedSlotPayload.donorDomain, "horeca-expert.ru", "already-bought.ru must be excluded");
  assert.equal(finalizedSlotPayload.placementFormat, "article");
  assert.equal(finalizedSlotPayload.estimatedPriceRub, 850);
  assert.equal((finalizedSlotPayload.alternativeDonors as Array<{ domain: string }>)[0]?.domain, "sanpin-news.ru");
});

test("recycleRejectedSlotOrders swaps next alternative donor and returns slot to pending_approval", async () => {
  const updated: Array<{ slotId: string; donorDomain: string; status: string }> = [];
  const res = await recycleRejectedSlotOrders({
    findRejectedLinkedSlots: async () => [
      {
        slotId: "slot_r1",
        alternativeDonors: [
          {
            siteId: 77,
            domain: "backup-horeca.ru",
            priceRub: 820,
            format: "article",
            metrics: { tf: 15, cf: 20, trust: 6, dailyTraffic: 800 },
          },
        ],
      },
    ],
    applyFallbackDonor: async (slotId, nextDonor) => {
      updated.push({ slotId, donorDomain: nextDonor.domain, status: "pending_approval" });
    },
  });
  assert.deepEqual(res.recycledSlotIds, ["slot_r1"]);
  assert.equal(updated[0].donorDomain, "backup-horeca.ru");
  assert.equal(updated[0].status, "pending_approval");
});

test("mutatePlannedSlot supports skip, swap_donor, and update_article while blocking already ordered slots", async () => {
  const audits: Array<{ action: string; entityId: string }> = [];
  let currentSlot: Record<string, unknown> = {
    id: "slot_m1",
    planId: "plan_ws",
    scheduledDate: "2026-11-10",
    maxPriceRub: 950,
    estimatedPriceRub: 860,
    targetUrl: "/zhurnal-haccp",
    targetKeyword: "журналы хассп",
    donorSiteId: 101,
    donorDomain: "donor-one.ru",
    donorMetricsJson: { tf: 16, cf: 20, trust: 6, dailyTraffic: 700 },
    placementFormat: "article",
    anchor: "журналы хассп",
    anchorKind: "exact",
    articleId: "art_m1",
    briefText: "Старое ТЗ",
    alternativeDonorsJson: [
      {
        siteId: 202,
        domain: "donor-two.ru",
        priceRub: 890,
        format: "note",
        metrics: { tf: 14, cf: 18, trust: 5, dailyTraffic: 650 },
      },
    ],
    status: "pending_approval",
    plan: { campaignId: "c_ws", campaign: { id: "c_ws", isWesetup: true } },
    article: {
      id: "art_m1",
      gglArticleId: 555,
      title: "Старый заголовок",
      announcement: "Старый анонс",
      bodyHtml: '<p><a href="https://wesetup.ru/zhurnal-haccp">журналы хассп</a></p>',
    },
  };
  const updatedArticleHolder: { data: Record<string, unknown> | null } = { data: null };

  const mockPrisma = {
    gglPlannedSlot: {
      findUnique: async () => currentSlot,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        currentSlot = { ...currentSlot, ...data };
        return currentSlot;
      },
    },
    gglArticle: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updatedArticleHolder.data = data;
        return { ...(currentSlot.article as Record<string, unknown>), ...data };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "art_created", ...data }),
    },
  };

  // 1. swap_donor
  const swapped = await mutatePlannedSlot(
    { slotId: "slot_m1", action: "swap_donor", donorSiteId: 202, actor: seoActor },
    {
      prismaClient: mockPrisma as never,
      writeAudit: async (entry) => {
        audits.push({ action: entry.action, entityId: entry.entityId });
      },
    },
  );
  assert.equal(swapped.donorDomain, "donor-two.ru");
  assert.equal(swapped.donorSiteId, 202);
  assert.equal(swapped.estimatedPriceRub, 890);
  const rotatedAlts = swapped.alternativeDonorsJson as Array<{ domain: string }>;
  assert.equal(rotatedAlts[0]?.domain, "donor-one.ru", "previous donor rotated to alternatives");

  // 2. update_article
  const articleEdited = await mutatePlannedSlot(
    {
      slotId: "slot_m1",
      action: "update_article",
      articlePatch: {
        title: "Обновлённый заголовок СанПиН",
        bodyHtml: '<p>Обновлённый текст со ссылкой <a href="https://wesetup.ru/zhurnal-haccp">wesetup.ru</a>.</p>',
        anchor: "wesetup.ru",
        anchorKind: "url_brand",
        briefText: "Новое ТЗ",
      },
      actor: seoActor,
    },
    {
      prismaClient: mockPrisma as never,
      writeAudit: async (entry) => {
        audits.push({ action: entry.action, entityId: entry.entityId });
      },
    },
  );
  assert.equal(articleEdited.anchor, "wesetup.ru");
  assert.equal(articleEdited.briefText, "Новое ТЗ");
  assert.equal(updatedArticleHolder.data?.title, "Обновлённый заголовок СанПиН");
  assert.equal(updatedArticleHolder.data?.gglArticleId, null, "edited article resets remote upload id");

  // 3. skip
  const skipped = await mutatePlannedSlot(
    { slotId: "slot_m1", action: "skip", actor: seoActor },
    {
      prismaClient: mockPrisma as never,
      writeAudit: async (entry) => {
        audits.push({ action: entry.action, entityId: entry.entityId });
      },
    },
  );
  assert.equal(skipped.status, "skipped");
  assert.ok(audits.some((a) => a.action === "ggl.slot.skip"));

  // 4. Blocking mutation when status === "ordered"
  currentSlot.status = "ordered";
  await assert.rejects(
    () =>
      mutatePlannedSlot(
        { slotId: "slot_m1", action: "skip", actor: adminActor },
        { prismaClient: mockPrisma as never, writeAudit: async () => {} },
      ),
    (err: unknown) => err instanceof GglOrderError && err.status === 409,
  );
});

test("plans, slots/[id], slots/[id]/approve, and orders API routes await params, validate input, enforce gates and serialize Decimals", async () => {
  // 1. /api/root/gogetlinks/plans (GET + POST)
  const plansRoute = loadRouteFixture<{
    GET: (req: Request) => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/plans/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_root", name: "Олег", isRoot: true } }),
    },
    "@/lib/db": {
      db: {
        gglSchedulePlan: {
          findMany: async () => [
            {
              id: "plan_1",
              name: "Ежемесячный план",
              campaignId: "c_ws",
              kind: "monthly",
              budgetRub: 5000,
              maxPricePerLinkRub: 900,
              startsAt: new Date("2026-11-05T00:00:00Z"),
              scheduleDaysOfWeek: [2, 5],
              minTfCf: 10,
              minTrust: 4,
              minDailyTraffic: 100,
              allowedFormats: ["article", "note"],
              anchorMixBrandPct: 50,
              isActive: true,
              createdByUserId: "u_root",
              createdAt: new Date("2026-11-05T00:00:00Z"),
              updatedAt: new Date("2026-11-05T00:00:00Z"),
            },
          ],
        },
        gglPlannedSlot: {
          findMany: async () => [],
        },
      },
    },
    "@/lib/seo/gogetlinks-orders.server": {
      GglOrderError,
      resolveGglActorFromSession: async () => seoActor,
      serializeSchedulePlan: (p: Record<string, unknown>) => p,
      serializePlannedSlot: (s: Record<string, unknown>) => s,
      upsertSchedulePlan: async () => {
        throw new GglOrderError(403, "Недостаточно прав для изменения плана");
      },
      materializePlanSlots: async () => ({ created: 0 }),
    },
  });

  const getPlansRes = await plansRoute.GET(new Request("https://wesetup.ru/api/root/gogetlinks/plans"));
  assert.equal(getPlansRes.status, 200);
  const getPlansJson = await getPlansRes.json();
  assert.equal(getPlansJson.plans.length, 1);
  assert.equal(getPlansJson.plans[0].budgetRub, 5000);

  const forbiddenPlanPost = await plansRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Новый план",
        campaignId: "c_ws",
        kind: "monthly",
        budgetRub: 5000,
        maxPricePerLinkRub: 900,
      }),
    }),
  );
  assert.equal(forbiddenPlanPost.status, 403);

  // 2. /api/root/gogetlinks/slots/[id] (PATCH)
  let capturedPatchSlotId = "";
  const slotMutateRoute = loadRouteFixture<{
    PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/slots/[id]/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_seo", name: "Анна", isRoot: false } }),
    },
    "@/lib/seo/gogetlinks-orders.server": {
      GglOrderError,
      resolveGglActorFromSession: async () => seoActor,
      serializePlannedSlot: (s: Record<string, unknown>) => s,
      mutatePlannedSlot: async (input: { slotId: string; action: string }) => {
        capturedPatchSlotId = input.slotId;
        return { id: input.slotId, status: input.action === "skip" ? "skipped" : "pending_approval" };
      },
    },
  });

  const patchSlotRes = await slotMutateRoute.PATCH(
    new Request("https://wesetup.ru/api/root/gogetlinks/slots/slot_abc", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "skip" }),
    }),
    { params: Promise.resolve({ id: "slot_abc" }) },
  );
  assert.equal(patchSlotRes.status, 200);
  assert.equal(capturedPatchSlotId, "slot_abc");

  // 3. /api/root/gogetlinks/slots/[id]/approve (POST)
  const slotApproveRoute = loadRouteFixture<{
    POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/slots/[id]/approve/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_root", name: "Олег", isRoot: true } }),
    },
    "@/lib/seo/gogetlinks-orders.server": {
      GglOrderError,
      resolveGglActorFromSession: async () => adminActor,
      approvePlannedSlot: async (input: { slotId: string }) => {
        if (input.slotId === "slot_conflict") {
          throw new GglOrderError(409, "Слот уже отправляется или обработан");
        }
        return { slotStatus: "ordered", orderId: "ord_777" };
      },
    },
  });

  const conflictApproveRes = await slotApproveRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/slots/slot_conflict/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "ap-conf-1" }),
    }),
    { params: Promise.resolve({ id: "slot_conflict" }) },
  );
  assert.equal(conflictApproveRes.status, 409);

  const okApproveRes = await slotApproveRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/slots/slot_ok/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "ap-ok-1" }),
    }),
    { params: Promise.resolve({ id: "slot_ok" }) },
  );
  assert.equal(okApproveRes.status, 200);
  const okApproveJson = await okApproveRes.json();
  assert.equal(okApproveJson.slotStatus, "ordered");
  assert.equal(okApproveJson.orderId, "ord_777");

  // 4. /api/root/gogetlinks/orders (GET + POST)
  const ordersRoute = loadRouteFixture<{
    GET: (req: Request) => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/orders/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_root", name: "Олег", isRoot: true } }),
    },
    "@/lib/db": {
      db: {
        gglOrder: {
          findMany: async () => [
            {
              id: "ord_1",
              gglReviewId: 6046338,
              campaignId: "c_ws",
              campaign: {
                id: "c_ws",
                gglCampaignId: 200001,
                name: "WeSetup",
                domain: "wesetup.ru",
                isWesetup: true,
                state: "active",
              },
              donorSiteId: 404,
              donorDomain: "food-safety.ru",
              donorDailyTraffic: 1200,
              donorTfCf: "16 / 22",
              donorTrust: 7,
              placementFormat: "article",
              priceRub: createFakeDecimal(845.5),
              targetUrl: "https://wesetup.ru/zhurnal-haccp",
              anchor: "журналы хассп",
              publishedUrl: null,
              articleId: "art_1",
              paidAt: null,
              cancelledAt: null,
              indexedStatus: null,
              status: "pending_webmaster",
              origin: "scheduled_wesetup",
              initiatedByUserId: "u_root",
              initiatedByName: "Олег",
              approvedByUserId: "u_root",
              approvedByName: "Олег",
              approvedAt: new Date("2026-11-05T12:00:00Z"),
              plannedSlotId: "slot_ok",
              createdAt: new Date("2026-11-05T12:00:00Z"),
              updatedAt: new Date("2026-11-05T12:00:00Z"),
            },
          ],
        },
      },
    },
    "@/lib/seo/gogetlinks-orders.server": {
      GglOrderError,
      resolveGglActorFromSession: async () => adminActor,
      createManualGglOrder: async () => ({ orderId: "ord_manual_9", status: "pending_webmaster" }),
    },
  });

  const getOrdersRes = await ordersRoute.GET(new Request("https://wesetup.ru/api/root/gogetlinks/orders"));
  assert.equal(getOrdersRes.status, 200);
  const getOrdersJson = await getOrdersRes.json();
  assert.equal(typeof getOrdersJson.orders[0].priceRub, "number");
  assert.equal(getOrdersJson.orders[0].priceRub, 845.5);

  const createManualRes = await ordersRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaignId: "c_ws",
        donorSiteId: 505,
        donorDomain: "horeca-daily.ru",
        placementFormat: "note",
        maxPriceRub: 900,
        targetUrl: "/zhurnal-haccp",
        anchor: "wesetup.ru",
        idempotencyKey: "manual-k-1",
      }),
    }),
  );
  assert.equal(createManualRes.status, 200);
  const createManualJson = await createManualRes.json();
  assert.equal(createManualJson.orderId, "ord_manual_9");
});

test("upsertSchedulePlan, createManualGglOrder & default recycleRejectedSlotOrders enforce isolation, price/balance guards and detach rejected plannedSlotId", async () => {
  const audits: string[] = [];

  // 1. upsertSchedulePlan rejects non-wesetup campaign and succeeds for wesetup.ru
  const planPrisma = {
    gglAccount: {
      findFirst: async () => ({ allowSeoApproveWithinPlan: false, availableRub: createFakeDecimal(5000) }),
    },
    gglCampaign: {
      findFirst: async ({ where }: { where: { OR?: Array<{ id?: string }> } }) => {
        const ref = where.OR?.[0]?.id;
        if (ref === "c_yb") return { id: "c_yb", gglCampaignId: 149699, domain: "yesbeat.ru", isWesetup: false };
        return { id: "c_ws", gglCampaignId: 200001, domain: "wesetup.ru", isWesetup: true };
      },
    },
    gglSchedulePlan: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "plan_created_1",
        createdAt: new Date("2026-11-05T10:00:00Z"),
        updatedAt: new Date("2026-11-05T10:00:00Z"),
        ...data,
      }),
      findUnique: async () => null,
      update: async () => {
        throw new Error("not expected");
      },
    },
  };

  await assert.rejects(
    () =>
      upsertSchedulePlan(
        { name: "Чужой план", campaignId: "c_yb", kind: "monthly", budgetRub: 5000, maxPricePerLinkRub: 900 },
        adminActor,
        { prismaClient: planPrisma as never, writeAudit: async () => {} },
      ),
    GglIsolationError,
  );

  const createdPlan = await upsertSchedulePlan(
    { name: "Стартовый пакет", campaignId: "c_ws", kind: "one_time", budgetRub: 10000, maxPricePerLinkRub: 1000 },
    adminActor,
    {
      prismaClient: planPrisma as never,
      writeAudit: async (e) => {
        audits.push(e.action);
      },
    },
  );
  assert.equal(createdPlan.id, "plan_created_1");
  assert.ok(audits.includes("ggl.plan.update"));

  // 2. createManualGglOrder enforces wesetup.ru URL, live price cap, and writes manual_wesetup order
  const manualOrders = new Map<string, Record<string, unknown>>();
  const manualPrisma = {
    gglAccount: {
      findFirst: async () => ({
        allowSeoApproveWithinPlan: false,
        availableRub: createFakeDecimal(4000),
        defaultCampaignId: 200001,
      }),
    },
    gglCampaign: {
      findFirst: async () => ({ id: "c_ws", gglCampaignId: 200001, domain: "wesetup.ru", isWesetup: true }),
    },
    gglArticle: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "art_man_1", gglArticleId: null, ...data }),
      update: async () => ({}),
    },
    gglOrder: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        (manualOrders.get(where.idempotencyKey) as { id: string; status: string } | undefined) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const rec = { id: "ord_man_1", ...data };
        manualOrders.set(String(data.idempotencyKey), rec);
        return rec;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const rec of manualOrders.values()) {
          if (rec.id === where.id) Object.assign(rec, data);
        }
        return { id: where.id, ...data };
      },
    },
  };

  await assert.rejects(
    () =>
      createManualGglOrder(
        {
          campaignId: "c_ws",
          donorSiteId: 801,
          donorDomain: "horeca.ru",
          placementFormat: "note",
          maxPriceRub: 900,
          targetUrl: "https://yesbeat.ru/music",
          anchor: "yesbeat",
          idempotencyKey: "man-bad-url",
        },
        adminActor,
        { prismaClient: manualPrisma as never, writeAudit: async () => {} },
      ),
    GglIsolationError,
  );

  await assert.rejects(
    () =>
      createManualGglOrder(
        {
          campaignId: "c_ws",
          donorSiteId: 801,
          donorDomain: "horeca.ru",
          placementFormat: "note",
          maxPriceRub: 800,
          targetUrl: "/zhurnal-haccp",
          anchor: "wesetup.ru",
          idempotencyKey: "man-price-hike",
        },
        adminActor,
        {
          prismaClient: manualPrisma as never,
          fetchLiveDonorPrice: async () => 1100,
          writeAudit: async () => {},
        },
      ),
    (err: unknown) => err instanceof GglOrderError && err.status === 422,
  );

  const manualRes = await createManualGglOrder(
    {
      campaignId: "c_ws",
      donorSiteId: 801,
      donorDomain: "horeca.ru",
      placementFormat: "note",
      maxPriceRub: 950,
      targetUrl: "/zhurnal-haccp",
      anchor: "wesetup.ru",
      idempotencyKey: "man-ok-1",
    },
    adminActor,
    {
      prismaClient: manualPrisma as never,
      fetchLiveDonorPrice: async () => 870,
      ensureTargetAnchorInGgl: async () => {},
      uploadArticleIfNeeded: async () => null,
      submitRemoteOrder: async () => ({ status: "applied", gglReviewId: 99100 }),
      writeAudit: async (e) => {
        audits.push(e.action);
      },
    },
  );
  assert.equal(manualRes.orderId, "ord_man_1");
  assert.equal(manualRes.status, "pending_webmaster");
  assert.equal(manualOrders.get("man-ok-1")?.origin, "manual_wesetup");
  assert.ok(audits.includes("ggl.order.manual_create"));

  // 3. Default recycleRejectedSlotOrders detaches plannedSlotId on rejected GglOrder and resets slot to pending_approval
  const recycleHolder: { detachedSlotId: string | null; slotUpdate: Record<string, unknown> | null } = {
    detachedSlotId: null,
    slotUpdate: null,
  };
  const recycleRes = await recycleRejectedSlotOrders({
    prismaClient: {
      gglPlannedSlot: {
        findMany: async () => [
          {
            id: "slot_rej_db",
            alternativeDonorsJson: [
              {
                siteId: 909,
                domain: "fallback-sanpin.ru",
                priceRub: 790,
                format: "note",
                metrics: { tf: 14, cf: 18, trust: 5, dailyTraffic: 500 },
              },
            ],
          },
        ],
        update: async ({ data }: { data: Record<string, unknown> }) => {
          recycleHolder.slotUpdate = data;
          return data;
        },
      },
      gglOrder: {
        updateMany: async ({ where }: { where: { plannedSlotId?: string } }) => {
          recycleHolder.detachedSlotId = where.plannedSlotId ?? null;
          return { count: 1 };
        },
      },
    } as never,
  });
  assert.deepEqual(recycleRes.recycledSlotIds, ["slot_rej_db"]);
  assert.equal(recycleHolder.detachedSlotId, "slot_rej_db", "must detach rejected order plannedSlotId unique FK");
  assert.equal(recycleHolder.slotUpdate?.status, "pending_approval");
  assert.equal(recycleHolder.slotUpdate?.donorDomain, "fallback-sanpin.ru");
});
