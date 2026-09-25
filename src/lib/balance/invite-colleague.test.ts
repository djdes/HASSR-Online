import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REFERRAL_INVITES_PER_DAY } from "@/lib/balance/constants";
import type { ReferralInviteEmailParams } from "@/lib/balance/emails";
import {
  inviteColleague,
  referralInviteLink,
  replyToAddress,
  senderDisplayName,
  type InviteColleagueDeps,
  type InviteColleagueInput,
  type NpsRecommendAuditDetails,
} from "@/lib/balance/invite-colleague";
import { NPS_RECOMMEND_MESSAGE_MAX_LENGTH, NPS_RECOMMEND_PER_USER_PER_DAY } from "@/lib/nps";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

type Invite = { organizationId: string; email: string; invitedByUserId: string; createdAt: Date };

/**
 * Подделка базы и почты. ReferralInvite и AuditLog — массивы, которые растут
 * после каждой отправки, как в жизни: лимиты считаются по ним же.
 */
function makeDeps(
  overrides: Partial<InviteColleagueDeps> & {
    invites?: Invite[];
    npsAudit?: Array<{ userId: string; at: Date }>;
    registered?: string[];
  } = {},
) {
  const invites: Invite[] = overrides.invites ?? [];
  const npsAudit = overrides.npsAudit ?? [];
  const registered = new Set(overrides.registered ?? ["taken@example.com", "anna@example.com"]);
  const emails: ReferralInviteEmailParams[] = [];
  const audits: Array<{ organizationId: string; responseId: string; details: NpsRecommendAuditDetails }> = [];
  const codesEnsured: string[] = [];
  const deps: InviteColleagueDeps = {
    appUrl: "https://wesetup.ru",
    now: () => NOW,
    loadSender: async () => ({ name: "Анна Смирнова", email: "anna@example.com", contactEmail: "anna.work@example.com" }),
    loadOrganizationName: async () => "Кафе «Ромашка»",
    ensureReferralCode: async (organizationId) => {
      codesEnsured.push(organizationId);
      return "ABCD2345";
    },
    isRegisteredEmail: async (email) => registered.has(email),
    isOrganizationStaffEmail: async (_org, email) => email === "cook@example.com",
    domainAcceptsMail: async (domain) => domain !== "no-such-domain.example",
    withOrganizationLock: async (_org, fn) => ({ acquired: true, value: await fn() }),
    countOrganizationInvitesSince: async (organizationId, since) =>
      invites.filter((i) => i.organizationId === organizationId && i.createdAt >= since).length,
    lastInviteAt: async (organizationId, email) =>
      invites.find((i) => i.organizationId === organizationId && i.email === email)?.createdAt ?? null,
    countNpsRecommendationsSince: async (userId, since) => npsAudit.filter((a) => a.userId === userId && a.at >= since).length,
    sendInvite: async (params) => {
      emails.push(params);
      return "sent";
    },
    saveInvite: async ({ organizationId, email, invitedByUserId }) => {
      const existing = invites.find((i) => i.organizationId === organizationId && i.email === email);
      if (existing) Object.assign(existing, { createdAt: NOW, invitedByUserId });
      else invites.push({ organizationId, email, invitedByUserId, createdAt: NOW });
    },
    recordNpsAudit: async (entry) => {
      audits.push(entry);
      npsAudit.push({ userId: "u1", at: NOW });
    },
    ...overrides,
  };
  return { deps, invites, emails, audits, codesEnsured };
}

const balance = (extra: Partial<InviteColleagueInput> = {}): InviteColleagueInput => ({
  source: "balance",
  organizationId: "org1",
  actor: { id: "u1", name: "Анна Смирнова", email: "anna@example.com" },
  email: "friend@example.com",
  message: "Попробуй, удобно",
  ...extra,
});

const nps = (extra: Partial<InviteColleagueInput> = {}): InviteColleagueInput => ({
  source: "nps",
  organizationId: "org1",
  actor: { id: "u1", name: "Анна Смирнова", email: "anna@example.com" },
  email: "colleague@example.com",
  message: "Привет! <b>Попробуй</b> WeSetup",
  nps: { responseId: "r5", score: 5 },
  ...extra,
});

