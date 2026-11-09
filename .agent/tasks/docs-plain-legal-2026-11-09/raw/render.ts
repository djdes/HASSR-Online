/**
 * Образцы договора, счёта и КП без базы — для проверки глазами.
 * npx tsx .agent/tasks/docs-plain-legal-2026-11-09/raw/render.ts [out-dir]
 */
import fs from "node:fs";
import path from "node:path";

import { brandSeller } from "@/lib/brand-docs/pdf-kit";
import { buildSellerSnapshot } from "@/lib/closing-documents/build";
import { EMPTY_REQUISITES } from "@/lib/closing-documents/types";
import { renderContractPdf } from "@/lib/contracts/pdf";
import { sellerFromRequisites } from "@/lib/contracts/snapshot";
import { buildContractDocument, contractPlainText, CONTRACT_TEMPLATE_VERSION } from "@/lib/contracts/template";
import { buildInvoiceDraft } from "@/lib/invoices/build";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { buildProposalContent } from "@/lib/proposal/content";
import { renderProposalPdfDocument } from "@/lib/proposal/pdf";
import { sampleProposalContext } from "@/lib/proposal/sample";

const out = process.argv[2] ?? path.join(process.cwd(), ".agent/tasks/docs-plain-legal-2026-11-09/raw/out");
fs.mkdirSync(out, { recursive: true });

const requisites = {
  ...EMPTY_REQUISITES,
  nameFull: "Общество с ограниченной ответственностью «БФС»",
  nameShort: "ООО «БФС»",
  inn: "5018215599",
  kpp: "501801001",
  ogrn: "1235000105306",
  address: "141079, Московская область, г. Королёв, ул. Ленина, д. 10/6, ком. 80",
  bank: { name: "АО «ТЕСТОВЫЙ БАНК», г. Москва", bik: "044500000", account: "40702810000000000001", corrAccount: "30101810000000000001" },
  head: { post: "Генеральный директор", name: "Волков Денис Владимирович" },
  email: "admin@wesetup.ru",
  phone: "+74951096543",
};

const seller = sellerFromRequisites(requisites);
const contract = buildContractDocument({
  number: "WS-2026/0007",
  date: "2026-11-09",
  city: "Королёв",
  templateVersion: CONTRACT_TEMPLATE_VERSION,
  seller,
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
  params: { signerName: "Иванова Анна Сергеевна", signerPost: "генеральный директор", signerBasis: "Устава", useFacsimile: false },
});
const contractPdf = renderContractPdf(contract, seller, { facsimile: null, stamp: null });
fs.writeFileSync(path.join(out, "contract.pdf"), contractPdf.bytes);
fs.writeFileSync(path.join(out, "contract.txt"), contractPlainText(contract));

const draft = buildInvoiceDraft({
  order: { id: 1287, createdAt: new Date("2026-11-09T09:00:00Z"), amountRub: 23880, bundleConfig: null },
  tariff: { title: "Стандарт, 1 точка", periodDays: 365, priceRub: 23880 },
  seller: buildSellerSnapshot(requisites),
  buyer: { name: "ООО «Ромашка»", inn: "7707083893", kpp: "773601001", ogrn: null, address: "117997, г. Москва, ул. Вавилова, д. 19", head: null },
});
draft.basis = "Договор № WS-2026/0007 от 09.11.2026";
fs.writeFileSync(path.join(out, "invoice.pdf"), renderInvoicePdf(draft, { facsimile: null, stamp: null }, { brand: brandSeller(requisites) }));

for (const plan of ["standard", "premium"] as const) {
  const content = buildProposalContent(
    { sphere: "restaurant", companyName: "ООО «Ромашка»", addressee: "Генеральному директору Ивановой Анне Сергеевне", recipientName: "Анна Сергеевна", plan },
    sampleProposalContext({ requisites, now: new Date("2026-11-09T09:00:00Z") }),
  );
  const kp = renderProposalPdfDocument(content);
  fs.writeFileSync(path.join(out, `kp-${plan}.pdf`), kp.buffer);
  console.log(`kp ${plan}: pages ${kp.pages}, scale ${kp.scale}`);
}
console.log(`contract pages ${contractPdf.pages}`);
