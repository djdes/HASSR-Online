import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COMPANY_EMAIL, COMPANY_MOBILE, COMPANY_PHONE, COMPANY_PHONES } from "@/lib/company-contacts";
import { CONTACT_EMAIL, CONTACT_MOBILE, CONTACT_PHONE } from "@/lib/contact-us";
import { HOME_PHONE, HOME_PHONES } from "@/lib/home-page";
import { cardVcard } from "@/lib/promo/card-offer";
import { SUPPORT_EMAIL } from "@/lib/support-chat-bus";

const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("контакты как на визитке: 495, мобильный, admin@", () => {
  assert.equal(COMPANY_EMAIL, "admin@wesetup.ru");
  assert.deepEqual(COMPANY_PHONE, { display: "+7 (495) 109-65-43", tel: "+74951096543" });
  assert.deepEqual(COMPANY_MOBILE, { display: "+7 (925) 305-80-77", tel: "+79253058077" });
  assert.deepEqual(COMPANY_PHONES, [COMPANY_PHONE, COMPANY_MOBILE]);
  for (const phone of COMPANY_PHONES) assert.equal(phone.tel, `+7${phone.display.replace(/\D/g, "").slice(1)}`);
});

test("окно «Свяжитесь с нами», главная, чат и визитка берут один источник", () => {
  assert.equal(CONTACT_PHONE, COMPANY_PHONE);
  assert.equal(CONTACT_MOBILE, COMPANY_MOBILE);
  assert.equal(CONTACT_EMAIL, COMPANY_EMAIL);
  assert.equal(SUPPORT_EMAIL, COMPANY_EMAIL);
  assert.equal(HOME_PHONES, COMPANY_PHONES);
  assert.equal(HOME_PHONE, COMPANY_MOBILE);
  const vcard = cardVcard();
  assert.match(vcard, /TEL;TYPE=WORK:\+74951096543\r\n/);
  assert.match(vcard, /TEL;TYPE=CELL:\+79253058077\r\n/);
  assert.match(vcard, /EMAIL:admin@wesetup\.ru\r\n/);
});

test("подвал, реквизиты и политика показывают оба номера; старого 999 нет", () => {
  const footer = src("components/public/public-chrome.tsx");
  assert.match(footer, /COMPANY_PHONES\.map\(\(phone\) => \(/);
  assert.match(footer, /href=\{`mailto:\$\{COMPANY_EMAIL\}`\}/);
  const requisites = src("components/public/legal-article.tsx");
  assert.match(requisites, /Телефоны:\{" "\}\s*\{COMPANY_PHONES\.map/);
  const privacy = src("app/privacy/page.tsx");
  assert.match(privacy, /office: COMPANY_PHONE\.display,\s*mobile: COMPANY_MOBILE\.display,/);
  for (const file of ["components/public/public-chrome.tsx", "components/public/legal-article.tsx", "app/privacy/page.tsx"]) {
    assert.ok(!/999\)?[ -]?634|79996341612/.test(src(file)), file);
  }
  for (const locale of ["ru", "en", "uz"]) {
    const messages = JSON.parse(src(`i18n/messages/${locale}.json`)) as {
      publicLegalRequisites: { telephone: string };
      homePage: { mobile?: string };
      sharedUi: { contactUs: { mobileHint?: string } };
    };
    assert.match(messages.publicLegalRequisites.telephone, /<officeLink>\{office\}<\/officeLink>, <mobileLink>\{mobile\}<\/mobileLink>/, locale);
    assert.ok(messages.homePage.mobile, locale);
    assert.ok(messages.sharedUi.contactUs.mobileHint, locale);
  }
});

test("окно «Свяжитесь с нами» — мобильный строкой под крупным номером", () => {
  const dialog = src("components/contact/contact-us-dialog.tsx");
  const big = dialog.indexOf("data-contact-phone");
  const mobile = dialog.indexOf("data-contact-mobile");
  const telegram = dialog.indexOf("data-contact-telegram");
  assert.ok(big > 0 && mobile > big && telegram > mobile);
  assert.match(dialog, /href=\{`tel:\$\{CONTACT_MOBILE\.tel\}`\}/);
});

test("почты support@ в сайте и текстах больше нет", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const raw = src(`i18n/messages/${locale}.json`);
    assert.ok(!raw.includes("support@wesetup.ru"), locale);
    assert.ok(raw.includes("admin@wesetup.ru"), locale);
  }
  for (const file of ["components/public/public-chrome.tsx", "components/dashboard/dashboard-footer.tsx", "app/oferta/page.tsx", "app/privacy/page.tsx", "lib/support-chat-bus.ts"]) {
    assert.ok(!src(file).includes("support@wesetup.ru"), file);
  }
  assert.match(readFileSync(new URL("../../public/.well-known/security.txt", import.meta.url), "utf8"), /^Contact: mailto:admin@wesetup\.ru$/m);
});
