// Тестовые данные e2e orgsw (только локальная база wesetup_wt_orgsw):
//  • консультант Ольга — владелец личного аккаунта (оплачен на 40 дней, скидка навсегда 10 %) с шестью
//    организациями: своя компания «Консалтинг» (домашняя, из неё подана заявка партнёра, ИНН = ИНН партнёра),
//    «Кафе «Ромашка»» (1280: перевод и оплата), «Пекарня «Колосок»» (1280: перевод и возврат),
//    «Кафе «Берёзка»» (390: перевод и оплата), «Столовая «Уют»» (390: перевод и возврат), «Бар «Вечер»»;
//  • действующий партнёрский кабинет «Ольга Консалт» (онбординг пройден);
//  • в каждом кафе — директор-руководитель (он оплачивает после перевода) и повар.
// Пишет creds.json в папку прогона. Запуск: node .agent/tasks/orgsw/e2e/seed.cjs
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { WT, CREDS, sql } = require("./lib.cjs");

// Принятая редакция документов — LEGAL_VERSION из src/lib/legal-consent.ts: иначе поверх кабинета окно «Мы обновили условия».
const LEGAL_VERSION = fs.readFileSync(path.join(WT, "src/lib/legal-consent.ts"), "utf8").match(/LEGAL_VERSION = "([^"]+)"/)[1];

const bcrypt = createRequire(path.join(WT, "package.json"))("bcryptjs");

