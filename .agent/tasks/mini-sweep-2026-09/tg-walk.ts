// Мини-приложение «как в Telegram»: настоящий telegram-web-app.js, подписанный initData, эмулятор клиента (tg-host.js).
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
const BASE = process.env.SWEEP_BASE ?? "http://localhost:3021";
const TOKEN = process.env.TG_FAKE_TOKEN!;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = process.env.SWEEP_OUT!; fs.mkdirSync(OUT, { recursive: true });
const HOST = fs.readFileSync(path.join(HERE, "tg-host.js"), "utf8");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
const ROLE = process.env.SWEEP_ROLE ?? "cookA"; const THEME = process.env.SWEEP_THEME ?? "light";
const TG_IDS: Record<string, number> = { cookA: 990001, managerA: 990002, cleanerA: 990003, headA: 990004, ownerA: 990005 };
const DARK = { bg_color: "#17212b", text_color: "#f5f5f5", hint_color: "#708499", link_color: "#6ab3f3", button_color: "#5288c1", button_text_color: "#ffffff", secondary_bg_color: "#232e3c", header_bg_color: "#17212b" };
const LIGHT = { bg_color: "#ffffff", text_color: "#000000", hint_color: "#999999", link_color: "#2481cc", button_color: "#2481cc", button_text_color: "#ffffff", secondary_bg_color: "#efeff4", header_bg_color: "#efeff4" };

function forge(tgId: number, ageSec = 5): string {
  const p = new URLSearchParams();
  p.set("auth_date", String(Math.floor(Date.now() / 1000) - ageSec)); p.set("query_id", "AAE2E" + tgId);
  p.set("user", JSON.stringify({ id: tgId, first_name: "Тест", last_name: "Телеграм", username: "e2e_" + tgId, language_code: "ru" }));
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  p.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex")); return p.toString();
}
function hashFor(initData: string, theme: string) {
  return "#tgWebAppData=" + encodeURIComponent(initData) + "&tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppThemeParams=" + encodeURIComponent(JSON.stringify(theme === "dark" ? DARK : LIGHT));
}
const log: any[] = []; const note = (k: string, v: any) => { log.push({ k, v }); console.log(k, typeof v === "string" ? v : JSON.stringify(v)); };

async function newTgPage(browser: any, theme: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: theme === "dark" ? "dark" : "light", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS/11.2" });
  await ctx.addInitScript(`window.__tgHostConfig=${JSON.stringify({ themeParams: theme === "dark" ? DARK : LIGHT })};` + HOST);
  await ctx.addInitScript(`try{localStorage.setItem("wesetup.mini.tour.seen",String(Date.now()));localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){}`);
  const page = await ctx.newPage(); const errs: string[] = [];
  page.on("console", (m: any) => { if (m.type() === "error" && !/hydrat|DevTools|same key/i.test(m.text())) errs.push("console: " + m.text().slice(0, 200)); });
  page.on("pageerror", (e: any) => errs.push("pageerror: " + String(e).slice(0, 200)));
  page.on("response", (r: any) => { if (r.status() >= 400 && !/favicon|_next\/static/.test(r.url())) errs.push(`http ${r.status()} ${r.url().replace(BASE, "").slice(0, 110)}`); });
  return { ctx, page, errs };
}
const hostState = (page: any) => page.evaluate(`(function(){var h=window.__tgHost||{};var tg=window.Telegram&&window.Telegram.WebApp;return {path:location.pathname,back:h.backVisible,main:h.mainButton&&h.mainButton.is_visible?h.mainButton.text:null,closing:h.closingConfirmation,swipes:h.verticalSwipes,header:h.headerColor,bg:h.bgColor,popups:(h.popups||[]).length,platform:tg&&tg.platform,version:tg&&tg.version,initLen:tg&&tg.initData?tg.initData.length:0,scheme:tg&&tg.colorScheme,dataTheme:(document.getElementById('mini-root')||{}).dataset?document.getElementById('mini-root').dataset.theme:null,ownBack:!!document.querySelector('header [aria-label*="азад"], header a[href="/mini"] svg.lucide-arrow-left'),text:(document.querySelector('main')||document.body).innerText.replace(/\\s+/g,' ').slice(0,160)}})()`);
const shot = (page: any, name: string) => page.screenshot({ path: path.join(OUT, `${ROLE}.${THEME}.${name}.png`) });

