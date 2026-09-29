// Тестовые данные e2e КП: платформа + ROOT (как prisma/seed.ts), реквизиты «ООО «Пример»» (условные),
// два действующих промокода (ROMASHKA10 без срока, OKTYABR10 до 31.10) и один выключенный.
// Пишет creds.json в папку прогона (вне проекта). Запуск: node e2e/seed.cjs (dev-сервер не обязателен).
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { WT, CREDS, sql } = require("./lib.cjs");

const bcrypt = createRequire(path.join(WT, "package.json"))("bcryptjs");

(async () => {
  const run = Date.now().toString(36);
  const creds = { run, password: "Kp2026!e2e", root: `kp-root-${run}@example.com` };
  const hash = bcrypt.hashSync(creds.password, 10);

  await sql(
    `insert into "Organization" (id, name, type, "subscriptionPlan", "updatedAt")
     values ('platform', 'WeSetup', 'platform', 'platform', now())
     on conflict (id) do nothing`,
  );
  await sql(
    `insert into "User" (id, email, name, "passwordHash", role, "organizationId", "isRoot", "isActive", "journalAccessMigrated", "showWhatsNew")
     values ($1, $2, 'ROOT e2e', $3, 'manager', 'platform', true, true, true, false)`,
    [`kproot${run}`, creds.root, hash],
  );

  // Реквизиты — условные, для вёрстки подвала КП (и чтобы счёт «по безналу» считался доступным).
  const requisites = {
    nameFull: "Общество с ограниченной ответственностью «Пример»",
    nameShort: "ООО «Пример»",
    inn: "7700000000",
    kpp: "770001001",
    ogrn: "1027700000000",
    address: "123000, г. Москва, ул. Примерная, д. 1",
    bank: { name: "АО «Банк»", bik: "044525000", account: "40702810000000000000", corrAccount: "30101810000000000000" },
    head: { post: "Генеральный директор", name: "Иванов Иван Иванович" },
    vatMode: "none",
    email: "support@wesetup.ru",
    phone: "",
    facsimileFile: null,
    stampFile: null,
    updatedAt: new Date().toISOString(),
  };
  await sql(
    `insert into "PlatformSetting" (key, value, "updatedAt") values ('legal.requisites', $1, now())
     on conflict (key) do update set value = excluded.value, "updatedAt" = now()`,
    [JSON.stringify(requisites)],
  );
  // Отправитель по умолчанию — не задан: e2e сохраняет его из генератора.
  await sql(`delete from "PlatformSetting" where key = 'proposal.sender'`);

  const codes = [
    ["ROMASHKA10", "percent", 10, true, null],
    ["OKTYABR10", "percent", 10, true, "2026-10-31T21:00:00.000Z"],
    ["STARYI20", "percent", 20, false, null],
  ];
  for (const [code, kind, value, active, endsAt] of codes) {
    await sql(
      `insert into "PromoCode" (id, code, kind, value, active, "endsAt", "newClientsOnly", note, "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, $6, false, 'e2e КП', now(), now())
       on conflict (code) do update set kind = excluded.kind, value = excluded.value, active = excluded.active, "endsAt" = excluded."endsAt"`,
      [`kp${code.toLowerCase()}${run}`, code, kind, value, active, endsAt],
    );
  }
  fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
  console.log("seeded", creds);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
