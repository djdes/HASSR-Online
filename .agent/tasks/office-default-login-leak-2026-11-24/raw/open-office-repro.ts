/**
 * Стенд (не для прода): проверка разового шага «открыть офис» (AC5) на
 * временных организациях `open-office-check-*`.
 *   setup   — завести организации разных видов;
 *   check   — показать, что с ними стало (офис, журналы по объектам, записи
 *             журнала действий, версия сессии руководителя объекта);
 *   cleanup — удалить временные организации и снять ключ once:open-office:v1.
 * Между setup и check запускается сам шаг: prisma/seed-open-office-2026-11.ts.
 * Запуск: npx tsx .agent/tasks/office-default-login-leak-2026-11-24/raw/open-office-repro.ts setup|check|cleanup
 */
import "dotenv/config";
import { db } from "../../../../src/lib/db";

const PREFIX = "open-office-check";
const PHASE = process.argv[2] ?? "check";

async function org(name: string, data: { kind?: string; perLocationJournals?: boolean }) {
  return db.organization.create({ data: { name: `${PREFIX}-${name}`, type: "restaurant", ...data }, select: { id: true } });
}

async function setup() {
  // 1) Один объект, журналы общие, офиса нет; руководитель закреплён за объектом, повар без места.
  const one = await org("1obj", { perLocationJournals: false });
  const oneObject = await db.building.create({ data: { organizationId: one.id, name: "Кафе", sortOrder: 0 } });
  await db.user.create({ data: { email: `${PREFIX}-manager@stand.local`, name: "Руководитель объекта", passwordHash: "x", organizationId: one.id, role: "manager", buildingIds: [oneObject.id] } });
  await db.user.create({ data: { email: `${PREFIX}-cook@stand.local`, name: "Повар без места", passwordHash: "x", organizationId: one.id, role: "cook", buildingIds: [] } });
  // 2) Офис есть, журналы общие.
  const officeOff = await org("officeoff", { perLocationJournals: false });
  await db.building.create({ data: { organizationId: officeOff.id, name: "Офис", kind: "office", sortOrder: -1 } });
  await db.building.create({ data: { organizationId: officeOff.id, name: "Склад", sortOrder: 0 } });
  // 3) Без объектов.
  await org("noobj", { perLocationJournals: false });
  // 4) Мастер-кабинет справочников с объектом — служебный, не трогается.
  const directory = await org("directory", { kind: "directory", perLocationJournals: false });
  await db.building.create({ data: { organizationId: directory.id, name: "Справочник", sortOrder: 0 } });
  // 5) Два объекта, журналы по объектам, офиса нет; названия «Офис» и «Офис компании» заняты объектами.
  const two = await org("2obj", { perLocationJournals: true });
  const twoA = await db.building.create({ data: { organizationId: two.id, name: "Офис", sortOrder: 3 } });
  const twoB = await db.building.create({ data: { organizationId: two.id, name: "Офис компании", sortOrder: 5 } });
  // Владелец за обоими объектами — без офиса это «вся компания»: должен ею остаться («без места»).
  await db.user.create({ data: { email: `${PREFIX}-owner2@stand.local`, name: "Владелец за всеми", passwordHash: "x", organizationId: two.id, role: "owner", buildingIds: [twoA.id, twoB.id] } });
  // Руководитель одного объекта — становится руководителем объекта (новый вход).
  await db.user.create({ data: { email: `${PREFIX}-head2@stand.local`, name: "Руководитель одного", passwordHash: "x", organizationId: two.id, role: "manager", buildingIds: [twoA.id] } });
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
      buildings: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, sortOrder: true, address: true } },
      users: { select: { email: true, sessionVersion: true, buildingIds: true } },
    },
  });
  const out: Record<string, unknown> = {};
  for (const item of orgs) {
    const audit = await db.auditLog.findMany({
      where: { organizationId: item.id, action: "building.office_opened" },
      select: { userName: true, details: true },
    });
    out[item.name.replace(`${PREFIX}-`, "")] = {
      journalsByObjects: item.perLocationJournals,
      buildings: item.buildings.map((building) => `${building.kind}:${building.name}@${building.sortOrder}`),
      audit,
      users: item.users.map((user) => ({
        who: user.email.replace(`${PREFIX}-`, ""),
        sessionVersion: user.sessionVersion,
        places: user.buildingIds.map((id) => item.buildings.find((building) => building.id === id)?.name ?? id),
      })),
    };
  }
  out.onceKey = Boolean(await db.platformSetting.findUnique({ where: { key: "once:open-office:v1" } }));
  console.log(JSON.stringify(out, null, 2));
}

async function cleanup() {
  const orgs = await db.organization.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  for (const { id } of orgs) {
    await db.auditLog.deleteMany({ where: { organizationId: id } });
    await db.user.deleteMany({ where: { organizationId: id } });
    await db.building.deleteMany({ where: { organizationId: id } });
    await db.organization.delete({ where: { id } });
  }
  await db.platformSetting.deleteMany({ where: { key: "once:open-office:v1" } });
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
