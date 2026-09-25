/* eslint-disable no-console */
// E2E задачи cabinet-nav-dashboard-2026-09 (AC1–AC4) на локальном dev.
//   BASE=http://localhost:3042 npx tsx .agent/tasks/cabinet-nav-dashboard-2026-09/e2e/verify.ts
// Пишет results.json и скриншоты в ../shots (390 и 1440, светлая и тёмная).
import { chromium, type Browser, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3040";
const TASK = path.resolve(process.cwd(), ".agent/tasks/cabinet-nav-dashboard-2026-09");
const OUT = path.join(TASK, "shots");
fs.mkdirSync(OUT, { recursive: true });
const EMAIL = "e2e-nav@wesetup.local";
const PASSWORD = "E2e-Nav-2026!";
const HIDDEN = ["/batches", "/changes", "/losses", "/competencies", "/bonuses"];
const HIDDEN_LABELS = ["Партии", "Изменения", "Потери", "Компетенции", "Премии"];

const results: Record<string, unknown> = {};
const shot = (p: Page, name: string) =>
  p.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 70, fullPage: false });

async function newPage(browser: Browser, width: number, height: number, theme: "light" | "dark") {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  // esbuild (tsx) оборачивает функции в __name — в странице его нет.
  await ctx.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("wesetup-app-theme", t);
      localStorage.setItem("wesetup-theme-mode", t);
      localStorage.setItem("wesetup-theme-auto-schedule", "0");
      // Гайды и «что нового» не должны закрывать экран на скриншотах.
      localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  // Форма входа отправляется нативно (GET), если нажать до гидратации —
  // ждём сеть и повторяем.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    const ok = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return page;
  }
  throw new Error("login failed");
}

