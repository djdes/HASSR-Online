/**
 * Проверка HTML-видов глазами на локальном стенде (wesetup_company, порт 3041,
 * НЕ прод): форма «Моя компания» (сведения для документов, брендинг),
 * QR-плакаты A4/A5 и наклейки (печать → PDF → PNG), лист приказа, плакат и
 * Программа ППК, портал проверяющего и лист с QR. Организация e2e-org-loc
 * уже подготовлена `gen-samples.ts` (логотип, цвет, правки реквизитов).
 *
 *   npx tsx .agent/tasks/company-docs-brand-2026-10/raw/ui-check.ts
 */
import fs from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "@playwright/test";

import { db } from "@/lib/db";
import { hashInspectorToken } from "@/lib/inspector-tokens";
import { readOrgLogo } from "@/lib/org-logo";
import { renderPdfPageToPng } from "@/lib/journal-preview/render-pages";

const BASE = "http://localhost:3041";
const ORG = "e2e-org-loc";
const EMAIL = "loc-manager@e2e.local";
const OUT = path.join(process.cwd(), ".agent", "tasks", "company-docs-brand-2026-10", "raw", "ui");
const url = process.env.DATABASE_URL ?? "";
if (!url.includes("wesetup_company")) throw new Error(`Не та база: ${url}`);
const state = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), ".agent/tasks/location-tabs-2026-09/e2e/state.json"), "utf8"),
) as { password: string };

const results: Record<string, unknown> = {};
const errors: string[] = [];

async function login(page: Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 600_000 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 30; i += 1) {
      await page.fill("#email", EMAIL);
      await page.fill("#password", state.password);
      if ((await page.inputValue("#email")) === EMAIL) break;
      await page.waitForTimeout(300);
    }
    await page.click('button[type="submit"]');
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
  }
  throw new Error("не удалось войти");
}

async function open(page: Page, route: string, ready: string, state: "visible" | "attached" = "visible") {
  const response = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await page.waitForSelector(ready, { timeout: 600_000, state });
  // `/api/live` — долгий опрос: «networkidle» не наступает, ждём недолго.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  return response?.status() ?? 0;
}

function saveResults() {
  fs.writeFileSync(path.join(OUT, "ui-check.json"), JSON.stringify({ ...results, errors }, null, 2));
}

