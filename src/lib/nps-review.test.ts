import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditActionLabel, auditDetailPairs } from "@/lib/audit-labels";
import { REVIEW_TEXT_MAX_LENGTH, REVIEW_TEXT_MIN_LENGTH } from "@/lib/balance/constants";
import { ReviewError, type ReviewView, type SubmitReviewInput } from "@/lib/balance/reviews";
import { NPS_RECOMMEND_DEFAULT_MESSAGE } from "@/lib/nps";
import type { NpsRecommendResponseRow } from "@/lib/nps-recommend";
import {
  NPS_REVIEW_FALLBACK_AUTHOR,
  npsReviewAuthorName,
  npsReviewIdFromDetails,
  runNpsReview,
  type NpsReviewAuditDetails,
  type NpsReviewDeps,
  type NpsReviewModerationNotice,
} from "@/lib/nps-review";

const responses: Record<string, NpsRecommendResponseRow> = {
  r5: { id: "r5", userId: "u1", organizationId: "org1", score: 5, scale: 5 },
  r4: { id: "r4", userId: "u1", organizationId: "org1", score: 4, scale: 5 },
  r3: { id: "r3", userId: "u1", organizationId: "org1", score: 3, scale: 5 },
  legacy10: { id: "legacy10", userId: "u1", organizationId: "org1", score: 10, scale: 10 },
  foreign: { id: "foreign", userId: "u2", organizationId: "org1", score: 5, scale: 5 },
};

const TEXT = "Ведём все журналы в WeSetup, проверку прошли без замечаний. Советую!";

function reviewView(input: SubmitReviewInput): ReviewView {
  return {
    id: "rev1",
    organizationId: input.organizationId,
    organizationName: "Кафе «Ромашка»",
    userId: input.userId,
    authorName: input.authorName,
    place: input.place,
    text: input.text,
    kind: "text",
    mediaUrl: null,
    mediaMime: null,
    rating: input.rating,
    consentPublic: input.consentPublic,
    anonymous: false,
    organizationSphere: null,
    status: "pending",
    rewardRub: 0,
    suggestedRewardRub: 300,
    rejectReason: null,
    showOnLanding: true,
    createdAt: "2026-09-26T10:00:00.000Z",
    moderatedAt: null,
  };
}

function makeDeps(
  options: {
    pending?: { id: string; userId: string } | null;
    submitError?: Error;
    lockBusy?: boolean;
    signature?: { userName: string | null; organizationName: string | null };
  } = {},
) {
  const submitted: SubmitReviewInput[] = [];
  const audits: Array<{ organizationId: string; responseId: string; details: NpsReviewAuditDetails }> = [];
  const notices: NpsReviewModerationNotice[] = [];
  const locks: string[] = [];
  const deps: NpsReviewDeps = {
    findResponse: async (id) => responses[id] ?? null,
    loadSignature: async () => options.signature ?? { userName: "Анна Смирнова", organizationName: "Кафе «Ромашка»" },
    withOrganizationLock: async (organizationId, fn) => {
      locks.push(organizationId);
      if (options.lockBusy) return { acquired: false };
      return { acquired: true, value: await fn() };
    },
    findPendingReview: async () => options.pending ?? null,
    submitReview: async (input) => {
      if (options.submitError) throw options.submitError;
      submitted.push(input);
      return reviewView(input);
    },
    recordAudit: async (entry) => {
      audits.push(entry);
    },
    notifyModerators: async (notice) => {
      notices.push(notice);
    },
  };
  return { deps, submitted, audits, notices, locks };
}

const actor = { id: "u1" };

