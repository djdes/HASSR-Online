import assert from "node:assert/strict";
import test from "node:test";

import {
  GUEST_REPLY_EMAIL_PAUSE_MS,
  buildSupportChatTag,
  composeGuestReplyEmail,
  composePartnerHandoffAdminMessage,
  composeSupportChatAdminMessage,
  composeSupportChatPartnerMessage,
  extractSupportThreadId,
  shouldEmailGuestReply,
} from "@/lib/support-chat";

// Тот же приём, что и в escapeTelegramHtml — тест не должен быть мягче.
const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

test("extractSupportThreadId reads the anchor out of a replied message", () => {
  const text = composeSupportChatAdminMessage({
    threadId: "thr_1",
    body: "не открывается журнал",
    userName: "Иван",
    userEmail: "ivan@x.ru",
    organizationName: "ООО БФС",
    phone: "+79263740794",
    previousMessages: 0,
    escape,
    appUrl: "https://wesetup.ru",
  });

  assert.equal(extractSupportThreadId(text), "thr_1");
});

test("extractSupportThreadId ignores feedback anchors", () => {
  // У обращений свой тег #fb_. Если чат начнёт его подхватывать, ответ на
  // обращение улетит в чужую ветку переписки.
  assert.equal(extractSupportThreadId("хвост #fb_abc123 хвост"), null);
  assert.equal(extractSupportThreadId(buildSupportChatTag("abc123")), "abc123");
  assert.equal(extractSupportThreadId(null), null);
  assert.equal(extractSupportThreadId("без тега"), null);
});

test("composeSupportChatAdminMessage carries who is writing", () => {
  const text = composeSupportChatAdminMessage({
    threadId: "thr_2",
    body: "вопрос",
    userName: "Анна",
    userEmail: "anna@x.ru",
    organizationName: "Кафе",
    phone: null,
    previousMessages: 4,
    escape,
    appUrl: "https://wesetup.ru",
  });

  // Оператор отвечает свайпом из Telegram — весь контекст обязан быть в
  // самом сообщении, иначе он не поймёт, кому отвечает.
  assert.match(text, /Анна · anna@x\.ru/);
  assert.match(text, /Кафе/);
  assert.match(text, /реплик в ветке: 4/);
  assert.doesNotMatch(text, /📞/);
});

test("composeSupportChatAdminMessage escapes the body", () => {
  const text = composeSupportChatAdminMessage({
    threadId: "thr_3",
    body: "<b>жирный</b>",
    previousMessages: 0,
    escape,
    appUrl: "https://wesetup.ru",
  });

  // parse_mode HTML: неэкранированный тег из пользовательского текста
  // ломает сообщение, и Telegram отвечает 400 — обращение не дойдёт.
  assert.match(text, /&lt;b&gt;жирный/);
});

test("partner handoff admin message keeps the chat anchor but asks nothing", () => {
  const text = composePartnerHandoffAdminMessage({
    threadId: "thr_9",
    body: "не печатается журнал",
    organizationName: "Кафе «Луна»",
    brandName: "Консалт-Про",
    authorName: "Мария",
    escape,
    appUrl: "https://wesetup.ru",
  });
  assert.equal(extractSupportThreadId(text), "thr_9");
  assert.ok(text.includes("Консалт-Про"));
  assert.ok(text.includes("Отвечать не нужно"));
  assert.ok(!text.includes("Ответить: свайп-реплай"));
});

test("partner message links to the partner chats page", () => {
  const text = composeSupportChatPartnerMessage({
    threadId: "thr_9",
    body: "<b>вопрос</b>",
    organizationName: "Кафе",
    authorName: "Мария",
    escape,
    appUrl: "https://wesetup.ru",
  });
  assert.ok(text.includes("/partner/chats?thread=thr_9"));
  assert.ok(text.includes("&lt;b&gt;вопрос&lt;/b&gt;"));
});

test("guest reply email: one per operator turn, again after a 30-minute pause", () => {
  const at = new Date("2026-10-31T12:00:00Z");
  const ago = (minutes: number) => new Date(at.getTime() - minutes * 60_000);
  // First reply in the thread, or the guest wrote last — email.
  assert.equal(shouldEmailGuestReply(null, at), true);
  assert.equal(shouldEmailGuestReply({ author: "client", createdAt: ago(1) }, at), true);
  // The operator keeps typing in the same turn — no second email.
  assert.equal(shouldEmailGuestReply({ author: "operator", createdAt: ago(2) }, at), false);
  assert.equal(shouldEmailGuestReply({ author: "operator", createdAt: ago(29) }, at), false);
  // A follow-up after a pause reaches the guest too.
  assert.equal(shouldEmailGuestReply({ author: "operator", createdAt: ago(GUEST_REPLY_EMAIL_PAUSE_MS / 60_000) }, at), true);
});

test("guest reply email escapes the reply, keeps line breaks and links back to the chat", () => {
  const mail = composeGuestReplyEmail({
    operatorName: "Поддержка <WeSetup>",
    body: "Здравствуйте!\nТариф <b>Стандарт</b> подойдёт.",
    attachmentsCount: 1,
    appUrl: "https://wesetup.ru",
    escape,
  });
  assert.equal(mail.subject, "Ответ поддержки WeSetup");
  assert.match(mail.html, /Здравствуйте!<br>Тариф &lt;b&gt;Стандарт&lt;\/b&gt; подойдёт\./);
  assert.match(mail.html, /Отвечает: Поддержка &lt;WeSetup&gt;/);
  assert.match(mail.html, /К ответу приложены файлы/);
  assert.match(mail.html, /href="https:\/\/wesetup\.ru\/\?support=chat"/);
  assert.doesNotMatch(mail.html, /<b>Стандарт<\/b>/);

  const bare = composeGuestReplyEmail({ operatorName: null, body: "  ", attachmentsCount: 2, appUrl: "https://wesetup.ru", escape });
  assert.match(bare.html, /📎 Вложение/);
  assert.doesNotMatch(bare.html, /Отвечает:/);
});
