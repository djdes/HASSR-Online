import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditActionLabel, auditDetailPairs, auditEntityLabel } from "@/lib/audit-labels";
import type { InviteColleagueInput, InviteColleagueResult, NpsRecommendAuditDetails } from "@/lib/balance/invite-colleague";
import { runNpsRecommendation, type NpsRecommendResponseRow } from "@/lib/nps-recommend";

const responses: Record<string, NpsRecommendResponseRow> = {
  r5: { id: "r5", userId: "u1", organizationId: "org1", score: 5, scale: 5 },
  r4: { id: "r4", userId: "u1", organizationId: "org1", score: 4, scale: 5 },
  r3: { id: "r3", userId: "u1", organizationId: "org1", score: 3, scale: 5 },
  legacy10: { id: "legacy10", userId: "u1", organizationId: "org1", score: 10, scale: 10 },
  foreign: { id: "foreign", userId: "u2", organizationId: "org1", score: 5, scale: 5 },
};

function makeDeps(result: InviteColleagueResult = { ok: true, delivery: "sent", code: "ABCD2345" }) {
  const calls: InviteColleagueInput[] = [];
  return {
    calls,
    deps: {
      findResponse: async (id: string) => responses[id] ?? null,
      inviteColleague: async (input: InviteColleagueInput) => {
        calls.push(input);
        return result;
      },
    },
  };
}

const actor = { id: "u1", name: "Анна Смирнова", email: "anna@example.com" };

describe("runNpsRecommendation", () => {
  it("4–5: передаёт в общее приглашение коллеги с source = nps, организацией и оценкой ответа", async () => {
    const { deps, calls } = makeDeps();
    const result = await runNpsRecommendation({ actor, body: { responseId: "r5", email: "colleague@example.com", message: "Привет" } }, deps);
    assert.deepEqual(result, { status: 200, body: { ok: true, delivery: "sent" } });
    assert.deepEqual(calls, [
      {
        source: "nps",
        organizationId: "org1",
        actor,
        email: "colleague@example.com",
        message: "Привет",
        nps: { responseId: "r5", score: 5 },
      },
    ]);
    const four = makeDeps();
    assert.equal((await runNpsRecommendation({ actor, body: { responseId: "r4", email: "c@example.com" } }, four.deps)).status, 200);
    assert.deepEqual(four.calls[0]?.nps, { responseId: "r4", score: 4 });
  });

  it("без оценки, чужой ответ, 1–3 и старая шкала 0–10 — без письма", async () => {
    const { deps, calls } = makeDeps();
    assert.deepEqual(await runNpsRecommendation({ actor, body: { email: "c@example.com" } }, deps), {
      status: 400,
      body: { error: "Сначала поставьте оценку" },
    });
    assert.equal((await runNpsRecommendation({ actor, body: null }, deps)).status, 400);
    assert.deepEqual(await runNpsRecommendation({ actor, body: { responseId: "foreign" } }, deps), {
      status: 404,
      body: { error: "Ответ не найден — обновите страницу" },
    });
    assert.equal((await runNpsRecommendation({ actor, body: { responseId: "missing" } }, deps)).status, 404);
    assert.deepEqual(await runNpsRecommendation({ actor, body: { responseId: "r3" } }, deps), {
      status: 400,
      body: { error: "Рекомендация доступна после оценки 4 или 5" },
    });
    assert.equal((await runNpsRecommendation({ actor, body: { responseId: "legacy10" } }, deps)).status, 400);
    assert.equal(calls.length, 0);
  });

  it("ошибки приглашения отдаются как есть — с полем для формы", async () => {
    const { deps } = makeDeps({ ok: false, status: 409, body: { error: "Этот адрес уже зарегистрирован в WeSetup — приглашение не нужно", field: "email" } });
    assert.deepEqual(await runNpsRecommendation({ actor, body: { responseId: "r5", email: "taken@example.com" } }, deps), {
      status: 409,
      body: { error: "Этот адрес уже зарегистрирован в WeSetup — приглашение не нужно", field: "email" },
    });
  });
});

describe("журнал действий (/settings/audit)", () => {
  it("рекомендация подписана по-русски: кому, оценка, доставка — без текста письма", () => {
    assert.equal(auditActionLabel("nps.recommend").label, "Рекомендация WeSetup коллеге");
    assert.equal(auditEntityLabel("NpsResponse"), "Опрос «Посоветуете WeSetup коллегам?»");
    const details: NpsRecommendAuditDetails = { colleagueEmail: "c@example.com", npsScore: 5, delivery: "sent" };
    assert.deepEqual(
      auditDetailPairs(details).map((pair) => `${pair.label}: ${pair.value}`),
      ["Почта коллеги: c@example.com", "Оценка: 5", "Доставка: письмо отправлено"],
    );
  });
});
