/**
 * Стенд (не для прода) для проверки в браузере (ui-check.cjs):
 *   setup   — две временные организации с владельцем (пароль Passw0rd!):
 *             «ui-office-noobj» — без объектов; «ui-office-straggler» — один
 *             объект, офиса нет, журналы общие (компания до шага выкладки);
 *   check   — офис, журналы по объектам, записи журнала действий, цеха;
 *   cleanup — удалить их.
 * Запуск: npx tsx .agent/tasks/office-default-login-leak-2026-11-24/raw/ui-stand.ts setup|check|cleanup
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../../../../src/lib/db";
import { LEGAL_VERSION } from "../../../../src/lib/legal-consent";

const PREFIX = "ui-office";
const PHASE = process.argv[2] ?? "check";

async function setup() {
  const passwordHash = await bcrypt.hash("Passw0rd!", 10);
  const noobj = await db.organization.create({ data: { name: `${PREFIX}-noobj`, type: "restaurant" } });
  await db.user.create({
    data: { email: `${PREFIX}-noobj@stand.local`, name: "Нина Без-объектов", passwordHash, organizationId: noobj.id, role: "owner", permissionPreset: "admin", legalVersion: LEGAL_VERSION },
  });
  const straggler = await db.organization.create({ data: { name: `${PREFIX}-straggler`, type: "restaurant", perLocationJournals: false } });
  await db.building.create({ data: { organizationId: straggler.id, name: "Кафе у моря", sortOrder: 0 } });
  await db.user.create({
    data: { email: `${PREFIX}-straggler@stand.local`, name: "Сергей Опоздавший", passwordHash, organizationId: straggler.id, role: "owner", permissionPreset: "admin", legalVersion: LEGAL_VERSION },
  });
  console.log(JSON.stringify({ setup: "ok" }));
}

async function check() {
  const orgs = await db.organization.findMany({
    where: { name: { startsWith: PREFIX } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      perLocationJournals: true,
      buildings: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true } },
      areas: { select: { name: true, buildingId: true } },
    },
  });
  const out: Record<string, unknown> = {};
  for (const org of orgs) {
    const audit = await db.auditLog.findMany({ where: { organizationId: org.id, action: "building.office_opened" }, select: { userName: true, details: true } });
    const nameOf = (id: string | null) => org.buildings.find((building) => building.id === id)?.name ?? null;
    out[org.name] = {
      journalsByObjects: org.perLocationJournals,
      buildings: org.buildings.map((building) => `${building.kind}:${building.name}`),
      areas: org.areas.map((area) => `${area.name} → ${nameOf(area.buildingId) ?? "без объекта"}`),
      audit,
    };
  }
  console.log(JSON.stringify(out, null, 2));
}

async function cleanup() {
  const orgs = await db.organization.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  for (const { id } of orgs) {
    await db.auditLog.deleteMany({ where: { organizationId: id } });
    await db.area.deleteMany({ where: { organizationId: id } });
    await db.user.deleteMany({ where: { organizationId: id } });
    await db.building.deleteMany({ where: { organizationId: id } });
    await db.organization.delete({ where: { id } }).catch(async () => {
      // Остались связанные строки (журналы, роли) — удаляем организацию каскадом.
      await db.$executeRaw`DELETE FROM "Organization" WHERE id = ${id}`;
    });
  }
  console.log(JSON.stringify({ removed: orgs.length, left: await db.organization.count({ where: { name: { startsWith: PREFIX } } }) }));
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("stand only");
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("local DB only");
  if (PHASE === "setup") await setup();
  else if (PHASE === "cleanup") await cleanup();
  else await check();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
