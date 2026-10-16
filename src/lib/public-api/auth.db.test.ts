import assert from "node:assert/strict";
import test from "node:test";
import { DB_TEST_SKIP, bearer, createDbFixture } from "./db-test-fixtures";

test("authenticateApiKey на живой базе", { skip: DB_TEST_SKIP }, async (t) => {
  const { authenticateApiKey } = await import("./auth");
  const fx = await createDbFixture();
  try {
    const org = await fx.makeOrg();

    await t.test("действующий ключ руководителя → ok; orgId из ключа; actor.isRoot = false; access из ключа", async () => {
      const user = await fx.makeUser(org.id, { role: "manager" });
      const key = await fx.makeKey(user.id, org.id, { access: "read" });
      const res = await authenticateApiKey(bearer(key.secret), { via: "mcp" });
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.ctx.orgId, org.id);
      assert.equal(res.ctx.actor.id, user.id);
      assert.equal(res.ctx.actor.isRoot, false);
      assert.equal(res.ctx.access, "read");
      assert.equal(res.ctx.keyId, key.id);
    });

    await t.test("отозванный ключ → 401 «Ключ не найден или отозван.»", async () => {
      const user = await fx.makeUser(org.id);
      const key = await fx.makeKey(user.id, org.id, { revoked: true });
      const res = await authenticateApiKey(bearer(key.secret), { via: "rest" });
      assert.deepEqual(res.ok ? null : [res.status, res.error], [401, "Ключ не найден или отозван."]);
    });

    await t.test("владелец архивирован → 403", async () => {
      const user = await fx.makeUser(org.id, { archived: true });
      const key = await fx.makeKey(user.id, org.id);
      const res = await authenticateApiKey(bearer(key.secret), { via: "rest" });
      assert.equal(res.ok ? 200 : res.status, 403);
    });

    await t.test("владелец понижен до cook → 403 «…больше нет прав руководителя…»", async () => {
      const user = await fx.makeUser(org.id, { role: "manager" });
      const key = await fx.makeKey(user.id, org.id);
      await fx.db.user.update({ where: { id: user.id }, data: { role: "cook" } });
      const res = await authenticateApiKey(bearer(key.secret), { via: "rest" });
      assert.equal(res.ok ? 200 : res.status, 403);
      assert.match(res.ok ? "" : res.error, /больше нет прав руководителя/);
    });

    const second = await fx.makeOrg("Второе кафе");
    const member = await fx.makeUser(org.id, { role: "manager" });
    await fx.db.organizationMember.create({ data: { userId: member.id, organizationId: second.id, role: "manager" } });
    const memberKey = await fx.makeKey(member.id, second.id);

    await t.test("ключ выпущен в организации, где владелец — OrganizationMember → ok, orgId — эта организация", async () => {
      const res = await authenticateApiKey(bearer(memberKey.secret), { via: "mcp" });
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.ctx.orgId, second.id);
      assert.notEqual(res.ctx.orgId, org.id);
    });

    await t.test("участие удалено → 403 «…больше не работает в этой организации.»", async () => {
      await fx.db.organizationMember.deleteMany({ where: { userId: member.id, organizationId: second.id } });
      const again = await authenticateApiKey(bearer(memberKey.secret), { via: "mcp" });
      assert.equal(again.ok ? 200 : again.status, 403);
      assert.match(again.ok ? "" : again.error, /больше не работает в этой организации/);
    });

    await t.test("lastUsedAt обновляется не чаще раза в минуту", async () => {
      const user = await fx.makeUser(org.id);
      const key = await fx.makeKey(user.id, org.id);
      const now = new Date();
      await authenticateApiKey(bearer(key.secret), { via: "mcp", now });
      await new Promise((r) => setTimeout(r, 50));
      const first = await fx.db.apiAccessKey.findUnique({ where: { id: key.id } });
      assert.equal(first?.lastUsedAt?.getTime(), now.getTime());
      assert.equal(first?.lastUsedVia, "mcp");

      await authenticateApiKey(bearer(key.secret), { via: "rest", now: new Date(now.getTime() + 10_000) });
      await new Promise((r) => setTimeout(r, 50));
      const second = await fx.db.apiAccessKey.findUnique({ where: { id: key.id } });
      assert.equal(second?.lastUsedAt?.getTime(), now.getTime());

      const later = new Date(now.getTime() + 61_000);
      await authenticateApiKey(bearer(key.secret), { via: "rest", now: later });
      await new Promise((r) => setTimeout(r, 50));
      const third = await fx.db.apiAccessKey.findUnique({ where: { id: key.id } });
      assert.equal(third?.lastUsedAt?.getTime(), later.getTime());
      assert.equal(third?.lastUsedVia, "rest");
    });
  } finally {
    await fx.cleanup();
  }
});
