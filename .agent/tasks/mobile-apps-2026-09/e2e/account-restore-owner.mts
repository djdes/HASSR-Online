// Восстановление ownerA в e2e-базе после ошибочного обезличивания прогоном 2026-09-26 17:54
// (роль legacy "owner" не распознавалась как владелец). Только localhost:5432/wesetup_e2e.
import bcrypt from "bcryptjs"; import { PrismaClient } from "@prisma/client"; import { PrismaPg } from "@prisma/adapter-pg"; import pg from "pg";
const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable" })) });
const id = "cmu2stnc30006wk9mo57z0txk";
const since = new Date("2026-09-26T17:54:00Z");
await db.user.update({ where: { id }, data: { name: "owner-a@e2e.local", email: "owner-a@e2e.local", passwordHash: await bcrypt.hash("E2eTest2026!", 10), isActive: true, archivedAt: null } });
const tokens = await db.personalLoginToken.updateMany({ where: { userId: id, revokedAt: { gte: since } }, data: { revokedAt: null } });
console.log("tokens unrevoked", tokens.count);
console.log("memberships total", await db.organizationMember.count(), "for managerA", await db.organizationMember.count({ where: { userId: "cmu2stnbo0005wk9me2bn3w8b" } }));
console.log(JSON.stringify(await db.user.findUnique({ where: { id }, select: { name: true, email: true, isActive: true, archivedAt: true, role: true } })));
await db.$disconnect();
