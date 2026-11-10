import assert from "node:assert/strict";
import test from "node:test";

import { offerPriceLine, offerSchema, renderOfferEmail, termsMismatch } from "./offer";

test("форма КП: скидка до 90 %, точек от 1, почта обязательна", () => {
  const ok = offerSchema.safeParse({ organizationId: "org1", tier: "standard", cycle: "year", points: 2, discountPercent: 15, toEmail: "boss@cafe.ru" });
  assert.equal(ok.success, true);
  assert.equal(ok.success && ok.data.validDays, 7);
  assert.equal(offerSchema.safeParse({ organizationId: "org1", tier: "standard", cycle: "year", points: 0, discountPercent: 15, toEmail: "boss@cafe.ru" }).success, false);
  assert.equal(offerSchema.safeParse({ organizationId: "org1", tier: "standard", cycle: "year", points: 1, discountPercent: 95, toEmail: "boss@cafe.ru" }).success, false);
  assert.equal(offerSchema.safeParse({ organizationId: "org1", tier: "standard", cycle: "year", points: 1, discountPercent: 5, toEmail: "нет" }).success, false);
});

test("согласованные условия менять нельзя", () => {
  assert.equal(termsMismatch({ tier: "premium", cycle: "year", points: 3 }, { tier: "premium", cycle: "year", points: 3 }), null);
  assert.match(termsMismatch({ tier: "premium", cycle: "year", points: 3 }, { tier: "premium", cycle: "month", points: 3 }) ?? "", /Согласовано на «Премиум», 3 точ\., за год/);
});

test("письмо КП: точная цена со скидкой, код, подпись, без двойных кавычек", () => {
  assert.equal(offerPriceLine({ tier: "standard", cycle: "year", points: 2, fullRub: 47760, discountPercent: 20 }), "«Стандарт» на 2 точки, за год: 47 760 ₽ → 38 208 ₽ (−20 %)");
  const mail = renderOfferEmail({
    orgName: "Кафе «Ромашка»",
    recipientName: "Ирина",
    tier: "standard",
    cycle: "year",
    points: 2,
    fullRub: 47760,
    discountPercent: 20,
    code: "ROMASHKA20",
    codeEndsLabel: "17 ноября",
    lifetime: false,
    invoice: { number: "901", amountRub: 38208 },
    links: { pay: "https://wesetup.ru/settings/subscription?promo=ROMASHKA20", web: "https://wesetup.ru/kp/x", pdf: "https://wesetup.ru/kp/x.pdf" },
    note: "",
    manager: { name: "Алексей Петров", position: "Менеджер", phone: "+7 900 000-00-00", email: "alexey@wesetup.ru" },
  });
  assert.equal(mail.subject, "Кафе «Ромашка»: спецпредложение — «Стандарт» со скидкой 20 %");
  assert.match(mail.text, /Здравствуйте, Ирина!/);
  assert.match(mail.text, /38 208 ₽ \(−20 %\) — 3 184 ₽ в месяц/);
  assert.match(mail.text, /Промокод ROMASHKA20 действует по 17 ноября, скидка — на эту оплату/);
  assert.match(mail.text, /Счёт №901 на 38 208 ₽ — во вложении/);
  assert.match(mail.text, /Алексей Петров\nМенеджер/);
});
