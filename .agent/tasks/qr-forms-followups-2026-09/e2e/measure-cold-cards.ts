// AC3: поле температуры в карточках холодильников на сайте (журнал документа) показывает
// число целиком: ось «Сегодня» (карточки) и «По оборудованию» (строки дней), 390 и 1440.
// Запуск: dev на 3042 → npx tsx --env-file=.env .agent/tasks/qr-forms-followups-2026-09/e2e/measure-cold-cards.ts [префикс снимков]
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { db } from "@/lib/db";

const BASE = process.env.BASE ?? "http://localhost:3042";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = path.join(HERE, "..", "evidence");
const SAMPLE = "-18,5";

export const PHONE_390 = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU" };
export const DESKTOP_1440 = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" };

/** Сессия кабинета одна на весь прогон: частые входы упираются в лимит попыток входа. */
let sessionCookies: Awaited<ReturnType<BrowserContext["cookies"]>> | null = null;

export async function login(context: BrowserContext): Promise<Page> {
  if (sessionCookies) {
    await context.addCookies(sessionCookies);
    const page = await context.newPage();
    const session = await (await page.request.get(`${BASE}/api/auth/session`, { timeout: 240_000 })).json();
    if (session?.user) return page;
    await page.close();
  }
  const page = await context.newPage();
  const csrf = await (await page.request.get(`${BASE}/api/auth/csrf`, { timeout: 240_000 })).json();
  await page.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { email: "admin@haccp.local", password: "admin1234", csrfToken: csrf.csrfToken, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
    timeout: 240_000,
  });
  const session = await (await page.request.get(`${BASE}/api/auth/session`, { timeout: 240_000 })).json();
  if (!session?.user) throw new Error("login failed");
  // Окно «Мы обновили условия» закрывало бы страницу на снимках.
  await page.request.post(`${BASE}/api/legal/accept`, { data: { consent: true }, timeout: 240_000 });
  sessionCookies = await context.cookies(BASE);
  return page;
}

/** Ширина текста «-18,5» шрифтом поля против места под текст (без отступов и «°C»). */
async function fieldMetrics(page: Page, selector: string) {
  return page.evaluate(
    ({ selector, sample }) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      return Array.from(document.querySelectorAll<HTMLInputElement>(selector))
        .filter((el) => el.offsetParent !== null)
        .slice(0, 3)
        .map((el) => {
          const cs = getComputedStyle(el);
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const need = ctx.measureText(sample).width;
          const textArea = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const card = el.closest("[data-testid]")?.parentElement ?? el.parentElement!;
          const tools = el.closest(".\\@container")?.querySelector('[data-testid="cold-cell-tools"]') as HTMLElement | null;
          const inputRect = el.getBoundingClientRect();
          const toolsRect = tools?.getBoundingClientRect();
          return {
            id: el.id,
            inputWidth: Math.round(inputRect.width),
            textArea: Math.round(textArea),
            need: Math.round(need),
            fits: textArea >= need,
            toolsBelow: toolsRect ? toolsRect.top >= inputRect.bottom - 1 : null,
            overflowsCard: Boolean(card && toolsRect && toolsRect.right > document.documentElement.clientWidth),
          };
        });
    },
    { selector, sample: SAMPLE }
  );
}

async function shotCard(page: Page, input: ReturnType<Page["locator"]>, file: string) {
  // Без blur: значение только показываем, в журнал оно не уходит.
  await input.fill(SAMPLE);
  const card = input.locator("xpath=ancestor::div[contains(@class,'py-2.5') or contains(@class,'rounded-xl')][1]");
  // Значок dev-оверлея Next и плавающие кнопки у нижнего края не должны закрывать карточку.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  const box = await card.boundingBox();
  const vw = page.viewportSize()!.width;
  await page.screenshot({
    path: path.join(OUT, file),
    ...(box ? { clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: Math.min(box.width + 24, vw - Math.max(0, box.x - 12)), height: box.height + 24 } } : {}),
  });
}

export async function measureColdCards(browser: import("playwright").Browser, docId: string, prefix: string | null) {
  const result: Record<string, unknown> = {};
  for (const [name, opts] of [["390", PHONE_390], ["1440", DESKTOP_1440]] as const) {
    for (const axis of ["today", "entity"] as const) {
      const context = await browser.newContext(opts);
      await context.addInitScript((axisValue) => {
        try {
          localStorage.setItem("journal-mobile-view:cold_equipment_control", "cards");
          localStorage.setItem("journal-mobile-axis:cold_equipment_control", axisValue);
        } catch {}
      }, axis);
      const page = await login(context);
      await page.goto(`${BASE}/journals/cold_equipment_control/documents/${docId}`, { waitUntil: "load", timeout: 240_000 });
      let selector = 'input[id^="today-temp-"]';
      if (axis === "entity") {
        // Раскрыть первую карточку оборудования без отметки «обсл»/«рем»: внутри — строки дней.
        selector = 'input[id^="temp-"]';
        const toggles = page.locator("button.text-left:has(svg.lucide-chevron-down)");
        await toggles.first().waitFor({ timeout: 240_000 });
        const count = await toggles.count();
        for (let i = 0; i < count; i += 1) {
          await toggles.nth(i).click();
          await page.waitForTimeout(400);
          if ((await page.locator(selector).count()) > 0) break;
          await toggles.nth(i).click();
        }
      }
      await page.locator(selector).first().waitFor({ timeout: 240_000 });
      await page.waitForTimeout(1200);
      result[`${axis}-${name}`] = await fieldMetrics(page, selector);
      if (prefix) await shotCard(page, page.locator(selector).first(), `${prefix}-${axis}-${name}.png`);
      await context.close();
    }
  }
  return result;
}

async function main() {
  const doc = await db.journalDocument.findFirstOrThrow({
    where: { template: { code: "cold_equipment_control" }, status: "active", organization: { name: { contains: "Гавань" } } },
    select: { id: true },
  });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const result = await measureColdCards(browser, doc.id, process.argv[2] ?? null);
    console.log(JSON.stringify(result, null, 1));
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.includes("measure-cold-cards")) void main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
