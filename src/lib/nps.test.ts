import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NPS_COMMENT_MAX_LENGTH,
  canEditNpsResponse,
  computeNps,
  computeNpsReport,
  normalizeNpsScale,
  npsCategory,
  npsInvitesRecommendation,
  parseNpsAnswer,
  parseNpsUpdate,
  shouldAskNps,
} from "@/lib/nps";

const now = new Date("2026-09-10T12:00:00.000Z");

describe("shouldAskNps", () => {
  it("не раньше двух недель после регистрации и не чаще раза в 90 дней", () => {
    assert.equal(shouldAskNps({ orgCreatedAt: new Date("2026-09-01"), npsAskedAt: null, now }), false);
    assert.equal(shouldAskNps({ orgCreatedAt: new Date("2026-06-01"), npsAskedAt: null, now }), true);
    assert.equal(shouldAskNps({ orgCreatedAt: new Date("2026-06-01"), npsAskedAt: new Date("2026-08-01"), now }), false);
    assert.equal(shouldAskNps({ orgCreatedAt: new Date("2026-06-01"), npsAskedAt: new Date("2026-05-01"), now }), true);
  });
});

describe("computeNps", () => {
  it("промоутеры минус критики в процентах", () => {
    assert.deepEqual(computeNps([10, 9, 8, 7, 6, 3]), { total: 6, promoters: 2, passives: 2, detractors: 2, nps: 0, average: 7.2 });
    assert.equal(computeNps([10, 10, 9]).nps, 100);
    assert.equal(computeNps([]).nps, null);
  });
});

describe("шкалы NPS", () => {
  it("1–5: 5 — промоутер, 4 — нейтральный, 1–3 — критик", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((s) => npsCategory(s, 5)),
      ["detractor", "detractor", "detractor", "passive", "promoter"],
    );
  });

  it("0–10 — как раньше: 9–10 промоутеры, 7–8 нейтральные, 0–6 критики", () => {
    assert.deepEqual(
      [0, 6, 7, 8, 9, 10].map((s) => npsCategory(s, 10)),
      ["detractor", "detractor", "passive", "passive", "promoter", "promoter"],
    );
    // Шкала по умолчанию — старая.
    assert.equal(npsCategory(5), "detractor");
  });

  it("шкала из базы: всё, что не 5, — старая 0–10", () => {
    assert.equal(normalizeNpsScale(5), 5);
    assert.equal(normalizeNpsScale(10), 10);
    assert.equal(normalizeNpsScale(null), 10);
    assert.equal(normalizeNpsScale(undefined), 10);
    assert.equal(normalizeNpsScale(7), 10);
  });

  it("рекомендацию коллеге предлагаем только после 4–5 по шкале 1–5", () => {
    assert.equal(npsInvitesRecommendation(5, 5), true);
    assert.equal(npsInvitesRecommendation(4, 5), true);
    assert.equal(npsInvitesRecommendation(3, 5), false);
    assert.equal(npsInvitesRecommendation(10, 10), false);
  });
});

describe("computeNpsReport", () => {
  it("старые ответы 0–10 без scale считаются как раньше", () => {
    const legacy = [10, 9, 8, 7, 6, 3].map((score) => ({ score }));
    const report = computeNpsReport(legacy);
    assert.deepEqual(report.overall, { total: 6, promoters: 2, passives: 2, detractors: 2, nps: 0, average: null });
    assert.equal(report.scale10.nps, computeNps([10, 9, 8, 7, 6, 3]).nps);
    assert.equal(report.scale10.average, 7.2);
    assert.equal(report.scale5.total, 0);
    assert.equal(report.scale5.nps, null);
  });

  it("обе шкалы: распределение по каждой и общий NPS по категориям", () => {
    const report = computeNpsReport([
      { score: 5, scale: 5 },
      { score: 5, scale: 5 },
      { score: 4, scale: 5 },
      { score: 2, scale: 5 },
      { score: 10, scale: 10 },
      { score: 6, scale: 10 },
      { score: 8, scale: null },
      { score: 9, scale: 10 },
    ]);
    assert.deepEqual(
      report.scale5.distribution.map((bar) => [bar.score, bar.count, bar.category]),
      [
        [1, 0, "detractor"],
        [2, 1, "detractor"],
        [3, 0, "detractor"],
        [4, 1, "passive"],
        [5, 2, "promoter"],
      ],
    );
    assert.equal(report.scale5.nps, 25); // (2 − 1) / 4
    assert.equal(report.scale5.average, 4);
    assert.equal(report.scale10.distribution.length, 11);
    assert.deepEqual(
      report.scale10.distribution.filter((bar) => bar.count > 0).map((bar) => [bar.score, bar.count]),
      [
        [6, 1],
        [8, 1],
        [9, 1],
        [10, 1],
      ],
    );
    assert.equal(report.scale10.nps, 25); // (2 − 1) / 4
    // Общий: промоутеров 4 (5, 5, 10, 9), критиков 2 (2, 6), всего 8.
    assert.deepEqual(report.overall, { total: 8, promoters: 4, passives: 2, detractors: 2, nps: 25, average: null });
  });

  it("пусто — без NPS", () => {
    const report = computeNpsReport([]);
    assert.equal(report.overall.nps, null);
    assert.equal(report.scale5.distribution.every((bar) => bar.count === 0), true);
  });
});

