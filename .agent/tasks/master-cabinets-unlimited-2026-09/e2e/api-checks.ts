// API /api/settings/master-cabinets: проверки ввода и доступа. Один вход на
// пользователя (лимит входов 5 за 5 минут). Стенд 3021 + ЛОКАЛЬНАЯ e2e-база;
// временный аккаунт manager-a откатывается в finally.
// Запуск: DATABASE_URL=<e2e> node --import tsx .agent/tasks/master-cabinets-unlimited-2026-09/e2e/api-checks.ts
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { BASE, db, signIn, USERS } from "../../mobile-apps-2026-09/e2e/server-db";

if (!/@localhost:5432\/wesetup_e2e\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL must be e2e db");

const OUT = ".agent/tasks/master-cabinets-unlimited-2026-09/e2e/api-checks.json";
const ORG_A = "e2e-org-a";
const API = `${BASE}/api/settings/master-cabinets`;

async function main() {
  const out: Record<string, unknown> = {};
  const browser = await chromium.launch({ headless: true });
  const owner = await db.user.findFirstOrThrow({ where: { email: USERS.managerA }, select: { id: true } });
  const orgA = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { accountId: true } });
  let accountId: string | null = null;
  try {
    // 1. Руководитель без аккаунта: окно не открывается, в мини-приложении кнопки нет.
    const ctx = await browser.newContext();
    await signIn(ctx, USERS.managerA);
    const notOwner = await ctx.request.get(API);
    const notOwnerOrgs = await (await ctx.request.get(`${BASE}/api/organizations`)).json();
    out.notOwner = { status: notOwner.status(), body: await notOwner.json(), canCreate: notOwnerOrgs.canCreateMasterCabinet };
    assert.equal(notOwner.status(), 403);
    assert.equal(notOwnerOrgs.canCreateMasterCabinet, false);

    // 2. Тот же человек — владелец аккаунта (сессия та же: владелец проверяется по базе).
    const account = await db.account.create({ data: { ownerUserId: owner.id }, select: { id: true } });
    accountId = account.id;
    await db.organization.update({ where: { id: ORG_A }, data: { accountId } });
    const list = await ctx.request.get(API);
    const listed = await list.json();
    out.ownerList = { status: list.status(), objects: listed.objects };
    assert.equal(list.status(), 200);
    assert.ok(listed.objects.some((object: { id: string }) => object.id === ORG_A));

    const noName = await ctx.request.post(API, { data: { name: " ", organizationIds: [] } });
    const foreign = await db.organization.findFirst({
      where: { OR: [{ accountId: null }, { accountId: { not: accountId } }], kind: "regular", id: { not: ORG_A } },
      select: { id: true },
    });
    const alien = await ctx.request.post(API, { data: { name: "Чужой", organizationIds: [foreign?.id ?? "nope"] } });
    const empty = await ctx.request.post(API, { data: { name: "  Без   объектов  ", organizationIds: [] } });
    const emptyBody = await empty.json();
    out.validation = {
      noName: { status: noName.status(), body: await noName.json() },
      alien: { status: alien.status(), body: await alien.json() },
      empty: { status: empty.status(), body: emptyBody },
    };
    assert.equal(noName.status(), 400);
    assert.equal(alien.status(), 400);
    assert.equal(empty.status(), 200);
    assert.equal(emptyBody.cabinet.name, "Без объектов");
    const created = await db.organization.findUniqueOrThrow({
      where: { id: emptyBody.cabinet.id },
      select: { kind: true, serviceCode: true, linkedServiceCode: true, accountId: true },
    });
    assert.equal(created.kind, "directory");
    assert.ok(created.serviceCode);
    assert.equal(created.accountId, accountId);
    const audit = await db.auditLog.count({ where: { action: "master_cabinet.created", entityId: emptyBody.cabinet.id } });
    out.auditRows = audit;
    assert.equal(audit, 2);
    await ctx.close();

    // 3. Повар: 403, кнопки нет.
    const cook = await browser.newContext();
    await signIn(cook, USERS.cookA);
    const cookGet = await cook.request.get(API);
    const cookOrgs = await (await cook.request.get(`${BASE}/api/organizations`)).json();
    out.cook = { status: cookGet.status(), canCreate: cookOrgs.canCreateMasterCabinet };
    assert.equal(cookGet.status(), 403);
    assert.equal(cookOrgs.canCreateMasterCabinet, false);
    await cook.close();
    out.ok = true;
  } catch (error) {
    out.ok = false;
    out.error = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    throw error;
  } finally {
    await browser.close();
    if (accountId) {
      const ids = (
        await db.organization.findMany({ where: { accountId, id: { not: ORG_A } }, select: { id: true } })
      ).map((org) => org.id);
      await db.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: ids } }, { action: "master_cabinet.created", organizationId: ORG_A }] } });
      await db.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
      await db.organization.deleteMany({ where: { id: { in: ids } } });
      await db.organization.update({ where: { id: ORG_A }, data: { accountId: orgA.accountId } });
      await db.account.delete({ where: { id: accountId } });
    }
    writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await db.$disconnect();
  }
}

main().catch(() => process.exit(1));
