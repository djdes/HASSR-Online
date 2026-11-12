import assert from "node:assert/strict";
import test from "node:test";

import { applyBuyerInput, blocksToText, buyerChecklist, buyerInputFrom, buyerKindFromInput, cleanCustomSections, textToBlocks } from "./buyer-form";
import { renderContractDocx } from "./docx";
import { renderContractPdf } from "./pdf";
import { BLANK_SHORT, buildContractDocument, CONTRACT_TEMPLATE_VERSION, contractPlainText, contractTemplateSections } from "./template";
import type { ContractBuyer, ContractSnapshot } from "./types";

const SELLER: ContractSnapshot["seller"] = {
  nameFull: "Общество с ограниченной ответственностью «БФС»",
  nameShort: "ООО «БФС»",
  inn: "5018215599",
  kpp: "501801001",
  ogrn: "1235000105306",
  address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
  bank: { name: "АО «Тестовый банк»", bik: "044500000", account: "40702810000000000001", corrAccount: "30101810000000000001" },
  head: { post: "Генеральный директор", name: "Тестов Тест Тестович" },
  vatMode: "none",
  email: "admin@example.ru",
  phone: "",
  site: "wesetup.ru",
};

const EMPTY_BUYER: ContractBuyer = {
  kind: "legal",
  nameFull: "",
  nameShort: "",
  inn: null,
  kpp: null,
  ogrn: null,
  legalAddress: null,
  actualAddress: null,
  phone: null,
  email: null,
  bank: null,
};

/** «Рыба» — как её собирает `buildBlankContractSnapshot`. */
const BLANK_SNAPSHOT: ContractSnapshot = {
  number: BLANK_SHORT,
  date: "",
  city: "Королёв",
  templateVersion: CONTRACT_TEMPLATE_VERSION,
  seller: SELLER,
  buyer: EMPTY_BUYER,
  params: { signerName: null, signerPost: null, signerBasis: null, useFacsimile: false, customSections: null },
};

const n = (value: string) => value.replace(/\s/g, " ");

function assertNoHoles(text: string) {
  for (const bad of ["undefined", "null", "NaN", "[object Object]", "${"]) assert.ok(!text.includes(bad), `text contains ${bad}`);
  assert.doesNotMatch(text, /\(\s*\)/, "empty brackets");
}

test("blank contract: seller filled, client, number and date are lines, no draft mark", async () => {
  const document = buildContractDocument(BLANK_SNAPSHOT, { blank: true });
  assert.equal(document.draft, false, "no «Проект» mark on the blank");
  assert.match(document.number, /^_+$/);
  assert.match(document.dateLong, /«____»/);
  const text = n(contractPlainText(document));
  assertNoHoles(text);
  assert.ok(text.includes("5018215599"), "seller INN");
  assert.match(n(document.preamble), /и _{6,}, ИНН _{6,}, ОГРН _{6,} \(далее — «Заказчик»\)/);
  assert.ok(document.requisites.buyer.every((row) => row.value.trim().length > 0), "every row has a value or a line");
  assert.ok(!document.requisites.buyer.some((row) => row.label === "Телефон"), "optional phone row is not printed empty");
  assert.ok(!document.requisites.seller.some((row) => row.label === "Телефон"), "seller without phone — no phone row");
  assert.ok(document.requisites.buyer.some((row) => row.label === "Эл. почта"), "email stays: the text refers to it");

  const pdf = renderContractPdf(document, SELLER, { facsimile: null, stamp: null });
  assert.ok(pdf.pages > 1);
  const docx = await renderContractDocx(document, SELLER);
  assert.equal(docx.subarray(0, 2).toString(), "PK", "docx is a zip");
});

test("client requisites from the form go into the snapshot, kind follows the INN", () => {
  const legal = applyBuyerInput(
    EMPTY_BUYER,
    {
      nameFull: "  Общество с ограниченной ответственностью «Ромашка» ",
      nameShort: "ООО «Ромашка»",
      inn: "7707083893",
      kpp: "773601001",
      ogrn: "1027700132195",
      legalAddress: "г. Москва, ул. Вавилова, д. 19",
      actualAddress: "г. Москва, ул. Вавилова, д. 19",
      phone: "",
      bankName: "ПАО «Банк»",
      bankBik: "044525000",
      bankAccount: "40702810000000000002",
      bankCorrAccount: "30101810000000000002",
    },
    "buh@romashka.example",
  );
  assert.equal(legal.kind, "legal");
  assert.equal(legal.nameFull, "Общество с ограниченной ответственностью «Ромашка»");
  assert.equal(legal.actualAddress, null, "actual address equal to legal is dropped");
  assert.equal(legal.phone, null);
  assert.deepEqual(legal.bank, { name: "ПАО «Банк»", bik: "044525000", account: "40702810000000000002", corrAccount: "30101810000000000002" });

  const document = buildContractDocument({ ...BLANK_SNAPSHOT, number: "WS-2026/0007", date: "2026-11-12", buyer: legal });
  const rows = Object.fromEntries(document.requisites.buyer.map((row) => [row.label, row.value]));
  assert.equal(rows["Банк"], "ПАО «Банк»");
  assert.equal(rows["БИК"], "044525000");
  assert.equal(rows["Расчётный счёт"], "40702810000000000002");
  assert.equal(rows["ИНН / КПП"], "7707083893 / 773601001");
  assert.equal(rows["Телефон"], undefined, "empty phone — no row");
  assert.equal(rows["Фактический адрес"], undefined);

  const individual = applyBuyerInput(legal, { ...buyerInputFrom(legal), inn: "500100732259", kpp: "773601001" }, null);
  assert.equal(individual.kind, "individual");
  assert.equal(individual.kpp, null, "sole trader has no KPP");
  assert.equal(buyerKindFromInput("12", "individual"), "individual", "partial INN keeps the organization kind");

  const items = buyerChecklist(legal, { signerName: "Иванова Анна", signerPost: "директор", signerBasis: "Устава", useFacsimile: false }, true);
  assert.ok(items.every((item) => item.ok), JSON.stringify(items.filter((item) => !item.ok)));
  assert.equal(buyerChecklist({ ...legal, inn: "7707083890" }, { signerName: null, signerPost: null, signerBasis: null, useFacsimile: false }, true)[0].ok, false);
});

