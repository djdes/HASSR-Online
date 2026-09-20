// Настоящий Telegram: сколько грузятся экраны профиля/персонала/техники. Только чтение.
import { chromium } from "playwright";
(async () => { const b = await chromium.connectOverCDP("http://127.0.0.1:9334"); const page = b.contexts().flatMap((c) => c.pages()).find((p) => /wesetup\.ru/.test(p.url()))!;
  for (const r of ["/mini/me", "/mini/staff", "/mini/equipment"]) { const reqs: string[] = []; const on = (resp: any) => { const u = resp.url(); if (/\/api\//.test(u)) { const t = resp.request().timing(); reqs.push(`${u.replace("https://wesetup.ru", "").slice(0, 50)} ${resp.status()} ${Math.round(t.responseEnd)}ms`); } }; page.on("response", on);
    const t0 = Date.now(); await page.goto("https://wesetup.ru" + r, { waitUntil: "load" }); const tLoad = Date.now() - t0;
    await page.waitForFunction(`!/Загружаем/.test((document.querySelector('main')||document.body).innerText.slice(0,200))`, null, { timeout: 30000 }).catch(() => null); const tReady = Date.now() - t0; await page.waitForTimeout(500); page.off("response", on);
    console.log(r, "load", tLoad, "ready", tReady); reqs.forEach((x) => console.log("   ", x)); }
  await page.goto("https://wesetup.ru/mini", { waitUntil: "load" }); await b.close(); })().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
