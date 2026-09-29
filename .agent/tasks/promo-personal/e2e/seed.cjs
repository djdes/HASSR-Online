// Тестовые данные e2e promo-personal: платформа + ROOT (SQL, как prisma/seed.ts), владелец
// организации «Лавка» (мгновенная регистрация через API, анкета заполнена, ИНН для счёта),
// реквизиты исполнителя (заведомо тестовые — только в локальной базе wesetup_wt_promo), почты
// двух гостей, которые придут по ссылке с промокодом. Пишет creds.json в папку прогона.
// Запуск: node e2e/seed.cjs  (dev-сервер поднят)
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
    root: `pp-root-${run}@example.com`,
    owner: `pp-owner-${run}@example.com`,
    guest1280: `pp-guest1280-${run}@example.com`,
    guest390: `pp-guest390-${run}@example.com`,
  };
  const hash = bcrypt.hashSync(creds.password, 10);

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
      headers: { "X-Forwarded-For": `10.99.${Date.now() % 250}.1` },
      timeout: 300000,
    });
    const body = await reg.json().catch(() => null);
    if (reg.status() !== 200 || !body || body.created !== true) {
      throw new Error(`instant-register: ${reg.status()} ${JSON.stringify(body)}`);
    }
  } finally {
    await browser.close();
  }
  const [me] = await sql('select id, "organizationId" from "User" where email = $1', [creds.owner]);
  // Анкета заполнена (иначе поверх — «Завершите регистрацию»), пароль известен, ИНН — для счёта.
  await sql('update "Organization" set name = $1, inn = $2 where id = $3', ["Кафе «Лавка»", "7700000017", me.organizationId]);
  await sql('update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3 where id = $4', [
    "Лариса Лавкина",
    "+79990001133",
    hash,
    me.id,
  ]);

  // Реквизиты исполнителя для счёта по безналу — заведомо тестовые, только в этой базе.
  const requisites = {
    nameFull: "ООО «Тестовый исполнитель e2e»",
    nameShort: "ООО «Тест e2e»",
    inn: "7700000000",
    kpp: "770001001",
    ogrn: "1027700000000",
    address: "г. Москва, ул. Тестовая, д. 1, офис 1",
    bank: { name: "Тестовый банк", bik: "044525000", account: "40702810000000000000", corrAccount: "30101810000000000000" },
    head: { post: "Генеральный директор", name: "Тестов Тест Тестович" },
    vatMode: "none",
    email: "billing@example.com",
    phone: "+70000000000",
    facsimileFile: null,
    stampFile: null,
    updatedAt: new Date().toISOString(),
  };
  await sql(
    `insert into "PlatformSetting" (key, value, "updatedAt") values ('legal.requisites', $1, now())
     on conflict (key) do update set value = excluded.value, "updatedAt" = now()`,
    [JSON.stringify(requisites)],
  );

  creds.organizationId = me.organizationId;
  creds.ownerId = me.id;
  fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
  console.log("seeded", { run, organizationId: me.organizationId, owner: creds.owner, root: creds.root });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
