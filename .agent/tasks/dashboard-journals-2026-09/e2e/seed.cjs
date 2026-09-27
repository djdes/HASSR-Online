// Тестовая организация для e2e: ресторан, владелец (мгновенная регистрация через API),
// 10 электронных журналов (5 заполнены сегодня — см. lib.resetToday), 5 бумажных, остальные отключены.
// Запуск (dev-сервер уже поднят): node .agent/tasks/dashboard-journals-2026-09/e2e/seed.cjs
// Пишет creds.json в E2E_OUT (вне проекта): почта и пароль для входа из других скриптов.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { BASE, WT, OUT, CREDS, ENABLED, launch, sql, resetToday } = require("./lib.cjs");

const bcrypt = createRequire(path.join(WT, "package.json"))("bcryptjs");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const run = Date.now().toString(36);
  const creds = { run, password: "DashJournals2026!", email: `dj-owner-${run}@example.com` };
  const browser = await launch();
  try {
    const ctx = await browser.newContext();
    const reg = await ctx.request.post(`${BASE}/api/auth/instant-register`, {
      data: { email: creds.email, consent: true },
      timeout: 240000,
    });
    const body = await reg.json().catch(() => null);
    if (reg.status() !== 200 || !body || body.created !== true) {
      throw new Error(`instant-register: ${reg.status()} ${JSON.stringify(body)}`);
    }
    const [me] = await sql('select id, "organizationId" from "User" where email = $1', [creds.email]);
    const active = await sql('select code from "JournalTemplate" where "isActive" order by code');
    const disabled = active.map((r) => r.code).filter((code) => !ENABLED.includes(code));
    // Анкета заполнена (иначе поверх — «Завершите регистрацию»), пароль известен, сфера — ресторан.
    await sql(
      'update "Organization" set name = $1, type = $2, "disabledJournalCodes" = $3::jsonb, "disabledPaperJournalIds" = $4::jsonb where id = $5',
      ["Кафе «Ромашка»", "restaurant", JSON.stringify(disabled), "[]", me.organizationId],
    );
    await sql(
      'update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3 where id = $4',
      ["Анна Смирнова", "+79990001122", bcrypt.hashSync(creds.password, 10), me.id],
    );
    creds.userId = me.id;
    creds.organizationId = me.organizationId;
    creds.enabled = ENABLED;
    creds.disabledCount = disabled.length;
    fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
    const filled = await resetToday(creds);
    console.log("seeded", { run, organizationId: me.organizationId, enabled: ENABLED.length, disabled: disabled.length, filled });
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
