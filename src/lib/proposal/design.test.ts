import assert from "node:assert/strict";
import test from "node:test";

import { buildProposalContent } from "./content";
import { equipmentFromRub, senderDisplayName, senderSignature } from "./design";
import { SAMPLE_PROMO_LIFETIME, sampleProposalContext } from "./sample";

const plain = (value: string) => value.replace(/\s/g, " ");

test("prices come from the tariff rates, not from constants in the text", () => {
  const ctx = sampleProposalContext({ rates: { standard: { month: 3500, year: 2500 }, premium: { month: 6000, year: 4500 }, vip: { month: 13000, year: 9000 } } });
  const standard = buildProposalContent({ sphere: "cafe" }, ctx).design;
  assert.equal(standard.planName, "Стандарт");
  assert.equal(plain(standard.price.month.monthly), "3 500 ₽");
  assert.equal(plain(standard.price.year.monthly), "2 500 ₽");
  assert.equal(plain(standard.price.year.total), "30 000 ₽ за год");
  assert.equal(plain(standard.price.year.saving), "12 000 ₽");
  assert.deepEqual(standard.comparison.priceRow.values.map(plain), ["2 500 ₽", "4 500 ₽"]);
  const premium = buildProposalContent({ sphere: "cafe", plan: "premium" }, ctx).design;
  assert.equal(plain(premium.price.month.total), "6 000 ₽ в месяц");
  assert.equal(premium.comparison.current, 1);
});

test("extras: ППК in both plans, sensors only in Премиум, each can be switched off", () => {
  const ctx = sampleProposalContext({ ppkFromRub: 12_000, equipmentFromRub: 18_000 });
  const standard = buildProposalContent({ sphere: "cafe" }, ctx).design.price.extras;
  assert.deepEqual(standard.map((row) => row.key), ["ppk"]);
  assert.equal(plain(standard[0].price), "от 12 000 ₽");
  const premium = buildProposalContent({ sphere: "cafe", plan: "premium" }, ctx).design.price.extras;
  assert.deepEqual(premium.map((row) => row.key), ["equipment", "ppk"]);
  assert.equal(plain(premium[0].price), "от 18 000 ₽");
  const none = buildProposalContent({ sphere: "cafe", plan: "premium", extras: { ppk: false, equipment: false } }, ctx).design.price.extras;
  assert.deepEqual(none, []);
  assert.equal(equipmentFromRub(), 17_750, "cheapest hardware bundle («Соло»)");
});

test("comparison rows follow the tariff catalog; no forbidden word", () => {
  const design = buildProposalContent({ sphere: "cafe" }, sampleProposalContext()).design;
  const row = (label: string) => design.comparison.rows.find((item) => item.label === label)!;
  assert.deepEqual(row("Показания по фото термометра").cells.map((cell) => cell.kind), ["no", "yes"]);
  assert.deepEqual(row("Заполнение с телефона").cells.map((cell) => cell.kind), ["yes", "yes"]);
  assert.deepEqual(row("Сотрудников на одну точку").cells, [{ kind: "text", text: "до 25" }, { kind: "text", text: "до 40" }]);
  assert.ok(!JSON.stringify(design).toLowerCase().includes("бланк"));
});

test("sender block: the staff member, name order like the design, signature only for a full name", () => {
  const design = buildProposalContent(
    { sphere: "cafe", sender: { name: "Волков Денис Владимирович", position: "Генеральный директор", phone: "+7 900 000-00-00", email: "d@example.ru" } },
    sampleProposalContext(),
  ).design;
  assert.equal(design.sender.displayName, "Денис Волков");
  assert.equal(design.sender.initials, "ДВ");
  assert.equal(design.sender.position, "Генеральный директор ООО «Пример»");
  assert.equal(plain(design.sender.signature ?? ""), "Волков Д. В.");
  assert.equal(design.contact.email, "d@example.ru");
  assert.equal(senderDisplayName("Команда WeSetup"), "Команда WeSetup");
  assert.equal(senderSignature("Команда WeSetup"), null);
});

test("greeting, addressee and promo note", () => {
  const ctx = sampleProposalContext();
  const byName = buildProposalContent({ sphere: "cafe", recipientName: "Анна Сергеевна" }, ctx).design;
  assert.equal(byName.greeting, "Уважаемая Анна Сергеевна!");
  assert.equal(byName.addressee, null);
  const explicit = buildProposalContent({ sphere: "cafe", greeting: "Добрый день, коллеги!", addressee: "Генеральному директору Ивановой Анне Сергеевне", companyName: "ООО «Ромашка»" }, ctx).design;
  assert.equal(explicit.greeting, "Добрый день, коллеги!");
  assert.equal(explicit.addressee, "Генеральному директору Ивановой Анне Сергеевне");
  assert.equal(explicit.forLine, "для ООО «Ромашка»");
  const promo = buildProposalContent({ sphere: "cafe", promo: SAMPLE_PROMO_LIFETIME }, ctx).design;
  assert.match(plain(promo.price.discountNote ?? ""), /ROMASHKA10: −10 % навсегда/);
  assert.equal(promo.contact.qrCaption, "Промокод ROMASHKA10");
  // 2 990 − 10 % = 2 691.
  assert.equal(plain(promo.price.month.monthly), "2 691 ₽");
});

test("price note: points discount scale of 2026-11-05", () => {
  const design = buildProposalContent({ sphere: "cafe" }, sampleProposalContext()).design;
  assert.match(
    plain(design.price.note),
    /скидка на все точки: от 5 точек — 5 %, от 10 — 10 %, от 15 — 20 %, от 35 — 25 %, от 50 — индивидуальное предложение\./
  );
  assert.doesNotMatch(design.price.note, /от (тр|пят)[её]?х точек/);
});

test("ВИП: колонки «Премиум» и «ВИП», ряды сопровождения, та же высота таблицы", () => {
  const ctx = sampleProposalContext({ rates: { standard: { month: 2990, year: 1990 }, premium: { month: 4990, year: 3990 }, vip: { month: 12990, year: 8990 } } });
  const standard = buildProposalContent({ sphere: "cafe" }, ctx).design;
  const vip = buildProposalContent({ sphere: "cafe", plan: "vip" }, ctx).design;
  assert.equal(vip.planName, "ВИП");
  assert.equal(plain(vip.price.month.total), "12 990 ₽ в месяц");
  assert.deepEqual(vip.comparison.columns, ["Премиум", "ВИП"]);
  assert.equal(vip.comparison.current, 1);
  assert.deepEqual(vip.comparison.priceRow.values.map(plain), ["3 990 ₽", "8 990 ₽"]);
  assert.equal(vip.comparison.rows.length, standard.comparison.rows.length);
  const row = (label: string) => vip.comparison.rows.find((item) => item.label === label)!;
  assert.deepEqual(row("Горячая линия").cells.map((cell) => cell.kind), ["no", "text"]);
  assert.deepEqual(row("Личный консультант").cells.map((cell) => cell.kind), ["no", "yes"]);
  assert.deepEqual(vip.price.extras.map((item) => item.key), ["equipment", "ppk"]);
});
