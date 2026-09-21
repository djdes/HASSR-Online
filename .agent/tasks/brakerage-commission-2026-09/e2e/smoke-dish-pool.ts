// Смоук общего справочника блюд (этап E): организация B вносит блюдо → A привязывает код B
// (превью с названием B) → блюдо B в подсказках A → отвязка — чужое пропало, своё осталось.
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/brakerage-commission-2026-09/e2e/smoke-dish-pool.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const FP_DOC = "cmu3xu9lc005lks9mmmr8ltma";

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
  }
  throw new Error("login failed");
}

async function suggestions(ctx: BrowserContext): Promise<string[]> {
  const res = await ctx.request.get(`${BASE}/api/name-suggestions?scope=dish`);
  const body = (await res.json().catch(() => ({}))) as { values?: string[] };
  return body.values ?? [];
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctxB = await browser.newContext();
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  try {
    await db.nameSuggestion.upsert({
      where: { organizationId_scope_value: { organizationId: "e2e-org-b", scope: "dish", value: "Сырники E2E пул" } },
      update: { lastUsedAt: new Date() },
      create: { organizationId: "e2e-org-b", scope: "dish", value: "Сырники E2E пул" },
    });
    await db.nameSuggestion.upsert({
      where: { organizationId_scope_value: { organizationId: "e2e-org-a", scope: "dish", value: "Борщ E2E свой" } },
      update: { lastUsedAt: new Date() },
      create: { organizationId: "e2e-org-a", scope: "dish", value: "Борщ E2E свой" },
    });

    await login(pageB, state.users.managerB.email);
    const infoB = (await (await ctxB.request.get(`${BASE}/api/settings/dish-pool`)).json()) as { ownCode: string };
    check("у организации B есть служебный код", /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(infoB.ownCode), infoB);

    await login(pageA, state.users.managerA.email);
    const before = await suggestions(ctxA);
    check("до привязки блюда B в подсказках A нет", !before.includes("Сырники E2E пул"));

    const bad = await ctxA.request.post(`${BASE}/api/settings/dish-pool`, { data: { code: "ZZZZZ-ZZZZZ" } });
    check("неизвестный код — понятная ошибка", bad.status() === 400);

    const preview = (await (await ctxA.request.post(`${BASE}/api/settings/dish-pool`, { data: { code: infoB.ownCode.toLowerCase() } })).json()) as {
      preview?: { organizationName: string };
    };
    check("превью называет организацию-владельца кода", Boolean(preview.preview?.organizationName), preview);

    // UI: раздел в «Настройках документа», ввод кода, предупреждение, подключение.
    await pageA.goto(`${BASE}/journals/finished_product/documents/${FP_DOC}`, { waitUntil: "load", timeout: 240_000 });
    await pageA.getByRole("button", { name: /Настройки документа/ }).first().click();
    await pageA.getByTestId("own-service-code").waitFor({ timeout: 60_000 });
    await pageA.getByLabel("Привязать журнал, служебный код").fill(infoB.ownCode);
    await pageA.getByRole("button", { name: "Привязать", exact: true }).click();
    await pageA.getByText("Номенклатура блюд станет единой").waitFor({ timeout: 30_000 });
    await pageA.screenshot({ path: path.join(SHOTS, "120-dish-pool-warning.png") });
    await pageA.getByRole("button", { name: "Подключить общий справочник" }).click();
    await pageA.getByText(/Подключено к базе/).waitFor({ timeout: 30_000 });
    check("после подтверждения раздел показывает «Подключено к базе…»", true);

    const linked = await suggestions(ctxA);
    check(
      "после привязки блюдо B в подсказках A, свои — выше",
      linked.includes("Сырники E2E пул") && linked.indexOf("Борщ E2E свой") < linked.indexOf("Сырники E2E пул"),
      linked.slice(0, 10)
    );

    const unlink = await ctxA.request.delete(`${BASE}/api/settings/dish-pool`);
    const after = await suggestions(ctxA);
    check(
      "после отвязки чужое блюдо пропало, своё осталось",
      unlink.status() === 200 && !after.includes("Сырники E2E пул") && after.includes("Борщ E2E свой"),
      after.slice(0, 10)
    );
  } finally {
    await browser.close();
    await db.nameSuggestion.deleteMany({ where: { value: { in: ["Сырники E2E пул", "Борщ E2E свой"] } } });
    await db.organization.update({ where: { id: "e2e-org-a" }, data: { linkedServiceCode: null } });
    fs.writeFileSync(path.join(HERE, "smoke-dish-pool.json"), JSON.stringify(checks, null, 2));
    await db.$disconnect();
  }
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
