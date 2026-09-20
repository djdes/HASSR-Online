import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/journal-documents")) console.log("<<", r.status(), (await r.text().catch(() => "")).slice(0, 200)); });
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(10000);
  await p.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>/^По сотрудникам$/.test((e.innerText||'').trim())); e&&e.click()})()`);
  await p.waitForTimeout(4000);
  console.log("TXT", (await T(p)).slice(0, 800));
  await shot(p, "by-employee-tab");
  await shot(p, "by-employee-tab-full", true);
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
