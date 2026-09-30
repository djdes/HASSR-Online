// Тестовые данные e2e balance-reviews-topup — только в локальной базе wesetup_wt_balance:
//   • платформа + ROOT (SQL, как prisma/seed.ts);
//   • владелец A — кейс со скрина владельца: человек и организация названы одинаково
//     «Алексей Партнёрская программа»; сфера «кафе», ИНН (для счёта), адрес с городом (Казань);
//   • повар в организации A — сотрудник без права пополнять;
//   • владелец B — для отзыва «через API» с подделанными суммой и видом;
//   • партнёр (активный) и привязка организации A к нему — для комиссии с пополнения;
//   • реквизиты исполнителя (заведомо тестовые) — для счёта по безналу.
// Пишет creds.json в папку прогона. Запуск: node e2e/seed.cjs (dev-сервер поднят).
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { BASE, WT, CREDS, launch, sql } = require("./lib.cjs");

const bcrypt = createRequire(path.join(WT, "package.json"))("bcryptjs");

async function instantRegister(browser, email, ipTail) {
  const ctx = await browser.newContext();
  try {
    const reg = await ctx.request.post(`${BASE}/api/auth/instant-register`, {
      data: { email, consent: true },
      headers: { "X-Forwarded-For": `10.98.${Date.now() % 250}.${ipTail}` },
      timeout: 300000,
    });
    const body = await reg.json().catch(() => null);
    if (reg.status() !== 200 || !body || body.created !== true) {
      throw new Error(`instant-register ${email}: ${reg.status()} ${JSON.stringify(body)}`);
    }
  } finally {
    await ctx.close();
  }
  const [me] = await sql('select id, "organizationId" from "User" where email = $1', [email]);
  return me;
}

(async () => {
  const run = Date.now().toString(36);
  const creds = {
    run,
    password: "Balance2026!e2e",
    root: `bt-root-${run}@example.com`,
    owner: `bt-owner-${run}@example.com`,
    ownerB: `bt-ownerb-${run}@example.com`,
    cook: `bt-cook-${run}@example.com`,
    partnerUser: `bt-partner-${run}@example.com`,
    sameName: "Алексей Партнёрская программа",
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
  let ownerA;
  let ownerB;
  let partnerOwner;
  try {
    ownerA = await instantRegister(browser, creds.owner, 1);
    ownerB = await instantRegister(browser, creds.ownerB, 2);
    partnerOwner = await instantRegister(browser, creds.partnerUser, 3);
  } finally {
    await browser.close();
  }

  // A: человек и организация названы одинаково (как на скрине владельца), город — из адреса.
  await sql(
    `update "Organization" set name = $1, type = 'cafe', inn = $2, address = $3 where id = $4`,
    [creds.sameName, "7700000017", "420111, г Казань, ул Баумана, д 1", ownerA.organizationId],
  );
  await sql(`update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3 where id = $4`, [
    creds.sameName,
    "+79990002201",
    hash,
    ownerA.id,
  ]);
  // B: обычная пара «человек — заведение».
  await sql(`update "Organization" set name = $1, type = 'cafe' where id = $2`, ["Кофейня «Зерно»", ownerB.organizationId]);
  await sql(`update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3 where id = $4`, [
    "Борис Тестов",
    "+79990002202",
    hash,
    ownerB.id,
  ]);
  // Партнёр — своя организация, свой пользователь.
  await sql(`update "Organization" set name = $1 where id = $2`, ["Партнёр e2e", partnerOwner.organizationId]);
  await sql(`update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3 where id = $4`, [
    "Пётр Партнёров",
    "+79990002203",
    hash,
    partnerOwner.id,
  ]);

  // Повар в организации A: баланс не видит, пополнять не может.
  await sql(
    `insert into "User" (id, email, name, "passwordHash", role, "organizationId", "isRoot", "isActive", "journalAccessMigrated", "showWhatsNew")
     values ($1, $2, 'Повар Иванов', $3, 'cook', $4, false, true, true, false)`,
    [`cook${run}`, creds.cook, hash, ownerA.organizationId],
  );

  // Партнёр и привязка организации A (вчера) — комиссия с платежей A идёт ему.
  const partnerId = `partner${run}`;
  await sql(
    `insert into "Partner" (id, slug, code, status, type, "companyName", inn, city, phone, "contactEmail",
       "termsAcceptedAt", "applicantUserId", "applicantOrganizationId", "updatedAt")
     values ($1, $2, $3, 'active', 'consultant', 'ИП Партнёров', '770000000001', 'Москва', '+79990002203', $4,
       now(), $5, $6, now())`,
    [partnerId, `e2e-${run}`, `E${run}`.slice(0, 12).toUpperCase(), creds.partnerUser, partnerOwner.id, partnerOwner.organizationId],
  );
  await sql(
    `insert into "PartnerClient" (id, "partnerId", "organizationId", "accessLevel", source, "attachedAt")
     values ($1, $2, $3, 'view', 'manual', now() - interval '1 day')`,
    [`pc${run}`, partnerId, ownerA.organizationId],
  );

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

  Object.assign(creds, {
    organizationId: ownerA.organizationId,
    ownerId: ownerA.id,
    organizationIdB: ownerB.organizationId,
    ownerIdB: ownerB.id,
    partnerId,
    partnerOrganizationId: partnerOwner.organizationId,
  });
  fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
  console.log("seeded", { run, organizationId: ownerA.organizationId, owner: creds.owner, partnerId });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
