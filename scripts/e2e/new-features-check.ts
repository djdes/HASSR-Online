/*
 * Смоук новинок 21.11.2026 на настоящей базе (DB level, без браузера): подсказки журнала приёмки
 * (Меркурий, iiko), загрузка Poster настоящей серверной функцией `syncSupplyConnection` — с
 * подменённым Poster, но с настоящими записями во «Входящие», «Потери» и справочник, блюда в
 * подсказках бракеража, подпись УКЭП настоящего PDF документа журнала (openssl cms) с разбором,
 * проверкой и записью в `JournalDocumentSignature`. Строит свою организацию и удаляет её.
 *
 *   npx tsx scripts/e2e/new-features-check.ts
 */
import "./env";

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Ключ шифрования подключений: в CI его нет — берём одноразовый (до первого шифрования).
process.env.INTEGRATION_KEY_SECRET ||= "e2e-new-features-integration-key-0123456789abcdef";

import { loadAcceptanceSources } from "@/lib/acceptance-sources.server";
import { checkSignatureForPdf, parseCmsSignature } from "@/lib/cms-signature";
import { db } from "@/lib/db";
import { generateJournalDocumentPdf } from "@/lib/document-pdf";
import { DEFAULT_OFF_JOURNAL_CODES } from "@/lib/health-check-default-off";
import { encryptSecret } from "@/lib/integration-crypto";
import { defaultJournalAutomationJson } from "@/lib/journal-automation";
import { listNameSuggestions } from "@/lib/name-suggestions-db";
import { syncSupplyConnection } from "@/lib/supply/sync.server";

const TAG = `nfchk${Date.now().toString(36)}`;
const orgIds: string[] = [];
let failed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

/** Ответы Poster — по примерам документации (`.agent/tasks/pos-menu-poster-2026-11-21/raw/poster-docs/`). */
const POSTER: Record<string, unknown> = {
  "storage.getSuppliers": { response: [{ supplier_id: "1", supplier_name: "ООО «Овощебаза»", supplier_tin: "7701234567", delete: "0" }] },
  "storage.getSupplies": {
    response: [
      { supply_id: "47", storage_id: "1", supplier_id: "1", date: "2026-11-19 09:11:00", supplier_name: "ООО «Овощебаза»", delete: "0" },
      { supply_id: "48", storage_id: "1", supplier_id: "1", date: "2026-11-20 08:09:33", supplier_name: "ООО «Овощебаза»", delete: "1" },
    ],
  },
  "storage.getSupplyIngredients": {
    response: [
      { ingredient_id: "66", supply_ingredient_num: "3.00000", supply_ingredient_sum: "15000", ingredient_name: "Рыба", ingredient_unit: "kg" },
      { ingredient_id: "76", supply_ingredient_num: "30.00000", supply_ingredient_sum: "390", ingredient_name: "Яйца", ingredient_unit: "p" },
    ],
  },
  "storage.getWastes": { response: [{ waste_id: 1, storage_id: 1, date: "2026-11-19 14:30:02", reason_name: "Истёк срок годности", delete: 0 }] },
  "storage.getWaste": {
    response: {
      waste_id: 1,
      storage_id: 1,
      date: "2026-11-19 14:30:02",
      reason_name: "Истёк срок годности",
      elements: [
        { type: 2, product_id: 30, count: 2, ingredients: [{ ingredient_id: 16, weight: 0.3, unit: "kg", cost: 500 }] },
        { type: 10, product_id: 0, count: 1, ingredients: [{ ingredient_id: 73, weight: 1.5, unit: "kg", cost: 800 }] },
      ],
    },
  },
  "menu.getProducts": {
    response: [
      { product_id: "30", product_name: "Борщ", type: "2", unit: "", hidden: "0" },
      { product_id: "167", product_name: "Куриный бульон", type: "1", unit: "kg", hidden: "0" },
    ],
  },
  "menu.getIngredients": {
    response: [
      { ingredient_id: "73", ingredient_name: "Авокадо", ingredient_unit: "kg" },
      { ingredient_id: "16", ingredient_name: "Свёкла", ingredient_unit: "kg" },
    ],
  },
};

const posterFetch = async (url: string) => {
  const method = new URL(url).pathname.split("/").pop() ?? "";
  const body = POSTER[method] ?? { error: { code: 42, message: "The variable does not exist" } };
  return new Response(JSON.stringify(body), { status: 200 });
};

