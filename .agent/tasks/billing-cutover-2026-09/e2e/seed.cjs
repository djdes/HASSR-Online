// Организации для e2e перехода на оплату. Запуск: node seed.cjs (dev-сервер :3171 должен работать).
//   A «Кафе «Ромашка»»   — тестовый «платный» без срока, 4 активных (владелец, повар с паролем, ещё двое) → окно решения
//   B «Столовая «Ласточка»» — бесплатный, 1 активный (владелец) → лимит на втором
//   C «Бар «Орион»»      — реально оплачено (+20 дней), 4 активных → не трогается
//   D «Пекарня «Колос»»   — тестовый «платный», 3 активных → автопереход по грейсу
//   E «Кофейня «Зерно»»   — тестовый «платный», 1 активный → тихий бесплатный
const fs = require("node:fs");
const { BASE, CREDS, sql, launch, hash } = require("./lib.cjs");

const PASSWORD = "Billing2026!";

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
  const [me] = await sql('select id, "organizationId", "legalVersion" from "User" where email = $1', [email]);
  return me;
}

(async () => {
  const run = Date.now().toString(36);
  const pw = hash(PASSWORD);
  const creds = { run, password: PASSWORD, orgs: {} };
  // Прошлые прогоны — прочь: ежедневная задача и счётчики ROOT считают все организации.
  const old = await sql(`select distinct "organizationId" as id from "User" where email like 'bc-%-owner-%@example.com'`);
  if (old.length) {
    const ids = old.map((r) => r.id);
    await sql(`delete from "PaymentOrder" where "organizationId" = any($1)`, [ids]);
    await sql(`delete from "TelegramLog" where "organizationId" = any($1)`, [ids]);
    await sql(`delete from "Organization" where id = any($1)`, [ids]);
    console.log("removed old e2e orgs:", ids.length);
  }
  await sql(`delete from "PlatformSetting" where key = 'billing.free-period'`);
  const browser = await launch();
  try {
    const ctx = await browser.newContext();
    const specs = [
      { key: "A", name: "Кафе «Ромашка»", owner: "Анна Смирнова", plan: "paid", end: null,
        staff: [["Пётр Повар", "cook", true], ["Мария Кассир", "cook", false], ["Олег Мойщик", "cook", false]] },
      { key: "B", name: "Столовая «Ласточка»", owner: "Борис Ласточкин", plan: "free", end: null, staff: [] },
      { key: "C", name: "Бар «Орион»", owner: "Вера Орлова", plan: "paid", end: 20,
        staff: [["Глеб Бармен", "cook", false], ["Дина Официант", "waiter", false], ["Егор Повар", "cook", false]] },
      { key: "D", name: "Пекарня «Колос»", owner: "Жанна Колосова", plan: "paid", end: null,
        staff: [["Захар Пекарь", "cook", false], ["Ирина Кондитер", "cook", false]] },
      { key: "E", name: "Кофейня «Зерно»", owner: "Кирилл Зернов", plan: "paid", end: null, staff: [] },
    ];
    let n = 10;
    for (const spec of specs) {
      n += 1;
      const email = `bc-${spec.key.toLowerCase()}-owner-${run}@example.com`;
      const me = await register(ctx, email, `10.77.0.${n}`);
      const orgId = me.organizationId;
      const [{ accountId }] = await sql('select "accountId" from "Organization" where id = $1', [orgId]);
      const endSql = spec.end ? `now() + interval '${spec.end} days'` : "null";
      await sql(
        `update "Organization" set name = $1, type = 'cafe', "subscriptionPlan" = $2, "subscriptionEnd" = ${endSql},
           "planAutoUpgradedAt" = case when $2 = 'paid' and ${spec.end ? "false" : "true"} then now() else null end
         where id = $3`,
        [spec.name, spec.plan, orgId],
      );
      await sql(
        `update "Account" set "subscriptionPlan" = $1, "subscriptionEnd" = ${endSql} where id = $2`,
        [spec.plan, accountId],
      );
      await sql(
        'update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3, "createdAt" = now() - interval \'30 days\' where id = $4',
        [spec.owner, `+7999000${String(n).padStart(4, "0")}`, pw, me.id],
      );
      // Должность «Повар» — чтобы в «Добавить сотрудника» сразу был выбор.
      const posId = `pos${spec.key}${run}`;
      await sql(
        'insert into "JobPosition" (id, "organizationId", "categoryKey", name, "sortOrder", "updatedAt") values ($1,$2,$3,$4,0, now())',
        [posId, orgId, "staff", "Повар"],
      );
      const staff = [];
      let i = 0;
      for (const [name, role, canLogin] of spec.staff) {
        i += 1;
        const id = `u${spec.key}${i}${run}`;
        const staffEmail = canLogin ? `bc-${spec.key.toLowerCase()}-cook${i}-${run}@example.com` : `staff-${id}@${orgId}.local.haccp`;
        await sql(
          `insert into "User" (id, email, name, phone, "passwordHash", role, "organizationId", "jobPositionId", "positionTitle",
             "journalAccessMigrated", "showWhatsNew", "legalVersion", "createdAt")
           values ($1,$2,$3,$4,$5,$6,$7,$8,'Повар',true,false,$9, now() - interval '${20 - i} days')`,
          [id, staffEmail, name, `+7999100${String(n * 10 + i).padStart(4, "0")}`, canLogin ? pw : "", role, orgId, posId, me.legalVersion],
        );
        staff.push({ id, name, email: staffEmail, canLogin });
      }
      creds.orgs[spec.key] = { orgId, accountId, name: spec.name, owner: { id: me.id, email, name: spec.owner }, staff, positionId: posId };
      console.log("seeded", spec.key, spec.name, orgId, `staff=${staff.length}`);
    }
    fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
    console.log("creds →", CREDS);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
