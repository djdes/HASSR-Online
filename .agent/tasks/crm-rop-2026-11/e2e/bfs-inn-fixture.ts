/** Локально: «БФС» не в названии — по ИНН 5018215599 и по снимку ЕГРЮЛ. */
import "dotenv/config";
import { db } from "../../../../src/lib/db";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) process.exit(1);

async function main() {
  await db.organization.upsert({ where: { id: "fixture-bfs-inn" }, update: {}, create: { id: "fixture-bfs-inn", name: "Кофейня владельца", type: "restaurant", inn: "5018215599" } });
  await db.organization.upsert({ where: { id: "fixture-bfs-egrul" }, update: {}, create: { id: "fixture-bfs-egrul", name: "Тестовая точка", type: "restaurant", legalProfileJson: { nameShort: "ООО «БФС»", nameFull: "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «БФС»" } } });
  await db.organization.upsert({ where: { id: "fixture-other" }, update: {}, create: { id: "fixture-other", name: "Чужое кафе", type: "restaurant", inn: "7700000000" } });
  await db.user.upsert({ where: { email: "inn-owner@bfs.local.test" }, update: {}, create: { email: "inn-owner@bfs.local.test", name: "Владелец по ИНН", role: "owner", organizationId: "fixture-bfs-inn", telegramChatId: "900100", passwordHash: "x" } });
  await db.user.upsert({ where: { email: "egrul-manager@bfs.local.test" }, update: {}, create: { email: "egrul-manager@bfs.local.test", name: "Руководитель по ЕГРЮЛ", role: "manager", organizationId: "fixture-bfs-egrul", telegramChatId: "900200", passwordHash: "x" } });
  await db.user.upsert({ where: { email: "notg@bfs.local.test" }, update: {}, create: { email: "notg@bfs.local.test", name: "Без Telegram", role: "owner", organizationId: "fixture-bfs-inn", passwordHash: "x" } });
  await db.user.upsert({ where: { email: "other@other.local.test" }, update: {}, create: { email: "other@other.local.test", name: "Чужой владелец", role: "owner", organizationId: "fixture-other", telegramChatId: "900300", passwordHash: "x" } });
  console.log("bfs inn/egrul fixture ready");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); process.exit(process.exitCode ?? 0); });
