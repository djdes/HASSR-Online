import assert from "node:assert/strict";
import test from "node:test";

process.env.EQUIPMENT_QR_TOKEN_SECRET = "test-secret-for-journal-pdf-qr-0123456789";

import { verifyJournalFillToken } from "@/lib/journal-fill";
import {
  isJournalPointShortQr,
  journalDocumentPdfQr,
  journalPointShortQrUrl,
  resolveJournalPointShortQr,
  resolveJournalShortQr,
} from "@/lib/journal-pdf-qr-link";
import { JOURNAL_QR_MAX_MODULES, journalQrMatrix } from "@/lib/pdf-journal-qr";
import { journalPointShortSig, journalShortSig } from "@/lib/qr-fill-token";

/**
 * QR в шапке бланка документа точки (аудит 2026-11-01): скан открывал выбор
 * документов всех точек с их людьми. Теперь QR документа точки — QR этой
 * точки, той же длины, что и QR организации.
 */
const ORG = "cmf1abcdefghijklmnopqrstu";
const POINT = "cmf1pointaaaaaaaaaaaaaaaa";

test("бланк документа точки — короткий QR точки, влезает в шапку", () => {
  const qr = journalDocumentPdfQr("https://wesetup.ru", ORG, "cleaning_ventilation_checklist", POINT);
  assert.equal(qr.url, journalPointShortQrUrl("https://wesetup.ru", POINT, "cleaning_ventilation_checklist"));
  assert.match(qr.url, new RegExp(`/qj/${POINT}/cleaning_ventilation_checklist/[\\w-]{12}$`));
  assert.ok(journalQrMatrix(qr.url).modules.size <= JOURNAL_QR_MAX_MODULES);
});

test("общий документ — QR журнала организации, как раньше", () => {
  const qr = journalDocumentPdfQr("https://wesetup.ru", ORG, "hygiene", null);
  assert.match(qr.url, new RegExp(`/qj/${ORG}/hygiene/[\\w-]{12}$`));
});

test("подпись точки не подходит как подпись организации и наоборот", () => {
  const pointSig = journalPointShortSig(POINT, "hygiene");
  assert.equal(resolveJournalShortQr(POINT, "hygiene", pointSig), null, "QR точки не открывает «организацию» с её id");
  assert.equal(isJournalPointShortQr(POINT, "hygiene", pointSig), true);
  assert.equal(isJournalPointShortQr(ORG, "hygiene", journalShortSig(ORG, "hygiene")), false, "QR организации — не QR точки");
  assert.equal(isJournalPointShortQr(POINT, "health_check", pointSig), false, "другой журнал");
});

test("QR точки ведёт в журнал этой точки (токен с точкой, без документа)", () => {
  const target = resolveJournalPointShortQr(ORG, POINT, "hygiene");
  assert.match(target, new RegExp(`^/journal-fill/${ORG}/hygiene\\?token=`));
  const token = decodeURIComponent(new URL(target, "https://wesetup.ru").searchParams.get("token") ?? "");
  const check = verifyJournalFillToken(token, ORG, "hygiene");
  assert.equal(check.ok, true);
  if (check.ok) {
    assert.equal(check.buildingId, POINT);
    assert.equal(check.documentId, null);
  }
});
