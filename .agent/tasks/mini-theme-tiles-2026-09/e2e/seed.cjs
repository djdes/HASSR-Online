// Тестовая организация для e2e: владелец (мгновенная регистрация), повар и шеф.
// Запуск: node .agent/tasks/mini-theme-tiles-2026-09/e2e/seed.cjs
// Пишет e2e/creds.json (в .gitignore): почты и пароль для входа из других контекстов.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { BASE, WT, CREDS, launch, sql } = require("./lib.cjs");

const bcrypt = createRequire(path.join(WT, "package.json"))("bcryptjs");

(async () => {
  const run = Date.now().toString(36);
  const creds = {
    run,
    password: "MiniTheme2026!",
    owner: `mt-owner-${run}@example.com`,
    cook: `mt-cook-${run}@example.com`,
    chef: `mt-chef-${run}@example.com`,
  };
  const browser = await launch();
  try {
    const ctx = await browser.newContext();
    const reg = await ctx.request.post(`${BASE}/api/auth/instant-register`, {
      data: { email: creds.owner, consent: true },
      timeout: 240000,
    });
    const body = await reg.json().catch(() => null);
    if (reg.status() !== 200 || !body || body.created !== true) {
      throw new Error(`instant-register: ${reg.status()} ${JSON.stringify(body)}`);
    }
    const [me] = await sql('select id, "organizationId", "legalVersion" from "User" where email = $1', [creds.owner]);
    const hash = bcrypt.hashSync(creds.password, 10);
    // Анкета заполнена (иначе поверх — «Завершите регистрацию»), пароль известен.
    await sql('update "Organization" set name = $1 where id = $2', ["Кафе «Ромашка»", me.organizationId]);
    await sql(
      'update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3 where id = $4',
      ["Анна Смирнова", "+79990001122", hash, me.id],
    );
    for (const [id, email, name, role] of [
      [`mtc${run}`, creds.cook, "Пётр Повар", "cook"],
      [`mth${run}`, creds.chef, "Ольга Шеф", "head_chef"],
    ]) {
      await sql(
        'insert into "User" (id, email, name, phone, "passwordHash", role, "organizationId", "journalAccessMigrated", "showWhatsNew", "legalVersion") values ($1,$2,$3,$4,$5,$6,$7,true,false,$8)',
        [id, email, name, "+79990002233", hash, role, me.organizationId, me.legalVersion],
      );
    }
    creds.organizationId = me.organizationId;
    fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
    console.log("seeded", { run, organizationId: me.organizationId, owner: creds.owner });
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