(async () => {
  const run = Date.now().toString(36);
  const id = (name) => `osw-${name}-${run}`;
  const password = "Orgsw2026!e2e";
  const hash = bcrypt.hashSync(password, 10);
  const paidUntil = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
  const orgs = {
    home: { id: id("home"), name: "Консалтинг «Ольга»", type: "other", inn: "770123456789" },
    romashka: { id: id("romashka"), name: "Кафе «Ромашка»", type: "cafe", inn: "7709000011" },
    kolosok: { id: id("kolosok"), name: "Пекарня «Колосок»", type: "bakery", inn: "7709000022" },
    berezka: { id: id("berezka"), name: "Кафе «Берёзка»", type: "cafe", inn: "7709000033" },
    uyut: { id: id("uyut"), name: "Столовая «Уют»", type: "restaurant", inn: "7709000044" },
    vecher: { id: id("vecher"), name: "Бар «Вечер»", type: "restaurant", inn: "7709000055" },
  };
  const creds = {
    run,
    password,
    paidUntil: paidUntil.toISOString(),
    partnerEmail: `osw-olga-${run}@example.com`,
    managerRomashka: `osw-romashka-${run}@example.com`,
    managerBerezka: `osw-berezka-${run}@example.com`,
    orgs,
  };

  await sql(
    `insert into "Organization" (id, name, type, "subscriptionPlan", "updatedAt")
     values ('platform', 'WeSetup', 'platform', 'platform', now())
     on conflict (id) do nothing`,
  );

  // Организации (без аккаунта — привяжем после создания владельца).
  for (const [key, org] of Object.entries(orgs)) {
    await sql(
      `insert into "Organization" (id, name, type, inn, "subscriptionPlan", "updatedAt", "createdAt", "balanceRub",
         "recurringActive", "recurringParentOrderId")
       values ($1, $2, $3, $4, 'paid', now(), now() - ($5::text || ' days')::interval, $6::int, $7::boolean, $8::int)`,
      [
        org.id,
        org.name,
        org.type,
        org.inn,
        String(60 - Object.keys(orgs).indexOf(key)),
        key === "kolosok" ? 500 : 0,
        key === "romashka",
        key === "romashka" ? 999001 : null,
      ],
    );
  }

  const olgaId = id("olga");
  await sql(
    `insert into "User" (id, email, name, "passwordHash", role, phone, "organizationId", "isActive", "journalAccessMigrated",
       "showWhatsNew", "npsAskedAt", "emailVerifiedAt", "legalVersion")
     values ($1, $2, 'Ольга Консультантова', $3, 'manager', '+79990001001', $4, true, true, false, now(), now(), $5)`,
    [olgaId, creds.partnerEmail, hash, orgs.home.id, LEGAL_VERSION],
  );
  const accountId = id("account");
  await sql(
    `insert into "Account" (id, "ownerUserId", "subscriptionPlan", "subscriptionEnd", "updatedAt")
     values ($1, $2, 'paid', $3, now())`,
    [accountId, olgaId, paidUntil],
  );
  await sql(`update "Organization" set "accountId" = $1 where id = any($2::text[])`, [accountId, Object.values(orgs).map((o) => o.id)]);
  for (const org of Object.values(orgs)) {
    await sql(
      `insert into "OrganizationMember" (id, "userId", "organizationId", role) values ($1, $2, $3, 'owner')`,
      [id(`m-${org.id.slice(4, 12)}`), olgaId, org.id],
    );
  }
  await sql(
    `insert into "BalanceTransaction" (id, "organizationId", amount, kind, description, "createdAt")
     values ($1, $2, 500, 'manual_adjust', 'Начисление для e2e', now())`,
    [id("bal"), orgs.kolosok.id],
  );

  // Скидка навсегда на аккаунте: остаётся у Ольги и к переведённым не применяется.
  const promoId = id("promo");
  await sql(
    `insert into "PromoCode" (id, code, kind, value, lifetime, "updatedAt") values ($1, $2, 'percent', 10, true, now())`,
    [promoId, `VSEGDA${run.slice(-4).toUpperCase()}`],
  );
  await sql(
    `insert into "AccountLifetimeDiscount" (id, "accountId", "promoCodeId", code, kind, value, "orderId")
     values ($1, $2, $3, $4, 'percent', 10, 999002)`,
    [id("lifetime"), accountId, promoId, `VSEGDA${run.slice(-4).toUpperCase()}`],
  );
  creds.lifetimeCode = `VSEGDA${run.slice(-4).toUpperCase()}`;

  // Партнёрский кабинет Ольги.
  const partnerId = id("partner");
  await sql(
    `insert into "Partner" (id, slug, code, status, type, "companyName", inn, city, phone, "contactEmail", "termsAcceptedAt",
       "applicantUserId", "applicantOrganizationId", "onboardingDoneAt", "updatedAt")
     values ($1, $2, $3, 'active', 'consultant', 'ИП Консультантова О. А.', '770123456789', 'Москва', '+79990001001', $4,
       now(), $5, $6, now(), now())`,
    [partnerId, `olga-${run}`, run.slice(-6).toUpperCase().padStart(6, "K"), creds.partnerEmail, olgaId, orgs.home.id],
  );
  await sql(`insert into "PartnerUser" (id, "partnerId", "userId", role) values ($1, $2, $3, 'owner')`, [
    id("pu"),
    partnerId,
    olgaId,
  ]);
  await sql(`insert into "PartnerBranding" ("partnerId", "brandName", "updatedAt") values ($1, 'Ольга Консалт', now())`, [
    partnerId,
  ]);
  creds.partnerId = partnerId;
  creds.accountId = accountId;
  creds.olgaId = olgaId;

  // Люди кафе: директор (руководитель — он оплачивает после перевода) и повар.
  const staff = [
    ["romashka", creds.managerRomashka, "Роман Директоров", "manager"],
    ["romashka", `osw-cook1-${run}@example.com`, "Павел Поваров", "cook"],
    ["berezka", creds.managerBerezka, "Вера Берёзкина", "manager"],
    ["berezka", `osw-cook2-${run}@example.com`, "Анна Кулинарова", "cook"],
    ["kolosok", `osw-baker-${run}@example.com`, "Иван Пекарев", "cook"],
    ["uyut", `osw-cook3-${run}@example.com`, "Мария Супова", "cook"],
  ];
  for (const [org, email, name, role] of staff) {
    await sql(
      `insert into "User" (id, email, name, "passwordHash", role, phone, "organizationId", "isActive", "journalAccessMigrated",
         "showWhatsNew", "npsAskedAt", "emailVerifiedAt", "legalVersion")
       values ($1, $2, $3, $4, $5, '+79990002002', $6, true, true, false, now(), now(), $7)`,
      [id(`u-${email.split("@")[0].slice(4, 14)}`), email, name, hash, role, orgs[org].id, LEGAL_VERSION],
    );
  }

  // Живой пример бейджа: в «Ромашке» и «Берёзке» ведутся три журнала, записи за 28 из 30 прошедших дней —
  // бейдж посчитает настоящий процент (остальные журналы выключены в настройках организации).
  const templates = await sql(`select id, code from "JournalTemplate" where "isActive" = true order by "sortOrder", code`);
  if (templates.length >= 3) {
    const kept = templates.slice(0, 3);
    const disabled = templates.slice(3).map((t) => t.code);
    for (const [orgKey, cookKey] of [["romashka", "cook1"], ["berezka", "cook2"]]) {
      await sql(`update "Organization" set "disabledJournalCodes" = $1::jsonb where id = $2`, [JSON.stringify(disabled), orgs[orgKey].id]);
      const [cook] = await sql(`select id from "User" where email = $1`, [`osw-${cookKey}-${run}@example.com`]);
      for (let day = 1; day <= 30; day += 1) {
        if (day === 5 || day === 17) continue;
        const at = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - day, 9, 30));
        for (const tpl of kept) {
          await sql(
            `insert into "JournalEntry" (id, "templateId", "organizationId", "filledById", data, "createdAt", "updatedAt")
             values ($1, $2, $3, $4, '{}'::jsonb, $5, $5)`,
            [id(`je-${orgKey}-${day}-${tpl.code}`.slice(0, 60)), tpl.id, orgs[orgKey].id, cook.id, at],
          );
        }
      }
    }
    creds.badgeJournals = kept.map((t) => t.code);
  }

  fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
  console.log("seeded", { run, partner: creds.partnerEmail, accountId, partnerId });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
