/**
 * One-shot: выключаем журнал здоровья (`health_check`) у существующих
 * организаций, которые его фактически не ведут.
 *
 * Решение владельца: журнал здоровья выключен по умолчанию — он дублирует
 * гигиенический (включённый отмечается по тому же QR, см.
 * HEALTH_REGISTER_REMINDER в src/lib/hygiene-document.ts). Новым
 * организациям его выключает код регистрации; здесь — догоняем старые.
 *
 * Кого трогаем: health_check ещё не в `disabledJournalCodes` И журнал не
 * ведут люди. «Ведут» = за последние 30 дней есть реальная запись (не
 * плейсхолдер `{ _autoSeeded: true }` и не `{}`), и при этом либо
 * автозаполнение здоровья выключено (значит, отмечали руками), либо в
 * записях есть «Принятые меры» — их пишут только люди. Записи, которые
 * ставила автоматика (она была включена по умолчанию), за ведение не
 * считаются: они неотличимы от ручных и есть почти у всех.
 * Организации, которые журнал ведут, не трогаем.
 *
 * Что делаем: `applyHealthCheckDefaultOff` — журнал в выключенные,
 * автоматика health_check → autoCreate/autoFill = false, код убирается
 * из легаси-списка `autoJournalCodes`. Документы и записи не удаляются:
 * включить журнал обратно можно в /settings/journals.
 *
 * Однократно: после боевого прогона пишем PlatformSetting
 * `once:health-check-default-off:v1`, следующие деплои выходят сразу —
 * иначе журнал, который организация включила обратно руками, снова
 * выключался бы при каждом деплое.
 *
 * Запуск: npx tsx prisma/seed-disable-health-check.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

import { applyHealthCheckDefaultOff } from "../src/lib/health-check-default-off";
import { parseJournalAutomationJson } from "../src/lib/journal-automation";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ONCE_KEY = "once:health-check-default-off:v1";
const TEMPLATE_CODE = "health_check";
const LOOKBACK_DAYS = 30;
const DRY_RUN = process.argv.includes("--dry-run");

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function main() {
  const tag = DRY_RUN ? "[health-off:dry-run]" : "[health-off]";

  const done = await prisma.platformSetting.findUnique({
    where: { key: ONCE_KEY },
  });
  if (done) {
    console.log(`${tag} уже выполнено (${done.value}) — пропускаем`);
    return;
  }

  const template = await prisma.journalTemplate.findUnique({
    where: { code: TEMPLATE_CODE },
    select: { id: true },
  });

  // Организации с реальными записями за 30 дней — их не трогаем.
  // JournalDocumentEntry.date — день без времени (полночь UTC).
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
  const entriesByOrg = new Map<string, { any: boolean; withMeasures: boolean }>();
  if (template) {
    const rows = await prisma.journalDocumentEntry.findMany({
      where: {
        date: { gte: since },
        document: { templateId: template.id },
        NOT: [
          { data: { equals: { _autoSeeded: true } as Prisma.InputJsonValue } },
          { data: { equals: {} as Prisma.InputJsonValue } },
        ],
      },
      select: { data: true, document: { select: { organizationId: true } } },
    });
    for (const row of rows) {
      const orgId = row.document.organizationId;
      const entries = entriesByOrg.get(orgId) ?? { any: false, withMeasures: false };
      entries.any = true;
      const measures = (row.data as { measures?: unknown } | null)?.measures;
      if (typeof measures === "string" && measures.trim()) entries.withMeasures = true;
      entriesByOrg.set(orgId, entries);
    }
  }

  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      disabledJournalCodes: true,
      journalAutomationJson: true,
      autoJournalCodes: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let alreadyOff = 0;
  let keptActive = 0;
  let switched = 0;
  for (const org of orgs) {
    const disabled = toStringArray(org.disabledJournalCodes);
    if (disabled.includes(TEMPLATE_CODE)) {
      alreadyOff += 1;
      continue;
    }
    const entries = entriesByOrg.get(org.id);
    const autoFilled = parseJournalAutomationJson(org.journalAutomationJson)[TEMPLATE_CODE]?.autoFill === true;
    const keptByPeople = Boolean(entries?.any) && (!autoFilled || entries?.withMeasures === true);
    if (keptByPeople) {
      keptActive += 1;
      console.log(`${tag} ведёт журнал — оставляем: ${org.name} (${org.id})`);
      continue;
    }
    const next = applyHealthCheckDefaultOff({
      disabledJournalCodes: disabled,
      journalAutomationJson: org.journalAutomationJson,
      autoJournalCodes: toStringArray(org.autoJournalCodes),
    });
    if (!next.changed) continue;
    switched += 1;
    console.log(`${tag} выключаем: ${org.name} (${org.id})`);
    if (DRY_RUN) continue;
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        disabledJournalCodes: next.disabledJournalCodes as Prisma.InputJsonValue,
        journalAutomationJson: next.journalAutomationJson as Prisma.InputJsonValue,
        autoJournalCodes: next.autoJournalCodes as Prisma.InputJsonValue,
      },
    });
  }

  const summary = `организаций: ${orgs.length}, уже выключен: ${alreadyOff}, ведут (оставили): ${keptActive}, выключено: ${switched}`;
  console.log(`${tag} итог — ${summary}`);

  if (!DRY_RUN) {
    await prisma.platformSetting.upsert({
      where: { key: ONCE_KEY },
      create: { key: ONCE_KEY, value: `${new Date().toISOString()} · ${summary}` },
      update: { value: `${new Date().toISOString()} · ${summary}` },
    });
  }
}

main()
  .catch((error) => {
    console.error("[health-off] ошибка:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
