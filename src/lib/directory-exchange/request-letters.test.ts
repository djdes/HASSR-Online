import assert from "node:assert/strict";
import test from "node:test";

import {
  POOL_REQUEST_NOTE,
  STAFF_LETTER_NOTE,
  countersLine,
  decisionNotificationLabel,
  decisionTitle,
  letterSubject,
  ownerRequestLetter,
  ownerRequestNotice,
  poolDecisionLine,
  requesterDecisionLetter,
} from "@/lib/directory-exchange/request-letters";

const EXPIRES = new Date("2026-11-26T10:00:00.000Z");
const URL = "https://wesetup.ru/exchange-request/AbC_dEf-123";
const HOSTILE = `Кафе <script>alert("x")</script> & 'Ко'`;

const ownerLetter = (over: Partial<Parameters<typeof ownerRequestLetter>[0]> = {}) =>
  ownerRequestLetter({
    url: URL,
    mode: "link",
    kinds: ["products", "staff"],
    cabinetName: "Мастер-кабинет",
    requesterName: "ООО Ромашка",
    requesterInn: "7707083893",
    expiresAt: EXPIRES,
    ...over,
  });

test("owner letter, rule Р3: who asks, what for, which lists, the button and the term", () => {
  const letter = ownerLetter();
  assert.equal(letter.subject, "Запрос на обмен справочниками от «ООО Ромашка»");
  assert.equal(letter.title, "Запрос на обмен справочниками");
  assert.ok(letter.body.includes("«ООО Ромашка»"));
  assert.ok(letter.body.includes("ИНН 7707083893"));
  assert.ok(letter.body.includes("установить обмен справочниками через ваш мастер-кабинет «Мастер-кабинет»"));
  assert.ok(letter.body.includes("Продукция, Сотрудники"));
  assert.ok(letter.body.includes(`href="${URL}"`));
  assert.ok(letter.body.includes("Открыть запрос"));
  assert.ok(letter.body.includes("7 дней"));
  assert.ok(letter.body.includes("26 ноября 2026"));
});

test("owner letter: a one-off transfer is named as such; no INN is said plainly", () => {
  const letter = ownerLetter({ mode: "transfer", requesterInn: "  " });
  assert.ok(letter.body.includes("разово перенести к себе данные"));
  assert.ok(letter.body.includes("Связь после переноса не сохраняется"));
  assert.ok(letter.body.includes("ИНН не указан"));
  assert.ok(!letter.body.includes("установить обмен"));
});

test("letters, rule Р5: the staff note appears only when staff is among the lists", () => {
  assert.ok(ownerLetter().body.includes(STAFF_LETTER_NOTE));
  assert.ok(!ownerLetter({ kinds: ["products", "equipment"] }).body.includes(STAFF_LETTER_NOTE));
});