describe("inviteColleague: «Баланс и бонусы» ведёт себя как раньше", () => {
  it("успех: реферальная ссылка с почтой, одно письмо с Reply-To, запись ReferralInvite, без AuditLog", async () => {
    const { deps, invites, emails, audits, codesEnsured } = makeDeps();
    const result = await inviteColleague(balance({ email: "  Friend@Example.com " }), deps);
    assert.deepEqual(result, { ok: true, delivery: "sent", code: "ABCD2345" });
    assert.deepEqual(codesEnsured, ["org1"]);
    assert.deepEqual(emails, [
      {
        to: "friend@example.com",
        fromUserName: "Анна Смирнова",
        fromOrganizationName: "Кафе «Ромашка»",
        message: "Попробуй, удобно",
        link: "https://wesetup.ru/r/ABCD2345?email=friend%40example.com",
        replyTo: "anna.work@example.com",
      },
    ]);
    assert.deepEqual(invites, [{ organizationId: "org1", email: "friend@example.com", invitedByUserId: "u1", createdAt: NOW }]);
    assert.equal(audits.length, 0);
  });

  it("проверка тела — та же: кривая почта и сообщение длиннее 500 — «Укажите корректный адрес…»", async () => {
    const { deps, emails } = makeDeps();
    const invalid = { ok: false, status: 400, body: { error: "Укажите корректный адрес электронной почты" } };
    assert.deepEqual(await inviteColleague(balance({ email: "friend.example.com" }), deps), invalid);
    assert.deepEqual(await inviteColleague(balance({ email: undefined }), deps), invalid);
    assert.deepEqual(await inviteColleague(balance({ message: "а".repeat(501) }), deps), invalid);
    assert.deepEqual(await inviteColleague(balance({ message: 42 }), deps), invalid);
    assert.equal((await inviteColleague(balance({ message: "а".repeat(500) }), deps)).ok, true);
    assert.equal((await inviteColleague(balance({ email: "other@example.com", message: undefined }), deps)).ok, true);
    assert.equal(emails[1]?.message, null, "без сообщения — письмо без личного блока");
  });

  it("свой адрес (логин из сессии), уже зарегистрирован, домена нет — прежние ответы", async () => {
    const { deps, emails } = makeDeps();
    assert.deepEqual(await inviteColleague(balance({ email: "ANNA@example.com" }), deps), {
      ok: false,
      status: 400,
      body: { error: "Это ваш собственный адрес", field: "email" },
    });
    assert.deepEqual(await inviteColleague(balance({ email: "taken@example.com" }), deps), {
      ok: false,
      status: 409,
      body: { error: "Этот адрес уже зарегистрирован в WeSetup — бонуса не будет", field: "email" },
    });
    assert.deepEqual(await inviteColleague(balance({ email: "friend@no-such-domain.example" }), deps), {
      ok: false,
      status: 400,
      body: { error: "Такого почтового домена не существует — проверьте адрес", field: "email" },
    });
    assert.equal(emails.length, 0);
  });

  it(`не больше ${REFERRAL_INVITES_PER_DAY} приглашений в сутки на организацию, на один адрес — раз в сутки`, async () => {
    const full: Invite[] = Array.from({ length: REFERRAL_INVITES_PER_DAY }, (_, i) => ({
      organizationId: "org1",
      email: `f${i}@example.com`,
      invitedByUserId: "u2",
      createdAt: new Date(NOW.getTime() - HOUR),
    }));
    const busy = makeDeps({ invites: full });
    assert.deepEqual(await inviteColleague(balance(), busy.deps), {
      ok: false,
      status: 429,
      body: { error: `Не больше ${REFERRAL_INVITES_PER_DAY} приглашений в сутки. Попробуйте завтра` },
    });

    const repeat = makeDeps({
      invites: [{ organizationId: "org1", email: "friend@example.com", invitedByUserId: "u2", createdAt: new Date(NOW.getTime() - 2 * HOUR) }],
    });
    assert.deepEqual(await inviteColleague(balance(), repeat.deps), {
      ok: false,
      status: 429,
      body: { error: "На этот адрес уже отправляли приглашение сегодня", field: "email" },
    });
    assert.equal(busy.emails.length + repeat.emails.length, 0);

    const later = makeDeps({
      invites: [{ organizationId: "org1", email: "friend@example.com", invitedByUserId: "u2", createdAt: new Date(NOW.getTime() - 25 * HOUR) }],
    });
    assert.equal((await inviteColleague(balance(), later.deps)).ok, true);
    assert.deepEqual(later.invites, [{ organizationId: "org1", email: "friend@example.com", invitedByUserId: "u1", createdAt: NOW }]);
  });

  it("письмо не ушло — 502, приглашение не записано; почта не настроена (dev) — успех, письмо в логе", async () => {
    const failed = makeDeps({ sendInvite: async () => "failed" });
    assert.deepEqual(await inviteColleague(balance(), failed.deps), {
      ok: false,
      status: 502,
      body: { error: "Письмо не ушло. Попробуйте позже или отправьте ссылку сами" },
    });
    assert.equal(failed.invites.length, 0);

    const logged = makeDeps({ sendInvite: async () => "logged" });
    assert.deepEqual(await inviteColleague(balance(), logged.deps), { ok: true, delivery: "logged", code: "ABCD2345" });
    assert.equal(logged.invites.length, 1);
  });

  it("замок организации занят — просим подождать, письмо не шлём", async () => {
    const { deps, emails } = makeDeps({ withOrganizationLock: async () => ({ acquired: false }) });
    assert.deepEqual(await inviteColleague(balance(), deps), {
      ok: false,
      status: 429,
      body: { error: "Приглашение уже отправляется — подождите пару секунд" },
    });
    assert.equal(emails.length, 0);
  });
});

