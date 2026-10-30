import assert from "node:assert/strict";
import test from "node:test";

import { renderContractPdf } from "./pdf";
import { contractDateLong, personName, postAsTitle, postInSentence, shortPersonName } from "./format";
import { contractFileName, draftContractNumber, formatContractNumber, parseContractNumber } from "./numbering";
import { cleanRecipientList, contractRecipientSuggestions } from "./recipients";
import { buyerChecklist, buyerFromOrganization, buyerKind, defaultContractParams, sellerChecklist } from "./snapshot";
import { BLANK, buildContractDocument, buyerDisplayName, contractPlainText, CONTRACT_TEMPLATE_VERSION } from "./template";
import type { ContractSnapshot } from "./types";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

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
  phone: "+7 (495) 000-00-00",
  site: "wesetup.ru",
};

const LEGAL: ContractSnapshot = {
  number: "WS-2026/0001",
  date: "2026-10-29",
  city: "Королёв",
  templateVersion: CONTRACT_TEMPLATE_VERSION,
  seller: SELLER,
  buyer: {
    kind: "legal",
    nameFull: "Общество с ограниченной ответственностью «Ромашка»",
    nameShort: "ООО «Ромашка»",
    inn: "7707083893",
    kpp: "773601001",
    ogrn: "1027700132195",
    legalAddress: "117997, г. Москва, ул. Вавилова, д. 19",
    actualAddress: null,
    phone: "+7 (900) 000-00-00",
    email: "buh@romashka.example",
  },
  params: { signerName: "ИВАНОВА АННА СЕРГЕЕВНА", signerPost: "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР", signerBasis: "Устава", useFacsimile: false },
};

const INDIVIDUAL: ContractSnapshot = {
  ...LEGAL,
  buyer: {
    kind: "individual",
    nameFull: "Индивидуальный предприниматель Петров Пётр Петрович",
    nameShort: "ИП Петров Пётр Петрович",
    inn: "500100732259",
    kpp: null,
    ogrn: "304500116000157",
    legalAddress: null,
    actualAddress: null,
    phone: null,
    email: null,
  },
  params: { signerName: null, signerPost: null, signerBasis: null, useFacsimile: false },
};

/** Неразрывные пробелы → обычные: сравниваем текст, а не типографику. */
const n = (value: string) => value.replace(/\s/g, " ");

/** В тексте нет пропусков подстановки. */
function assertNoHoles(text: string) {
  for (const bad of ["undefined", "null", "NaN", "[object Object]", "{{", "}}", "${"]) {
    assert.ok(!text.includes(bad), `text contains ${bad}`);
  }
  assert.doesNotMatch(text, /,\s*,/, "empty item between commas");
  assert.doesNotMatch(text, /\(\s*\)/, "empty brackets");
  assert.doesNotMatch(text, / {2,}/, "double spaces");
}

function assertRequisitesFilled(document: ReturnType<typeof buildContractDocument>) {
  for (const row of [...document.requisites.seller, ...document.requisites.buyer]) {
    assert.ok(row.value.trim().length > 0, `requisite ${row.label} has a value or a blank line`);
  }
}

test("legal entity contract: both parties filled, caps normalized, no holes", () => {
  const document = buildContractDocument(LEGAL);
  const text = n(contractPlainText(document));
  assertNoHoles(text);
  assertRequisitesFilled(document);
  assert.equal(document.draft, false);
  assert.match(n(document.preamble), /ИНН[  ]5018215599/);
  assert.match(n(document.preamble), /ИНН 7707083893/);
  assert.match(n(document.preamble), /от имени которого на основании Устава действует генеральный директор Иванова Анна Сергеевна/);
  assert.match(n(document.preamble), /\(далее — «Исполнитель»\)/);
  assert.equal(document.signatures.buyer.post, "Генеральный директор");
  assert.equal(n(document.signatures.buyer.nameShort), "Иванова А. С.");
  assert.equal(n(document.signatures.seller.nameShort), "Тестов Т. Т.");
  assert.ok(document.requisites.buyer.some((row) => row.label === "ИНН / КПП" && row.value === "7707083893 / 773601001"));
  assert.ok(document.requisites.buyer.some((row) => row.label === "ОГРН"));
  assert.equal(document.city, "г. Королёв");
  assert.equal(n(document.dateLong), "«29» октября 2026 г.");
  // Сумм в договоре нет — цена только по тарифу и счетам.
  assert.doesNotMatch(text, /\d\s?(₽|руб\.)/);
  assert.match(text, /Арбитражном суде Московской области/);
  assert.match(text, /ч\. 3 ст\. 6 Федерального закона/);
});