async function dismissOverlays(page: Page) {
  await page.waitForTimeout(1500);

  for (let i = 0; i < 4; i++) {
    const overlay = page.locator("div.fixed.inset-0.z-40, [role=dialog]:not([data-autofill])").first();
    if (!(await overlay.count()) || !(await overlay.isVisible().catch(() => false))) return;
    const btn = overlay.getByRole("button", { name: /Напомнить позже|Позже|Закрыть|Понятно|Отлично/ }).first();
    if (await btn.count()) await btn.click({ force: true }).catch(() => {});
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
}

/** Контраст текста к фону (WCAG), фон — с учётом полупрозрачности над панелью. */
const CONTRAST_FN = `(() => {
  function parse(c){const m=c.match(/rgba?\\(([^)]+)\\)/); if(!m) return [0,0,0,0]; const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0],p[1],p[2],p.length>3?p[3]:1];}
  function over(top,bottom){const a=top[3]; return [top[0]*a+bottom[0]*(1-a),top[1]*a+bottom[1]*(1-a),top[2]*a+bottom[2]*(1-a),1];}
  function lum(c){const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);}
  function effectiveBg(el){const stack=[]; let n=el; while(n&&n.nodeType===1){stack.push(parse(getComputedStyle(n).backgroundColor)); n=n.parentElement;} let bg=[255,255,255,1]; const bodyBg=parse(getComputedStyle(document.body).backgroundColor); if(bodyBg[3]>0) bg=over(bodyBg,[255,255,255,1]); for(let i=stack.length-1;i>=0;i--){ if(stack[i][3]>0) bg=over(stack[i],bg);} return bg;}
  window.__contrast=function(el){const fg=parse(getComputedStyle(el).color); const bg=effectiveBg(el); const L1=lum(fg),L2=lum(bg); const r=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); return {fg:getComputedStyle(el).color,bg:'rgb('+bg.slice(0,3).map(Math.round).join(',')+')',ratio:Math.round(r*100)/100};};
})()`;

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    // ---------------- Desktop 1440, светлая ----------------
    const page = await newPage(browser, 1440, 900, "light");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await page.waitForSelector('details[data-storage-key="compliance-grid"]', { timeout: 120_000 });
    await dismissOverlays(page);

    // AC2 — карточка
    results.card = await page.evaluate(() => {
      const d = document.querySelector('details[data-storage-key="compliance-grid"]') as HTMLElement;
      const summary = d.querySelector("summary") as HTMLElement;
      const h3 = summary.querySelector("h3") as HTMLElement;
      const sr = summary.getBoundingClientRect();
      const hr = h3.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(h3);
      const tr = range.getBoundingClientRect();
      const buttons = Array.from(summary.querySelectorAll("[data-journals-actions] button, [data-journals-actions] a")).map((el) => (el.textContent ?? "").trim());
      return {
        layout: d.getAttribute("data-section-layout"),
        title: (h3.textContent ?? "").trim(),
        textAlign: getComputedStyle(h3).textAlign,
        titleCenterOffsetPx: Math.round((tr.left + tr.width / 2) - (sr.left + sr.width / 2)),
        headingBox: { left: Math.round(hr.left), width: Math.round(hr.width) },
        buttons,
        qrHref: summary.querySelector("[data-qr-link]")?.getAttribute("href"),
        hasOldSubtitle: summary.textContent?.includes("Есть запись за сегодня") ?? false,
        hasCloseDay: /Закрыть день|Выборочно/.test(summary.textContent ?? ""),
      };
    });
    await page.locator('details[data-storage-key="compliance-grid"] summary').screenshot({ path: path.join(OUT, "ac2-card-1440-light.jpg"), type: "jpeg", quality: 75 });

    // AC1 — десктопное меню под пилюлей организации
    const pill = page.locator("header .group\\/nav").first();
    await pill.hover();
    await page.waitForTimeout(400);
    results.desktopMenu = await page.evaluate((hidden) => {
      const menu = document.querySelector('header [role="menu"]');
      const items = Array.from(menu?.querySelectorAll("a[role=menuitem]") ?? []).map((a) => ({ label: (a.textContent ?? "").trim(), href: a.getAttribute("href") }));
      const gear = document.querySelector("header [data-nav-settings]") as HTMLElement | null;
      const pillEl = document.querySelector("header .group\\/nav") as HTMLElement | null;
      const g = gear?.getBoundingClientRect();
      const p = pillEl?.getBoundingClientRect();
      return {
        items,
        hiddenPresent: items.filter((i) => hidden.includes(i.href ?? "")).map((i) => i.href),
        staffBeforeJournals: items.findIndex((i) => i.href === "/settings/users") < items.findIndex((i) => i.href === "/journals"),
        gearHref: gear?.getAttribute("href") ?? null,
        gearGapToOrgPillPx: g && p ? Math.round(g.left - p.right) : null,
      };
    }, HIDDEN);
    await page.screenshot({ path: path.join(OUT, "ac1-desktop-menu-1440-light.jpg"), type: "jpeg", quality: 70, clip: { x: 0, y: 0, width: 900, height: 420 } });
    await page.mouse.move(1200, 700);

    // AC1 — командная палитра не находит убранные разделы
    const palette: Record<string, number> = {};
    await page.keyboard.press("Control+k");
    const paletteInput = page.locator('input[placeholder^="Найти журнал, сотрудника"]');
    await paletteInput.waitFor({ timeout: 20_000 });
    const countExact = (label: string) =>
      page.evaluate((l) => {
        const input = document.querySelector('input[placeholder^="Найти журнал, сотрудника"]') as HTMLElement;
        let root: HTMLElement | null = input;
        for (let i = 0; i < 8 && root && !root.querySelector("ul"); i++) root = root.parentElement;
        return Array.from(root?.querySelectorAll("li") ?? []).filter((li) => (li.querySelector("div div")?.textContent ?? "").trim() === l).length;
      }, label);
    for (const label of HIDDEN_LABELS) {
      await paletteInput.fill(label);
      await page.waitForTimeout(400);
      palette[label] = await countExact(label);
    }
    await paletteInput.fill("Отчёты");
    await page.waitForTimeout(400);
    results.palette = { hiddenMatches: palette, sanityReportsExact: await countExact("Отчёты") };
    await page.keyboard.press("Escape");

    // AC2 — «Автозаполнить»: шторка, картинка, запуск
    await page.locator("[data-autofill-open]").click();
    const dialog = page.locator('[role="dialog"][aria-labelledby="confirm-dialog-title"]');
    await dialog.waitFor({ timeout: 20_000 });
    results.autofillSheet = {
      title: (await dialog.locator("#confirm-dialog-title").textContent())?.trim(),
      text: (await dialog.textContent())?.includes("Создадим или дозаполним записи во всех журналах по прошлым данным, если за сегодня их нет. Уже введённые данные не тронем."),
      illustration: await dialog.locator("[data-autofill-illustration] svg[role=img]").count(),
    };
    await shot(page, "ac2-autofill-sheet-1440-light");
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/dashboard/close-day") && r.request().method() === "POST", { timeout: 240_000 }),
      dialog.getByRole("button", { name: "Автозаполнить" }).click(),
    ]);
    const body = await resp.json().catch(() => null);
    const toast = page.locator("[data-sonner-toast]").first();
    await toast.waitFor({ timeout: 60_000 });
    results.autofillRun = {
      status: resp.status(),
      totalFilled: body?.totalFilled,
      documentsCreated: body?.documentsCreated,
      processed: body?.processed,
      toast: (await toast.textContent())?.trim(),
    };
    await shot(page, "ac2-autofill-toast-1440-light");

    // AC2 — «QR-коды» ведёт в раздел; AC3 — состав раздела
    await page.locator("[data-qr-link]").click();
    await page.waitForURL((u) => u.pathname === "/settings/qr-posters", { timeout: 240_000 });
    await page.waitForSelector("[data-qr-section=main]", { timeout: 240_000 });
    results.qr = await page.evaluate(() => {
      const labels = (section: string) =>
        Array.from(document.querySelectorAll(`[data-qr-section=${section}] article, [data-qr-section=${section}] li, [data-qr-section=${section}] label`))
          .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80));
      const text = (section: string) => (document.querySelector(`[data-qr-section=${section}]`)?.textContent ?? "").replace(/\s+/g, " ");
      const checkboxes = (section: string) => document.querySelectorAll(`[data-qr-section=${section}] input[type=checkbox], [data-qr-section=${section}] [role=checkbox]`).length;
      return {
        url: location.pathname,
        sections: Array.from(document.querySelectorAll("[data-qr-section]")).map((s) => s.getAttribute("data-qr-section")),
        mainTitle: document.querySelector("[data-qr-section=main] h2")?.textContent,
        mainCards: checkboxes("main"),
        mainHasHub: text("main").includes("Все журналы"),
        mainHasVerify: text("main").includes("Допуск сотрудников к смене"),
        journalsRows: checkboxes("journals"),
        journalsHasHygiene: text("journals").includes("Гигиенический журнал"),
        journalsHasFryer: /фритюр/i.test(text("journals")),
        objectsRows: checkboxes("objects"),
        objectsText: text("objects").slice(0, 300),
        sample: labels("journals").slice(0, 3),
      };
    });
    await shot(page, "ac3-qr-1440-light");
    await page.locator("[data-qr-section=journals]").scrollIntoViewIfNeeded();
    await shot(page, "ac3-qr-journals-1440-light");

    // AC1 — страницы убранных разделов открываются по адресу
    const pages: Record<string, { status: number | null; path: string }> = {};
    for (const href of HIDDEN) {
      const r = await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      pages[href] = { status: r?.status() ?? null, path: new URL(page.url()).pathname };
    }
    results.hiddenPages = pages;
    await page.context().close();

    // ---------------- Mobile 390, светлая ----------------
    const mobile = await newPage(browser, 390, 844, "light");
    await mobile.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await mobile.waitForSelector('details[data-storage-key="compliance-grid"]', { timeout: 120_000 });
    await dismissOverlays(mobile);
    await mobile.locator('details[data-storage-key="compliance-grid"] summary').screenshot({ path: path.join(OUT, "ac2-card-390-light.jpg"), type: "jpeg", quality: 75 });
    results.cardMobile = await mobile.evaluate(() => {
      const summary = document.querySelector('details[data-storage-key="compliance-grid"] summary') as HTMLElement;
      const h3 = summary.querySelector("h3") as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(h3);
      const tr = range.getBoundingClientRect();
      const sr = summary.getBoundingClientRect();
      const btns = Array.from(summary.querySelectorAll("[data-journals-actions] > button, [data-journals-actions] > a")).map((b) => {
        const r = b.getBoundingClientRect();
        return { text: (b.textContent ?? "").trim(), h: Math.round(r.height), w: Math.round(r.width) };
      });
      return { titleCenterOffsetPx: Math.round(tr.left + tr.width / 2 - (sr.left + sr.width / 2)), btns, overflowX: document.documentElement.scrollWidth > window.innerWidth };
    });
    await mobile.getByRole("button", { name: "Меню" }).click();
    await mobile.waitForTimeout(800);
    results.mobileMenu = await mobile.evaluate((hidden) => {
      const sheet = Array.from(document.querySelectorAll("[role=dialog]")).find((d) => d.textContent?.includes("Меню")) as HTMLElement;
      const nav = sheet.querySelector("nav") as HTMLElement;
      const links = Array.from(nav.querySelectorAll("a")).map((a) => {
        const r = a.getBoundingClientRect();
        const cs = getComputedStyle(a);
        const icon = a.querySelector("svg")?.getBoundingClientRect();
        return { label: (a.textContent ?? "").trim() || a.getAttribute("aria-label"), href: a.getAttribute("href"), h: Math.round(r.height), font: cs.fontSize, icon: icon ? Math.round(icon.width) : null, top: Math.round(r.top) };
      });
      const gear = nav.querySelector("[data-nav-settings]") as HTMLElement | null;
      const org = links[0];
      return {
        links,
        hiddenPresent: links.filter((l) => hidden.includes(l.href ?? "")).map((l) => l.href),
        settingsRowPresent: links.some((l) => l.label === "Настройки" && !l.href?.includes("aria")) && links.filter((l) => l.href === "/settings").length > 1,
        gear: gear ? { href: gear.getAttribute("href"), sameRowAsOrg: Math.abs(Math.round(gear.getBoundingClientRect().top) - (org?.top ?? -1)) <= 2 } : null,
        staffBeforeJournals: links.findIndex((l) => l.href === "/settings/users") < links.findIndex((l) => l.href === "/journals"),
      };
    }, HIDDEN);
    await shot(mobile, "ac1-mobile-menu-390-light");
    await mobile.keyboard.press("Escape");
    await mobile.waitForTimeout(500);
    await mobile.locator("[data-autofill-open]").click();
    await mobile.locator('[role="dialog"][aria-labelledby="confirm-dialog-title"]').waitFor({ timeout: 20_000 });
    await mobile.waitForTimeout(300);
    results.autofillMobile = await mobile.evaluate(() => {
      const card = document.querySelector('[role="dialog"][aria-labelledby="confirm-dialog-title"] > div[tabindex]') as HTMLElement;
      const r = card.getBoundingClientRect();
      return { bottomAligned: Math.abs(r.bottom - window.innerHeight) <= 2, width: Math.round(r.width) };
    });
    await shot(mobile, "ac2-autofill-sheet-390-light");
    await mobile.context().close();

    // ---------------- Тёмная тема: 1440 и 390 ----------------
    const dark = await newPage(browser, 1440, 900, "dark");
    await dark.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await dark.waitForSelector('details[data-storage-key="compliance-grid"]', { timeout: 120_000 });
    await dismissOverlays(dark);
    await dark.evaluate(CONTRAST_FN);
    results.darkTheme = await dark.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-app-theme"));
    await shot(dark, "ac2-dashboard-1440-dark");

    // Меню профиля: наведение и фокус на пунктах
    await dark.getByRole("button", { name: "Профиль" }).click();
    const menu = dark.locator('[role="menu"][data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-content"]').first();
    await menu.waitFor({ timeout: 20_000 });
    const items = menu.locator('[role="menuitem"]');
    const count = await items.count();
    const hover: Array<Record<string, unknown>> = [];
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      await item.hover();
      await dark.waitForTimeout(220);
      const m = await item.evaluate((el) => {
        const w = window as unknown as { __contrast: (e: Element) => { fg: string; bg: string; ratio: number } };
        const span = (el.querySelector("span") as Element | null) ?? el;
        return { label: (el.textContent ?? "").trim().slice(0, 40), highlighted: el.hasAttribute("data-highlighted"), ...w.__contrast(span) };
      });
      hover.push(m);
      if (i === 1) await dark.screenshot({ path: path.join(OUT, "ac4-profile-menu-hover-1440-dark.jpg"), type: "jpeg", quality: 75, clip: { x: 900, y: 0, width: 540, height: 520 } });
    }
    results.darkProfileHover = hover;
    // Клавиатура: фокус стрелками
    await dark.keyboard.press("Home");
    await dark.waitForTimeout(150);
    const focus: Array<Record<string, unknown>> = [];
    for (let i = 0; i < Math.min(count, 5); i++) {
      const m = await dark.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const w = window as unknown as { __contrast: (e: Element) => { fg: string; bg: string; ratio: number } };
        const span = (el.querySelector("span") as Element | null) ?? el;
        return { label: (el.textContent ?? "").trim().slice(0, 40), role: el.getAttribute("role"), ...w.__contrast(span) };
      });
      focus.push(m);
      await dark.keyboard.press("ArrowDown");
      await dark.waitForTimeout(150);
    }
    results.darkProfileFocus = focus;
    await dark.keyboard.press("Escape");

    // Меню разделов под пилюлей организации — наведение
    await dark.locator("header .group\\/nav").first().hover();
    await dark.waitForTimeout(400);
    const navLinks = dark.locator('header [role="menu"] a[role=menuitem]');
    const navHover: Array<Record<string, unknown>> = [];
    for (let i = 0; i < (await navLinks.count()); i++) {
      await navLinks.nth(i).hover();
      await dark.waitForTimeout(200);
      navHover.push(await navLinks.nth(i).evaluate((el) => {
        const w = window as unknown as { __contrast: (e: Element) => { fg: string; bg: string; ratio: number } };
        return { label: (el.textContent ?? "").trim(), ...w.__contrast(el) };
      }));
    }
    results.darkNavHover = navHover;
    await dark.screenshot({ path: path.join(OUT, "ac4-nav-menu-hover-1440-dark.jpg"), type: "jpeg", quality: 75, clip: { x: 0, y: 0, width: 900, height: 420 } });
    await dark.mouse.move(1200, 800);

    // Старые хекс-варианты, дописанные на месте вызова (страховка в
    // app-theme.css): реальный hover/focus мышью и клавиатурой.
    await dark.evaluate(() => {
      const panel = document.createElement("div");
      panel.id = "e2e-variants";
      panel.className = "rounded-2xl border border-[#ececf4] bg-white text-[#0b1024] p-1.5";
      panel.style.cssText = "position:fixed;left:10px;top:120px;z-index:9999;width:320px";
      const cases = [
        "text-[#0b1024] focus:bg-[#f5f6ff]",
        "text-[#0b1024] data-[highlighted]:bg-[#f5f6ff]",
        "text-[#6f7282] hover:bg-white hover:text-[#0b1024]",
        "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]",
        "text-[#a13a32] focus:bg-[#fff4f2] focus:text-[#a13a32]",
      ];
      cases.forEach((cls, i) => {
        const el = document.createElement("div");
        el.id = `e2e-case-${i}`;
        el.className = `rounded-xl px-3 py-2 ${cls}`;
        el.tabIndex = 0;
        el.textContent = cls;
        if (cls.includes("highlighted")) el.setAttribute("data-highlighted", "");
        panel.appendChild(el);
      });
      document.body.appendChild(panel);
    });
    const variants: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 5; i++) {
      const el = dark.locator(`#e2e-case-${i}`);
      await el.hover();
      await el.focus();
      await dark.waitForTimeout(250);
      variants.push(await el.evaluate((node) => {
        const w = window as unknown as { __contrast: (e: Element) => { fg: string; bg: string; ratio: number } };
        return { cls: node.className, ...w.__contrast(node) };
      }));
    }
    results.darkVariantsHoverFocus = variants;
    await dark.screenshot({ path: path.join(OUT, "ac4-variants-hover-1440-dark.jpg"), type: "jpeg", quality: 75, clip: { x: 0, y: 100, width: 360, height: 260 } });
    await dark.context().close();

    const darkMobile = await newPage(browser, 390, 844, "dark");
    await darkMobile.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await darkMobile.waitForSelector('details[data-storage-key="compliance-grid"]', { timeout: 120_000 });
    await dismissOverlays(darkMobile);
    await shot(darkMobile, "ac2-dashboard-390-dark");
    await darkMobile.getByRole("button", { name: "Меню" }).click();
    await darkMobile.waitForTimeout(800);
    await shot(darkMobile, "ac1-mobile-menu-390-dark");
    await darkMobile.context().close();

    const darkQr = await newPage(browser, 1440, 900, "dark");
    await darkQr.goto(`${BASE}/settings/qr-posters`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await darkQr.waitForSelector("[data-qr-section=main]", { timeout: 240_000 });
    await dismissOverlays(darkQr);
    await shot(darkQr, "ac3-qr-1440-dark");
    await darkQr.context().close();
  } finally {
    fs.writeFileSync(path.join(TASK, "raw", "e2e-results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    await browser.close();
  }
}

fs.mkdirSync(path.join(TASK, "raw"), { recursive: true });
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
