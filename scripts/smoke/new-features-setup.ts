/*
 * Данные для смоука новинок в браузере (scripts/smoke/new-features.smoke.cjs): организация как
 * после регистрации, руководитель с известным паролем, журнал приёмки, ВСД в Меркурии (две ждут,
 * одна оформлена — с партией для истории партии), подключения iiko и Poster, блюдо в справочнике.
 * Только локальная база (тот же запрет, что у scripts/e2e/env.ts). Печатает JSON для смоука.
 *
 *   npx tsx scripts/smoke/new-features-setup.ts            # создать
 *   npx tsx scripts/smoke/new-features-setup.ts --cleanup  # удалить прошлые организации смоука
 */
import "../e2e/env";

import bcrypt from "bcryptjs";

process.env.INTEGRATION_KEY_SECRET ||= "smoke-integration-key-0123456789abcdef0123456789abcdef";

import { db } from "@/lib/db";
import { DEFAULT_OFF_JOURNAL_CODES } from "@/lib/health-check-default-off";
import { encryptSecret } from "@/lib/integration-crypto";
import { defaultJournalAutomationJson } from "@/lib/journal-automation";
import { LEGAL_VERSION } from "@/lib/legal-consent";

const ORG_PREFIX = "Смоук-кафе";
const PASSWORD = "smoke-pass-2026";

async function cleanup() {
  const orgs = await db.organization.findMany({ where: { name: { startsWith: ORG_PREFIX } }, select: { id: true } });
  for (const org of orgs) {
    await db.user.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } }).catch((error) => console.error("cleanup", org.id, error));
  }
  return orgs.length;
}

async function main() {
  const removed = await cleanup();
  if (process.argv.includes("--cleanup")) {
    console.log(JSON.stringify({ removed }));
    return;
  }
  const stamp = Date.now().toString(36);
  const org = await db.organization.create({
    data: {
      name: `${ORG_PREFIX} ${stamp}`,
      type: "restaurant",
      subscriptionPlan: "free",
      journalAutomationJson: defaultJournalAutomationJson(),
      disabledJournalCodes: [...DEFAULT_OFF_JOURNAL_CODES],
    },
  });
  const email = `smoke-${stamp}@example.test`;
  await db.user.create({
    data: {
      email,
      name: "Смоук Руководитель",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "manager",
      organizationId: org.id,
      journalAccessMigrated: true,
      emailVerifiedAt: new Date(),
      // Условия уже приняты — окно «Мы обновили условия» не перекрывает экраны смоука.
      legalVersion: LEGAL_VERSION,
    },
  });

  const template = await db.journalTemplate.findFirst({ where: { code: "incoming_control" }, select: { id: true } });
  if (!template) throw new Error("Нет шаблона incoming_control — запустите prisma/seed.ts");
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const document = await db.journalDocument.create({
    data: { organizationId: org.id, templateId: template.id, title: "Журнал приёмки", dateFrom: monthStart, dateTo: monthEnd, status: "active", config: {} },
  });

  const integration = await db.mercuryIntegration.create({
    data: { organizationId: org.id, issuerGuid: `issuer-${stamp}`, initiatorLogin: "smoke", enabled: true },
  });
  const batchKey = `B-${stamp.toUpperCase()}`;
  const batch = await db.batch.create({
    data: {
      organizationId: org.id,
      code: batchKey,
      productName: "Говядина охлаждённая",
      supplier: "ООО «Мясной двор»",
      quantity: 12.5,
      unit: "kg",
      receivedAt: new Date(now.getTime() - 86_400_000),
      status: "received",
    },
  });
  const vsd = (n: number, localStatus: string, dueOffsetMs: number, extra: Record<string, unknown> = {}) => ({
    integrationId: integration.id,
    organizationId: org.id,
    uuid: `smoke-${stamp}-${n}`,
    number: `10${n}2026${n}`,
    remoteStatus: "CONFIRMED",
    localStatus,
    deliveryDate: new Date(now.getTime() - 86_400_000),
    processingDueAt: new Date(now.getTime() + dueOffsetMs),
    productName: ["Говядина охлаждённая", "Молоко 3,2%", "Сыр российский"][n - 1],
    volume: [12.5, 40, 6][n - 1],
    unit: ["kg", "l", "kg"][n - 1],
    consignorName: ["ООО «Мясной двор»", "АО «Молочный край»", "ООО «Сыроварня»"][n - 1],
    raw: {},
    lastSyncedAt: now,
    ...extra,
  });
  await db.mercuryVetDocument.createMany({
    data: [
      vsd(1, "processed", -3_600_000, { batchKey, batchId: batch.id, journalDocumentId: document.id, processedAt: now }),
      vsd(2, "new", -3_600_000),
      vsd(3, "acknowledged", 6 * 3_600_000),
    ],
  });

  await db.supplyConnection.create({
    data: {
      organizationId: org.id,
      provider: "iiko",
      credentialsEnc: encryptSecret(JSON.stringify({ serverUrl: "https://smoke.iiko.it", login: "smoke", password: "x", options: { invoices: true, writeoffs: true, products: true } })),
      boxTitle: "https://smoke.iiko.it",
      status: "active",
    },
  });
  await db.supplyConnection.create({
    data: {
      organizationId: org.id,
      provider: "poster",
      credentialsEnc: encryptSecret(JSON.stringify({ token: "687409:4164553abf6a031302898da7800b59fb", options: { invoices: true, writeoffs: true, products: true } })),
      boxTitle: "Poster № 687409",
      status: "active",
      lastSyncAt: now,
    },
  });
  await db.product.create({ data: { organizationId: org.id, name: "Борщ с говядиной", kind: "finished", unit: "pcs" } });

  console.log(JSON.stringify({ email, password: PASSWORD, organizationId: org.id, documentId: document.id, batchKey, batchId: batch.id }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