test("sole trader (12-digit INN): ИП wording, ОГРНИП, no КПП, self-signature", () => {
  const document = buildContractDocument(INDIVIDUAL);
  const text = n(contractPlainText(document));
  assertNoHoles(text);
  assertRequisitesFilled(document);
  assert.match(n(document.preamble), /Индивидуальный предприниматель Петров Пётр Петрович, ИНН 500100732259, ОГРНИП 304500116000157 \(далее — «Заказчик»\)/);
  assert.doesNotMatch(n(document.preamble), /действует представитель/);
  assert.ok(!document.requisites.buyer.some((row) => row.label.includes("КПП")));
  assert.ok(document.requisites.buyer.some((row) => row.label === "ОГРНИП"));
  assert.equal(document.signatures.buyer.post, "Индивидуальный предприниматель");
  assert.equal(n(document.signatures.buyer.nameShort), "Петров П. П.");
  // Адреса и почты нет — линия для ручного заполнения.
  assert.ok(document.requisites.buyer.some((row) => row.label === "Адрес" && row.value === BLANK));
});

test("sole trader with a representative by power of attorney", () => {
  const document = buildContractDocument({
    ...INDIVIDUAL,
    params: { signerName: "Сидорова Мария Ивановна", signerPost: null, signerBasis: "доверенности № 7 от 01.10.2026", useFacsimile: false },
  });
  assert.match(n(document.preamble), /от имени которого на основании доверенности № 7 от 01\.10\.2026 действует представитель Сидорова Мария Ивановна/);
  assert.equal(document.signatures.buyer.post, "Представитель по доверенности");
});

test("sole trader without registry snapshot: never the in-app cafe name as the party", () => {
  const bare = { ...INDIVIDUAL, buyer: { ...INDIVIDUAL.buyer, nameFull: "Кафе у дома", nameShort: "Кафе у дома", ogrn: null } };
  const unknown = buildContractDocument(bare);
  assertNoHoles(n(contractPlainText(unknown)));
  assert.ok(!contractPlainText(unknown).includes("Кафе у дома"));
  assert.match(n(unknown.requisites.buyer[0].value), /^Индивидуальный предприниматель _{6,}$/);
  assert.equal(unknown.signatures.buyer.caption, "Индивидуальный предприниматель");
  const typed = buildContractDocument({ ...bare, params: { ...bare.params, signerName: "Петров Пётр Петрович" } });
  assert.equal(typed.requisites.buyer[0].value, "Индивидуальный предприниматель Петров Пётр Петрович");
  assert.equal(n(typed.parties.buyer), "ИП Петров П. П.");
  assert.equal(n(buyerDisplayName(bare.buyer, { ...bare.params, signerName: "Петров Пётр Петрович" })), "ИП Петров П. П.");
});

test("missing client data becomes blank lines, never empty or null", () => {
  const document = buildContractDocument({
    ...LEGAL,
    buyer: { ...LEGAL.buyer, kpp: null, ogrn: null, legalAddress: null, phone: null, email: null },
    params: { signerName: null, signerPost: null, signerBasis: null, useFacsimile: false },
  });
  const text = n(contractPlainText(document));
  assertNoHoles(text);
  assert.match(n(document.preamble), /на основании _{6,} действует _{6,} _{6,}/);
  assert.ok(document.requisites.buyer.every((row) => row.value.trim().length > 0));
});

test("draft number is marked as draft", () => {
  const document = buildContractDocument({ ...LEGAL, number: draftContractNumber(2026) });
  assert.equal(document.draft, true);
  assert.equal(document.number, "WS-2026/____");
});