describe("runNpsReview (POST /api/nps/review)", () => {
  it("4–5: тот же отзыв, что в «Баланс и бонусы» — оценка из опроса, текст, согласие, организация ответа; AuditLog и уведомление", async () => {
    const { deps, submitted, audits, notices, locks } = makeDeps();
    const result = await runNpsReview({ actor, body: { responseId: "r5", text: `  ${TEXT}\r\n`, consent: true } }, deps);
    assert.deepEqual(result, { status: 200, body: { ok: true, reviewId: "rev1" } });
    assert.deepEqual(submitted, [
      {
        organizationId: "org1",
        userId: "u1",
        authorName: "Анна Смирнова",
        place: "Кафе «Ромашка»",
        text: TEXT,
        rating: 5,
        consentPublic: true,
        attachment: null,
      },
    ]);
    assert.deepEqual(locks, ["org1"]);
    assert.deepEqual(audits, [{ organizationId: "org1", responseId: "r5", details: { customerReviewId: "rev1", npsScore: 5 } }]);
    assert.equal(notices.length, 1);
    assert.equal(notices[0]?.npsScore, 5);
    assert.equal(notices[0]?.organizationName, "Кафе «Ромашка»");

    const four = makeDeps();
    assert.equal((await runNpsReview({ actor, body: { responseId: "r4", text: TEXT, consent: true } }, four.deps)).status, 200);
    assert.equal(four.submitted[0]?.rating, 4);
  });

  it("текст по умолчанию годится в отзыв как есть", async () => {
    const { deps, submitted } = makeDeps();
    const result = await runNpsReview({ actor, body: { responseId: "r5", text: NPS_RECOMMEND_DEFAULT_MESSAGE, consent: true } }, deps);
    assert.equal(result.status, 200);
    assert.equal(submitted[0]?.text, NPS_RECOMMEND_DEFAULT_MESSAGE);
  });

  it("у организации уже есть отзыв на проверке — говорим об этом, второй не создаём", async () => {
    const other = makeDeps({ pending: { id: "old", userId: "u9" } });
    assert.deepEqual(await runNpsReview({ actor, body: { responseId: "r5", text: TEXT, consent: true } }, other.deps), {
      status: 409,
      body: { error: "У вашей организации уже есть отзыв на проверке — дождитесь решения" },
    });
    assert.equal(other.submitted.length, 0);
    assert.equal(other.audits.length, 0);
    assert.equal(other.notices.length, 0);

    const own = makeDeps({ pending: { id: "old", userId: "u1" } });
    assert.deepEqual(await runNpsReview({ actor, body: { responseId: "r5", text: TEXT, consent: true } }, own.deps), {
      status: 409,
      body: { error: "Ваш отзыв уже на проверке — дождитесь решения" },
    });
    assert.equal(own.submitted.length, 0);
  });

  it("правила программы отзывов — из submitReview: принятый отзыв второй раз не примут", async () => {
    const { deps, audits, notices } = makeDeps({ submitError: new ReviewError("Отзыв уже принят. Спасибо!", 409) });
    assert.deepEqual(await runNpsReview({ actor, body: { responseId: "r5", text: TEXT, consent: true } }, deps), {
      status: 409,
      body: { error: "Отзыв уже принят. Спасибо!" },
    });
    assert.equal(audits.length, 0);
    assert.equal(notices.length, 0);
  });

  it("без согласия, короткий или длинный текст — ошибка с полем формы, без отзыва", async () => {
    const { deps, submitted } = makeDeps();
    assert.deepEqual(await runNpsReview({ actor, body: { responseId: "r5", text: TEXT, consent: false } }, deps), {
      status: 400,
      body: { error: "Без согласия на публикацию отзыв опубликовать нельзя", field: "consent" },
    });
    assert.equal((await runNpsReview({ actor, body: { responseId: "r5", text: TEXT } }, deps)).status, 400);
    assert.deepEqual(await runNpsReview({ actor, body: { responseId: "r5", text: "Отлично!", consent: true } }, deps), {
      status: 400,
      body: { error: `Для отзыва напишите хотя бы пару предложений — от ${REVIEW_TEXT_MIN_LENGTH} символов`, field: "message" },
    });
    assert.deepEqual(await runNpsReview({ actor, body: { responseId: "r5", text: "а".repeat(REVIEW_TEXT_MAX_LENGTH + 1), consent: true } }, deps), {
      status: 400,
      body: { error: `Отзыв — не больше ${REVIEW_TEXT_MAX_LENGTH} символов`, field: "message" },
    });
    assert.equal((await runNpsReview({ actor, body: { responseId: "r5", text: 42, consent: true } }, deps)).status, 400);
    assert.equal(submitted.length, 0);
  });

  it("без оценки, чужой ответ, 1–3 и старая шкала 0–10 — без отзыва", async () => {
    const { deps, submitted } = makeDeps();
    assert.deepEqual(await runNpsReview({ actor, body: { text: TEXT, consent: true } }, deps), {
      status: 400,
      body: { error: "Сначала поставьте оценку" },
    });
    assert.equal((await runNpsReview({ actor, body: null }, deps)).status, 400);
    assert.deepEqual(await runNpsReview({ actor, body: { responseId: "foreign", text: TEXT, consent: true } }, deps), {
      status: 404,
      body: { error: "Ответ не найден — обновите страницу" },
    });
    assert.equal((await runNpsReview({ actor, body: { responseId: "missing", text: TEXT, consent: true } }, deps)).status, 404);
    assert.deepEqual(await runNpsReview({ actor, body: { responseId: "r3", text: TEXT, consent: true } }, deps), {
      status: 400,
      body: { error: "Отзыв из опроса — после оценки 4 или 5" },
    });
    assert.equal((await runNpsReview({ actor, body: { responseId: "legacy10", text: TEXT, consent: true } }, deps)).status, 400);
    assert.equal(submitted.length, 0);
  });

  it("параллельный запрос той же организации — 429, без отзыва", async () => {
    const { deps, submitted } = makeDeps({ lockBusy: true });
    assert.deepEqual(await runNpsReview({ actor, body: { responseId: "r5", text: TEXT, consent: true } }, deps), {
      status: 429,
      body: { error: "Отзыв уже отправляется — подождите пару секунд" },
    });
    assert.equal(submitted.length, 0);
  });

  it("почту и название организации вместо имени не публикуем", async () => {
    assert.equal(npsReviewAuthorName("Анна Смирнова", "Кафе"), "Анна Смирнова");
    assert.equal(npsReviewAuthorName("anna@example.com", "Кафе"), NPS_REVIEW_FALLBACK_AUTHOR);
    assert.equal(npsReviewAuthorName("  кафе ", "Кафе"), NPS_REVIEW_FALLBACK_AUTHOR);
    assert.equal(npsReviewAuthorName(null, "Кафе"), NPS_REVIEW_FALLBACK_AUTHOR);

    const { deps, submitted } = makeDeps({ signature: { userName: "anna@example.com", organizationName: "  Кафе «Ромашка» " } });
    await runNpsReview({ actor, body: { responseId: "r5", text: TEXT, consent: true } }, deps);
    assert.equal(submitted[0]?.authorName, NPS_REVIEW_FALLBACK_AUTHOR);
    assert.equal(submitted[0]?.place, "Кафе «Ромашка»");
  });
});

describe("связь ответа опроса с отзывом", () => {
  it("id отзыва из деталей строки nps.review", () => {
    assert.equal(npsReviewIdFromDetails({ customerReviewId: "rev1", npsScore: 5 }), "rev1");
    assert.equal(npsReviewIdFromDetails({ npsScore: 5 }), null);
    assert.equal(npsReviewIdFromDetails(null), null);
    assert.equal(npsReviewIdFromDetails(["rev1"]), null);
  });

  it("журнал действий: подпись по-русски, id отзыва не показываем", () => {
    assert.equal(auditActionLabel("nps.review").label, "Отзыв о WeSetup из опроса");
    const details: NpsReviewAuditDetails = { customerReviewId: "rev1", npsScore: 5 };
    assert.deepEqual(
      auditDetailPairs(details).map((pair) => `${pair.label}: ${pair.value}`),
      ["Оценка: 5"],
    );
  });
});
