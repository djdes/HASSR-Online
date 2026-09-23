// Смоук этапа D «Подписи комиссии»: подпись на сайте, колонка подписи, запрет закрытия.
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/brakerage-commission-2026-09/e2e/smoke-signatures.ts
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { orgTodayKey } from "../../../../src/lib/timezone";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const ORG = "e2e-org-a";
const FP_DOC = "cmu3xu9lc005lks9mmmr8ltma";
const ROW_ID = "smoke-sign-row-1";

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

type Row = { id: string; productName?: string; signatures?: Array<{ userId: string; method: string }>; rejectionTime?: string };

async function docRows(): Promise<{ status: string; rows: Row[] }> {
  const doc = await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true, status: true } });
  return { status: doc.status, rows: ((doc.config as { rows?: Row[] }).rows ?? []) };
}

async function main() {
  const original = await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true, status: true } });
  const originalOrg = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { journalCommissionJson: true } });
  const originalHead = await db.user.findUniqueOrThrow({ where: { id: state.users.headA.id }, select: { seenNoticesJson: true, legalVersion: true } });
  const startedAt = new Date();
  const otherDocs = await db.journalDocument.findMany({
    where: { organizationId: ORG, status: "active", template: { code: "finished_product" }, id: { not: FP_DOC } },
    select: { id: true, config: true },
  });
  const today = orgTodayKey();
  const browser = await chromium.launch({ channel: "chrome" });
  const managerCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const headCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const manager = await managerCtx.newPage();
  const head = await headCtx.newPage();
  const errors: string[] = [];
  head.on("pageerror", (err) => errors.push(String(err)));
  try {
    await login(manager, state.users.managerA.email);
    const saved = await managerCtx.request.put(`${BASE}/api/settings/brakerage-commission/finished_product`, {
      data: { members: [{ employeeId: state.users.headA.id, role: "Председатель" }] },
    });
    check("комиссия: заведующая — председатель", saved.status() === 200, await saved.text());

    // Документ с одной сегодняшней строкой без подписи.
    const cfg = (await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } })).config as Record<string, unknown>;
    await db.journalDocument.update({
      where: { id: FP_DOC },
      data: {
        status: "active",
        config: {
          ...cfg,
          rows: [
            {
              id: ROW_ID,
              productionDateTime: `${today} 12:00`,
              rejectionTime: "",
              productName: "Суп смоук подписи",
              organoleptic: "Отлично",
              releaseAllowed: "yes",
              releasePermissionTime: "",
            },
          ],
        } as never,
      },
    });

    const closeEarly = await managerCtx.request.patch(`${BASE}/api/journal-documents/${FP_DOC}`, { data: { status: "closed" } });
    const closeEarlyBody = (await closeEarly.json().catch(() => null)) as { code?: string } | null;
    check("закрыть с неподписанной строкой нельзя (409 unsigned-rows)", closeEarly.status() === 409 && closeEarlyBody?.code === "unsigned-rows", closeEarlyBody);

    const foreign = await managerCtx.request.post(`${BASE}/api/journal-documents/${FP_DOC}/sign`, { data: { entries: [{ rowId: ROW_ID }] } });
    check("не член комиссии подписать не может (403)", foreign.status() === 403, foreign.status());

    // Руководитель видит запрет в «Закончить журнал».
    await manager.goto(`${BASE}/journals/finished_product/documents/${FP_DOC}`, { waitUntil: "load", timeout: 240_000 });
    const line = manager.getByTestId("brakerage-today-signatures");
    await line.waitFor({ timeout: 60_000 });
    const lineText = await line.innerText();
    check("плашка «Сегодня: 1 строка, 1 ждёт подписи комиссии»", /1 строка, 1 ждёт подписи/.test(lineText), lineText);
    check("у не-члена комиссии нет кнопки «Подписать»", (await manager.getByTestId("selection-sign").count()) === 0);

    // Член комиссии подписывает на сайте.
    await login(head, state.users.headA.email);
    // Первый визит открывает гайд заполнения (модалка z-[80] перекрывает
    // клики), причём чуть позже загрузки — после ответа /api/me/notices.
    // Отмечаем гайд увиденным заранее, как это сделал бы сам гайд.
    const noticeSeen = await head.request.post(`${BASE}/api/me/notices`, { data: { key: "fill-guide:finished_product" } });
    check("гайд заполнения отмечен увиденным до захода", noticeSeen.ok(), noticeSeen.status());
    // «Мы обновили условия» (модалка z-[80]) у заведующей стенда ещё не принято —
    // принимаем заранее тем же запросом, что кнопка модалки; в finally вернём.
    const legal = await head.request.post(`${BASE}/api/legal/accept`, { data: { consent: true } });
    check("условия приняты до захода (модалка не перекроет таблицу)", legal.ok(), legal.status());
    await head.goto(`${BASE}/journals/finished_product/documents/${FP_DOC}`, { waitUntil: "load", timeout: 240_000 });
    await head.getByTestId("brakerage-today-signatures").waitFor({ timeout: 60_000 });
    // Страховка: если гайд всё же открылся (отметка не записалась) — дождаться и закрыть.
    const guide = head.locator('[aria-labelledby="fill-guide-title"]');
    if (await guide.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
      await head.keyboard.press("Escape");
      if (await guide.isVisible().catch(() => false)) await guide.getByRole("button", { name: "Закрыть" }).first().click({ force: true });
      await guide.waitFor({ state: "hidden", timeout: 10_000 });
    }
    const rowCheckbox = head.locator("tbody tr").filter({ hasText: "Суп смоук подписи" }).getByRole("checkbox").first();
    await rowCheckbox.click();
    const signButton = head.getByTestId("selection-sign");
    await signButton.waitFor({ timeout: 15_000 });
    await head.screenshot({ path: path.join(SHOTS, "140-sign-selection-bar.png") });
    await signButton.click();
    await head.getByText(/Подписано строк: 1/).waitFor({ timeout: 30_000 });

    const after = await docRows();
    const signedRow = after.rows.find((row) => row.id === ROW_ID);
    check(
      "подпись в строке: заведующая, метод «вход в кабинет»",
      signedRow?.signatures?.length === 1 && signedRow.signatures[0].userId === state.users.headA.id && signedRow.signatures[0].method === "session",
      signedRow
    );
    check("время снятия бракеража дописано подписью", Boolean(signedRow?.rejectionTime), signedRow?.rejectionTime);
    const events = await db.signatureEvent.count({ where: { documentId: FP_DOC, rowId: ROW_ID, entryKind: "brakerage_row" } });
    check("событие в журнале подписей", events === 1, events);

    const greenText = await head.getByTestId("brakerage-today-signatures").innerText();
    check("плашка стала «все подписаны комиссией»", greenText.includes("все подписаны"), greenText);
    const tableText = await head.locator("tbody tr").filter({ hasText: "Суп смоук подписи" }).first().innerText();
    check("колонка «Подпись бракеражной комиссии» показывает подписавшего", /·\s*\d{2}:\d{2}/.test(tableText), tableText.slice(0, 400));
    await head.screenshot({ path: path.join(SHOTS, "141-signed-row.png") });

    // Сохранение с сайта (устаревшая вкладка руководителя без подписей) не стирает подпись.
    const staleCfg = { ...cfg, rows: [{ id: ROW_ID, productionDateTime: `${today} 12:00`, productName: "Суп смоук подписи", organoleptic: "Отлично", releaseAllowed: "yes" }] };
    const stale = await managerCtx.request.patch(`${BASE}/api/journal-documents/${FP_DOC}`, { data: { config: staleCfg, knownRowIds: [ROW_ID] } });
    const afterStale = await docRows();
    check(
      "сохранение устаревшей вкладки не стирает подпись",
      stale.status() === 200 && (afterStale.rows.find((row) => row.id === ROW_ID)?.signatures?.length ?? 0) === 1,
      afterStale.rows
    );

    const closeLate = await managerCtx.request.patch(`${BASE}/api/journal-documents/${FP_DOC}`, { data: { status: "closed" } });
    check("после подписи журнал закрывается", closeLate.status() === 200, await closeLate.text());
    check("без ошибок в консоли страницы", errors.length === 0, errors);
  } finally {
    await browser.close();
    await db.signatureEvent.deleteMany({ where: { documentId: FP_DOC } });
    await db.journalDocument.update({ where: { id: FP_DOC }, data: { config: original.config as never, status: original.status } });
    await db.organization.update({ where: { id: ORG }, data: { journalCommissionJson: originalOrg.journalCommissionJson as never } });
    for (const doc of otherDocs) await db.journalDocument.update({ where: { id: doc.id }, data: { config: doc.config as never } });
    await db.user.update({
      where: { id: state.users.headA.id },
      data: { seenNoticesJson: (originalHead.seenNoticesJson ?? Prisma.DbNull) as never, legalVersion: originalHead.legalVersion },
    });
    await db.legalConsent.deleteMany({ where: { userId: state.users.headA.id, createdAt: { gte: startedAt } } });
    fs.writeFileSync(path.join(HERE, "smoke-signatures.json"), JSON.stringify(checks, null, 2));
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
