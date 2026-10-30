import assert from "node:assert/strict";
import test from "node:test";

import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_TELEGRAM_FALLBACK, contactTelegramUrl } from "@/lib/contact-us";

test("окно «Свяжитесь с нами»: телефон и почта WeSetup", () => {
  assert.deepEqual(CONTACT_PHONE, { display: "8 (925) 305-80-77", tel: "+79253058077" });
  assert.equal(CONTACT_EMAIL, "support@wesetup.ru");
});

test("Telegram — отдел продаж из окружения, иначе бот WeSetup", () => {
  assert.equal(contactTelegramUrl({}), CONTACT_TELEGRAM_FALLBACK);
  assert.equal(CONTACT_TELEGRAM_FALLBACK, "https://t.me/wesetupbot");
  assert.equal(contactTelegramUrl({ WESETUP_TG_SALES_URL: "https://t.me/wesetup_sales" }), "https://t.me/wesetup_sales");
  // Не Telegram и не https — не ссылка в окне.
  assert.equal(contactTelegramUrl({ WESETUP_TG_SALES_URL: "javascript:alert(1)" }), CONTACT_TELEGRAM_FALLBACK);
  assert.equal(contactTelegramUrl({ WESETUP_TG_SALES_URL: "http://t.me/wesetup_sales" }), CONTACT_TELEGRAM_FALLBACK);
  // Адрес поддержки не подменяет продажи.
  assert.equal(contactTelegramUrl({ WESETUP_TG_SUPPORT_URL: "https://t.me/wesetup_support" }), CONTACT_TELEGRAM_FALLBACK);
});
