// Тестовые данные e2e: платформа + ROOT (SQL, как prisma/seed.ts), владелец организации
// (мгновенная регистрация через API) и пять сотрудников — чтобы в кабинете была платная
// ступень подписки. Пишет creds.json в папку прогона (вне проекта).
// Запуск: node e2e/seed.cjs  (dev-сервер должен быть поднят)
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { BASE, WT, CREDS, launch, sql } = require("./lib.cjs");

const bcrypt = createRequire(path.join(WT, "package.json"))("bcryptjs");

(async () => {
  const run = Date.now().toString(36);
  const creds = {
    run,
    password: "Promo2026!e2e",
    root: `pr-root-${run}@example.com`,
    owner: `pr-owner-${run}@example.com`,
  };
  const hash = bcrypt.hashSync(creds.password, 10);

  // Платформенная организация и ROOT — тем же набором полей, что prisma/seed.ts.
  await sql(
    `insert into "Organization" (id, name, type, "subscriptionPlan", "updatedAt")
     values ('platform', 'WeSetup', 'platform', 'platform', now())
     on conflict (id) do nothing`,
  );
  await sql(
    `insert into "User" (id, email, name, "passwordHash", role, "organizationId", "isRoot", "isActive", "journalAccessMigrated", "showWhatsNew")
     values ($1, $2, 'ROOT e2e', $3, 'manager', 'platform', true, true, true, false)`,
    [`root${run}`, creds.root, hash],
  );

  const browser = await launch();
  try {
    const ctx = await browser.newContext();
    const reg = await ctx.request.post(`${BASE}/api/auth/instant-register`, {
      data: { email: creds.owner, consent: true },
      timeout: 300000,
    });
    const body = await reg.json().catch(() => null);
    if (reg.status() !== 200 || !body || body.created !== true) {
      throw new Error(`instant-register: ${reg.status()} ${JSON.stringify(body)}`);
    }
  } finally {
    await browser.close();
  }
  const [me] = await sql('select id, "organizationId", "legalVersion" from "User" where email = $1', [creds.owner]);
  // Анкета заполнена (иначе поверх — «Завершите регистрацию»), пароль известен.
  await sql('update "Organization" set name = $1 where id = $2', ["Кафе «Акция»", me.organizationId]);
  await sql('update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3 where id = $4', [
    "Анна Акционова",
    "+79990001122",
    hash,
    me.id,
  ]);
  // Пять сотрудников: с владельцем шесть — платная ступень подписки при любых лимитах
  // (сейчас бесплатно до 3; параллельная задача billing делает до 1).
  for (let i = 1; i <= 5; i += 1) {
    await sql(
      'insert into "User" (id, email, name, phone, "passwordHash", role, "organizationId", "journalAccessMigrated", "showWhatsNew", "legalVersion") values ($1,$2,$3,$4,$5,$6,$7,true,false,$8)',
      [`prs${i}${run}`, `pr-staff${i}-${run}@example.com`, `Сотрудник ${i}`, `+7999000330${i}`, hash, "cook", me.organizationId, me.legalVersion],
    );
  }
  creds.organizationId = me.organizationId;
  creds.ownerId = me.id;
  fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
  console.log("seeded", { run, organizationId: me.organizationId, owner: creds.owner, root: creds.root });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
