import { openSite } from "./site";
import { shot, go, probe } from "./lib";
import { db } from "../tg-session";
const URLS = ["/dashboard/catch-up","/dashboard/compliance-audit","/mercury","/orders","/bonuses","/ideas","/competencies","/reports","/settings/journal-responsibles","/settings/journals-by-position","/settings/journal-access","/settings/staff-hierarchy","/settings/permissions","/settings/buildings","/settings/notifications","/settings/calendar","/settings/qr-posters","/settings/print-agent","/settings/inspector","/settings/backups","/settings/webhooks","/settings/journal-strictness","/settings/journal-flow","/settings/journal-periods","/settings/journal-bonuses","/settings/auto-journals","/settings/organization"];
(async () => {
const role = process.argv[2] || "ownerA";
const s = await openSite({ role, width: 1280, height: 900 });
const p = s.page;
for (const u of URLS) {
  const errs: string[] = [];
  const h = (r: any) => { if (r.status()>=400 && !/_next\/static|favicon/.test(r.url())) errs.push(r.status()+" "+r.request().method()+" "+r.url().replace(s.base,"").slice(0,80)); };
  p.on("response", h);
  await go(p, s.base + u, 4000);
  await p.waitForTimeout(6000);
  const pr = await probe(p);
  p.off("response", h);
  const en = (pr.bodyText.match(/[A-Za-z]{4,}/g) || []).filter(w=>!/WeSetup|Telegram|HACCP|CAPA|TasksFlow|Excel|CSV|PDF|iiko|QR|Wesetup|WESETUP|support|wesetup|ru|com|IoT|Tuya|API|SanPiN|SMS|Face|ID|http|https|localhost/.test(w));
  console.log(`--- ${u} | ${pr.url} | ov=${pr.overflow} | http=${JSON.stringify(errs)} | en=${JSON.stringify([...new Set(en)].slice(0,12))}`);
  console.log("    " + pr.bodyText.replace(/\n+/g," | ").slice(0, 320));
}
console.log("ALLERR", JSON.stringify(s.errors).slice(0,1500));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
