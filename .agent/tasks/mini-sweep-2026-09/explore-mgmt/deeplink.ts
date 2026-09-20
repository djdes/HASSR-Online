import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path";
import { chromium } from "playwright";
import { db, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const HERE = "D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09";
const HOST = fs.readFileSync(path.join(HERE, "tg-host.js"), "utf8");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
const TOKEN = "7000000001:AAE2eFakeTokenForLocalStandOnly000000";
const TG_IDS: Record<string, number> = { cookA: 990001, managerA: 990002, cleanerA: 990003, headA: 990004, ownerA: 990005 };
function forge(id: number) { const p = new URLSearchParams(); p.set("auth_date", String(Math.floor(Date.now()/1000)-5)); p.set("user", JSON.stringify({id, first_name:"Т"})); const dcs=[...p.entries()].map(([k,v])=>`${k}=${v}`).sort().join("\n"); const s=crypto.createHmac("sha256","WebAppData").update(TOKEN).digest(); p.set("hash", crypto.createHmac("sha256",s).update(dcs).digest("hex")); return p.toString(); }
async function main() {
  const role = process.argv[2] || "managerA";
  const target = process.argv[3] || "/settings/users";
  const tgId = TG_IDS[role];
  await db.user.updateMany({ where: { telegramChatId: String(tgId) }, data: { telegramChatId: null } });
  await db.user.update({ where: { email: state.users[role].email }, data: { telegramChatId: String(tgId), themePreference: "light" } });
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(HOST);
  await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  const p = await ctx.newPage();
  const nav: string[] = [];
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) nav.push(f.url().replace(BASE, "")); });
  await p.goto(`${BASE}${target}#tgWebAppData=${encodeURIComponent(forge(tgId))}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`, { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(15000);
  console.log("role", role, "target", target);
  console.log("nav:", JSON.stringify(nav));
  console.log("final:", p.url().replace(BASE, ""));
  console.log("txt:", (await p.evaluate(`(document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,300)`)));
  await p.screenshot({ path: `${SHOTS}/deeplink-${role}-${target.replace(/\W+/g,"_")}.png`, fullPage: false });
  await br.close(); await db.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1)});
