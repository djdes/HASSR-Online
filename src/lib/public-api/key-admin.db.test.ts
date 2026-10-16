import assert from "node:assert/strict";
import test from "node:test";
import { DB_TEST_SKIP, createDbFixture } from "./db-test-fixtures";

test("выпуск, список и отзыв ключей на живой базе", { skip: DB_TEST_SKIP }, async (t) => {
  const { createApiKey, listOrgApiKeys, revokeApiKey } = await import("./key-admin");
  const { hashApiKey, looksLikeApiKey, MAX_ACTIVE_KEYS_PER_ORG } = await import("./keys");
  const fx = await createDbFixture();
  try {
    const org = await fx.makeOrg();
    const other = await fx.makeOrg("Чужое кафе");
    const anna = await fx.makeUser(org.id, { name: "Анна Руководитель" });
    const boris = await fx.makeUser(org.id, { name: "Борис Руководитель" });

    let firstKeyId = "";

    await t.test("createApiKey: ключ формата wsk_, в базе только хеш, строка api_key.created", async () => {
      const res = await createApiKey({ orgId: org.id, user: anna, name: "Claude на ноутбуке", access: "write" });
      assert.equal(res.ok, true);
      if (!res.ok) return;
      firstKeyId = res.key.id;
      assert.equal(looksLikeApiKey(res.secret), true);
      assert.ok(res.mcpUrl.endsWith(`/api/mcp/${res.secret}`));
      const row = await fx.db.apiAccessKey.findUnique({ where: { id: res.key.id } });
      assert.equal(row?.tokenHash, hashApiKey(res.secret));
      assert.equal(JSON.stringify(row).includes(res.secret), false);
      const audit = await fx.db.auditLog.findFirst({ where: { organizationId: org.id, action: "api_key.created", entityId: res.key.id } });
      assert.ok(audit);
    });

    await t.test("listOrgApiKeys: нет secret и tokenHash; isMine верен; отозванные скрыты", async () => {
      const second = await createApiKey({ orgId: org.id, user: boris, name: "ChatGPT", access: "read" });
      assert.equal(second.ok, true);
      const forAnna = await listOrgApiKeys(org.id, anna.id);
      assert.equal(forAnna.length, 2);
      for (const view of forAnna) {
        assert.equal("tokenHash" in view, false);
        assert.equal("secret" in view, false);
      }
      assert.deepEqual(
        forAnna.map((k) => [k.name, k.isMine, k.owner.name]).sort(),
        [["ChatGPT", false, "Борис Руководитель"], ["Claude на ноутбуке", true, "Анна Руководитель"]]
      );
    });

    await t.test(`${MAX_ACTIVE_KEYS_PER_ORG + 1}-й активный ключ → 409`, async () => {
      const existing = await fx.db.apiAccessKey.count({ where: { organizationId: org.id, revokedAt: null } });
      for (let i = existing; i < MAX_ACTIVE_KEYS_PER_ORG; i += 1) {
        const res = await createApiKey({ orgId: org.id, user: anna, name: `Ключ ${i}`, access: "read" });
        assert.equal(res.ok, true);
      }
      const extra = await createApiKey({ orgId: org.id, user: anna, name: "Лишний", access: "read" });
      assert.equal(extra.ok ? 201 : extra.status, 409);
    });

    await t.test("revokeApiKey: чужая организация → 404; своя → revokedAt и api_key.revoked; повторно → 404", async () => {
      const foreign = await revokeApiKey({ orgId: other.id, keyId: firstKeyId, actor: boris });
      assert.equal(foreign.ok ? 200 : foreign.status, 404);
      const own = await revokeApiKey({ orgId: org.id, keyId: firstKeyId, actor: boris });
      assert.equal(own.ok, true);
      const row = await fx.db.apiAccessKey.findUnique({ where: { id: firstKeyId } });
      assert.ok(row?.revokedAt);
      const audit = await fx.db.auditLog.findFirst({ where: { organizationId: org.id, action: "api_key.revoked", entityId: firstKeyId } });
      assert.equal(audit?.userId, boris.id);
      const again = await revokeApiKey({ orgId: org.id, keyId: firstKeyId, actor: boris });
      assert.equal(again.ok ? 200 : again.status, 404);
      const list = await listOrgApiKeys(org.id, anna.id);
      assert.equal(list.some((k) => k.id === firstKeyId), false);
    });
  } finally {
    await fx.cleanup();
  }
});
