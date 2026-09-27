import assert from "node:assert/strict";
import test from "node:test";

process.env.EQUIPMENT_QR_TOKEN_SECRET = "test-secret-for-journal-pdf-qr-0123456789";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { verifyJournalFillToken } from "@/lib/journal-fill";
import {
  journalDocumentPdfQr,
  journalSamplePdfQr,
  journalShortQrUrl,
  resolveJournalShortQr,
} from "@/lib/journal-pdf-qr-link";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { JOURNAL_QR_MAX_MODULES, journalQrMatrix } from "@/lib/pdf-journal-qr";
import { journalShortSig, verifyJournalShortSig } from "@/lib/qr-fill-token";

const ORG = "cmf1abcdefghijklmnopqrstu";

test("короткий адрес журнала: /qj/<org>/<code>/<подпись 12 символов>", () => {
  const url = journalShortQrUrl("https://wesetup.ru/", ORG, "hygiene");
  assert.match(url, /^https:\/\/wesetup\.ru\/qj\/cmf1abcdefghijklmnopqrstu\/hygiene\/[\w-]{12}$/);
  assert.equal(url, journalShortQrUrl("https://wesetup.ru", ORG, "hygiene"), "детерминирован");
});

test("переадресация: верная подпись → основной QR журнала с рабочим токеном", () => {
  const sig = journalShortSig(ORG, "cold_equipment_control");
  const target = resolveJournalShortQr(ORG, "cold_equipment_control", sig);
  assert.ok(target);
  assert.match(target, new RegExp(`^/journal-fill/${ORG}/cold_equipment_control\\?token=`));
  const token = decodeURIComponent(new URL(target, "https://wesetup.ru").searchParams.get("token") ?? "");
  const check = verifyJournalFillToken(token, ORG, "cold_equipment_control");
  assert.equal(check.ok, true);
  if (check.ok) {
    // Основной QR журнала: без документа и точки, не хаб.
    assert.equal(check.documentId, null);
    assert.equal(check.hub, false);
  }
});

test("переадресация: неверная подпись, чужой журнал или организация → null", () => {
  const sig = journalShortSig(ORG, "hygiene");
  assert.equal(resolveJournalShortQr(ORG, "health_check", sig), null, "подпись от другого журнала");
  assert.equal(resolveJournalShortQr("cmfOTHERorg00000000000000", "hygiene", sig), null, "чужая организация");
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.equal(resolveJournalShortQr(ORG, "hygiene", flipped), null, "изменённая подпись");
  assert.equal(resolveJournalShortQr(ORG, "hygiene", sig.slice(0, 11)), null, "короче");
  assert.equal(resolveJournalShortQr(ORG, "hygiene", `${sig}x`), null, "длиннее");
  assert.equal(resolveJournalShortQr("../x", "hygiene", sig), null, "мусор в id");
  assert.equal(verifyJournalShortSig(ORG, "hygiene", sig), true);
});

test("QR документа — короткий адрес, влезает в шапку (коррекция H, ≤ 53 модулей); подписи сбоку нет", () => {
  const qr = journalDocumentPdfQr("https://wesetup.ru", ORG, "cleaning_ventilation_checklist");
  assert.ok(qr.url.includes("/qj/"));
  assert.equal(qr.footer, undefined, "подпись — в полосе самого QR");
  assert.ok(journalQrMatrix(qr.url).modules.size <= JOURNAL_QR_MAX_MODULES);
});

test("QR образца бланка → /journals-info/<code>, без токенов", () => {
  const qr = journalSamplePdfQr("https://wesetup.ru", "hygiene");
  assert.equal(qr.url, "https://wesetup.ru/journals-info/hygiene");
  assert.equal(qr.footer, undefined);
});

test("печать журнала: с qr — QR в шапке каждой страницы; без qr — как раньше", () => {
  const input = buildJournalSampleInput("hygiene");
  const withQr = renderJournalDocumentPdf({ ...input, qr: journalSamplePdfQr("https://wesetup.ru", "hygiene") });
  assert.ok(withQr.qrPlacements && withQr.qrPlacements.length > 0);
  const pages = new Set(withQr.qrPlacements.map((p) => p.page));
  assert.equal(pages.size, withQr.qrPlacements.length);
  assert.ok(withQr.qrPlacements.every((p) => p.where === "header"));

  const plain = renderJournalDocumentPdf(input);
  assert.equal(plain.qrPlacements, undefined);
  assert.equal(plain.fileName, withQr.fileName);
});
