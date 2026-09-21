import { chromium, type Page, type BrowserContext } from "playwright";
import { state } from "../tg-session";
export const BASE = "http://localhost:3021";
/** Обычный сайт: свежий контекст, вход по паролю, без куки ws-shell. */
export async function openSite(opts: { role?: string; email?: string; password?: string; width?: number; height?: number; theme?: "light"|"dark" }) {
  const browser = await chromium.launch({ headless: true });
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: opts.height ?? 900 }, colorScheme: opts.theme === "dark" ? "dark" : "light" });
  await ctx.addInitScript(`try{localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){};document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})`);
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|DevTools|hydrat/i.test(m.text())) errors.push("console: " + m.text().slice(0, 200)); });
  page.on("response", (r) => { if (r.status() >= 400 && !/_next\/static|favicon/.test(r.url())) errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "").slice(0, 110)}`); });
  const email = opts.email ?? state.users[opts.role!].email;
  const password = opts.password ?? state.password;
  await page.goto(BASE + "/login", { waitUntil: "load", timeout: 300000 });
  await page.waitForTimeout(1500);
  const r = await ctx.request.post(BASE + "/api/auth/login", { data: { email, password } }).catch((e)=>({ status: ()=>0, text: async()=>String(e) } as any));
  console.log("login", email, r.status ? r.status() : "?", (await r.text().catch(()=>"" )).slice(0,200));
  return { browser, ctx, page, errors, base: BASE, close: async () => { await browser.close(); } };
}
