// E2E главной и галки согласия на письма (спека landing-pack-2026-09).
//
// Запуск (dev-сервер уже поднят на :3040 с NEXTAUTH_URL=http://localhost:3040):
//   node --env-file=.env .agent/tasks/landing-pack-2026-09/e2e/landing-e2e.mjs
//
// AC3: QR-ролик на месте и работает (идёт сам, пауза, переход по главе,
//      «Попробуйте сами»), ссылки на /blanki, /journals-info и все /dlya-*
//      есть на главной и открываются.
// AC4: в окне «Куда прислать шаблон?» галка на письма снята по умолчанию;
//      без неё — одна запись LegalConsent, с ней — вторая (source
//      "blank-download-marketing", дословный текст, IP, браузер); в /root
//      в списке скачиваний колонка «Рассылка: да/нет».
// Протокол — raw/e2e.json, скриншоты — evidence/after-*.png.
import { chromium } from "playwright-core";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.BASE ?? "http://localhost:3040").replace(/\/+$/, "");
const TASK = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const EVIDENCE = path.join(TASK, "evidence");
const RAW = path.join(TASK, "raw");
fs.mkdirSync(EVIDENCE, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

const RUN = Date.now().toString(36);
const EMAIL_PLAIN = `lp.nomkt.${RUN}@example.com`;
const EMAIL_MKT = `lp.mkt.${RUN}@example.com`;
const IP_PLAIN = "198.51.100.21";
const IP_MKT = "198.51.100.22";
const MARKETING_TEXT = "Присылать полезные материалы и новости WeSetup. Согласие можно отозвать в любой момент.";
const CONSENT_TEXT = "Даю согласие на обработку персональных данных и ознакомлен с политикой конфиденциальности";
const NICHE_SLUGS = [
  "dlya-kafe",
  "dlya-pekarni",
  "dlya-stolovoy",
  "dlya-proizvodstva",
  "dlya-bara",
  "dlya-fastfuda",
  "dlya-keyteringa",
  "dlya-otelya",
  "dlya-medcentra",
  "dlya-azs",
  "dlya-magazina",
  "dlya-detskogo-sada",
  "dlya-fitnes-centra",
  "dlya-salona-krasoty",
];

const report = { base: BASE, run: RUN, startedAt: new Date().toISOString(), checks: [] };
function check(name, ok, details) {
  report.checks.push({ name, ok: Boolean(ok), details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details === undefined ? "" : " " + JSON.stringify(details)}`);
}

function chromePath() {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const dirs = fs.readdirSync(root).filter((name) => name.startsWith("chromium-")).sort().reverse();
  for (const dir of dirs) {
    const exe = path.join(root, dir, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error("chromium not found");
}

async function context(browser, width, extra = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: width < 768 ? 844 : 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    acceptDownloads: true,
    ...extra,
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("wesetup-theme-auto-schedule", "0");
      localStorage.setItem("wesetup-theme-mode", "light");
    } catch {
      /* без хранилища — тема по умолчанию */
    }
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  });
  return ctx;
}

const playerState = (page) =>
  page.evaluate(() => {
    const player = document.querySelector("[data-qr-player]");
    const current = document.querySelector('[aria-label="Главы ролика"] [aria-current]');
    return {
      frame: Number(player?.getAttribute("data-frame") ?? -1),
      playing: player?.getAttribute("data-playing") ?? null,
      chapter: current?.textContent?.trim() ?? null,
    };
  });

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
const db = new pg.Client({ connectionString: (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "") });
await db.connect();

try {
  // ── AC3: QR-ролик ────────────────────────────────────────────────
  for (const width of [390, 1440]) {
    const ctx = await context(browser, width);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 300_000 });
    await page.locator("#qr [data-qr-player]").waitFor({ timeout: 120_000 });
    await page.locator("#qr").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const start = await playerState(page);
    await page.waitForTimeout(2000);
    const later = await playerState(page);
    check(`AC3 ${width}: ролик идёт сам в зоне видимости`, later.frame > start.frame && later.playing === "1", { start, later });

    await page.getByRole("button", { name: "Пауза" }).click();
    await page.waitForTimeout(400);
    const paused = await playerState(page);
    await page.waitForTimeout(800);
    const stillPaused = await playerState(page);
    check(`AC3 ${width}: пауза`, paused.playing === "0" && stillPaused.frame === paused.frame, { paused, stillPaused });

    await page.getByRole("button", { name: /4\s*Фритюр/ }).click();
    await page.waitForTimeout(500);
    const chapter4 = await playerState(page);
    check(`AC3 ${width}: переход на главу «Фритюр»`, /Фритюр/.test(chapter4.chapter ?? "") && chapter4.frame !== stillPaused.frame, chapter4);

    await page.getByRole("button", { name: /Попробуйте сами/ }).click();
    await page.locator("#qrp-try-fridge").waitFor({ state: "visible" });
    await page.locator("#qrp-try-fridge").fill("8");
    await page.waitForTimeout(600);
    const tryText = (await page.locator("#qrp-try-panel").innerText()).replace(/\s+/g, " ");
    const afterTry = await playerState(page);
    check(`AC3 ${width}: «Попробуйте сами» — +8 °C вне нормы, ролик на итоге главы`, /Вне нормы/.test(tryText) && /Холодильник/.test(afterTry.chapter ?? ""), { tryText: tryText.slice(0, 90), afterTry });

    if (width === 390) {
      await page.getByRole("button", { name: /Попробуйте сами/ }).click();
      await page.waitForTimeout(300);
      // Липкая шапка и пузырь поддержки висят поверх кадра — на время
      // снимка блока прячем их.
      await page.addStyleTag({ content: ".landing-nav,[class*='fixed'][class*='bottom-5']{visibility:hidden!important}" });
      await page.locator("#qr").screenshot({ path: path.join(EVIDENCE, "after-qr-block-390.png") });
    }

    // Ссылки для поиска — прямо на главной.
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll(".landing-page a[href]")).map((a) => ({ href: a.getAttribute("href"), inFooter: Boolean(a.closest("footer")) })));
    const bodyHrefs = hrefs.filter((h) => !h.inFooter).map((h) => h.href);
    const allHrefs = hrefs.map((h) => h.href);
    const missingNiches = NICHE_SLUGS.filter((slug) => !bodyHrefs.includes(`/${slug}`));
    check(`AC3 ${width}: /blanki и /journals-info в теле страницы и в подвале`, bodyHrefs.includes("/blanki") && bodyHrefs.includes("/journals-info") && allHrefs.filter((h) => h === "/blanki").length >= 2, {
      blanki: allHrefs.filter((h) => h === "/blanki").length,
      journalsInfo: allHrefs.filter((h) => h === "/journals-info").length,
    });
    check(`AC3 ${width}: все 14 страниц сфер /dlya-* в блоке «Журналы для вашей сферы»`, missingNiches.length === 0, { missing: missingNiches });
    await ctx.close();
  }

  // Страницы по ссылкам открываются (каждая /dlya-* — своя папка маршрута).
  const probe = await browser.newContext();
  const statuses = {};
  for (const url of ["/blanki", "/journals-info", "/journals-info/hygiene", ...NICHE_SLUGS.map((slug) => `/${slug}`)]) {
    const res = await probe.request.get(`${BASE}${url}`, { timeout: 300_000 });
    statuses[url] = res.status();
  }
  await probe.close();
  check("AC3: /blanki, /journals-info и все /dlya-* отвечают 200", Object.values(statuses).every((s) => s === 200), statuses);

  // ── AC4: окно «Куда прислать шаблон?» ────────────────────────────
  async function download({ width, email, ip, marketing, shots }) {
    const ctx = await context(browser, width, { extraHTTPHeaders: { "x-forwarded-for": ip } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/journals-info/hygiene`, { waitUntil: "load", timeout: 300_000 });
    // Кнопка — обычная ссылка на файл, пока React не повесил обработчик:
    // ждём гидрации, иначе клик уйдёт по ссылке.
    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await page.getByTestId("blank-download-pdf").first().click();
    const dialog = page.getByTestId("blank-download-dialog");
    try {
      await dialog.waitFor({ state: "visible", timeout: 120_000 });
    } catch (error) {
      await page.screenshot({ path: path.join(RAW, `fail-dialog-${width}.png`) });
      throw error;
    }
    const box = page.getByTestId("blank-download-marketing");
    const defaultChecked = await box.isChecked();
    const labelText = (await box.locator("xpath=ancestor::label[1]").innerText()).replace(/\s+/g, " ").trim();
    if (shots?.empty) await dialog.screenshot({ path: path.join(EVIDENCE, shots.empty) });
    await page.locator("#blank-download-email").fill(email);
    await page.getByTestId("blank-download-consent").check();
    if (marketing) await box.check();
    if (shots?.filled) await dialog.screenshot({ path: path.join(EVIDENCE, shots.filled) });
    await page.getByTestId("blank-download-submit").click();
    await page.getByText("Шаблон скачивается").waitFor({ timeout: 120_000 });
    await ctx.close();
    return { defaultChecked, labelText };
  }

  const plain = await download({ width: 390, email: EMAIL_PLAIN, ip: IP_PLAIN, marketing: false, shots: { empty: "after-modal-default-390.png" } });
  check("AC4: галка «Присылать полезные материалы» по умолчанию снята (390)", plain.defaultChecked === false, plain);
  check("AC4: текст галки и пометка об отзыве согласия", plain.labelText === "Присылать полезные материалы и новости WeSetup Согласие можно отозвать в любой момент.", plain.labelText);
  const mkt = await download({ width: 1440, email: EMAIL_MKT, ip: IP_MKT, marketing: true, shots: { filled: "after-modal-marketing-1440.png" } });
  check("AC4: галка снята по умолчанию и на 1440", mkt.defaultChecked === false);

  const rows = (
    await db.query(
      `select id, email, source, "statementText", "ipAddress", "userAgent", version from "LegalConsent" where email = any($1) order by email, source`,
      [[EMAIL_PLAIN, EMAIL_MKT]],
    )
  ).rows;
  const plainRows = rows.filter((row) => row.email === EMAIL_PLAIN);
  const mktRows = rows.filter((row) => row.email === EMAIL_MKT);
  check("AC4: без галки — только основное согласие (скачивание прошло)", plainRows.length === 1 && plainRows[0].source === "blank-download" && plainRows[0].statementText === CONSENT_TEXT, plainRows.map((r) => r.source));
  const mainRow = mktRows.find((row) => row.source === "blank-download");
  const mktRow = mktRows.find((row) => row.source === "blank-download-marketing");
  check("AC4: с галкой — отдельная запись blank-download-marketing рядом с основной", mktRows.length === 2 && Boolean(mainRow) && Boolean(mktRow), mktRows.map((r) => r.source));
  check("AC4: дословный текст галки в statementText", mktRow?.statementText === MARKETING_TEXT, mktRow?.statementText);
  check("AC4: IP и браузер записаны, как у основного согласия", mktRow?.ipAddress === IP_MKT && mainRow?.ipAddress === IP_MKT && /Chrome/.test(mktRow?.userAgent ?? "") && mktRow?.userAgent === mainRow?.userAgent && mktRow?.version === mainRow?.version, {
    ip: mktRow?.ipAddress,
    ua: (mktRow?.userAgent ?? "").slice(0, 60),
    version: mktRow?.version,
  });
  const audit = (
    await db.query(`select "entityId", details from "AuditLog" where action = 'blank.download' and "entityId" = any($1)`, [rows.map((r) => r.id)])
  ).rows;
  const auditMkt = audit.find((row) => row.entityId === mainRow?.id)?.details;
  const auditPlain = audit.find((row) => row.entityId === plainRows[0]?.id)?.details;
  check("AC4: в журнале скачивания отмечено, была ли галка", auditMkt?.marketing === true && auditMkt?.marketingConsentId === mktRow?.id && auditPlain?.marketing === false, { auditMkt, auditPlain });
  report.consentRows = rows.map((row) => ({ ...row, userAgent: (row.userAgent ?? "").slice(0, 80) }));

  // ── AC4: /root — колонка «Рассылка» ──────────────────────────────
  const rootEmail = process.env.ROOT_EMAIL;
  const rootPassword = process.env.ROOT_PASSWORD;
  if (!rootEmail || !rootPassword) {
    check("AC4 /root: ROOT_EMAIL/ROOT_PASSWORD не заданы", false);
  } else {
    for (const width of [1440, 390]) {
      const ctx = await context(browser, width);
      const login = await ctx.request.post(`${BASE}/api/auth/login`, {
        data: { email: rootEmail, password: rootPassword },
        headers: { "x-forwarded-for": `192.0.2.${width === 1440 ? 41 : 42}` },
      });
      check(`AC4 /root ${width}: ROOT вошёл`, login.ok(), login.status());
      const page = await ctx.newPage();
      await page.goto(`${BASE}/root/blank-downloads`, { waitUntil: "load", timeout: 300_000 });
      if (width === 1440) {
        const table = page.getByTestId("blank-downloads-table");
        await table.waitFor();
        const header = (await table.locator("thead").innerText()).replace(/\s+/g, " ");
        const rowMkt = table.locator("tbody tr", { hasText: EMAIL_MKT });
        const rowPlain = table.locator("tbody tr", { hasText: EMAIL_PLAIN });
        const cellMkt = (await rowMkt.getByTestId("blank-download-marketing-cell").innerText()).trim();
        const cellPlain = (await rowPlain.getByTestId("blank-download-marketing-cell").innerText()).trim();
        check("AC4 /root 1440: колонка «Рассылка» — да/нет", /Рассылка/.test(header) && cellMkt === "да" && cellPlain === "нет", { header, cellMkt, cellPlain });
        await page.screenshot({ path: path.join(EVIDENCE, "after-root-downloads-1440.png") });
      } else {
        const list = page.getByTestId("blank-downloads-list");
        await list.waitFor();
        const itemMkt = (await list.locator("li", { hasText: EMAIL_MKT }).innerText()).replace(/\s+/g, " ");
        const itemPlain = (await list.locator("li", { hasText: EMAIL_PLAIN }).innerText()).replace(/\s+/g, " ");
        check("AC4 /root 390: в карточке «Рассылка: да/нет»", /Рассылка: да/.test(itemMkt) && /Рассылка: нет/.test(itemPlain), { itemMkt, itemPlain });
        await page.screenshot({ path: path.join(EVIDENCE, "after-root-downloads-390.png") });
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await db.end();
}

report.finishedAt = new Date().toISOString();
report.passed = report.checks.filter((c) => c.ok).length;
report.failed = report.checks.filter((c) => !c.ok).length;
fs.writeFileSync(path.join(RAW, "e2e.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.passed} passed, ${report.failed} failed`);
process.exitCode = report.failed ? 1 : 0;