async function makeOrg() {
  // Как при регистрации: тариф «free» с пробным периодом (Меркурий в нём есть).
  const org = await db.organization.create({
    data: {
      name: `Смоук новинок ${TAG}`,
      type: "restaurant",
      subscriptionPlan: "free",
      journalAutomationJson: defaultJournalAutomationJson(),
      disabledJournalCodes: [...DEFAULT_OFF_JOURNAL_CODES],
    },
  });
  orgIds.push(org.id);
  return org;
}

async function acceptanceSources(organizationId: string) {
  check("журнал приёмки: без Меркурия и iiko подсказок нет", JSON.stringify(await loadAcceptanceSources({ organizationId, buildingId: null, canManage: true })) === JSON.stringify({ mercury: null, iikoConnected: false }));
  check("журнал приёмки: не руководителю — ничего", (await loadAcceptanceSources({ organizationId, buildingId: null, canManage: false })) === null);

  const integration = await db.mercuryIntegration.create({
    data: { organizationId, issuerGuid: `issuer-${TAG}`, initiatorLogin: "smoke", enabled: true },
  });
  const now = Date.now();
  const vsd = (n: number, localStatus: string, dueOffsetMs: number) => ({
    integrationId: integration.id,
    organizationId,
    uuid: `${TAG}-${n}`,
    remoteStatus: "CONFIRMED",
    localStatus,
    processingDueAt: new Date(now + dueOffsetMs),
    productName: `Говядина ${n}`,
    raw: {},
    lastSyncedAt: new Date(now),
  });
  await db.mercuryVetDocument.createMany({
    data: [vsd(1, "new", -3_600_000), vsd(2, "acknowledged", 3_600_000), vsd(3, "processed", -3_600_000), vsd(4, "irrelevant", -3_600_000)],
  });
  const sources = await loadAcceptanceSources({ organizationId, buildingId: null, canManage: true });
  check("журнал приёмки: Меркурий в пробном — ждут 2, просрочено 1", sources?.mercury?.pending === 2 && sources.mercury.overdue === 1, sources);
}

async function poster(organizationId: string) {
  const connection = await db.supplyConnection.create({
    data: {
      organizationId,
      provider: "poster",
      credentialsEnc: encryptSecret(JSON.stringify({ token: "687409:4164553abf6a031302898da7800b59fb", options: { invoices: true, writeoffs: true, products: true } })),
      status: "active",
    },
  });
  const now = new Date();
  const first = await syncSupplyConnection(connection.id, { fetch: posterFetch, now });
  check("Poster: загрузка прошла", first?.ok === true, first);
  const doc = await db.supplyDocument.findFirst({ where: { organizationId, source: "poster" }, select: { externalId: true, number: true } });
  check("Poster: поставка → «Входящие накладные», удалённая — нет", doc?.externalId === "47" && (await db.supplyDocument.count({ where: { organizationId, source: "poster" } })) === 1, doc);
  const losses = await db.lossRecord.findMany({ where: { organizationId, sourceEntryId: { startsWith: "poster:" } }, orderBy: { sourceEntryId: "asc" }, select: { productName: true, quantity: true } });
  check("Poster: списание → «Потери» (блюдо и ингредиент)", losses.length === 2 && losses[0].productName === "Борщ" && losses[1].productName === "Авокадо", losses);
  const kinds = Object.fromEntries(
    (await db.product.findMany({ where: { organizationId }, select: { name: true, kind: true } })).map((product) => [product.name, product.kind]),
  );
  check("Poster: справочник с видами — блюдо, полуфабрикат, сырьё", kinds["Борщ"] === "finished" && kinds["Куриный бульон"] === "semi" && kinds["Свёкла"] === "raw", kinds);

  const second = await syncSupplyConnection(connection.id, { fetch: posterFetch, now: new Date(now.getTime() + 60_000) });
  check(
    "Poster: повтор — без дублей",
    second?.ok === true && second.created === 0 && (second.losses ?? 0) === 0 &&
      (await db.supplyDocument.count({ where: { organizationId, source: "poster" } })) === 1 &&
      (await db.lossRecord.count({ where: { organizationId, sourceEntryId: { startsWith: "poster:" } } })) === 2,
    second,
  );
  const stored = await db.supplyConnection.findUnique({ where: { id: connection.id }, select: { status: true, lastError: true, credentialsEnc: true } });
  check("Poster: токен хранится зашифрованным", Boolean(stored?.credentialsEnc) && !stored!.credentialsEnc.includes("4164553abf6a031302898da7800b59fb") && stored!.status === "active");

  const dishes = await listNameSuggestions(organizationId, "dish");
  check("бракераж: блюдо из Poster в подсказках", dishes.values.includes("Борщ"), dishes.values.slice(0, 10));
}

