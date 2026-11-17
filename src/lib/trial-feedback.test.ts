import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXTAUTH_SECRET = "test-secret-for-trial-feedback-0123456789";

import {
  composeTrialFeedbackEmail,
  normalizeTrialFeedbackComment,
  TRIAL_FEEDBACK_LAUNCHED_AT,
  trialFeedbackAdminText,
  trialFeedbackDue,
  trialFeedbackStatsLine,
} from "@/lib/trial-feedback";
import { signTrialFeedbackToken, trialFeedbackHref, verifyTrialFeedbackToken, TRIAL_FEEDBACK_TOKEN_TTL_MS } from "@/lib/trial-feedback-token";

/** Запрос отзыва после пробного (спека trial-emails-rename-2026-11). */

const DAY = 24 * 60 * 60 * 1000;
const END = new Date(TRIAL_FEEDBACK_LAUNCHED_AT.getTime() + 10 * DAY);
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = { kind: "needs_decision", reason: "trial_ended", trialEndsAt: END, inactive: false, exempt: false, alreadyAsked: false };

test("AC1: спрашиваем в первые 3 дня после конца неоплаченного пробного, один раз", () => {
  assert.equal(trialFeedbackDue({ ...base, now: new Date(END.getTime() + DAY) }), true);
  assert.equal(trialFeedbackDue({ ...base, kind: "free", now: new Date(END.getTime() + 2 * DAY) }), true);
  assert.equal(trialFeedbackDue({ ...base, now: new Date(END.getTime() - DAY) }), false, "пробный ещё идёт");
  assert.equal(trialFeedbackDue({ ...base, now: new Date(END.getTime() + 4 * DAY) }), false, "окно прошло");
  assert.equal(trialFeedbackDue({ ...base, kind: "paid", now: new Date(END.getTime() + DAY) }), false, "оплатили");
  assert.equal(trialFeedbackDue({ ...base, alreadyAsked: true, now: new Date(END.getTime() + DAY) }), false, "уже спрашивали");
  assert.equal(trialFeedbackDue({ ...base, inactive: true, now: new Date(END.getTime() + DAY) }), false);
  assert.equal(trialFeedbackDue({ ...base, exempt: true, now: new Date(END.getTime() + DAY) }), false);
  assert.equal(trialFeedbackDue({ ...base, reason: "subscription_expired", now: new Date(END.getTime() + DAY) }), false, "кончилась оплата, не пробный");
  const old = new Date(TRIAL_FEEDBACK_LAUNCHED_AT.getTime() - DAY);
  assert.equal(trialFeedbackDue({ ...base, trialEndsAt: old, now: new Date(old.getTime() + DAY) }), false, "до запуска — не пишем");
});

test("AC1: персональное письмо — имя, организация, цифры пробного, три ответа", () => {
  const links = { good: "https://wesetup.ru/trial-feedback?t=X&a=good", later: "https://wesetup.ru/trial-feedback?t=X&a=later", help: "https://wesetup.ru/trial-feedback?t=X&a=help" };
  const mail = composeTrialFeedbackEmail({
    name: "Анна",
    organizationName: "Кафе <Ромашка>",
    stats: { entries: 128, journals: 4, employees: 6, topJournal: "Гигиенический журнал" },
    links,
    phone: "+7 (495) 109-65-43",
    escape: esc,
  });
  assert.equal(mail.subject, "Анна, удалось оценить электронные журналы?");
  assert.ok(mail.html.includes("Здравствуйте, Анна!"));
  assert.ok(mail.html.includes("Кафе &lt;Ромашка&gt;"), "организация экранирована");
  assert.ok(mail.html.includes("сделано 128 записей в 4 журналах, чаще всего — «Гигиенический журнал». Журналы вели 6 сотрудников."));
  for (const answer of ["good", "later", "help"]) {
    assert.match(mail.html, new RegExp(`href="https://wesetup\\.ru/trial-feedback\\?t=X&amp;a=${answer}" data-trial-feedback="${answer}"`));
  }
  assert.ok(mail.text.includes(links.help));
  assert.ok(mail.html.includes("+7 (495) 109-65-43"));
});

test("AC1: журналы не начинали — без цифр, предложение помочь; почта вместо имени — без имени", () => {
  const mail = composeTrialFeedbackEmail({
    name: "owner@example.com",
    organizationName: "Цех",
    stats: { entries: 0, journals: 0, employees: 1, topJournal: null },
    links: { good: "g", later: "l", help: "h" },
    phone: "+7",
    escape: esc,
  });
  assert.equal(mail.subject, "Удалось оценить электронные журналы?");
  assert.ok(mail.html.includes("Здравствуйте!"));
  assert.ok(mail.html.includes("поможем начать"));
  assert.ok(!mail.html.includes("owner@example.com"));
  assert.equal(trialFeedbackStatsLine("Цех", { entries: 1, journals: 1, employees: 1, topJournal: "Х" }), "За пробный период в «Цех» сделано 1 запись в 1 журнале.");
  assert.equal(trialFeedbackStatsLine("Цех", { entries: 22, journals: 2, employees: 3, topJournal: "Уборка" }), "За пробный период в «Цех» сделано 22 записи в 2 журналах, чаще всего — «Уборка». Журналы вели 3 сотрудника.");
});

test("AC1: подписанная ссылка — организация и владелец; подделка, чужой ответ и срок отклоняются", () => {
  const now = Date.parse("2026-12-01T10:00:00Z");
  const token = signTrialFeedbackToken({ organizationId: "org_1", userId: "user_1" }, now);
  assert.deepEqual(verifyTrialFeedbackToken(token, now + DAY), { organizationId: "org_1", userId: "user_1" });
  assert.equal(verifyTrialFeedbackToken(token, now + TRIAL_FEEDBACK_TOKEN_TTL_MS + DAY), null, "истёк");
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ v: 1, o: "org_2", u: "user_1", x: 9_999_999_999 })).toString("base64url");
  assert.equal(verifyTrialFeedbackToken(`${forged}.${sig}`, now), null, "чужая организация");
  assert.equal(verifyTrialFeedbackToken(`${body}.${sig}x`, now), null);
  assert.equal(verifyTrialFeedbackToken("garbage", now), null);
  assert.equal(verifyTrialFeedbackToken(null, now), null);
  assert.equal(trialFeedbackHref("a.b", "good"), "/trial-feedback?t=a.b&a=good");
});

test("AC1: комментарий и сообщение продажам", () => {
  assert.equal(normalizeTrialFeedbackComment("  ок \u0000 "), "ок");
  assert.equal(normalizeTrialFeedbackComment("   "), null);
  assert.equal(normalizeTrialFeedbackComment(5), null);
  assert.equal(normalizeTrialFeedbackComment("x".repeat(5000))?.length, 2000);
  const text = trialFeedbackAdminText({ organizationName: "Кафе <1>", answer: "help", comment: "Не понял QR", email: "a@b.ru", escape: esc });
  assert.equal(text, "🆘 Отзыв о пробном: Есть вопросы\nОрганизация: Кафе &lt;1&gt;\nПочта: a@b.ru\nКомментарий: Не понял QR");
});
