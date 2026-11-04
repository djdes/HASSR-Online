import assert from "node:assert/strict";
import test from "node:test";

import { isPlatformAdministrator, PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import {
  adminNotificationEmail,
  mergeAdminEmails,
  mergeChatIds,
  parseEmailList,
  telegramHtmlToEmailHtml,
  telegramHtmlToPlain,
} from "@/lib/platform-admin-mail";

test("isPlatformAdministrator: владелец и пресет «Администратор» — да, частичный доступ — нет", () => {
  assert.equal(isPlatformAdministrator({ isRoot: true, platformSections: [] }), true);
  assert.equal(isPlatformAdministrator({ isRoot: false, platformSections: [...PLATFORM_SECTION_KEYS] }), true);
  assert.equal(isPlatformAdministrator({ isRoot: false, platformSections: ["clients", "support", "assistant"] }), false);
  assert.equal(isPlatformAdministrator({ isRoot: false, platformSections: [] }), false);
});

test("mergeAdminEmails: env + администраторы без дублей, служебные адреса пропускаются", () => {
  const env = parseEmailList(" owner@wesetup.ru , help@wesetup.ru ");
  assert.deepEqual(env, ["owner@wesetup.ru", "help@wesetup.ru"]);
  assert.deepEqual(
    mergeAdminEmails([env, ["Owner@WeSetup.ru", "anna@mail.ru", "staff@invite.local", "admin@haccp.local", "", null, "не почта"]]),
    ["owner@wesetup.ru", "help@wesetup.ru", "anna@mail.ru"]
  );
  assert.deepEqual(mergeAdminEmails([[], []]), []);
});

test("mergeChatIds: env-чат и чат администратора — одно сообщение на чат", () => {
  assert.deepEqual(mergeChatIds([["5438186408"], ["5438186408", null, " 777 ", ""]]), ["5438186408", "777"]);
});

test("adminNotificationEmail: первая строка — тема и заголовок, остальное — тело", () => {
  const text = [
    "🆕 <b>Новая регистрация</b>",
    "",
    "Организация: ООО &quot;Ромашка&quot; &amp; Ко",
    "Почта: a@b.ru",
    '<a href="https://wesetup.ru/root/organizations/1">Открыть</a>',
  ].join("\n");
  const mail = adminNotificationEmail(text);
  assert.equal(mail.title, "🆕 Новая регистрация");
  assert.equal(mail.subject, "WeSetup · 🆕 Новая регистрация");
  assert.match(mail.bodyHtml, /Организация: ООО &quot;Ромашка&quot; &amp; Ко<br>/);
  assert.match(mail.bodyHtml, /<a href="https:\/\/wesetup\.ru\/root\/organizations\/1" style="color:#3848c7">Открыть<\/a>/);
  assert.doesNotMatch(mail.bodyHtml, /^<br>/);
});

test("adminNotificationEmail: однострочное уведомление и пустой текст", () => {
  assert.deepEqual(adminNotificationEmail("⚠️ Сбой оплаты"), {
    subject: "WeSetup · ⚠️ Сбой оплаты",
    title: "⚠️ Сбой оплаты",
    bodyHtml: "",
  });
  assert.equal(adminNotificationEmail("").title, "Уведомление платформы");
});

test("telegramHtmlToEmailHtml: только безопасные теги, ссылки — только http(s)", () => {
  const html = telegramHtmlToEmailHtml(
    '<b>a</b> <tg-spoiler>b</tg-spoiler> <a href="javascript:alert(1)">c</a> <img src=x onerror=alert(1)> &lt;script&gt;'
  );
  assert.equal(html, "<b>a</b> b <a>c</a>  &lt;script&gt;");
  assert.equal(telegramHtmlToPlain("<b>Тест</b> &lt;1&gt; &amp;"), "Тест <1> &");
});
