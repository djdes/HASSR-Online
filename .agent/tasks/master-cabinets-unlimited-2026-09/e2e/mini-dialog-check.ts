// Мини-приложение: окно «Новый мастер-кабинет» поверх шапки и нижнего меню
// (до портала шапка и меню его накрывали, «Отмена» уходила под меню).
// Один вход; временный аккаунт manager-a откатывается в finally.
// Запуск: DATABASE_URL=<e2e> node --import tsx .agent/tasks/master-cabinets-unlimited-2026-09/e2e/mini-dialog-check.ts
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { APP_UA, BASE, db, signIn, USERS } from "../../mobile-apps-2026-09/e2e/server-db";

if (!/@localhost:5432\/wesetup_e2e\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL must be e2e db");

const OUT = ".agent/tasks/master-cabinets-unlimited-2026-09/e2e/mini-dialog-check.json";
const SHOTS = "d:/wt/tmp/mc-shots";
const ORG_A = "e2e-org-a";

async function main() {
  const out: Record<string, unknown> = {};
  const browser = await chromium.launch({ headless: true });
  const owner = await db.user.findFirstOrThrow({ where: { email: USERS.managerA }, select: { id: true } });
  const orgA = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { accountId: true } });
  const account = await db.account.create({ data: { ownerUserId: owner.id }, select: { id: true } });
  await db.organization.update({ where: { id: ORG_A }, data: { accountId: account.id } });
  try {
    const ctx = await browser.newContext({ userAgent: APP_UA("1.0.0"), viewport: { width: 390, height: 844 } });
    await ctx.addInitScript("try{localStorage.removeItem(\"wesetup.last-seen-build-sha\")}catch(e){}");
    await signIn(ctx, USERS.managerA);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/mini/me`, { waitUntil: "load", timeout: 300000 });
    await page.getByTestId("mini-create-master-cabinet").click({ timeout: 60000 });
    const dialog = page.getByTestId("create-master-cabinet-dialog");
    await dialog.getByTestId("create-master-cabinet-object").first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
    // Верхний элемент в точке заголовка, «Отмена» и «Создать» — внутри окна.
    // Строкой, а не функцией: tsx оборачивает вложенные функции в __name,
    // которого нет в странице.
    out.onTop = await page.evaluate(`(() => {
      const form = document.querySelector('[data-testid="create-master-cabinet-dialog"]');
      function probe(el) {
        if (!el) return "missing";
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return form && form.contains(top) ? "dialog" : String((top && top.className) || "none").slice(0, 60);
      }
      const buttons = Array.from(form ? form.querySelectorAll("button") : []);
      return {
        title: probe(document.getElementById("create-master-cabinet-title")),
        cancel: probe(buttons.find((b) => (b.textContent || "").trim() === "Отмена") || null),
        submit: probe(document.querySelector('[data-testid="create-master-cabinet-submit"]')),
        inBody: Boolean(form && form.parentElement && form.parentElement.parentElement === document.body),
      };
    })()`);
    await page.screenshot({ path: `${SHOTS}/11-mini-dialog-portal.png` });
    assert.deepEqual(out.onTop, { title: "dialog", cancel: "dialog", submit: "dialog", inBody: true });
    // «Отмена» закрывает окно.
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await dialog.waitFor({ state: "detached", timeout: 10000 });
    out.cancelCloses = true;
    await ctx.close();
    out.ok = true;
  } catch (error) {
    out.ok = false;
    out.error = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    throw error;
  } finally {
    await browser.close();
    await db.organization.update({ where: { id: ORG_A }, data: { accountId: orgA.accountId } });
    await db.account.delete({ where: { id: account.id } });
    writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await db.$disconnect();
  }
}

main().catch(() => process.exit(1));
