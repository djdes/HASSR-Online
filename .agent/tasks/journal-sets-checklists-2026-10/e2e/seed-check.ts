/**
 * AC3 на базе (wesetup_e2e, НЕ прод): первая активация `ccp_monitoring`
 * сидом и безопасный повтор.
 *
 *   npx tsx .agent/tasks/journal-sets-checklists-2026-10/e2e/seed-check.ts deactivate
 *   npx tsx .agent/tasks/journal-sets-checklists-2026-10/e2e/seed-check.ts enable-in-restaurant
 *   npx tsx .agent/tasks/journal-sets-checklists-2026-10/e2e/seed-check.ts snapshot <метка>
 *
 * `deactivate` — шаблон снова «ещё не включён» (как на проде до деплоя);
 * `enable-in-restaurant` — человек включил журнал в тестовом ресторане;
 * `snapshot` — состояние шаблона и организаций в raw/seed-<метка>.json.
 */
import "dotenv/config";
import fs from "node:fs";

import { db } from "@/lib/db";

const DIR = ".agent/tasks/journal-sets-checklists-2026-10/raw";
const CODE = "ccp_monitoring";
const PLATFORM = process.env.PLATFORM_ORG_ID || "platform";

const codesOf = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);

async function main() {
  if (!/wesetup_e2e/.test(process.env.DATABASE_URL ?? "")) throw new Error("Только локальная база wesetup_e2e");
  const [command, label] = process.argv.slice(2);
  const state = JSON.parse(fs.readFileSync(`${DIR}/e2e-state.json`, "utf8"));

  if (command === "deactivate") {
    await db.journalTemplate.update({ where: { code: CODE }, data: { isActive: false } });
    console.log(`${CODE}: isActive=false`);
    return;
  }
  if (command === "enable-in-restaurant") {
    const org = await db.organization.findUniqueOrThrow({ where: { id: state.restaurant }, select: { disabledJournalCodes: true } });
    await db.organization.update({
      where: { id: state.restaurant },
      data: { disabledJournalCodes: codesOf(org.disabledJournalCodes).filter((code) => code !== CODE) },
    });
    console.log(`${CODE}: включён в ${state.restaurant}`);
    return;
  }
  if (command !== "snapshot" || !label) throw new Error("deactivate | enable-in-restaurant | snapshot <метка>");

  const template = await db.journalTemplate.findUnique({ where: { code: CODE }, select: { isActive: true } });
  const orgs = await db.organization.findMany({ where: { id: { not: PLATFORM } }, select: { id: true, disabledJournalCodes: true } });
  const withCode = orgs.filter((org) => codesOf(org.disabledJournalCodes).includes(CODE)).map((org) => org.id);
  const snapshot = {
    label,
    templateActive: template?.isActive ?? null,
    orgsTotal: orgs.length,
    orgsWithCcpDisabled: withCode.length,
    orgsWithCcpEnabled: orgs.filter((org) => !withCode.includes(org.id)).map((org) => org.id),
    restaurantCcpDisabled: withCode.includes(state.restaurant),
    disabledListsHash: orgs.map((org) => `${org.id}:${codesOf(org.disabledJournalCodes).length}`).sort().join(","),
  };
  fs.writeFileSync(`${DIR}/seed-${label}.json`, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ ...snapshot, disabledListsHash: undefined }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
