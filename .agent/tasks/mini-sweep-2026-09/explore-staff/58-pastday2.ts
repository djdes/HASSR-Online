import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/journal-documents")) console.log("<<", r.status(), r.request().method(), (await r.text().catch(() => "")).slice(0, 220)); });
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(10000);
  await p.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>/^По сотрудникам$/.test((e.innerText||'').trim())); e&&e.click()})()`);
  await p.waitForTimeout(4000);
  await p.evaluate(`(()=>{const e=[...document.querySelectorAll('button,div[role=button],a')].find(e=>/Иван Повар/.test(e.innerText||'')); e&&e.click()})()`);
  await p.waitForTimeout(4000);
  console.log("TXT", (await T(p)).slice(0, 1000));
  await shot(p, "employee-days");
  await shot(p, "employee-days-full", true);
  // past day cell
  const cells: any = await p.evaluate(`[...document.querySelectorAll('button')].map((b,i)=>({i,t:(b.innerText||'').replace(/\s+/g,' ').trim().slice(0,26),d:b.disabled,title:b.getAttribute('title')||''})).filter(c=>c.t).slice(0,40)`);
  console.log("BUTTONS", JSON.stringify(cells));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
