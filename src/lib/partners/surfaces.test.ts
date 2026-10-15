import assert from "node:assert/strict";
import test from "node:test";

import { partnerPdfFooterText } from "@/lib/pdf-page-labels";
import { PLATFORM_BADGE_TEXT, parseAttachInput } from "@/lib/partners/validation";
import { encodePartnerRef, parsePartnerRef } from "@/lib/partners/referral";
import { phoneHref, telegramHref } from "@/lib/partners/consultant-contact-shared";
import { buildTelegramLinkedStartReply } from "@/lib/bot/start-response";

test("PDF-подвал: подпись партнёра + обязательная плашка платформы", () => {
  const withSignature = partnerPdfFooterText({
    brandName: "Иванов Консалт",
    pdfSignature: "Сопровождение ХАССП — Иванов Консалт, +7 900 000-00-00",
  });
  assert.equal(
    withSignature,
    `Сопровождение ХАССП — Иванов Консалт, +7 900 000-00-00 · ${PLATFORM_BADGE_TEXT}`
  );

  // Без подписи — бренд всё равно виден, плашку убрать нельзя.
  const fallback = partnerPdfFooterText({ brandName: "Иванов Консалт", pdfSignature: "   " });
  assert.equal(fallback, `Сопровождение: Иванов Консалт · ${PLATFORM_BADGE_TEXT}`);
  assert.ok(fallback.endsWith(PLATFORM_BADGE_TEXT));
});

test("PDF branding localizes platform copy while retaining partner signatures and names", () => {
  const brandName = "Иванов O‘tkir";
  const pdfSignature = "Сопровождение: O‘tkir — +7 900 000-00-00";
  assert.equal(partnerPdfFooterText({ brandName, pdfSignature }, "en"), `${pdfSignature} · Powered by WeSetup`);
  assert.equal(partnerPdfFooterText({ brandName, pdfSignature }, "uz"), `${pdfSignature} · WeSetup platformasida ishlaydi`);
  assert.equal(partnerPdfFooterText({ brandName, pdfSignature: null }, "en"), `Support: ${brandName} · Powered by WeSetup`);
  assert.equal(partnerPdfFooterText({ brandName, pdfSignature: null }, "uz"), `Qo‘llab-quvvatlash: ${brandName} · WeSetup platformasida ishlaydi`);
});

test("поле «ссылка или код»: URL, голый slug, 6-символьный код, мусор", () => {
  assert.deepEqual(parseAttachInput("https://wesetup.ru/p/ivanov-consult?utm=1"), {
    slug: "ivanov-consult",
  });
  assert.deepEqual(parseAttachInput("  Ivanov-Consult "), { slug: "ivanov-consult" });
  assert.deepEqual(parseAttachInput("abc 234"), { code: "ABC234" });
  assert.equal(parseAttachInput(""), null);
  assert.equal(parseAttachInput("??"), null);
});

test("реферальная cookie: round-trip и строгий разбор", () => {
  const encoded = encodePartnerRef({ slug: "ivanov", level: "edit" });
  assert.deepEqual(parsePartnerRef(encoded), { slug: "ivanov", level: "edit" });
  // Неизвестный уровень деградирует до view — безопасный дефолт.
  assert.deepEqual(parsePartnerRef("ivanov|admin"), { slug: "ivanov", level: "view" });
  assert.equal(parsePartnerRef("!!|edit"), null);
  assert.equal(parsePartnerRef(undefined), null);
});

test("контакты консультанта → корректные href", () => {
  assert.equal(telegramHref("@ivanov_haccp"), "https://t.me/ivanov_haccp");
  assert.equal(telegramHref("https://t.me/ivanov_haccp"), "https://t.me/ivanov_haccp");
  assert.equal(phoneHref("+7 (900) 123-45-67"), "tel:+79001234567");
});

test("приветствие бота: подпись консультанта добавляется хвостом, без неё текст прежний", () => {
  const state = {
    name: "Мария",
    role: "manager",
    isRoot: false,
    kind: "manager" as const,
    pendingCount: 0,
    employeesWithPending: 0,
  };
  const plain = buildTelegramLinkedStartReply(state, "https://t.me/wesetupbot/app");
  const branded = buildTelegramLinkedStartReply(
    state,
    "https://t.me/wesetupbot/app",
    "\n\n🤝 Ваш консультант: <b>Иванов Консалт</b>, +7 900 000-00-00"
  );
  assert.ok(!plain.text.includes("Ваш консультант"));
  assert.ok(branded.text.startsWith(plain.text));
  assert.ok(branded.text.endsWith("+7 900 000-00-00"));
  assert.equal(branded.buttonLabel, plain.buttonLabel);
});
