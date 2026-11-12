import assert from "node:assert/strict";
import test from "node:test";

import {
  BLANK_BOT_MIN_ELAPSED_MS,
  BLANK_REGISTER_CONSENT_SOURCE,
  BLANK_CONSENT_SOURCE,
  blankBotVerdict,
  buildBlankDownloadAdminText,
  normalizeBlankPhone,
  readRememberedBlankEmail,
  shouldNotifyBlankDownloadAdmin,
} from "@/lib/blank-download";
import { parseBlankDownloadRequest } from "@/lib/blank-download-targets";
import { blankDownloadErrorKey } from "@/lib/blank-download-presentation";
import { ACCOUNT_BENEFITS, renderAccountPasswordEmail, buildBlankDownloadEmail } from "@/lib/email";
import { loadMessages } from "@/i18n/messages";
import { TRIAL_DAYS } from "@/lib/tariff-plans";

/**
 * Окно «Куда прислать шаблон?»: телефон, быстрая регистрация, невидимая
 * проверка от ботов (спека .agent/tasks/blank-download-phone-autoreg-2026-11).
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

test("AC1: телефон — пустой не ошибка, номер приводится к +7…, мусор отклоняется", () => {
  assert.equal(normalizeBlankPhone(undefined), null);
  assert.equal(normalizeBlankPhone(""), null);
  assert.equal(normalizeBlankPhone("+7 "), null, "только подставленный префикс — поле пустое");
  assert.equal(normalizeBlankPhone("+7 985 123-45-67"), "+79851234567");
  assert.equal(normalizeBlankPhone("8 (985) 123-45-67"), "+79851234567");
  assert.equal(normalizeBlankPhone("9851234567"), "+79851234567");
  assert.equal(normalizeBlankPhone("+998 90 123 45 67"), "+998901234567", "номер другой страны");
  assert.equal(normalizeBlankPhone("+7 985 123"), undefined, "недобранный номер");
  assert.equal(normalizeBlankPhone("+7 985 123-45-678"), undefined, "лишняя цифра у российского номера");
  assert.equal(normalizeBlankPhone("позвоните мне"), undefined);
  assert.equal(normalizeBlankPhone(42), undefined);
});

test("AC1: разбор запроса — телефон и галка регистрации; кривой телефон — invalid_phone", () => {
  const ok = parseBlankDownloadRequest(
    { email: "a@example.com", code: "hygiene", format: "pdf", consent: true, phone: "8 985 123 45 67", register: true, source: { place: "x" } },
    "v1",
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.phone, "+79851234567");
    assert.equal(ok.value.register, true);
    assert.deepEqual(ok.value.source, { place: "x" });
  }

  const legacy = parseBlankDownloadRequest({ email: "a@example.com", code: "hygiene", format: "pdf", consent: true }, "v1");
  assert.equal(legacy.ok && legacy.value.register, false, "старый клиент без галки — без регистрации");
  assert.equal(legacy.ok && legacy.value.phone, undefined);

  const remembered = parseBlankDownloadRequest(
    { email: "a@example.com", code: "hygiene", format: "pdf", consent: true, register: true, remembered: true, consentVersion: "v1" },
    "v1",
  );
  assert.equal(remembered.ok && remembered.value.register, false, "по запомненной почте окна не было — кабинет не создаём");

  const bad = parseBlankDownloadRequest({ email: "a@example.com", code: "hygiene", format: "pdf", consent: true, phone: "123" }, "v1");
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.status, 400);
    assert.equal(bad.errorCode, "invalid_phone");
  }
  assert.equal(blankDownloadErrorKey("invalid_phone"), "invalidPhone");
  assert.equal(blankDownloadErrorKey("too_fast"), "tooFast");
});

test("AC1: запомненная почта несёт телефон, мусорный телефон отбрасывается", () => {
  assert.deepEqual(
    readRememberedBlankEmail(JSON.stringify({ email: "a@example.com", consentVersion: "v1", phone: "+79851234567" })),
    { email: "a@example.com", consentVersion: "v1", phone: "+79851234567" },
  );
  assert.deepEqual(
    readRememberedBlankEmail(JSON.stringify({ email: "a@example.com", consentVersion: "v1", phone: "мусор" })),
    { email: "a@example.com", consentVersion: "v1" },
  );
});

test("AC2: уведомление продажам — телефон сразу после почты, строка о созданном кабинете", () => {
  assert.equal(
    buildBlankDownloadAdminText({
      title: "Гигиенический журнал (сотрудники)",
      format: "pdf",
      email: "treschova@example.com",
      phone: "+79851234567",
      company: "Школа-гимназия №10",
      accountCreated: true,
      escape: esc,
    }),
    [
      "📥 Скачивание шаблона журнала",
      "Журнал: Гигиенический журнал (сотрудники) (PDF)",
      "Почта: treschova@example.com",
      "Телефон: +7 985 123-45-67",
      "Организация: Школа-гимназия №10",
      "✅ Быстрая регистрация: кабинет создан, доступ отправлен на почту",
    ].join("\n"),
  );
  assert.equal(
    buildBlankDownloadAdminText({ title: "Т", format: "pdf", email: "a@example.com", phone: null, escape: esc }),
    ["📥 Скачивание шаблона журнала", "Журнал: Т (PDF)", "Почта: a@example.com"].join("\n"),
    "без телефона и регистрации — как раньше",
  );
  assert.equal(shouldNotifyBlankDownloadAdmin(3), false, "повторное скачивание — тихо");
  assert.equal(shouldNotifyBlankDownloadAdmin(3, true), true, "новый кабинет — пишем всегда");
  assert.equal(shouldNotifyBlankDownloadAdmin(0, false), true);
});

test("AC3/AC4: согласие при быстрой регистрации пишется своим source, не путается со скачиваниями", () => {
  assert.equal(BLANK_REGISTER_CONSENT_SOURCE, "blank-register");
  assert.notEqual(BLANK_REGISTER_CONSENT_SOURCE, BLANK_CONSENT_SOURCE);
});

test("AC5: невидимая проверка — ловушка, слишком быстрая отправка, скачивание по запомненной почте", () => {
  assert.equal(blankBotVerdict({ website: "", elapsedMs: 4000 }), "ok");
  assert.equal(blankBotVerdict({ website: "https://spam.example", elapsedMs: 4000 }), "honeypot");
  assert.equal(blankBotVerdict({ website: 1, elapsedMs: 4000 }), "honeypot", "ловушка — только пустая строка");
  assert.equal(blankBotVerdict({ website: "", elapsedMs: BLANK_BOT_MIN_ELAPSED_MS - 1 }), "too_fast");
  assert.equal(blankBotVerdict({ website: "", elapsedMs: BLANK_BOT_MIN_ELAPSED_MS }), "ok");
  assert.equal(blankBotVerdict({}), "too_fast", "без замера (прямой запрос к API) — не из окна");
  assert.equal(blankBotVerdict({ elapsedMs: "5000" }), "too_fast");
  assert.equal(blankBotVerdict({ remembered: true }), "ok", "по запомненной почте окна нет — время не меряем");
  assert.equal(blankBotVerdict({ remembered: true, website: "x" }), "honeypot");
});

test("AC4/AC6: письмо после регистрации из окна — логин, пароль, автовход, преимущества и пробный срок", async () => {
  const ru = await loadMessages("ru");
  const { subject, html } = await renderAccountPasswordEmail({
    to: "chef@example.com",
    password: "Ab3dEf7hJk9m",
    via: "blank",
    autoLoginUrl: "https://wesetup.ru/api/auth/magic/TOKEN123",
    autoLoginDays: 7,
  });
  assert.equal(subject, ru.email.accountPassword.subject);
  assert.ok(html.includes("chef@example.com"));
  assert.ok(html.includes("Ab3dEf7hJk9m"));
  assert.ok(html.includes('href="https://wesetup.ru/api/auth/magic/TOKEN123"'), "кнопка автовхода");
  assert.ok(html.includes("7 дней"), "срок ссылки");
  assert.ok(html.includes("кабинет уже создан"), "текст для регистрации из окна");
  assert.ok(!html.includes("вы уже вошли"), "из окна человек не входил — без «вы уже вошли»");
  assert.ok(html.includes(ru.email.accountPassword.benefitsTitle));
  for (const id of ACCOUNT_BENEFITS) {
    assert.ok(html.includes(ru.email.accountPassword.benefits[id].title), `преимущество ${id}`);
  }
  assert.ok(html.includes(`${TRIAL_DAYS} дн`), "пробный срок из тарифов");
});

test("AC6: то же письмо с лендинга — «вы уже вошли», кнопка кабинета, те же преимущества; en и uz", async () => {
  const ru = await loadMessages("ru");
  const { html } = await renderAccountPasswordEmail({ to: "a@example.com", password: "p" });
  assert.ok(html.includes(ru.email.accountPassword.createdNotice));
  assert.ok(html.includes("/dashboard"));
  assert.ok(!html.includes("data-auto-login"));
  assert.ok(html.includes("data-account-benefits"));
  for (const locale of ["en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const localized = await renderAccountPasswordEmail({ to: "a@example.com", password: "p", locale, via: "blank", autoLoginUrl: "https://wesetup.ru/api/auth/magic/T" });
    assert.ok(localized.html.includes(messages.email.accountPassword.benefits.qr.title), `${locale}: преимущества переведены`);
    assert.ok(!localized.html.includes("Журналы с телефона"), `${locale}: без русского текста`);
  }
});

test("AC4: копия шаблона при созданном кабинете — без блока «зарегистрируйтесь»", async () => {
  const params = {
    journalTitle: "Гигиенический журнал",
    files: [{ label: "Скачать PDF", url: "https://wesetup.ru/api/journal-samples/hygiene/pdf?t=A.B" }],
    pageUrl: null,
    registerUrl: "https://wesetup.ru/register?source=blank",
    expiresDays: 7,
  };
  const plain = await buildBlankDownloadEmail(params);
  const created = await buildBlankDownloadEmail({ ...params, accountCreated: true });
  assert.ok(plain.html.includes("register?source=blank"));
  assert.ok(!created.html.includes("register?source=blank"));
  assert.ok(created.html.includes("api/journal-samples/hygiene/pdf"), "ссылка на файл остаётся");
});