describe("parseNpsAnswer (POST /api/nps)", () => {
  it("новый формат: { score, scale: 5 }", () => {
    assert.deepEqual(parseNpsAnswer({ score: 4, scale: 5 }), { kind: "answer", score: 4, scale: 5, comment: null });
    assert.deepEqual(parseNpsAnswer({ score: 1, scale: 5, comment: "  медленно  " }), { kind: "answer", score: 1, scale: 5, comment: "медленно" });
  });

  it("старый формат без scale — 0–10, как раньше", () => {
    assert.deepEqual(parseNpsAnswer({ score: 7, comment: "ок" }), { kind: "answer", score: 7, scale: 10, comment: "ок" });
    assert.deepEqual(parseNpsAnswer({ score: 0 }), { kind: "answer", score: 0, scale: 10, comment: null });
    assert.deepEqual(parseNpsAnswer({ score: 11 }), { kind: "invalid", error: "Оценка — от 0 до 10" });
  });

  it("оценка вне шкалы 1–5 и неизвестная шкала — ошибка", () => {
    assert.deepEqual(parseNpsAnswer({ score: 0, scale: 5 }), { kind: "invalid", error: "Оценка — от 1 до 5" });
    assert.deepEqual(parseNpsAnswer({ score: 6, scale: 5 }), { kind: "invalid", error: "Оценка — от 1 до 5" });
    assert.deepEqual(parseNpsAnswer({ score: 4.5, scale: 5 }), { kind: "invalid", error: "Оценка — от 1 до 5" });
    assert.deepEqual(parseNpsAnswer({ score: "5", scale: 5 }), { kind: "invalid", error: "Оценка — от 1 до 5" });
    assert.deepEqual(parseNpsAnswer({ score: 3, scale: 7 }), { kind: "invalid", error: "Неизвестная шкала оценки" });
    assert.deepEqual(parseNpsAnswer(null), { kind: "invalid", error: "Оценка — от 0 до 10" });
  });

  it("«не сейчас» и комментарий не длиннее лимита", () => {
    assert.deepEqual(parseNpsAnswer({ dismiss: true }), { kind: "dismiss" });
    const long = parseNpsAnswer({ score: 2, scale: 5, comment: "а".repeat(NPS_COMMENT_MAX_LENGTH + 50) });
    assert.equal(long.kind, "answer");
    assert.equal(long.kind === "answer" ? long.comment?.length : 0, NPS_COMMENT_MAX_LENGTH);
  });
});

describe("parseNpsUpdate (PATCH /api/nps)", () => {
  it("смена оценки и «Что улучшить?»", () => {
    assert.deepEqual(parseNpsUpdate({ id: "r1", score: 5 }), { kind: "update", id: "r1", score: 5 });
    assert.deepEqual(parseNpsUpdate({ id: "r1", comment: "  отчёты  " }), { kind: "update", id: "r1", comment: "отчёты" });
    assert.deepEqual(parseNpsUpdate({ id: "r1", comment: "   " }), { kind: "update", id: "r1", comment: null });
  });

  it("без id, без полей или с дробной оценкой — ошибка", () => {
    assert.equal(parseNpsUpdate({ score: 5 }).kind, "invalid");
    assert.equal(parseNpsUpdate({ id: "x".repeat(65), score: 5 }).kind, "invalid");
    assert.deepEqual(parseNpsUpdate({ id: "r1" }), { kind: "invalid", error: "Нечего сохранять" });
    assert.deepEqual(parseNpsUpdate({ id: "r1", score: 4.2 }), { kind: "invalid", error: "Оценка — целое число" });
  });

  it("поправить ответ можно в течение суток", () => {
    const created = new Date("2026-09-10T10:00:00.000Z");
    assert.equal(canEditNpsResponse(created, new Date("2026-09-11T09:59:00.000Z")), true);
    assert.equal(canEditNpsResponse(created, new Date("2026-09-11T10:01:00.000Z")), false);
  });
});
