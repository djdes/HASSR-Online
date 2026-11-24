import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml } from "@/lib/html-escape";
import {
  advanceRubFromKopecks,
  composeAvitoAlert,
  composeLowBalanceAlert,
  DEFAULT_AVITO_NOTIFY,
  normalizeAvitoNotify,
  validateAvitoNotify,
} from "@/lib/avito/notify";

test("аванс из копеек — рубли без округления вверх", () => {
  assert.equal(advanceRubFromKopecks(51940), 519);
  assert.equal(advanceRubFromKopecks(-150), -1);
  assert.equal(advanceRubFromKopecks("x"), null);
});

test("настройки: пусто — получатели по умолчанию, дубли и мусор отброшены", () => {
  assert.deepEqual(normalizeAvitoNotify(null), DEFAULT_AVITO_NOTIFY);
  const s = normalizeAvitoNotify({ chats: [{ chatId: " 123 ", label: "a" }, { chatId: "123", label: "b" }, null, { chatId: "" }], lowBalanceRub: -5 });
  assert.deepEqual(s.chats, [{ chatId: "123", label: "a" }]);
  assert.equal(s.lowBalanceRub, DEFAULT_AVITO_NOTIFY.lowBalanceRub);
  assert.equal(normalizeAvitoNotify({ chats: [], lowBalanceRub: 0 }).lowBalanceRub, 0);
});

test("проверка: chat_id только цифрами", () => {
  assert.equal(validateAvitoNotify({ chats: [{ chatId: "@djdes", label: "Денис" }] }).ok, false);
  assert.equal(validateAvitoNotify({ chats: [{ chatId: "-100123456", label: "группа" }], lowBalanceRub: 500 }).ok, true);
});

test("уведомление о новом лиде: имя, объявление, последние сообщения, ссылки, экранирование", () => {
  const text = composeAvitoAlert({
    isNewContact: true,
    name: "Ирина <script>",
    adTitle: "Электронные журналы",
    messages: ["1", "2", "3", "4", "5", "Здравствуйте, сколько стоит?"],
    crmUrl: "https://wesetup.ru/root/crm/contacts/c1",
    chatUrl: "https://www.avito.ru/profile/messenger/channel/u2i",
    escape: escapeHtml,
  });
  assert.match(text, /Новое обращение с Авито/);
  assert.match(text, /Ирина &lt;script&gt;/);
  assert.match(text, /📌 Электронные журналы/);
  assert.match(text, /…и ещё 1 сообщ\. выше/);
  assert.doesNotMatch(text, /«1»/);
  assert.match(text, /«Здравствуйте, сколько стоит\?»/);
  assert.match(text, /«Новый», без ответственного/);
  assert.match(text, /contacts\/c1">Открыть в CRM/);
  assert.doesNotMatch(text, /\n\n\n/);
});

test("ответ старого контакта — без строки про новый лид", () => {
  const text = composeAvitoAlert({ isNewContact: false, name: null, adTitle: null, messages: ["ок"], crmUrl: "u", chatUrl: "c", escape: escapeHtml });
  assert.match(text, /Новое сообщение в Авито/);
  assert.match(text, /Без имени/);
  assert.doesNotMatch(text, /без ответственного/);
});

test("аванс кончился — красное предупреждение", () => {
  assert.match(composeLowBalanceAlert({ advanceRub: 0, walletRub: 0, threshold: 300, pageUrl: "p" }), /закончился/);
  assert.match(composeLowBalanceAlert({ advanceRub: 120, walletRub: 0, threshold: 300, pageUrl: "p" }), /заканчивается/);
});
