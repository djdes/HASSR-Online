import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { openTelegramSession, state, db, BASE } from "../tg-session";

const OUT = path.join(process.cwd(), ".agent/tasks/mini-sweep-2026-09/explore-mgmt/parity-result.json");
const ROUTES: string[] = [
  ...JSON.parse(fs.readFileSync(path.join(process.cwd(), ".agent/tasks/mini-sweep-2026-09/parity-routes.json"), "utf8")),
  "/mini/today", "/mini/sections", "/mini/me",
];

const PROBE = `(function(){
  var b = document.body ? document.body.innerText : "";
  var h1 = document.querySelector("h1");
  return { url: location.pathname + location.search, h1: h1 ? h1.innerText.trim().slice(0,80) : "", len: b.length, txt: b.replace(/\s+/g," ").slice(0,300) };
})()`;

const DENY = /Нет доступа|Доступ запрещ|Недостаточно прав|Только для руковод|404|Страница не найдена|Не найдено|Войти в аккаунт|Вход в аккаунт/i;

async function sweep(page: any, tag: string, out: any[]) {
  for (const r of ROUTES) {
    let res: any = { route: r, tag };
    try {
      await page.goto(BASE + r, { waitUntil: "domcontentloaded", timeout: 300000 });
      await page.waitForTimeout(900);
      for (let k=0;k<12;k++){ const u1=page.url(); await page.waitForTimeout(1200); if (page.url()===u1) break; }
      let p: any;
      try { p = await page.evaluate(PROBE); }
      catch { await page.waitForTimeout(2500); p = await page.evaluate(PROBE); }
      res.final = p.url;
      res.h1 = p.h1;
      res.len = p.len;
      res.txt = p.txt;
      res.verdict = p.url.split("?")[0] !== r ? "redirect" : (DENY.test(p.txt.slice(0, 200)) ? "deny" : "ok");
    } catch (e: any) {
      res.verdict = "error";
      res.err = String(e).slice(0, 150);
    }
    out.push(res);
    console.log(tag, r, "->", res.final ?? res.err, res.verdict, (res.h1 || "").slice(0, 40));
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  }
}

async function main() {
  const roles = (process.argv[2] || "ownerA,managerA,headA,cookA,cleanerA").split(",");
  const out: any[] = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
  for (const role of roles) {
    // 1) оболочка
    const s = await openTelegramSession({ role, width: 390, height: 844 });
    console.log("== shell", role, s.page.url());
    await sweep(s.page, `shell:${role}`, out);
    await s.browser.close();
    // 2) сайт
    const br = await chromium.launch({ headless: true });
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
    const lr = await ctx.request.post(BASE + "/api/auth/login", { data: { email: (state as any).users[role].email, password: (state as any).password } });
    console.log("== site login", role, lr.status(), (await lr.text()).slice(0, 120));
    const pg2 = await ctx.newPage();
    await sweep(pg2, `site:${role}`, out);
    await br.close();
  }
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
