import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isEditablePasteTarget, pastedImageFiles } from "@/components/support/attachment-composer";
import { buildFeedbackReplyTelegramText, feedbackReplyEmailText } from "@/lib/feedback-reply";
import { isSupportStaff } from "@/lib/platform-access";
import { defaultReplyTarget, findQuotedMessage, quotePreview, sanitizeReplyToId } from "@/lib/support-reply-quote";
import {
  parseSupportStaffAlert,
  supportAlertHref,
  supportAlertPreview,
  supportAlertWho,
} from "@/lib/support-staff-alerts";

/**
 * Панель обращений (владелец, 2026-11-23): всплывашка и колокольчик всей
 * команде поддержки, переход к клиенту, ответ с цитатой и скриншоты.
 */

const read = (file: string) => readFileSync(file, "utf8");

test("команда поддержки: владелец, администратор и раздел «Обратная связь»", () => {
  assert.equal(isSupportStaff(true, []), true);
  assert.equal(isSupportStaff(false, ["support"]), true);
  assert.equal(isSupportStaff(false, ["crm", "billing"]), false);
  assert.equal(isSupportStaff(false, []), false);
});

test("всплывашка: кто, кусок текста, ссылки на обращение и ветку", () => {
  assert.equal(supportAlertHref("report", "r1"), "/root/feedback#report-r1");
  assert.equal(supportAlertHref("chat", "t 1"), "/root/feedback#chat-t%201");
  assert.equal(
    supportAlertWho({ name: "Анна", email: "anna@mail.ru", phone: null, organizationName: "Кафе" }),
    "Анна · anna@mail.ru · Кафе",
  );
  assert.equal(supportAlertWho({ name: "a@b.ru", email: "a@b.ru" }), "a@b.ru", "без повторов");
  assert.equal(supportAlertPreview("  Не  работает\n QR  "), "Не работает QR");
  assert.equal(supportAlertPreview("", [{ filename: "shot.png" }]), "📎 shot.png");
  assert.equal(supportAlertPreview("Смотрите", [{ filename: "a.png" }, { filename: "b.png" }]), "Смотрите 📎2");
  assert.ok(supportAlertPreview("x".repeat(500)).length <= 160);
});

test("данные живого события: чужие ссылки и мусор отбрасываются", () => {
  const alert = parseSupportStaffAlert({
    kind: "chat",
    id: "t1",
    who: "Анна",
    preview: "Привет",
    reportType: null,
    href: "https://evil.example/root",
    clientHref: "/root/organizations/o1",
  });
  assert.ok(alert);
  assert.equal(alert?.href, "/root/feedback#chat-t1", "внешняя ссылка заменена своей");
  assert.equal(alert?.clientHref, "/root/organizations/o1");
  assert.equal(parseSupportStaffAlert({ kind: "x", id: "1" }), null);
  assert.equal(parseSupportStaffAlert(null), null);
  assert.equal(parseSupportStaffAlert({ kind: "report", id: "r", clientHref: "javascript:alert(1)" })?.clientHref, null);
});

test("цитата ответа: последнее сообщение клиента, своё сообщение, превью", () => {
  const messages = [
    { id: "m1", author: "client", body: "Вопрос 1" },
    { id: "m2", author: "operator", body: "Ответ" },
    { id: "m3", author: "client", body: "Вопрос 2" },
  ];
  assert.equal(defaultReplyTarget(messages)?.id, "m3");
  assert.equal(defaultReplyTarget(messages.slice(0, 2)), null, "после ответа оператора — без цитаты");
  assert.equal(findQuotedMessage(messages, "m1")?.body, "Вопрос 1");
  assert.equal(findQuotedMessage(messages, "чужой"), null);
  assert.equal(quotePreview({ body: "", attachments: [{ filename: "shot.png" }] }), "📎 shot.png");
  assert.equal(quotePreview({ body: "a".repeat(200) }, 20).length, 20);
  assert.equal(sanitizeReplyToId("cmabc12345"), "cmabc12345");
  assert.equal(sanitizeReplyToId("../../etc"), null);
  assert.equal(sanitizeReplyToId(42), null);
});