/** Печатная версия страницы: PDF из Chromium (`@media print`) → PNG первых страниц. */
async function printToPng(page: Page, name: string, pages = 1) {
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ format: "A4", printBackground: false, preferCSSPageSize: true });
  await page.emulateMedia({ media: "screen" });
  fs.writeFileSync(path.join(OUT, `${name}.pdf`), pdf);
  for (let index = 1; index <= pages; index += 1) {
    const sheet = await renderPdfPageToPng(new Uint8Array(pdf), index, { width: 1100 });
    fs.writeFileSync(path.join(OUT, `${name}-p${index}.png`), sheet.png);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // Лист с QR для проверяющих: запись «навсегда» (periodTo 2099) только на локальной базе.
  const qrHash = hashInspectorToken("company-docs-sample-qr-000000000001");
  await db.inspectorToken.deleteMany({ where: { tokenHash: qrHash } });
  const qr = await db.inspectorToken.create({
    data: {
      organizationId: ORG,
      tokenHash: qrHash,
      label: "QR для проверяющих (company-docs)",
      periodFrom: new Date("2026-01-01T00:00:00Z"),
      periodTo: new Date("2099-12-31T00:00:00Z"),
      expiresAt: new Date("2099-12-31T00:00:00Z"),
    },
  });

  // Браузер — установленная сборка (версия Playwright в worktree ждёт другую).
  const shell = path.join(
    process.env.LOCALAPPDATA ?? "",
    "ms-playwright",
    "chromium_headless_shell-1243",
    "chrome-headless-shell-win64",
    "chrome-headless-shell.exe",
  );
  const browser = await chromium.launch(fs.existsSync(shell) ? { executablePath: shell } : {});

  // Обработчик логотипа рабочий (вызов напрямую — ниже). Dev-сервер этой
  // машины временами отвечал HTML-404 на API-маршруты внутри динамического
  // сегмента (и на нетронутые, вроде journal-documents/[id]/entries) —
  // наблюдатель Turbopack «терял» файлы, помогал `touch`. Если dev-сервер
  // логотип не отдаёт, снимки получают его из БД перехватом.
  const { GET: logoRoute } = await import("@/app/api/org-assets/[organizationId]/logo/route");
  const direct = await logoRoute(new Request(`${BASE}/api/org-assets/${ORG}/logo`), {
    params: Promise.resolve({ organizationId: ORG }),
  });
  results.logoRouteDirect = { status: direct.status, contentType: direct.headers.get("content-type") };
  const logoFile = await readOrgLogo(ORG);
  if (!logoFile) throw new Error("у организации нет логотипа — сначала gen-samples.ts");
  const viaServer = await fetch(`${BASE}/api/org-assets/${ORG}/logo`).then((r) => r.status).catch(() => 0);
  results.logoRouteDevServer = viaServer;
  const serveLogo = async (context: BrowserContext) => {
    if (viaServer === 200) return;
    await context.route("**/api/org-assets/*/logo*", (route) =>
      route.fulfill({ status: 200, contentType: logoFile.mime, body: Buffer.from(logoFile.bytes) }),
    );
  };

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light", locale: "ru-RU" });
  await serveLogo(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror ${page.url()}: ${String(error).slice(0, 300)}`));
  try {
    await login(page);

    // 1. Форма: сведения для документов и брендинг.
    results.organization = await open(page, "/settings/organization", "#documents");
    const documents = page.locator("#documents");
    await documents.scrollIntoViewIfNeeded();
    await documents.screenshot({ path: path.join(OUT, "form-documents.png") });
    results.headerPreview = await page.locator("[data-doc-header-preview]").innerText();
    // Живой предпросмотр: правка КПП сразу видна в шапке, «Вернуть из ЕГРЮЛ» её снимает.
    const kpp = documents.locator("input").nth(1);
    await kpp.fill("770199001");
    results.previewAfterEdit = await page.locator("[data-doc-header-preview]").innerText();
    await documents.getByRole("button", { name: "Вернуть из ЕГРЮЛ" }).first().click();
    results.previewAfterReset = await page.locator("[data-doc-header-preview]").innerText();
    const branding = page.locator("#branding");
    await branding.scrollIntoViewIfNeeded();
    await branding.locator("summary").click();
    await branding.screenshot({ path: path.join(OUT, "form-branding.png") });
    saveResults();

    // 2. QR-плакаты: A4, A5, наклейки — печать (печатное дерево на экране скрыто).
    for (const format of ["a4", "a5", "sticker"]) {
      results[`qr-${format}`] = await open(page, `/settings/qr-posters?journal=hygiene&format=${format}`, "[data-qr-print-root]", "attached");
      results[`qr-${format}-logos`] = await page.locator("[data-qr-print-root] img").count();
      results[`qr-${format}-brandBand`] = await page.locator("[data-qr-print-root] .qrp-brand-band").count();
      await printToPng(page, `qr-${format}`);
      saveResults();
    }

    // 3. Лист приказа в редакторе.
    results.order = await open(page, "/orders/haccp-responsible", "article");
    await printToPng(page, "order-sheet");
    saveResults();

    // 4. ППК: плакат и Программа (печать).
    results.poster = await open(page, "/production-control/documents/posters/hand-washing", "h2");
    await printToPng(page, "ppk-poster");
    results.program = await open(page, "/production-control/program", "h1");
    await printToPng(page, "ppk-program-sheet");
    saveResults();

    // 5. Лист с QR для проверяющих.
    results.inspectorSheet = await open(page, `/inspector-sheet/${qr.id}`, "[data-inspector-sheet]");
    await printToPng(page, "inspector-sheet");
    saveResults();
  } finally {
    await context.close();
  }

  // 6. Портал проверяющего (публичный, без входа).
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  await serveLogo(guest);
  const portal = await guest.newPage();
  portal.on("pageerror", (error) => errors.push(`pageerror ${portal.url()}: ${String(error).slice(0, 300)}`));
  results.inspector = await open(portal, "/inspector/company-docs-sample-token-000000000001", "[data-org-title]");
  results.inspectorLogo = await portal.locator("[data-org-logo]").count();
  results.inspectorBand = await portal.locator("[data-brand-band]").count();
  results.inspectorRequisites = await portal.locator("[data-requisites]").innerText();
  await portal.screenshot({ path: path.join(OUT, "inspector-portal.png"), fullPage: false });
  await guest.close();
  await browser.close();

  results.errors = errors;
  fs.writeFileSync(path.join(OUT, "ui-check.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
