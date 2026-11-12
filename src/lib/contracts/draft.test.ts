import assert from "node:assert/strict";
import test from "node:test";

import { mergeContractDraft, type ContractDraftForm } from "./draft";

const buyer = { nameFull: "ООО «Солянка»", nameShort: null, inn: "9701290368", kpp: null, ogrn: null, legalAddress: null, actualAddress: null, phone: null, bankName: null, bankBik: null, bankAccount: null, bankCorrAccount: null };
const defaults: ContractDraftForm & { date: string } = {
  date: "2026-11-12",
  city: "г. Королёв",
  signerName: null,
  signerPost: null,
  signerBasis: null,
  buyerEmail: null,
  useFacsimile: true,
  buyer,
  pricing: { tier: "premium", cycle: "month", points: 1, discountPercent: 0 },
};

test("черновик возвращает введённые реквизиты, тариф и текст", () => {
  const raw = {
    form: { date: "2020-01-01", buyer: { bankName: "ПАО Сбербанк", bankBik: "044525225", evil: "x" }, pricing: { tier: "standard", cycle: "year", points: 3, discountPercent: 10 }, useFacsimile: false, signerName: "Иванов И. И." },
    text: [{ title: "1. Предмет", text: "1.1. Текст" }],
  };
  const merged = mergeContractDraft(defaults, raw);
  assert.equal(merged.saved, true);
  assert.equal(merged.form.buyer.bankName, "ПАО Сбербанк");
  assert.equal(merged.form.buyer.bankBik, "044525225");
  assert.equal(merged.form.buyer.nameFull, "ООО «Солянка»", "незаполненное в черновике — из карточки");
  assert.equal((merged.form.buyer as Record<string, unknown>).evil, undefined);
  assert.deepEqual(merged.form.pricing, { tier: "standard", cycle: "year", points: 3, discountPercent: 10 });
  assert.equal(merged.form.useFacsimile, false);
  assert.equal(merged.form.signerName, "Иванов И. И.");
  assert.equal(merged.form.date, "2026-11-12", "дата договора — всегда сегодняшняя");
  assert.deepEqual(merged.text, [{ title: "1. Предмет", text: "1.1. Текст" }]);
});

test("нет черновика или он битый — значения карточки", () => {
  assert.deepEqual(mergeContractDraft(defaults, null), { form: defaults, text: null, saved: false });
  const broken = mergeContractDraft(defaults, { form: { pricing: { tier: "gold", points: -1 }, buyer: { inn: 5 } }, text: "x" });
  assert.deepEqual(broken.form.pricing, defaults.pricing);
  assert.equal(broken.form.buyer.inn, "9701290368");
  assert.equal(broken.text, null);
});
