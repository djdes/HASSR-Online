// E2E «Повторить неудачные» (после e2e.cjs): у завершённой рассылки один канал
// помечается ошибкой (как после сбоя SMTP), ROOT жмёт «Повторить неудачные»,
// очередь отправляет заново, итог — «Отправлено», в аудите mailing.campaign.retry.
const fs = require("node:fs");
const path = require("node:path");
const { BASE, OUT, envValue, launch, sql, login, quietPage, gotoHydrated, shot } = require("./lib.cjs");

const results = { checks: [] };
function check(name, ok, details) {
  results.checks.push({ name, ok: Boolean(ok), details: details ?? null });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, details !== undefined ? JSON.stringify(details).slice(0, 300) : "");
}

(async () => {
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    await login(ctx, envValue("ROOT_EMAIL"), envValue("ROOT_PASSWORD"));
    const [campaign] = await sql(`select id from "MailingCampaign" where title = 'E2E: осенние новости' and status = 'done'`);
    check("Есть завершённая рассылка", Boolean(campaign), campaign);
    const [victim] = await sql(
      `select id, email from "MailingRecipient" where "campaignId" = $1 and "isTest" = false and email like 'olga%'`,
      [campaign.id]
    );
    await sql(
      `update "MailingRecipient" set "emailStatus" = 'failed', "emailError" = '421: e2e — сервер попросил повторить позже', status = 'failed', "emailSentAt" = null where id = $1`,
      [victim.id]
    );
    await sql(`update "MailingCampaign" set "failedCount" = 1, "sentCount" = "sentCount" - 1 where id = $1`, [campaign.id]);
    const page = await quietPage(ctx, "retry");
    await gotoHydrated(page, `/root/mailing/${campaign.id}`, '[data-testid="card-retry"]');
    await shot(page, "19-card-failed-1280", false);
    await page.getByTestId("card-retry").click();
    await page.locator('[role="dialog"]').getByRole("button", { name: "Повторить" }).click();
    let row = null;
    for (let i = 0; i < 40; i += 1) {
      [row] = await sql(`select status, "emailStatus", "emailError", attempts from "MailingRecipient" where id = $1`, [victim.id]);
      if (row.emailStatus === "sent") break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    check("Повтор: канал с ошибкой ушёл заново", row.emailStatus === "sent" && row.status === "sent", row);
    const [c] = await sql(`select status, "failedCount", "sentCount" from "MailingCampaign" where id = $1`, [campaign.id]);
    check("Повтор: рассылка снова «Завершена», ошибок 0", c.status === "done" && c.failedCount === 0 && c.sentCount === 5, c);
    const audit = await sql(`select details from "AuditLog" where action = 'mailing.campaign.retry' and "entityId" = $1`, [campaign.id]);
    check("Повтор записан в аудит", audit.length >= 1, audit.map((a) => a.details));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("card-counters").waitFor({ timeout: 60000 });
    await shot(page, "20-card-retried-1280", false);
  } catch (error) {
    check("сценарий без исключений", false, String(error && error.stack ? error.stack : error).slice(0, 800));
  } finally {
    fs.writeFileSync(path.join(OUT, "results-retry.json"), JSON.stringify(results, null, 2));
    await browser.close();
    console.log(`done: ${results.checks.filter((c) => c.ok).length} passed, ${results.checks.filter((c) => !c.ok).length} failed`);
  }
})();
