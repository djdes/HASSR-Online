import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditActionLabel, auditDetailPairs, auditEntityLabel } from "@/lib/audit-labels";
import type { ColleagueRecommendationEmailParams } from "@/lib/email";
import { NPS_RECOMMEND_MESSAGE_MAX_LENGTH, NPS_RECOMMEND_PER_ORG_PER_DAY, NPS_RECOMMEND_PER_USER_PER_DAY } from "@/lib/nps";
import {
  parseNpsRecommendation,
  recommendationLink,
  replyToAddress,
  runNpsRecommendation,
  senderDisplayName,
  type NpsRecommendAuditDetails,
  type NpsRecommendDeps,
  type NpsRecommendResponseRow,
} from "@/lib/nps-recommend";

const NOW = new Date("2026-09-25T12:00:00.000Z");

describe("parseNpsRecommendation", () => {
  it("почта обязательна и проверяется, текст ≤ 1000 символов", () => {
    assert.deepEqual(parseNpsRecommendation({ responseId: "r1", email: " ", message: "x" }), {
      ok: false,
      error: "Укажите почту коллеги",
      field: "email",
    });
    const bad = parseNpsRecommendation({ responseId: "r1", email: "ivan.example.com", message: "x" });
    assert.equal(bad.ok, false);
    assert.equal(!bad.ok && bad.field, "email");
    assert.equal(!bad.ok && bad.error, "В адресе не хватает символа @");

    const tooLong = parseNpsRecommendation({ responseId: "r1", email: "ivan@example.com", message: "а".repeat(NPS_RECOMMEND_MESSAGE_MAX_LENGTH + 1) });
    assert.deepEqual(tooLong, { ok: false, error: "Сообщение длиннее 1000 символов — сократите его", field: "message" });

    const limit = parseNpsRecommendation({ responseId: "r1", email: "ivan@example.com", message: "а".repeat(NPS_RECOMMEND_MESSAGE_MAX_LENGTH) });
    assert.equal(limit.ok, true);
  });

  it("без оценки нельзя; адрес — в нижний регистр, переводы строк нормализуются", () => {
    assert.deepEqual(parseNpsRecommendation({ email: "ivan@example.com" }), { ok: false, error: "Сначала поставьте оценку" });
    assert.deepEqual(parseNpsRecommendation({ responseId: "r1", email: " Ivan@Example.COM ", message: " Привет\r\nколлега " }), {
      ok: true,
      value: { responseId: "r1", email: "ivan@example.com", message: "Привет\nколлега" },
    });
    assert.deepEqual(parseNpsRecommendation({ responseId: "r1", email: "ivan@example.com", message: 42 }), {
      ok: false,
      error: "Сообщение должно быть текстом",
      field: "message",
    });
  });

  it("похожий на опечатку домен не блокирует — у коллеги может быть mail.kz", () => {
    assert.equal(parseNpsRecommendation({ responseId: "r1", email: "ivan@mail.kz", message: "" }).ok, true);
  });
});

describe("recommendationLink", () => {
  it("есть реферальный код — ссылка /r/<код>, иначе обычная регистрация; почта подставляется", () => {
    assert.deepEqual(recommendationLink({ appUrl: "https://wesetup.ru/", referralCode: "ABCD2345", recipient: "ivan+cafe@example.com" }), {
      link: "https://wesetup.ru/r/ABCD2345?email=ivan%2Bcafe%40example.com",
      referral: true,
    });
    assert.deepEqual(recommendationLink({ appUrl: "https://wesetup.ru", referralCode: null, recipient: "ivan@example.com" }), {
      link: "https://wesetup.ru/register?email=ivan%40example.com",
      referral: false,
    });
  });
});