test("custom text: lines become clauses, «а) …» sub-items, requisites section stays last", () => {
  assert.deepEqual(textToBlocks("Первый пункт.\n\n  а)  подпункт один;\nб) подпункт два.\nВторой пункт."), [
    "Первый пункт.",
    ["а)", "подпункт один;"],
    ["б)", "подпункт два."],
    "Второй пункт.",
  ]);
  const template = contractTemplateSections(SELLER, "2026-11-12");
  assert.deepEqual(textToBlocks(blocksToText(template[0].blocks)), template[0].blocks, "template text round-trips through the editor");

  const custom = cleanCustomSections([
    { title: "Предмет договора", text: "Исполнитель оказывает услуги по особому порядку клиента.\nа) пункт по просьбе клиента." },
    { title: "Пустой раздел", text: "   " },
    { title: "", text: "Оплата — по графику, согласованному Сторонами." },
  ]);
  assert.equal(custom.length, 2, "empty sections are dropped");
  assert.equal(custom[1].title, "Раздел 3");

  const document = buildContractDocument({
    ...BLANK_SNAPSHOT,
    number: "WS-2026/0008",
    date: "2026-11-12",
    params: { ...BLANK_SNAPSHOT.params, customSections: custom },
  });
  assert.equal(document.sections.length, 3);
  assert.equal(document.sections[0].blocks[0].kind, "clause");
  assert.equal(document.sections[0].blocks[1].kind, "item");
  assert.equal(document.sections[2].title, "Реквизиты и подписи сторон");
  assert.ok(n(contractPlainText(document)).includes("по особому порядку клиента"));
});

test("agreed plan: default Premium for 1 month, discount on top, appendices 1 and 2", async () => {
  const { contractPricingLine, defaultContractPricing } = await import("./pricing");
  const { DEFAULT_PLAN_RATES } = await import("@/lib/tariff-plans");
  const pricing = defaultContractPricing(DEFAULT_PLAN_RATES);
  assert.equal(pricing.tier, "premium");
  assert.equal(pricing.cycle, "month");
  const plain = contractPricingLine(pricing);
  assert.equal(plain.totalRub, DEFAULT_PLAN_RATES.premium.month);
  assert.equal(plain.discountRub, 0);
  const discounted = contractPricingLine({ ...pricing, points: 2, discountPercent: 10 });
  assert.equal(discounted.fullRub, DEFAULT_PLAN_RATES.premium.month * 2);
  assert.equal(discounted.totalRub, Math.round(DEFAULT_PLAN_RATES.premium.month * 2 * 0.9));

  const snapshot: ContractSnapshot = {
    ...BLANK_SNAPSHOT,
    number: "WS-2026/0009",
    date: "2026-11-12",
    params: { ...BLANK_SNAPSHOT.params, pricing: { ...pricing, discountPercent: 10 } },
  };
  const document = buildContractDocument(snapshot);
  assert.equal(document.appendices.length, 2);
  assert.equal(document.appendices[0].title, "Стоимость услуг");
  assert.match(n(document.appendices[0].rows[0][0]), /«Премиум» на 1 месяц/);
  assert.match(n(document.appendices[0].notes[0].text), /Общая стоимость .* руб\. \(.+рубл.+\), НДС не облагается/);
  assert.equal(document.appendices[1].rows.length, 6, "3 plans × month/year");
  const text = n(contractPlainText(document));
  assert.match(text, /указаны в Приложении № 1/);
  assert.match(text, /Контакты Исполнителя/);
  assert.ok(!text.includes("указываются в счёте Исполнителя"));

  const plainDoc = buildContractDocument({ ...snapshot, params: { ...snapshot.params, pricing: null } });
  assert.equal(plainDoc.appendices.length, 0, "contracts issued without a plan keep their text");

  const pdf = renderContractPdf(document, SELLER, { facsimile: null, stamp: null });
  assert.ok(pdf.pages >= 6);
  const docx = await renderContractDocx(document, SELLER);
  assert.equal(docx.subarray(0, 2).toString(), "PK");
  if (process.env.CONTRACT_DUMP) {
    const fs = await import("node:fs");
    fs.writeFileSync(`${process.env.CONTRACT_DUMP}/plan.pdf`, pdf.bytes);
    fs.writeFileSync(`${process.env.CONTRACT_DUMP}/plan.docx`, docx);
  }
});
