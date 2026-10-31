import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_TELEGRAM_FALLBACK, contactMaxUrl, contactTelegramUrl } from "@/lib/contact-us";

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

test("MAX в окне — только https://max.ru/… с путём, иначе строки нет", () => {
  assert.equal(contactMaxUrl("https://max.ru/wesetup_support"), "https://max.ru/wesetup_support");
  assert.equal(contactMaxUrl("  https://max.ru/join/abc  "), "https://max.ru/join/abc");
  assert.equal(contactMaxUrl(""), null);
  assert.equal(contactMaxUrl(undefined), null);
  assert.equal(contactMaxUrl("https://max.ru/"), null);
  assert.equal(contactMaxUrl("http://max.ru/wesetup"), null);
  assert.equal(contactMaxUrl("https://evil.example/max.ru/wesetup"), null);
  assert.equal(contactMaxUrl("https://max.ru.evil.example/wesetup"), null);
  assert.equal(contactMaxUrl("javascript:alert(1)"), null);
});

test("окно показывает MAX только при заданной переменной сборки; тексты на трёх языках", () => {
  const dialog = readFileSync(new URL("../components/contact/contact-us-dialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /const max = contactMaxUrl\(process\.env\.NEXT_PUBLIC_WESETUP_MAX_URL\);/);
  assert.match(dialog, /\{max \? \(\s*<a href=\{max\}[^>]*data-contact-max>/);
  for (const locale of ["ru", "en", "uz"]) {
    const messages = JSON.parse(readFileSync(new URL(`../i18n/messages/${locale}.json`, import.meta.url), "utf8")) as {
      sharedUi: { contactUs: { max?: string; maxHint?: string } };
    };
    assert.equal(messages.sharedUi.contactUs.max, "MAX", locale);
    assert.ok(messages.sharedUi.contactUs.maxHint, locale);
  }
});
