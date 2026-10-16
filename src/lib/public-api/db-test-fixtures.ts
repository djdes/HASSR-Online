/**
 * Фикстуры DB-тестов публичного API. В обычном `npm test` DB-тесты
 * пропускаются: нужна локальная база рабочей копии (`wesetup_wt_*` или
 * `wesetup_e2e`) и явный флаг — чтобы тест никогда не писал в боевую базу.
 *
 *   WESETUP_DB_TESTS=1 DATABASE_URL=postgresql://…/wesetup_wt_aimcp \
 *     node --import tsx --test src/lib/public-api/auth.db.test.ts
 */
const DB_URL = process.env.DATABASE_URL ?? "";
const LOCAL_DB = /@(localhost|127\.0\.0\.1)(:\d+)?\/(wesetup_wt_[a-z0-9_]+|wesetup_e2e)(\?|$)/.test(DB_URL);

export const DB_TEST_SKIP: string | false =
  process.env.WESETUP_DB_TESTS === "1" && LOCAL_DB
    ? false
    : "нужна локальная база: WESETUP_DB_TESTS=1 и DATABASE_URL на wesetup_wt_*";

export type DbFixture = Awaited<ReturnType<typeof createDbFixture>>;

export async function createDbFixture() {
  const { db } = await import("@/lib/db");
  const { generateApiKey } = await import("./keys");
  const run = `dbt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgIds: string[] = [];
  let seq = 0;

  async function makeOrg(name = "Кафе") {
    const org = await db.organization.create({
      data: { name: `${name} ${run}`, type: "cafe", subscriptionPlan: "free", timezone: "Europe/Moscow" },
      select: { id: true, name: true },
    });
    orgIds.push(org.id);
    return org;
  }

  async function makeUser(organizationId: string, opts: { role?: string; name?: string; archived?: boolean; jobPositionId?: string } = {}) {
    seq += 1;
    return db.user.create({
      data: {
        email: `${run}-${seq}@test.local.haccp`,
        name: opts.name ?? `Сотрудник ${seq}`,
        passwordHash: "x",
        role: opts.role ?? "manager",
        organizationId,
        jobPositionId: opts.jobPositionId,
        archivedAt: opts.archived ? new Date() : null,
        isActive: opts.archived ? false : true,
      },
      select: { id: true, name: true, role: true },
    });
  }

  async function makeKey(userId: string, organizationId: string, opts: { access?: "read" | "write"; revoked?: boolean } = {}) {
    const generated = generateApiKey();
    const row = await db.apiAccessKey.create({
      data: {
        organizationId,
        userId,
        name: "Тестовый ключ",
        access: opts.access ?? "write",
        tokenHash: generated.tokenHash,
        displayPrefix: generated.displayPrefix,
        revokedAt: opts.revoked ? new Date() : null,
      },
      select: { id: true },
    });
    return { id: row.id, secret: generated.secret };
  }

  async function cleanup() {
    // Каскад организации уносит пользователей, ключи, документы и аудит.
    await db.user.deleteMany({ where: { email: { startsWith: `${run}-` } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    // Открытое соединение держит процесс node --test живым.
    await db.$disconnect();
  }

  return { db, run, makeOrg, makeUser, makeKey, cleanup };
}

export function bearer(secret: string): Request {
  return new Request("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Bearer ${secret}` } });
}