test("every clause and section reference points to an existing clause", () => {
  const document = buildContractDocument(LEGAL);
  const clauses = new Set(document.sections.flatMap((section) => section.blocks.filter((block) => block.kind === "clause").map((block) => block.num.replace(/\.$/, ""))));
  const sections = new Set(document.sections.map((section) => String(section.num)));
  const text = n(contractPlainText(document));
  const clauseRefs = [...text.matchAll(/п\. (\d+\.\d+)/g)].map((match) => match[1]);
  const sectionRefs = [...text.matchAll(/разд\. (\d+)/g)].map((match) => match[1]);
  assert.ok(clauseRefs.length > 10, "references are present");
  for (const ref of clauseRefs) assert.ok(clauses.has(ref), `п. ${ref} exists`);
  for (const ref of sectionRefs) assert.ok(sections.has(ref), `разд. ${ref} exists`);
  assert.equal(document.sections.length, 16);
  assert.equal(document.sections[15].title, "Адреса, реквизиты и подписи сторон");
});

test("contract numbers: WS-YYYY/NNNN, parse round trip, file names", () => {
  assert.equal(formatContractNumber(2026, 1), "WS-2026/0001");
  assert.equal(formatContractNumber(2026, 42), "WS-2026/0042");
  assert.equal(formatContractNumber(2027, 12345), "WS-2027/12345");
  assert.deepEqual(parseContractNumber("WS-2026/0042"), { year: 2026, seq: 42 });
  assert.equal(parseContractNumber("WS-2026/____"), null);
  assert.throws(() => formatContractNumber(2026, 0));
  assert.throws(() => formatContractNumber(26, 1));
  assert.deepEqual(contractFileName("WS-2026/0001", "pdf"), { ascii: "Contract-WS-2026-0001.pdf", utf8: "Договор-WS-2026-0001.pdf" });
});

test("recipient suggestions skip technical and invalid emails, dedupe, keep order", () => {
  const list = contractRecipientSuggestions({
    ownerEmail: "79991234567@cmf123.staff.local",
    ownerContactEmail: "Owner@Romashka.example",
    accountantEmail: "buh@romashka.example",
    legalProfileJson: { inn: "7707083893", emails: ["owner@romashka.example", "info@romashka.example", "not-an-email", 42] },
  });
  assert.deepEqual(list, [
    { email: "owner@romashka.example", source: "ownerContact" },
    { email: "buh@romashka.example", source: "accountant" },
    { email: "info@romashka.example", source: "registry" },
  ]);
  assert.deepEqual(contractRecipientSuggestions({ ownerEmail: "staff-abc@org1.local.haccp" }), []);
  assert.deepEqual(contractRecipientSuggestions({ ownerEmail: "boss@cafe.example" }), [{ email: "boss@cafe.example", source: "owner" }]);
  const cleaned = cleanRecipientList(["A@b.example", "a@b.example", "x@y.staff.local", "broken"]);
  assert.deepEqual(cleaned.valid, ["a@b.example"]);
  assert.deepEqual(cleaned.rejected, ["x@y.staff.local", "broken"]);
});

test("buyer snapshot from organization: registry data, overrides, ИП detection", () => {
  const org = {
    name: "Кафе у дома",
    inn: "7707083893",
    legalProfileJson: {
      inn: "7707083893",
      type: "LEGAL",
      nameFull: "Общество с ограниченной ответственностью «Ромашка»",
      nameShort: "ООО «Ромашка»",
      kpp: "773601001",
      ogrn: "1027700132195",
      address: "117997, г Москва, ул Вавилова, д 19",
      management: { name: "ИВАНОВА АННА СЕРГЕЕВНА", post: "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР" },
      emails: [],
    },
    directorPost: "Директор",
  };
  const buyer = buyerFromOrganization(org, "buh@romashka.example");
  assert.equal(buyer.kind, "legal");
  assert.equal(buyer.nameFull, "Общество с ограниченной ответственностью «Ромашка»");
  assert.equal(buyer.kpp, "773601001");
  assert.equal(buyer.email, "buh@romashka.example");
  const params = defaultContractParams(org, buyer);
  assert.equal(params.signerName, "Иванова Анна Сергеевна");
  assert.equal(params.signerPost, "директор", "override from «Реквизиты» wins over registry, written mid-sentence");
  assert.equal(defaultContractParams({ ...org, directorPost: null }, buyer).signerPost, "генеральный директор", "registry caps normalized");
  assert.equal(params.signerBasis, "Устава");
  const items = buyerChecklist(buyer, params, true);
  assert.ok(items.every((item) => item.ok), JSON.stringify(items.filter((item) => !item.ok)));

  // Снимок ЕГРЮЛ другого ИНН не подмешивается.
  const stale = buyerFromOrganization({ ...org, inn: "500100732259" }, null);
  assert.equal(stale.kind, "individual");
  assert.equal(stale.kpp, null);
  assert.equal(stale.nameFull, "Кафе у дома");
  assert.equal(buyerKind({ inn: "500100732259", legalProfileJson: null }), "individual");
  const noInn = buyerChecklist({ ...buyer, inn: null }, params, false);
  assert.equal(noInn.find((item) => item.key === "inn")?.ok, false);
  assert.equal(noInn.find((item) => item.key === "inn")?.required, true);
});

