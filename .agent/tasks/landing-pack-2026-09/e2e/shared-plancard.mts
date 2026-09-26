/**
 * Общая карточка тарифа (src/components/pricing/plan-card.tsx) — кроме
 * главной её рисует кабинет (/settings/subscription, PlanUpgrade). Новый
 * флаг `touch` меняет размеры только на главной; здесь доказываем, что
 * без флага классы те же, что до правки, и снимаем кабинетную страницу.
 *
 * Запуск (dev-сервер на :3040):
 *   node --env-file=.env --import tsx .agent/tasks/landing-pack-2026-09/e2e/shared-plancard.mts
 *
 * Вход — тестовый руководитель из сида mobile-cabinet-2026-09 (своя БД копии).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

// src/lib/utils.ts собирается как CommonJS — именованный импорт из .mts не
// виден, берём через default.
import utils from "@/lib/utils";

const { cn } = utils as unknown as typeof import("@/lib/utils");

const BASE = (process.env.BASE ?? "http://localhost:3040").replace(/\/+$/, "");
const TASK = path.join(process.cwd(), ".agent", "tasks", "landing-pack-2026-09");
const OWNER_EMAIL = "e2e-mobile-owner@wesetup.local";
// Пароль тестового руководителя берём из его сида, а не дублируем в код.
const OWNER_PASSWORD =
  /const PASSWORD = "([^"]+)"/.exec(
    fs.readFileSync(path.join(process.cwd(), ".agent", "tasks", "mobile-cabinet-2026-09", "e2e", "seed.ts"), "utf8"),
  )?.[1] ?? "";

const lines: string[] = [];
const log = (line: string) => {
  lines.push(line);
  console.log(line);
};

// 1. Классы без `touch` — те же наборы, что были строками до правки
//    (порядок в строке не важен, tailwind-merge ничего не выкинул).
const same = (label: string, got: string, want: string) => {
  const a = new Set(got.split(/\s+/).filter(Boolean));
  const b = new Set(want.split(/\s+/).filter(Boolean));
  const ok = a.size === b.size && [...a].every((x) => b.has(x));
  log(`${ok ? "SAME" : "DIFF"} ${label}: ${got}`);
  return ok;
};
let allSame = true;
for (const highlighted of [false, true]) {
  const tag = highlighted ? "highlighted" : "plain";
  allSame =
    same(`${tag} period`, cn("text-[13px]", highlighted ? "text-white/60" : "text-[#9b9fb3]"), highlighted ? "text-[13px] text-white/60" : "text-[13px] text-[#9b9fb3]") && allSame;
  allSame =
    same(
      `${tag} pointsIntro`,
      cn("mt-6 font-medium", "text-[13px]", highlighted ? "text-white/60" : "text-[#9b9fb3]"),
      highlighted ? "mt-6 text-[13px] font-medium text-white/60" : "mt-6 text-[13px] font-medium text-[#9b9fb3]",
    ) && allSame;
  allSame =
    same(
      `${tag} points`,
      cn("flex-1 space-y-2.5 pb-8", "text-[14px]", highlighted ? "mt-3 text-white/85" : "mt-6 text-[#3c4053]"),
      highlighted ? "mt-3 flex-1 space-y-2.5 pb-8 text-[14px] text-white/85" : "mt-6 flex-1 space-y-2.5 pb-8 text-[14px] text-[#3c4053]",
    ) && allSame;
  allSame =
    same(
      `${tag} note`,
      cn("mt-auto mb-2.5 text-center", "text-[12px]", "leading-snug", highlighted ? "text-white/70" : "text-[#6f7282]"),
      highlighted ? "mt-auto mb-2.5 text-center text-[12px] leading-snug text-white/70" : "mt-auto mb-2.5 text-center text-[12px] leading-snug text-[#6f7282]",
    ) && allSame;
  allSame =
    same(
      `${tag} cta`,
      cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-2xl font-medium transition-colors",
        "h-11 text-[15px]",
        highlighted
          ? "bg-white text-[#0b1024] hover:bg-white/90"
          : "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]",
      ),
      highlighted
        ? "inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-medium text-[#0b1024] transition-colors hover:bg-white/90"
        : "inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]",
    ) && allSame;
}
allSame =
  same(
    "disabled cta",
    cn("inline-flex w-full cursor-default items-center justify-center gap-2 rounded-2xl border border-[#c7ccea] bg-[#eef1ff] font-medium text-[#3848c7]", "h-11 text-[15px]"),
    "inline-flex h-11 w-full cursor-default items-center justify-center gap-2 rounded-2xl border border-[#c7ccea] bg-[#eef1ff] text-[15px] font-medium text-[#3848c7]",
  ) && allSame;
log(`RESULT classes without touch: ${allSame ? "identical to HEAD" : "CHANGED"}`);

// 2. Кабинет: /settings/subscription на 390 и 1440.
function chromePath(): string {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const dir = fs.readdirSync(root).filter((name) => name.startsWith("chromium-")).sort().reverse()[0];
  return path.join(root, dir, "chrome-win64", "chrome.exe");
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
try {
  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, colorScheme: "light" });
    const login = await ctx.request.post(`${BASE}/api/auth/login`, {
      data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
      headers: { "x-forwarded-for": `192.0.2.${width === 390 ? 51 : 52}` },
    });
    log(`login ${width}: ${login.status()}`);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/settings/subscription`, { waitUntil: "load", timeout: 300_000 });
    await page.waitForTimeout(2500);
    const cards = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a, span[aria-disabled]"))
        .filter((el) => /Начать бесплатно|Текущий|Оплатить|Перейти|Подключить/.test(el.textContent ?? ""))
        .map((el) => ({ text: (el.textContent ?? "").trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height), cls: (el.getAttribute("class") ?? "").includes("h-11") })),
    );
    log(`subscription ${width}: ${JSON.stringify(cards)}`);
    await page.screenshot({ path: path.join(TASK, "evidence", `after-cabinet-subscription-${width}.png`), fullPage: false });
    await ctx.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(TASK, "raw", "shared-plancard.txt"), lines.join("\n") + "\n");