describe("inviteColleague: опрос «Посоветуете WeSetup коллегам?» (source = nps)", () => {
  it("письмо коллеге = приглашение: реферальная ссылка, запись в «Баланс и бонусы», AuditLog без текста", async () => {
    const { deps, invites, emails, audits } = makeDeps();
    assert.deepEqual(await inviteColleague(nps(), deps), { ok: true, delivery: "sent", code: "ABCD2345" });
    assert.equal(emails[0]?.link, "https://wesetup.ru/r/ABCD2345?email=colleague%40example.com");
    assert.equal(emails[0]?.message, "Привет! <b>Попробуй</b> WeSetup", "экранирует шаблон письма, не вход");
    assert.equal(emails[0]?.replyTo, "anna.work@example.com");
    assert.deepEqual(invites, [{ organizationId: "org1", email: "colleague@example.com", invitedByUserId: "u1", createdAt: NOW }]);
    assert.deepEqual(audits, [
      { organizationId: "org1", responseId: "r5", details: { colleagueEmail: "colleague@example.com", npsScore: 5, delivery: "sent" } },
    ]);
    assert.equal(JSON.stringify(audits).includes("Попробуй"), false);
  });

  it(`текст до ${NPS_RECOMMEND_MESSAGE_MAX_LENGTH} символов, ошибки — у своего поля`, async () => {
    const { deps } = makeDeps();
    assert.deepEqual(await inviteColleague(nps({ message: "а".repeat(NPS_RECOMMEND_MESSAGE_MAX_LENGTH + 1) }), deps), {
      ok: false,
      status: 400,
      body: { error: "Сообщение длиннее 1000 символов — сократите его", field: "message" },
    });
    assert.deepEqual(await inviteColleague(nps({ message: 42 }), deps), {
      ok: false,
      status: 400,
      body: { error: "Сообщение должно быть текстом", field: "message" },
    });
    assert.deepEqual(await inviteColleague(nps({ email: " " }), deps), {
      ok: false,
      status: 400,
      body: { error: "Укажите почту коллеги", field: "email" },
    });
    assert.deepEqual(await inviteColleague(nps({ email: "ivan.example.com" }), deps), {
      ok: false,
      status: 400,
      body: { error: "В адресе не хватает символа @", field: "email" },
    });
    assert.deepEqual(await inviteColleague(nps({ email: "a,b@example.com" }), deps), {
      ok: false,
      status: 400,
      body: { error: "Проверьте адрес почты — в нём лишние символы", field: "email" },
    });
    const limit = await inviteColleague(nps({ message: "а".repeat(NPS_RECOMMEND_MESSAGE_MAX_LENGTH) }), deps);
    assert.equal(limit.ok, true);
  });

  it("не своя почта (логин и контактная) и не сотрудник своей организации", async () => {
    const { deps, emails, audits } = makeDeps({ registered: [] });
    assert.deepEqual(await inviteColleague(nps({ email: "Anna.Work@Example.com" }), deps), {
      ok: false,
      status: 400,
      body: { error: "Это ваша почта — укажите адрес коллеги", field: "email" },
    });
    assert.deepEqual(await inviteColleague(nps({ email: "anna@example.com" }), deps), {
      ok: false,
      status: 400,
      body: { error: "Это ваша почта — укажите адрес коллеги", field: "email" },
    });
    assert.deepEqual(await inviteColleague(nps({ email: "cook@example.com" }), deps), {
      ok: false,
      status: 400,
      body: { error: "Это почта сотрудника вашей организации — укажите коллегу из другого заведения", field: "email" },
    });
    assert.equal(emails.length + audits.length, 0);
  });

  it("уже зарегистрирован и нет домена — как у формы баланса, своими словами", async () => {
    const { deps } = makeDeps();
    assert.deepEqual(await inviteColleague(nps({ email: "taken@example.com" }), deps), {
      ok: false,
      status: 409,
      body: { error: "Этот адрес уже зарегистрирован в WeSetup — приглашение не нужно", field: "email" },
    });
    assert.equal((await inviteColleague(nps({ email: "ivan@no-such-domain.example" }), deps)).ok, false);
  });

  it(`не больше ${NPS_RECOMMEND_PER_USER_PER_DAY} рекомендаций в сутки на человека; вчерашние не считаются`, async () => {
    const { deps, emails } = makeDeps();
    for (let i = 1; i <= NPS_RECOMMEND_PER_USER_PER_DAY; i += 1) {
      assert.equal((await inviteColleague(nps({ email: `colleague${i}@example.com` }), deps)).ok, true, `письмо №${i}`);
    }
    assert.deepEqual(await inviteColleague(nps({ email: "colleague6@example.com" }), deps), {
      ok: false,
      status: 429,
      body: { error: "Не больше 5 рекомендаций в сутки — попробуйте завтра" },
    });
    assert.equal(emails.length, NPS_RECOMMEND_PER_USER_PER_DAY);

    const yesterday = makeDeps({
      npsAudit: Array.from({ length: NPS_RECOMMEND_PER_USER_PER_DAY }, () => ({ userId: "u1", at: new Date(NOW.getTime() - 25 * HOUR) })),
    });
    assert.equal((await inviteColleague(nps(), yesterday.deps)).ok, true);
  });

  it("общий лимит организации и повтор на тот же адрес — те же, что у формы баланса", async () => {
    const full: Invite[] = Array.from({ length: REFERRAL_INVITES_PER_DAY }, (_, i) => ({
      organizationId: "org1",
      email: `f${i}@example.com`,
      invitedByUserId: "u2",
      createdAt: NOW,
    }));
    assert.equal((await inviteColleague(nps(), makeDeps({ invites: full }).deps)).ok, false);
    const repeat = makeDeps({ invites: [{ organizationId: "org1", email: "colleague@example.com", invitedByUserId: "u2", createdAt: NOW }] });
    assert.deepEqual(await inviteColleague(nps(), repeat.deps), {
      ok: false,
      status: 429,
      body: { error: "На этот адрес уже отправляли приглашение сегодня", field: "email" },
    });
  });

  it("письмо не ушло — 502 без записи и без AuditLog", async () => {
    const { deps, invites, audits } = makeDeps({ sendInvite: async () => "failed" });
    assert.deepEqual(await inviteColleague(nps(), deps), { ok: false, status: 502, body: { error: "Письмо не ушло — попробуйте позже" } });
    assert.equal(invites.length + audits.length, 0);
  });
});

describe("ссылка, имя и адрес для ответа", () => {
  it("ссылка всегда реферальная, почта получателя подставляется в регистрацию", () => {
    assert.equal(referralInviteLink("https://wesetup.ru/", "ABCD2345", "ivan+cafe@example.com"), "https://wesetup.ru/r/ABCD2345?email=ivan%2Bcafe%40example.com");
  });

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
    assert.equal(replyToAddress(null), null);
  });

  it("имя-заглушка и служебная почта: письмо без имени и без Reply-To", async () => {
    const { deps, emails } = makeDeps({
      loadSender: async () => ({ name: "Кафе «Ромашка»", email: "staff-x1@org1.local.haccp", contactEmail: null }),
    });
    assert.equal((await inviteColleague(balance({ actor: { id: "u1", name: "Кафе «Ромашка»", email: "staff-x1@org1.local.haccp" } }), deps)).ok, true);
    assert.equal(emails[0]?.fromUserName, null);
    assert.equal(emails[0]?.replyTo, null);
  });
});