test("letters: every string typed in another account is escaped", () => {
  const letter = ownerLetter({ requesterName: HOSTILE, cabinetName: HOSTILE, requesterInn: `77<b>07</b>` });
  assert.ok(!letter.body.includes("<script>"));
  assert.ok(!letter.body.includes("<b>07"));
  assert.ok(letter.body.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Ко&#39;"));
  assert.ok(letter.body.includes("77&lt;b&gt;07&lt;/b&gt;"));
  // A link cannot break out of its attribute either.
  const link = ownerLetter({ url: `https://wesetup.ru/exchange-request/x"><img src=x>` });
  assert.ok(!link.body.includes(`"><img`));

  for (const status of ["approved", "declined"] as const) {
    for (const mode of ["link", "transfer"] as const) {
      const decision = requesterDecisionLetter({
        url: "https://wesetup.ru/settings/master-cabinet",
        status,
        mode,
        cabinetName: HOSTILE,
        requesterName: HOSTILE,
        allowedKinds: ["staff"],
        counters: null,
      });
      assert.ok(!decision.body.includes("<script>"), `${status}/${mode}`);
      assert.ok(decision.body.includes("&lt;script&gt;"), `${status}/${mode}`);
    }
  }
});

test("subject: no line breaks or control characters from a foreign name, bounded length", () => {
  assert.equal(letterSubject("Запрос от «Кафе\r\nBcc: evil@example.com»"), "Запрос от «Кафе Bcc: evil@example.com»");
  assert.equal(letterSubject("  a\u0000\tb  "), "a b");
  assert.equal(letterSubject("x".repeat(500)).length, 200);
  assert.ok(!ownerLetter({ requesterName: "Кафе\nВторая строка" }).subject.includes("\n"));
});

test("decision letter: approval of a link names the lists and the first exchange", () => {
  const letter = requesterDecisionLetter({
    url: "https://wesetup.ru/settings/master-cabinet",
    status: "approved",
    mode: "link",
    cabinetName: "Сеть",
    requesterName: "ООО Ромашка",
    allowedKinds: ["products", "staff"],
    counters: { created: 12, updated: 0, skippedLimit: 2, skippedConflict: 0 },
  });
  assert.equal(letter.subject, "Запрос на обмен справочниками подтверждён");
  assert.equal(letter.title, decisionTitle("approved"));
  assert.ok(letter.body.includes("«Сеть»") && letter.body.includes("«ООО Ромашка»"));
  assert.ok(letter.body.includes("Продукция, Сотрудники"));
  assert.ok(letter.body.includes(STAFF_LETTER_NOTE));
  assert.ok(letter.body.includes("добавлено записей — 12, не добавлено из-за тарифа — 2"));
  assert.ok(letter.body.includes("Выйти из обмена"));
  assert.ok(letter.body.includes(`href="https://wesetup.ru/settings/master-cabinet"`));
});

test("decision letter: a transfer keeps no link; a refusal says nothing was passed", () => {
  const transfer = requesterDecisionLetter({
    url: "u",
    status: "approved",
    mode: "transfer",
    cabinetName: "Сеть",
    requesterName: "Ромашка",
    allowedKinds: ["equipment"],
    counters: { created: 3, updated: 0, skippedLimit: 0, skippedConflict: 1 },
  });
  assert.ok(transfer.body.includes("разовый перенос"));
  assert.ok(transfer.body.includes("Перенос выполнен: добавлено записей — 3, пропущено из-за совпадения названий — 1"));
  assert.ok(transfer.body.includes("Связь между организациями не сохранена"));
  assert.ok(!transfer.body.includes(STAFF_LETTER_NOTE));

  const declined = requesterDecisionLetter({
    url: "u",
    status: "declined",
    mode: "link",
    cabinetName: "Сеть",
    requesterName: "Ромашка",
    allowedKinds: [],
    counters: null,
  });
  assert.equal(declined.subject, "Запрос на обмен справочниками отклонён");
  assert.ok(declined.body.includes("отклонил запрос"));
  assert.ok(declined.body.includes("Данные не передавались"));
});

test("counters line and the bell label", () => {
  assert.equal(countersLine({ created: 0, updated: 0, skippedLimit: 0, skippedConflict: 0 }), "добавлено записей — 0");
  assert.equal(
    countersLine({ created: 4, updated: 2, skippedLimit: 1, skippedConflict: 3 }),
    "добавлено записей — 4, обновлено — 2, не добавлено из-за тарифа — 1, пропущено из-за совпадения названий — 3",
  );
  assert.equal(decisionNotificationLabel({ status: "approved", mode: "link", cabinetName: "Сеть" }), "Мастер-кабинет «Сеть»: обмен справочниками установлен");
  assert.equal(decisionNotificationLabel({ status: "approved", mode: "transfer", cabinetName: "Сеть" }), "Мастер-кабинет «Сеть»: данные перенесены");
  assert.equal(decisionNotificationLabel({ status: "declined", mode: "transfer", cabinetName: "Сеть" }), "Мастер-кабинет «Сеть»: перенос данных отклонён");
});

test("owner notice, series A Р4: bell line and Telegram text name who asks, what for, lists and the term", () => {
  const notice = ownerRequestNotice({
    mode: "link",
    kinds: ["products", "staff"],
    cabinetName: "Мастер-кабинет",
    requesterName: "ООО Ромашка",
    expiresAt: EXPIRES,
  });
  assert.equal(notice.title, "Запрос на обмен справочниками");
  assert.equal(notice.label, "«ООО Ромашка» просит связать справочники — мастер-кабинет «Мастер-кабинет»");
  assert.equal(notice.hint, "Продукция, Сотрудники; ответить до 26 ноября 2026 г.");
  assert.match(notice.telegramText, /^<b>Запрос на обмен справочниками<\/b>\n\n/);
  assert.ok(notice.telegramText.includes("Без вашего подтверждения ничего не передаётся."));

  const transfer = ownerRequestNotice({
    mode: "transfer",
    kinds: ["equipment"],
    cabinetName: HOSTILE,
    requesterName: `${HOSTILE}\nвторая строка`,
    expiresAt: EXPIRES,
  });
  assert.ok(transfer.label.includes("просит разово перенести данные"));
  // The bell line is plain text on one line; Telegram HTML has the names escaped.
  assert.ok(!transfer.label.includes("\n"));
  assert.ok(!transfer.telegramText.includes("<script>"));
  assert.ok(transfer.telegramText.includes("&lt;script&gt;"));
});

test("series C1 Р7.1: the owner letter and notice name the menu and raw materials only when asked for a link", () => {
  assert.ok(!ownerLetter().body.includes(POOL_REQUEST_NOTE));
  assert.ok(ownerLetter({ withPool: true }).body.includes(POOL_REQUEST_NOTE));
  // A transfer never asks for the pool, whatever the flag says.
  assert.ok(!ownerLetter({ mode: "transfer", withPool: true }).body.includes(POOL_REQUEST_NOTE));

  const base = { mode: "link" as const, kinds: ["products" as const], cabinetName: "Сеть", requesterName: "ООО Ромашка", expiresAt: EXPIRES };
  const plain = ownerRequestNotice(base);
  const pooled = ownerRequestNotice({ ...base, withPool: true });
  assert.equal(plain.hint, "Продукция; ответить до 26 ноября 2026 г.");
  assert.equal(pooled.hint, "Продукция; меню и сырьё кабинета; ответить до 26 ноября 2026 г.");
  assert.ok(!plain.telegramText.includes(POOL_REQUEST_NOTE));
  assert.ok(pooled.telegramText.includes(POOL_REQUEST_NOTE));
  assert.ok(!ownerRequestNotice({ ...base, mode: "transfer", withPool: true }).telegramText.includes(POOL_REQUEST_NOTE));
});

test("series C1: the requester learns how the menu and raw materials ended — without the refusal reason", () => {
  const base = {
    url: URL,
    status: "approved" as const,
    mode: "link" as const,
    cabinetName: "Сеть",
    requesterName: "ООО Ромашка",
    allowedKinds: ["products" as const],
    counters: null,
  };
  assert.equal(poolDecisionLine(null), null);
  assert.ok(!requesterDecisionLetter(base).body.includes("Меню и сырьё"));
  assert.ok(requesterDecisionLetter({ ...base, pool: "connected" }).body.includes(poolDecisionLine("connected")!));
  assert.ok(requesterDecisionLetter({ ...base, pool: "not_allowed" }).body.includes("владелец не подключил"));
  const refused = requesterDecisionLetter({ ...base, pool: "refused" }).body;
  assert.ok(refused.includes("подключить не удалось") && !refused.includes("лимит"));
  // Отказ в запросе — о меню и сырье ни слова.
  assert.ok(!requesterDecisionLetter({ ...base, status: "declined", pool: "not_allowed" }).body.includes("Меню и сырьё"));
});