test("seller checklist requires bank and head, facsimile is optional", () => {
  const items = sellerChecklist({ ...SELLER, bank: { ...SELLER.bank, account: "123" } }, { facsimile: false, stamp: false });
  assert.equal(items.find((item) => item.key === "bank")?.ok, false);
  assert.equal(items.find((item) => item.key === "facsimile")?.required, false);
  assert.ok(sellerChecklist(SELLER, { facsimile: false, stamp: false }).filter((item) => item.required).every((item) => item.ok));
});

test("name, post and date formatting helpers", () => {
  assert.equal(personName("ПЕТРОВ-ВОДКИН КУЗЬМА СЕРГЕЕВИЧ"), "Петров-Водкин Кузьма Сергеевич");
  assert.equal(personName("Иванов Иван"), "Иванов Иван");
  assert.equal(n(shortPersonName("Волков Денис Владимирович") ?? ""), "Волков Д. В.");
  assert.equal(postInSentence("ГЕНЕРАЛЬНЫЙ ДИРЕКТОР"), "генеральный директор");
  assert.equal(postInSentence("Директор ООО"), "директор ООО");
  assert.equal(postAsTitle("генеральный директор"), "Генеральный директор");
  assert.equal(n(contractDateLong("2026-03-05")), "«05» марта 2026 г.");
  assert.match(contractDateLong("2026-02-30"), /«____»/);
});

async function pdfText(bytes: Buffer): Promise<{ pages: number; text: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const pdf = await task.promise;
    const parts: string[] = [];
    for (let page = 1; page <= pdf.numPages; page += 1) {
      const content = await (await pdf.getPage(page)).getTextContent();
      for (const item of content.items) if ("str" in item) parts.push(item.str);
    }
    return { pages: pdf.numPages, text: parts.join(" ").replace(/\s+/g, " ") };
  } finally {
    await task.destroy();
  }
}

test("PDF: several pages, both INNs, page numbers, voided mark", async () => {
  const { bytes, pages } = renderContractPdf(buildContractDocument(LEGAL), SELLER, { facsimile: null, stamp: null });
  assert.ok(pages > 1, `pages: ${pages}`);
  const { pages: parsed, text } = await pdfText(bytes);
  assert.equal(parsed, pages);
  assert.ok(text.includes("5018215599"), "seller INN");
  assert.ok(text.includes("7707083893"), "client INN");
  assert.ok(text.includes(`из ${pages}`), "page numbers");
  assert.ok(text.includes("WS-2026/0001"));

  const voided = renderContractPdf({ ...buildContractDocument(LEGAL), voided: true }, SELLER, { facsimile: null, stamp: null });
  assert.ok((await pdfText(voided.bytes)).text.includes("АННУЛИРОВАН"));

  const individual = renderContractPdf(buildContractDocument(INDIVIDUAL), SELLER, { facsimile: null, stamp: null });
  const ipText = (await pdfText(individual.bytes)).text;
  assert.ok(ipText.includes("500100732259"));
  assert.ok(ipText.includes("ОГРНИП"));
});