(async () => {
  const email = state.users[ROLE].email; const tgId = TG_IDS[ROLE];
  await db.user.updateMany({ where: { telegramChatId: String(tgId) }, data: { telegramChatId: null } });
  const me = await db.user.update({ where: { email }, data: { telegramChatId: String(tgId), themePreference: THEME }, select: { id: true, organizationId: true } });
  const docs = await db.journalDocument.findMany({ where: { organizationId: me.organizationId, status: "active" }, select: { id: true, template: { select: { code: true } } }, take: 40 });
  const hygiene = docs.find((d) => d.template.code === "hygiene") ?? docs[0];
  const browser = await chromium.launch({ headless: true });

  // 1. Холодный вход: куки нет, есть только подпись Telegram.
  { const { page, errs, ctx } = await newTgPage(browser, THEME); const t0 = Date.now();
    await page.goto(`${BASE}/mini${hashFor(forge(tgId), THEME)}`, { waitUntil: "load", timeout: 300000 });
    const marks: any[] = []; for (const ms of [300, 1000, 2500, 5000, 9000]) { await page.waitForTimeout(ms - (marks.length ? [300, 1000, 2500, 5000, 9000][marks.length - 1] : 0)); const s = await hostState(page); marks.push({ at: ms, path: s.path, text: s.text.slice(0, 70) }); if (marks.length === 1 || marks.length === 3) await shot(page, `01-cold-${ms}ms`); }
    note("cold.timeline", marks); note("cold.totalMs", Date.now() - t0); const s = await hostState(page); note("cold.state", s); await shot(page, "01-cold-final");
    note("cold.events", await page.evaluate(`window.__tgHost.events.map(function(e){return e.type+(e.d?':'+JSON.stringify(e.d):'')}).slice(0,30)`));
    note("cold.hashLeft", await page.evaluate(`location.hash.length`)); note("cold.errs", errs.slice(0, 8));

    // 2. Обход вкладок и кнопка «назад» Telegram.
    const nav = await page.evaluate(`Array.from(document.querySelectorAll('nav a[href^="/mini"]')).map(function(a){return {href:a.getAttribute('href'),label:a.innerText.trim()}})`); note("nav", nav);
    for (const item of nav as any[]) { errs.length = 0; await page.locator(`nav a[href="${item.href}"]`).first().click({ timeout: 15000 }).catch(() => null); await page.waitForTimeout(2500); const st = await hostState(page); note(`tab ${item.href}`, { back: st.back, ownBack: st.ownBack, main: st.main, text: st.text.slice(0, 90), errs: errs.slice(0, 3) }); await shot(page, `02-tab-${item.href.replace(/\W+/g, "_")}`); }
    // журнал → документ → назад, назад
    errs.length = 0; await page.goto(`${BASE}/mini`, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(2500);
    const before = await hostState(page); note("home.back", before.back);
    await page.evaluate(`history.length`).then((n: any) => note("history.len.home", n));
    const jl = page.locator('a[href^="/mini/journals/"]').first(); const jhref = await jl.getAttribute("href").catch(() => null); note("first.journal", jhref);
    if (jhref) { await jl.click().catch(() => null); await page.waitForTimeout(3000); note("journal.state", await hostState(page)); await shot(page, "03-journal");
      const dl = page.locator('a[href^="/mini/documents/"]').first(); if (await dl.isVisible().catch(() => false)) { await dl.click().catch(() => null); await page.waitForTimeout(4000); note("doc.state", await hostState(page)); await shot(page, "04-doc"); }
      await page.evaluate(`window.__tgHost.pressBack()`); await page.waitForTimeout(2500); note("after.back1", await hostState(page));
      await page.evaluate(`window.__tgHost.pressBack()`); await page.waitForTimeout(2500); note("after.back2", await hostState(page)); await shot(page, "05-after-back2"); }
    // перезагрузка внутри Telegram: подпись должна пережить reload
    await page.reload({ waitUntil: "load" }); await page.waitForTimeout(3000); note("reload.state", await hostState(page)); note("flow.errs", errs.slice(0, 8));
    await ctx.close(); }

  // 3. Прямая ссылка из бота сразу на документ: «назад» не должен быть тупиком.
  { const { page, errs, ctx } = await newTgPage(browser, THEME);
    await page.goto(`${BASE}/mini/documents/${hygiene.id}${hashFor(forge(tgId), THEME)}`, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(9000);
    note("deeplink.state", await hostState(page)); await shot(page, "06-deeplink");
    await page.evaluate(`window.__tgHost.pressBack()`); await page.waitForTimeout(3000); note("deeplink.afterBack", await hostState(page)); await shot(page, "07-deeplink-back"); note("deeplink.errs", errs.slice(0, 6)); await ctx.close(); }

  // 4. Telegram-аккаунт, который ни к кому не привязан.
  { const { page, errs, ctx } = await newTgPage(browser, THEME);
    await page.goto(`${BASE}/mini${hashFor(forge(555000111), THEME)}`, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(8000);
    note("unlinked.state", await hostState(page)); note("unlinked.full", await page.evaluate(`document.body.innerText.replace(/\\s+/g,' ').slice(0,500)`)); await shot(page, "08-unlinked"); note("unlinked.errs", errs.slice(0, 6)); await ctx.close(); }

  // 5. Просроченная подпись (приложение висело открытым больше суток).
  { const { page, errs, ctx } = await newTgPage(browser, THEME);
    await page.goto(`${BASE}/mini${hashFor(forge(tgId, 90000), THEME)}`, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(16000);
    note("stale.state", await hostState(page)); note("stale.full", await page.evaluate(`document.body.innerText.replace(/\\s+/g,' ').slice(0,500)`)); await shot(page, "09-stale"); note("stale.errs", errs.slice(0, 6)); await ctx.close(); }

  fs.writeFileSync(path.join(OUT, `tg-walk.${ROLE}.${THEME}.json`), JSON.stringify(log, null, 1));
  await browser.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 400)); process.exit(1); });