describe("имя и адрес для ответа", () => {
  it("имя-заглушку (название организации или почту) не пишем", () => {
    assert.equal(senderDisplayName("Анна Смирнова", "Кафе «Ромашка»"), "Анна Смирнова");
    assert.equal(senderDisplayName("Кафе «Ромашка»", "кафе «ромашка»"), null);
    assert.equal(senderDisplayName("anna@example.com", "Кафе"), null);
    assert.equal(senderDisplayName("  ", "Кафе"), null);
  });

  it("Reply-To — контактная почта, иначе логин; служебные адреса пропускаем", () => {
    assert.equal(replyToAddress({ email: "anna@example.com", contactEmail: "Anna.Work@Example.com" }), "anna.work@example.com");
    assert.equal(replyToAddress({ email: "anna@example.com", contactEmail: null }), "anna@example.com");
    assert.equal(replyToAddress({ email: "staff-x1@org1.local.haccp", contactEmail: null }), null);
    assert.equal(replyToAddress({ email: "79990001122@org1.staff.local", contactEmail: "" }), null);
  });
});

type Sent = { at: Date; userId: string; organizationId: string; recipient: string };

/** Подделка базы и почты: AuditLog — массив, как в жизни растёт после каждой отправки. */
function makeDeps(overrides: Partial<NpsRecommendDeps> & { referralCode?: string | null; sentLog?: Sent[] } = {}) {
  const emails: ColleagueRecommendationEmailParams[] = [];
  const audits: Array<{ organizationId: string; responseId: string; details: NpsRecommendAuditDetails }> = [];
  const sentLog: Sent[] = overrides.sentLog ?? [];
  const responses: Record<string, NpsRecommendResponseRow> = {
    r5: { id: "r5", userId: "u1", organizationId: "org1", score: 5, scale: 5 },
    r4: { id: "r4", userId: "u1", organizationId: "org1", score: 4, scale: 5 },
    r3: { id: "r3", userId: "u1", organizationId: "org1", score: 3, scale: 5 },
    legacy10: { id: "legacy10", userId: "u1", organizationId: "org1", score: 10, scale: 10 },
    foreign: { id: "foreign", userId: "u2", organizationId: "org1", score: 5, scale: 5 },
  };
  const deps: NpsRecommendDeps = {
    appUrl: "https://wesetup.ru",
    now: () => NOW,
    findResponse: async (id) => responses[id] ?? null,
    loadSender: async () => ({ name: "Анна Смирнова", email: "anna@example.com", contactEmail: null }),
    loadOrganization: async () => ({ name: "Кафе «Ромашка»", referralCode: overrides.referralCode === undefined ? "ABCD2345" : overrides.referralCode }),
    isOrganizationStaffEmail: async (_org, email) => email === "cook@example.com",
    domainAcceptsMail: async (domain) => domain !== "no-such-domain.example",
    withOrganizationLock: async (_org, fn) => ({ acquired: true, value: await fn() }),
    countSent: async ({ since, userId, organizationId, recipient }) =>
      sentLog.filter(
        (row) =>
          row.at >= since &&
          (!userId || row.userId === userId) &&
          (!organizationId || row.organizationId === organizationId) &&
          (!recipient || row.recipient === recipient),
      ).length,
    sendEmail: async (params) => {
      emails.push(params);
      return "sent";
    },
    recordAudit: async (entry) => {
      audits.push(entry);
      sentLog.push({ at: NOW, userId: "u1", organizationId: entry.organizationId, recipient: entry.details.colleagueEmail });
    },
    ...overrides,
  };
  return { deps, emails, audits, sentLog };
}

const body = (extra: Record<string, unknown> = {}) => ({
  responseId: "r5",
  email: "colleague@example.com",
  message: "Привет! <b>Попробуй</b> WeSetup",
  ...extra,
});