test("ответ на обращение со скриншотом: ссылки в Telegram и в письме", () => {
  const attachments = [{ url: "/uploads/support/" + "a".repeat(32) + ".png", filename: "Шаг 1.png", mimeType: "image/png", sizeBytes: 10 }];
  const telegram = buildFeedbackReplyTelegramText({ replyMessage: "Нажмите сюда", originalMessage: "Где кнопка?", attachments });
  assert.match(telegram, /📎 <a href="https?:\/\/[^"]+\/uploads\/support\/a{32}\.png">Шаг 1\.png<\/a>/);
  assert.match(telegram, /На ваше сообщение: «Где кнопка\?»/);
  assert.equal(feedbackReplyEmailText("Текст"), "Текст");
  assert.match(feedbackReplyEmailText("Текст", attachments), /^Текст\n\n📎 Шаг 1\.png — https?:\/\/\S+\/uploads\/support\/a{32}\.png$/);
});

test("Ctrl+V по всему сайту: в полях ввода — обычная вставка, вложение — только картинка", () => {
  const field = { closest: (selector: string) => (selector.includes("textarea") ? {} : null), isContentEditable: false };
  const page = { closest: () => null, isContentEditable: false };
  assert.equal(isEditablePasteTarget(field as unknown as EventTarget), true);
  assert.equal(isEditablePasteTarget(page as unknown as EventTarget), false);
  assert.equal(isEditablePasteTarget(null), false);
  const image = { type: "image/png", name: "a.png" } as File;
  const text = { type: "text/plain", name: "a.txt" } as File;
  assert.deepEqual(pastedImageFiles({ files: [image, text] as unknown as FileList }), [image]);
  assert.deepEqual(pastedImageFiles(null), []);
});

test("панель обращений: чаты и обращения рядом, якоря, переход к клиенту", () => {
  const page = read("src/app/root/feedback/page.tsx");
  assert.match(page, /xl:grid-cols-2/);
  assert.match(page, /data-feedback-column="chats"[\s\S]*data-feedback-column="reports"/);
  assert.match(page, /id=\{`report-\$\{r\.id\}`\}/);
  assert.match(page, /<ClientLinks/);
  assert.match(page, /<FeedbackHashFocus \/>/);
  assert.match(page, /orderBy: \{ createdAt: "desc" \},\s*take: 50/, "последние 50 реплик ветки");
  const chats = read("src/app/root/feedback/support-chats-client.tsx");
  assert.match(chats, /max-h-\[45vh\][^"]*overflow-y-auto/, "список чатов — короткий");
  assert.match(chats, /id=\{`chat-\$\{thread\.id\}`\}/);
  assert.match(chats, /replyToId: quoted\.id/, "ответ хранит цитату");
  assert.match(chats, /data-reply-target/);
  const reply = read("src/app/root/feedback/feedback-reply.tsx");
  assert.match(reply, /data-reply-context/);
  assert.match(reply, /onPaste=\{files\.handlePaste\}/);
  assert.match(reply, /onDrop=/);
});

test("всплывашка смонтирована в кабинете и админке, обращения её вызывают", () => {
  assert.match(read("src/app/(dashboard)/layout.tsx"), /<SupportStaffAlerts \/>/);
  assert.match(read("src/app/root/layout.tsx"), /<SupportStaffAlerts \/>/);
  for (const file of [
    "src/app/api/feedback/route.ts",
    "src/app/api/support/route.ts",
    "src/app/api/public/feedback/route.ts",
    "src/lib/bot/handlers/support.ts",
  ]) {
    assert.match(read(file), /alertSupportStaffAboutReport\(/, file);
  }
  assert.match(read("src/lib/support-threads.ts"), /alertSupportStaffAboutChat\(/);
});
