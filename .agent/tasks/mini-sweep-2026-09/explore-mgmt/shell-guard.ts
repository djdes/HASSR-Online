import { chromium } from "playwright";
import { state, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const T = `(function(){return {url:location.pathname+location.search, cookie:document.cookie, shell:!!document.getElementById("mini-root"), nav:!!document.querySelector('a[href="/mini/sections"]'), txt:(document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,300)};})()`;

async function scenario(name: string, opts: { width: number; height: number; cookie: boolean; login?: string; path: string; mobile?: boolean }) {
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({ viewport: { width: opts.width, height: opts.height }, isMobile: opts.mobile ?? false, hasTouch: opts.mobile ?? false });
  if (opts.login) {
    const r = await ctx.request.post(BASE + "/api/auth/login", { data: { email: (state as any).users[opts.login].email, password: (state as any).password } });
    if (r.status() !== 200) console.log("  login fail", r.status());
  }
  if (opts.cookie) await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  const p = await ctx.newPage();
  const nav: string[] = [];
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) nav.push(f.url().replace(BASE, "")); });
  await p.goto(BASE + opts.path, { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(6000);
  const r1: any = await p.evaluate(T);
  await p.waitForTimeout(4000);
  const r2: any = await p.evaluate(T);
  console.log(`\n### ${name}`);
  console.log(" nav:", JSON.stringify(nav));
  console.log(" t+6s:", JSON.stringify(r1));
  console.log(" t+10s:", JSON.stringify(r2));
  await p.screenshot({ path: `${SHOTS}/guard-${name}.png`, fullPage: false });
  await br.close();
}

async function main() {
  await scenario("anon-cookie-dashboard", { width: 390, height: 844, cookie: true, path: "/dashboard", mobile: true });
  await scenario("anon-cookie-settings-users", { width: 390, height: 844, cookie: true, path: "/settings/users", mobile: true });
  await scenario("anon-cookie-journals", { width: 390, height: 844, cookie: true, path: "/journals", mobile: true });
  await scenario("cook-cookie-settings-users", { width: 390, height: 844, cookie: true, login: "cookA", path: "/settings/users", mobile: true });
  await scenario("cook-cookie-verifications", { width: 390, height: 844, cookie: true, login: "cookA", path: "/verifications", mobile: true });
  await scenario("wide-cookie-dashboard", { width: 1280, height: 900, cookie: true, login: "managerA", path: "/dashboard" });
  await scenario("wide-cookie-mini-today", { width: 1280, height: 900, cookie: true, login: "cookA", path: "/mini/today" });
  await scenario("phone-nocookie-dashboard", { width: 390, height: 844, cookie: false, login: "managerA", path: "/dashboard", mobile: true });
}
main().catch(e => { console.error(e); process.exit(1); });