describe("runNpsRecommendation", () => {
  it("4–5: письмо коллеге с текстом, реферальной ссылкой и Reply-To; AuditLog без текста письма", async () => {
    const { deps, emails, audits } = makeDeps();
    const result = await runNpsRecommendation({ userId: "u1", body: body() }, deps);
    assert.deepEqual(result, { status: 200, body: { ok: true, referral: true, delivery: "sent" } });
    assert.deepEqual(emails, [
      {
        to: "colleague@example.com",
        fromUserName: "Анна Смирнова",
        fromOrganizationName: "Кафе «Ромашка»",
        message: "Привет! <b>Попробуй</b> WeSetup",
        link: "https://wesetup.ru/r/ABCD2345?email=colleague%40example.com",
        referral: true,
        replyTo: "anna@example.com",
      },
    ]);
    assert.deepEqual(audits, [
      {
        organizationId: "org1",
        responseId: "r5",
        details: { colleagueEmail: "colleague@example.com", referral: true, npsScore: 5, delivery: "sent" },
      },
    ]);
    assert.equal(JSON.stringify(audits).includes("Попробуй"), false);
  });

  it("оценка 4 тоже зовёт коллегу; без реферального кода — обычная регистрация", async () => {
    const { deps, emails } = makeDeps({ referralCode: null });
    const result = await runNpsRecommendation({ userId: "u1", body: body({ responseId: "r4" }) }, deps);
    assert.deepEqual(result, { status: 200, body: { ok: true, referral: false, delivery: "sent" } });
    assert.equal(emails[0]?.link, "https://wesetup.ru/register?email=colleague%40example.com");
    assert.equal(emails[0]?.referral, false);
  });

  it("не на свою почту и не на почту сотрудника своей организации", async () => {
    const own = makeDeps();
    assert.deepEqual(await runNpsRecommendation({ userId: "u1", body: body({ email: "Anna@Example.com" }) }, own.deps), {
      status: 400,
      body: { error: "Это ваша почта — укажите адрес коллеги", field: "email" },
    });
    const staff = makeDeps();
    assert.deepEqual(await runNpsRecommendation({ userId: "u1", body: body({ email: "cook@example.com" }) }, staff.deps), {
      status: 400,
      body: { error: "Это почта сотрудника вашей организации — укажите коллегу из другого заведения", field: "email" },
    });
    assert.equal(own.emails.length + staff.emails.length, 0);
    assert.equal(own.audits.length + staff.audits.length, 0);
  });

  it("несуществующий домен — понятная ошибка у поля почты", async () => {
    const { deps, emails } = makeDeps();
    const result = await runNpsRecommendation({ userId: "u1", body: body({ email: "ivan@no-such-domain.example" }) }, deps);
    assert.deepEqual(result, { status: 400, body: { error: "Почтового домена no-such-domain.example не существует — проверьте адрес", field: "email" } });
    assert.equal(emails.length, 0);
  });

  it("чужой ответ, оценка 1–3 и старая шкала 0–10 — без письма", async () => {
    const { deps, emails } = makeDeps();
    assert.equal((await runNpsRecommendation({ userId: "u1", body: body({ responseId: "foreign" }) }, deps)).status, 404);
    assert.equal((await runNpsRecommendation({ userId: "u1", body: body({ responseId: "missing" }) }, deps)).status, 404);
    assert.deepEqual(await runNpsRecommendation({ userId: "u1", body: body({ responseId: "r3" }) }, deps), {
      status: 400,
      body: { error: "Рекомендация доступна после оценки 4 или 5" },
    });
    assert.equal((await runNpsRecommendation({ userId: "u1", body: body({ responseId: "legacy10" }) }, deps)).status, 400);
    assert.equal(emails.length, 0);
  });

  it(`не больше ${NPS_RECOMMEND_PER_USER_PER_DAY} рекомендаций в сутки на человека`, async () => {
    const { deps, emails } = makeDeps();
    for (let i = 1; i <= NPS_RECOMMEND_PER_USER_PER_DAY; i += 1) {
      const ok = await runNpsRecommendation({ userId: "u1", body: body({ email: `colleague${i}@example.com` }) }, deps);
      assert.equal(ok.status, 200, `письмо №${i}`);
    }
    const sixth = await runNpsRecommendation({ userId: "u1", body: body({ email: "colleague6@example.com" }) }, deps);
    assert.deepEqual(sixth, { status: 429, body: { error: "Не больше 5 рекомендаций в сутки — попробуйте завтра" } });
    assert.equal(emails.length, NPS_RECOMMEND_PER_USER_PER_DAY);
  });

  it("вчерашние отправки лимит не занимают", async () => {
    const yesterday = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    const sentLog: Sent[] = Array.from({ length: NPS_RECOMMEND_PER_USER_PER_DAY }, (_, i) => ({
      at: yesterday,
      userId: "u1",
      organizationId: "org1",
      recipient: `old${i}@example.com`,
    }));
    const { deps } = makeDeps({ sentLog });
    assert.equal((await runNpsRecommendation({ userId: "u1", body: body() }, deps)).status, 200);
  });

  it("лимит организации и повтор на тот же адрес в течение суток", async () => {
    const orgLog: Sent[] = Array.from({ length: NPS_RECOMMEND_PER_ORG_PER_DAY }, (_, i) => ({
      at: NOW,
      userId: `other${i}`,
      organizationId: "org1",
      recipient: `c${i}@example.com`,
    }));
    const busyOrg = makeDeps({ sentLog: orgLog });
    assert.deepEqual(await runNpsRecommendation({ userId: "u1", body: body() }, busyOrg.deps), {
      status: 429,
      body: { error: "Из вашей организации сегодня уже отправили много рекомендаций — попробуйте завтра" },
    });

    const repeat = makeDeps({ sentLog: [{ at: NOW, userId: "u9", organizationId: "org1", recipient: "colleague@example.com" }] });
    assert.deepEqual(await runNpsRecommendation({ userId: "u1", body: body() }, repeat.deps), {
      status: 429,
      body: { error: "Этому адресу сегодня уже отправляли рекомендацию", field: "email" },
    });
    assert.equal(busyOrg.emails.length + repeat.emails.length, 0);
  });

  it("письмо не ушло — 502 и без записи в AuditLog; почта не настроена (dev) — успех с пометкой", async () => {
    const failed = makeDeps({ sendEmail: async () => "failed" });
    assert.deepEqual(await runNpsRecommendation({ userId: "u1", body: body() }, failed.deps), {
      status: 502,
      body: { error: "Письмо не ушло — попробуйте позже" },
    });
    assert.equal(failed.audits.length, 0);

    const logged = makeDeps({ sendEmail: async () => "logged" });
    assert.deepEqual(await runNpsRecommendation({ userId: "u1", body: body() }, logged.deps), {
      status: 200,
      body: { ok: true, referral: true, delivery: "logged" },
    });
    assert.equal(logged.audits[0]?.details.delivery, "logged");
  });

  it("замок организации занят — просим подождать, письмо не шлём", async () => {
    const { deps, emails } = makeDeps({ withOrganizationLock: async () => ({ acquired: false }) });
    assert.deepEqual(await runNpsRecommendation({ userId: "u1", body: body() }, deps), {
      status: 429,
      body: { error: "Письмо уже отправляется — подождите пару секунд" },
    });
    assert.equal(emails.length, 0);
  });

  it("имя-заглушка и служебная почта: письмо без имени и без Reply-To", async () => {
    const { deps, emails } = makeDeps({
      loadSender: async () => ({ name: "Кафе «Ромашка»", email: "staff-x1@org1.local.haccp", contactEmail: null }),
    });
    assert.equal((await runNpsRecommendation({ userId: "u1", body: body() }, deps)).status, 200);
    assert.equal(emails[0]?.fromUserName, null);
    assert.equal(emails[0]?.replyTo, null);
  });
});

describe("журнал действий (/settings/audit)", () => {
  it("рекомендация подписана по-русски: кому, реферальная ли ссылка, оценка — без текста письма", () => {
    assert.equal(auditActionLabel("nps.recommend").label, "Рекомендация WeSetup коллеге");
    assert.equal(auditEntityLabel("NpsResponse"), "Опрос «Посоветуете WeSetup коллегам?»");
    const details: NpsRecommendAuditDetails = { colleagueEmail: "c@example.com", referral: true, npsScore: 5, delivery: "sent" };
    assert.deepEqual(
      auditDetailPairs(details).map((pair) => `${pair.label}: ${pair.value}`),
      ["Почта коллеги: c@example.com", "Реферальная ссылка: да", "Оценка: 5", "Доставка: письмо отправлено"],
    );
  });
});