async function ukep(organizationId: string) {
  const template = await db.journalTemplate.findFirst({ where: { code: "incoming_control" }, select: { id: true } });
  if (!template) {
    check("УКЭП: шаблон журнала приёмки засеян", false);
    return;
  }
  const document = await db.journalDocument.create({
    data: {
      organizationId,
      templateId: template.id,
      title: "Журнал приёмки — смоук",
      dateFrom: new Date("2026-11-01T00:00:00Z"),
      dateTo: new Date("2026-11-30T00:00:00Z"),
      status: "active",
      config: {},
    },
  });
  const { buffer, fileName } = await generateJournalDocumentPdf({ documentId: document.id, organizationId, locale: "ru" });
  const pdf = new Uint8Array(buffer);
  check("УКЭП: PDF документа журнала собирается", pdf.length > 1000 && Buffer.from(pdf.subarray(0, 5)).toString() === "%PDF-", { size: pdf.length, fileName });

  const dir = mkdtempSync(path.join(tmpdir(), "ukep-smoke-"));
  try {
    writeFileSync(path.join(dir, "doc.pdf"), pdf);
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"), "-days", "2", "-utf8", "-subj", "/O=ООО Смоук/title=Управляющий/SN=Смоуков/GN=Тест Тестович/CN=Смоуков Тест Тестович"], { stdio: "ignore" });
    execFileSync("openssl", ["cms", "-sign", "-binary", "-in", path.join(dir, "doc.pdf"), "-signer", path.join(dir, "cert.pem"), "-inkey", path.join(dir, "key.pem"), "-outform", "DER", "-out", path.join(dir, "doc.sig"), "-md", "sha256"], { stdio: "ignore" });
    const signatureBytes = new Uint8Array(readFileSync(path.join(dir, "doc.sig")));
    const parsed = parseCmsSignature(signatureBytes);
    const result = checkSignatureForPdf(parsed, pdf, new Date());
    check("УКЭП: подпись настоящего PDF принята, хэш сверен", result.ok && result.digestChecked, result);
    check("УКЭП: подписант — из сертификата", parsed.signer.subjectName === "Смоуков Тест Тестович" && parsed.signer.organization === "ООО Смоук", parsed.signer);
    const otherPdf = new TextEncoder().encode("%PDF-1.4 другой документ");
    check("УКЭП: чужой PDF — отказ", !checkSignatureForPdf(parsed, otherPdf, new Date()).ok);

    const saved = await db.journalDocumentSignature.create({
      data: {
        organizationId,
        documentId: document.id,
        userId: "smoke",
        fileName,
        pdf,
        pdfSha256: "smoke",
        signature: signatureBytes,
        digest: parsed.digest,
        digestChecked: true,
        signerName: parsed.signer.subjectName,
      },
      select: { id: true },
    });
    const back = await db.journalDocumentSignature.findUnique({ where: { id: saved.id }, select: { pdf: true, signature: true } });
    check(
      "УКЭП: PDF и подпись в базе — байт в байт",
      Boolean(back) && Buffer.compare(Buffer.from(back!.pdf), Buffer.from(pdf)) === 0 && Buffer.compare(Buffer.from(back!.signature), Buffer.from(signatureBytes)) === 0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function cleanup() {
  for (const id of orgIds) await db.organization.delete({ where: { id } }).catch((error) => console.error("cleanup", id, error));
}

async function main() {
  const org = await makeOrg();
  await acceptanceSources(org.id);
  await poster(org.id);
  await ukep(org.id);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL crash", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(failed === 0 ? "RESULT: all checks passed" : `RESULT: ${failed} check(s) failed`);
    await db.$disconnect().catch(() => undefined);
    process.exit(failed === 0 ? 0 : 1);
  });
