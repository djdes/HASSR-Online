import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { db } from "@/lib/db";
import { listEmailSenders, resolveEmailSender } from "./email-sender-access.server";
import { EMAIL_SENDER_GRANTS_KEY } from "./email-sender-access";

const original = { setting: db.platformSetting.findUnique, first: db.user.findFirst, many: db.user.findMany, sender: db.platformMailSender.findUnique };
let active: boolean;
beforeEach(() => {
  active = true;
  db.platformSetting.findUnique = (async args => {
    assert.equal(args.where.key, EMAIL_SENDER_GRANTS_KEY);
    return { value: '{"alexey":["admin","archived"]}' };
  }) as typeof original.setting;
  db.user.findFirst = (async args => {
    assert.equal(args?.where?.isActive, true); assert.equal(args?.where?.archivedAt, null);
    return active && args?.where?.id === "admin" ? { id: "admin" } : null;
  }) as typeof original.first;
  db.user.findMany = (async args => {
    assert.equal(args?.where?.isActive, true); assert.equal(args?.where?.archivedAt, null);
    return ["admin", "alexey"].map(id => ({ id, name: id, email: `${id}@wesetup.ru`, contactEmail: null }));
  }) as typeof original.many;
  db.platformMailSender.findUnique = (async args => args.where.userId === "admin" ? {
    fromName: "Admin", fromEmail: "admin@wesetup.ru", host: "wesetup.ru", port: 587, secure: false, username: "admin@wesetup.ru",
    passwordEnc: "encrypted", enabled: true, verifiedAt: new Date(), lastError: null,
  } : null) as typeof original.sender;
});
afterEach(() => { db.platformSetting.findUnique = original.setting; db.user.findFirst = original.first; db.user.findMany = original.many; db.platformMailSender.findUnique = original.sender; });

test("default mailbox comes from session; a shared mailbox requires an explicit grant and active owner", async () => {
  assert.equal(await resolveEmailSender("alexey"), "alexey");
  assert.equal(await resolveEmailSender("alexey", "admin"), "admin");
  assert.equal(await resolveEmailSender("other", "admin"), null);
  assert.equal(await resolveEmailSender("alexey", "forged"), null);
  assert.equal(await resolveEmailSender("alexey", "archived"), null);
  active = false;
  assert.equal(await resolveEmailSender("alexey", "admin"), null);
});

test("list keeps own mailbox first, excludes archived owners, exposes readiness without credentials", async () => {
  const result = await listEmailSenders("alexey");
  assert.deepEqual(result, [
    { userId: "alexey", fromName: "alexey", fromEmail: "alexey@wesetup.ru", ready: false },
    { userId: "admin", fromName: "Admin", fromEmail: "admin@wesetup.ru", ready: true },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /encrypted|passwordEnc|username/);
});
