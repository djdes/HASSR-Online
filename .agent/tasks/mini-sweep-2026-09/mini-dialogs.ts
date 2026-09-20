// Мини-приложение: окно «Добавить» в каждом журнале — видны ли и нажимаются ли кнопки внизу (не под нижним меню).
import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
import { db } from "../journal-responsibles-org-2026-09/e2e/db";
const BASE = "http://localhost:3021"; const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = process.env.SWEEP_OUT!; fs.mkdirSync(OUT, { recursive: true }); const ONLY = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
const PROBE = `(() => { const vw = innerWidth, vh = innerHeight; const dlg = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')).filter(d => d.getBoundingClientRect().height > 0).pop(); if (!dlg) return { dialog: false };
  const r = dlg.getBoundingClientRect(); const btns = Array.from(dlg.querySelectorAll('button')).filter(b => b.getBoundingClientRect().height > 0 && /Сохранить|Добавить|Отмена|Закрыть|Готово|Записать|Создать/.test(b.textContent || ''));
  const covered = btns.map(b => { const br = b.getBoundingClientRect(); const cx = br.left + br.width / 2, cy = br.top + br.height / 2; const el = (cy >= 0 && cy <= vh) ? document.elementFromPoint(cx, cy) : null; const ok = el ? (b === el || b.contains(el)) : false; return { t: (b.textContent||'').trim().slice(0, 18), top: Math.round(br.top), bottom: Math.round(br.bottom), inView: br.bottom <= vh + 1 && br.top >= 0, hit: ok, by: ok || !el ? '' : (el.closest('.mini-nav-rail') ? 'NAV' : String(el.className).slice(0, 40)) }; });
  const nav = document.querySelector('.mini-nav-rail'); const inputs = Array.from(dlg.querySelectorAll('input,select,textarea')).filter(i => i.getBoundingClientRect().width > 0);
  return { dialog: true, title: (dlg.querySelector('h2,h1')?.textContent || '').trim().slice(0, 40), rect: [Math.round(r.top), Math.round(r.bottom)], vh, navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null, scrollable: dlg.scrollHeight > dlg.clientHeight + 2, buttons: covered, under16: inputs.filter(i => parseFloat(getComputedStyle(i).fontSize) < 16).length }; })()`;
(async () => {
  const user = await db.user.findUnique({ where: { email: state.users.managerA.email }, select: { organizationId: true } });
  const docs = await db.journalDocument.findMany({ where: { organizationId: user!.organizationId, status: "active" }, select: { id: true, template: { select: { code: true } } }, orderBy: { createdAt: "desc" } });
  const first = new Map<string, string>(); for (const d of docs) if (!first.has(d.template.code)) first.set(d.template.code, d.id);
  const browser = await chromium.launch({ headless: true }); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: state.users.managerA.email, password: state.password }, timeout: 300000 }); if (!r.ok()) throw new Error("login " + r.status());
  await page.goto(`${BASE}/mini`, { waitUntil: "load", timeout: 300000 }); await page.evaluate(() => { try { localStorage.setItem("wesetup.mini.tour.seen", "1"); localStorage.setItem("wesetup.last-seen-build-sha", "zzz"); } catch {} });
  const report: any[] = [];
  for (const [code, id] of first) {
    if (ONLY && !ONLY.test(code)) continue;
    try {
      await page.goto(`${BASE}/mini/documents/${id}`, { waitUntil: "load", timeout: 300000 }); await page.waitForTimeout(3000);
      for (const name of ["Понятно", "OK"]) { const b = page.getByRole("button", { name, exact: true }).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => null); await page.waitForTimeout(250); } }
      const btn = page.locator(".mini-document-host button, .mini-document-host a").filter({ hasText: /^\s*(Добавить|Заполнить)/ }).first();
      if (!(await btn.isVisible().catch(() => false))) { report.push({ code, note: "нет кнопки добавления" }); console.log(code, "no-add-button"); continue; }
      await btn.scrollIntoViewIfNeeded().catch(() => null); await btn.click({ timeout: 15000 }); await page.waitForTimeout(1000);
      const item = page.getByRole("menuitem").first(); if (await item.isVisible().catch(() => false)) { await item.click(); await page.waitForTimeout(1000); }
      const m: any = await page.evaluate(PROBE); await page.screenshot({ path: path.join(OUT, `${code}.png`) });
      report.push({ code, ...m }); const bad = (m.buttons ?? []).filter((b: any) => !b.inView || !b.hit);
      console.log(code, JSON.stringify({ dialog: m.dialog, bad: bad.map((b: any) => `${b.t}:${b.inView ? "" : "вне экрана"}${b.hit ? "" : " перекрыт " + b.by}`), under16: m.under16 }));
      await page.keyboard.press("Escape").catch(() => null); await page.waitForTimeout(300);
    } catch (e) { report.push({ code, error: String(e).slice(0, 160) }); console.log(code, "ERR", String(e).slice(0, 110)); }
    fs.writeFileSync(path.join(OUT, "mini-dialogs.json"), JSON.stringify(report, null, 1));
  }
  await browser.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
