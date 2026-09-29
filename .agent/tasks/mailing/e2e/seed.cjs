// Посев для e2e рассылки. Запуск: node seed.cjs (стенд :3193 должен работать).
//   A «Кафе «Ромашка»» (cafe)       — руководитель Анна: Telegram привязан, веб-push подписка; повар Пётр (служебная почта)
//   B «Ресторан «Север»» (restaurant) — руководитель Борис: только почта
//   C «Пекарня «Колос»» (bakery)    — руководитель Вера: оплачено +30 дней, телефон с приложением (Firebase не настроен)
//   D «Кофейня «Зерно»» (cafe)      — руководитель Глеб: контактная почта отдельно от логина
// Плюс адрес в стоп-листе заранее и настройки скорости по умолчанию.
const fs = require("node:fs");
const path = require("node:path");
const { BASE, OUT, sql, launch, hash } = require("./lib.cjs");

const PASSWORD = "Mailing2026!";

async function register(ctx, email, ip) {
  const res = await ctx.request.post(`${BASE}/api/auth/instant-register`, {
    data: { email, consent: true },
    headers: { "x-forwarded-for": ip, "x-real-ip": ip },
    timeout: 240000,
  });
  const body = await res.json().catch(() => null);
  if (res.status() !== 200 || !body || body.created !== true) {
    throw new Error(`instant-register ${email}: ${res.status()} ${JSON.stringify(body)}`);
  }
  const [me] = await sql('select id, "organizationId" from "User" where email = $1', [email]);
  return me;
}

(async () => {
  const run = Date.now().toString(36);
  const pw = hash(PASSWORD);
  // Прошлые прогоны — прочь: аудитория считает все организации.
  const old = await sql(`select distinct "organizationId" as id from "User" where email like 'ml-%@example.com'`);
  if (old.length) {
    await sql(`delete from "Organization" where id = any($1)`, [old.map((r) => r.id)]);
    console.log("removed old e2e orgs:", old.length);
  }
  await sql(`delete from "MailingCampaign"`);
  await sql(`delete from "MarketingContact"`);
  await sql(`delete from "EmailSuppression"`);
  await sql(`delete from "PlatformSetting" where key = 'mailing.settings'`);
  await sql(`update "User" set "marketingOptOut" = false`);
  // ROOT в локальной базе — с адресом на .local (писем не принимает): для «теста себе» — контактная почта.
  await sql(`update "User" set "contactEmail" = 'root.e2e@example.com' where "isRoot" = true`);

  const specs = [
    { key: "a", org: "Кафе «Ромашка»", type: "cafe", name: "Анна Смирнова", tg: "100000001", webPush: true, staff: "Пётр Повар" },
    { key: "b", org: "Ресторан «Север»", type: "restaurant", name: "Борис Северов" },
    { key: "c", org: "Пекарня «Колос»", type: "bakery", name: "Вера Колосова", paidDays: 30, device: true },
    { key: "d", org: "Кофейня «Зерно»", type: "cafe", name: "Глеб Зернов", contactEmail: `ml-d-work-${run}@example.com` },
  ];
  const creds = { run, password: PASSWORD, users: {} };
  const browser = await launch();
  try {
    const ctx = await browser.newContext();
    let n = 20;
    for (const s of specs) {
      n += 1;
      const email = `ml-${s.key}-${run}@example.com`;
      const me = await register(ctx, email, `10.88.0.${n}`);
      const orgId = me.organizationId;
      const end = s.paidDays ? `now() + interval '${s.paidDays} days'` : "null";
      await sql(
        `update "Organization" set name = $1, type = $2, "subscriptionPlan" = $3, "subscriptionEnd" = ${end} where id = $4`,
        [s.org, s.type, s.paidDays ? "paid" : "free", orgId]
      );
      await sql(
        `update "Account" set "subscriptionPlan" = $1, "subscriptionEnd" = ${end}
           where id = (select "accountId" from "Organization" where id = $2)`,
        [s.paidDays ? "paid" : "free", orgId]
      );
      await sql(
        `update "User" set name = $1, "passwordHash" = $2, "showWhatsNew" = false, "contactEmail" = $3,
           "telegramChatId" = $4, phone = $5, "createdAt" = now() - interval '${n} days' where id = $6`,
        [s.name, pw, s.contactEmail ?? null, s.tg ?? null, `+7999100${String(n).padStart(4, "0")}`, me.id]
      );
      if (s.webPush) {
        await sql(
          `insert into "WebPushSubscription" (id, "organizationId", "userId", endpoint, p256dh, auth)
           values ($1, $2, $3, $4, 'BFakeKeyForE2E', 'fakeauth')`,
          [`wp-${run}-${s.key}`, orgId, me.id, `https://push.example.invalid/e2e/${run}/${s.key}`]
        );
      }
      if (s.device) {
        await sql(
          `insert into "MobileDevice" (id, "organizationId", "userId", platform, token, "appVersion")
           values ($1, $2, $3, 'android', $4, '1.0.0')`,
          [`md-${run}-${s.key}`, orgId, me.id, `fcm-e2e-${run}-${s.key}`]
        );
      }
      if (s.staff) {
        await sql(
          `insert into "User" (id, email, name, "passwordHash", role, "organizationId")
           values ($1, $2, $3, $4, 'cook', $5)`,
          [`st-${run}-${s.key}`, `staff-${run}${s.key}@${orgId}.local.haccp`, s.staff, pw, orgId]
        );
      }
      creds.users[s.key] = { id: me.id, email, orgId, org: s.org, name: s.name, contactEmail: s.contactEmail ?? null };
      console.log("seeded", s.key, s.org, email);
    }
  } finally {
    await browser.close();
  }
  await sql(
    `insert into "EmailSuppression" (id, email, reason, note) values ($1, 'blocked@example.com', 'manual', 'e2e: заранее в стоп-листе')`,
    [`sup-${run}`]
  );
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "creds.json"), JSON.stringify(creds, null, 2));
  console.log("creds →", path.join(OUT, "creds.json"));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
