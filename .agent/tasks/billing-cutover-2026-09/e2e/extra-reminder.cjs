// Дополнительно: предупреждение «выберите до …» в грейсе — одно, дедуп по аудиту;
// попытка Telegram владельцу пишется в TelegramLog (токен фиктивный — отправка не уходит).
const fs = require("node:fs");
const path = require("node:path");
const { BASE, OUT, envValue, launch, sql, login, hash } = require("./lib.cjs");

const results = { checks: [] };
function check(name, ok, details) {
  results.checks.push({ name, ok: Boolean(ok), details: details ?? null });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${details ? ` — ${JSON.stringify(details)}` : ""}`);
}

(async () => {
  const run = Date.now().toString(36);
  const browser = await launch();
  try {
    const ctx = await browser.newContext();
    const email = `bc-f-owner-${run}@example.com`;
    const reg = await ctx.request.post(`${BASE}/api/auth/instant-register`, {
      data: { email, consent: true },
      headers: { "x-forwarded-for": "10.77.1.1" },
      timeout: 240000,
    });
    if (reg.status() !== 200) throw new Error(`register ${reg.status()}`);
    const [me] = await sql('select id, "organizationId" from "User" where email = $1', [email]);
    await sql(`update "Organization" set name = 'Столовая «Ф»', "subscriptionPlan" = 'paid' where id = $1`, [me.organizationId]);
    await sql(`update "Account" set "subscriptionPlan" = 'paid' where "ownerUserId" = $1`, [me.id]);
    await sql(`update "User" set name = 'Фёдор Владелец', "passwordHash" = $1, "telegramChatId" = '999000111' where id = $2`, [hash("x"), me.id]);
    for (let i = 1; i <= 2; i += 1) {
      await sql(
        `insert into "User" (id, email, name, "passwordHash", role, "organizationId", "journalAccessMigrated") values ($1,$2,$3,'','cook',$4,true)`,
        [`uF${i}${run}`, `staff-uF${i}${run}@x.local.haccp`, `Повар ${i}`, me.organizationId],
      );
    }
    // Период кончился вчера, грейс 7 дней идёт.
    const root = await browser.newContext();
    await login(root, envValue("ROOT_EMAIL"), envValue("ROOT_PASSWORD"));
    const now = Date.now();
    const put = await root.request.put(`${BASE}/api/root/billing-period`, {
      data: { startsAt: new Date(now - 11 * 864e5).toISOString(), endsAt: new Date(now - 864e5).toISOString(), graceDays: 7, transitionEnabled: true },
      timeout: 240000,
    });
    check("ROOT: период кончился, грейс идёт", put.status() === 200);
    const secret = envValue("CRON_SECRET");
    const run1 = await (await root.request.get(`${BASE}/api/cron/billing-transition`, { headers: { Authorization: `Bearer ${secret}` }, timeout: 240000 })).json();
    const mine1 = run1.results.find((r) => r.organizationId === me.organizationId);
    check("в грейсе — предупреждение, без архивации", mine1?.action === "await_decision" && mine1?.outcome === "reminder sent", mine1);
    const run2 = await (await root.request.get(`${BASE}/api/cron/billing-transition`, { headers: { Authorization: `Bearer ${secret}` }, timeout: 240000 })).json();
    const mine2 = run2.results.find((r) => r.organizationId === me.organizationId);
    check("повторный запуск: предупреждение не дублируется", mine2?.outcome === "reminder already sent", mine2);
    const audit = await sql(`select count(*)::int as n from "AuditLog" where "organizationId" = $1 and action = 'billing.transition.reminder'`, [me.organizationId]);
    check("в журнале действий одно напоминание", audit[0].n === 1, audit[0]);
    const tg = await sql(`select kind, status from "TelegramLog" where "organizationId" = $1 order by "createdAt"`, [me.organizationId]);
    check("Telegram владельцу: попытка записана в TelegramLog", tg.some((t) => t.kind === "billing.reminder"), tg);
    const active = await sql(`select count(*)::int as n from "User" where "organizationId" = $1 and "isActive" and "archivedAt" is null`, [me.organizationId]);
    check("сотрудники в грейсе остаются в работе", active[0].n === 3, active[0]);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, "results-extra.json"), JSON.stringify(results, null, 2));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
