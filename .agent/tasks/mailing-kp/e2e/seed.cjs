// Посев для e2e рассылки «КП». Запуск: node seed.cjs (стенд :3193 должен работать).
//   Руководитель Анна Смирнова, «Кафе «Ромашка»» (cafe): Telegram привязан.
// Контакты (детсад и отель) загружает сам e2e через ROOT API — как ROOT.
// Прошлые прогоны, коды рассылок и генератора, контакты и стоп-лист — прочь.
process.env.E2E_OUT = process.env.E2E_OUT || "d:/wt/tmp-mailing2/e2e-out";
const fs = require("node:fs");
const path = require("node:path");
const { BASE, OUT, sql, launch, hash } = require("../../mailing/e2e/lib.cjs");

const PASSWORD = "MailingKp2026!";

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
  const old = await sql(
    `select distinct "organizationId" as id from "User" where email like 'kp-%@example.com' or email like 'ml-%@example.com'`
  );
  if (old.length) {
    await sql(`delete from "Organization" where id = any($1)`, [old.map((r) => r.id)]);
    console.log("removed old e2e orgs:", old.length);
  }
  await sql(`delete from "MailingCampaign"`);
  await sql(`delete from "MarketingContact"`);
  await sql(`delete from "EmailSuppression"`);
  await sql(`delete from "PlatformSetting" where key = 'mailing.settings'`);
  await sql(`delete from "PromoCode" where "campaignId" is not null or note like 'Генератор КП%'`);
  await sql(`update "User" set "marketingOptOut" = false`);
  await sql(`update "User" set "contactEmail" = 'root.e2e@example.com' where "isRoot" = true`);

  const creds = { run, password: PASSWORD };
  const browser = await launch();
  try {
    const ctx = await browser.newContext();
    const email = `kp-anna-${run}@example.com`;
    const me = await register(ctx, email, "10.89.0.21");
    await sql(`update "Organization" set name = $1, type = 'cafe' where id = $2`, ["Кафе «Ромашка»", me.organizationId]);
    await sql(
      `update "User" set name = $1, "passwordHash" = $2, "showWhatsNew" = false, "telegramChatId" = $3 where id = $4`,
      ["Анна Смирнова", pw, "100000021", me.id]
    );
    creds.anna = { id: me.id, email, orgId: me.organizationId, org: "Кафе «Ромашка»" };
    console.log("seeded anna", email);
  } finally {
    await browser.close();
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "creds.json"), JSON.stringify(creds, null, 2));
  console.log("creds →", path.join(OUT, "creds.json"));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
