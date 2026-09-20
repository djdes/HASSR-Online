import { openTelegramSession } from "../tg-session";
import { shot, DUMP } from "./lib";
const DOC = process.env.DOC || "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i";
(async () => {
  const s = await openTelegramSession({ role: process.env.ROLE || "cookA", width: Number(process.env.W || 360), height: Number(process.env.H || 640), theme: (process.env.THEME as any) || "light" });
  const p = s.page;
  await p.goto(s.base + DOC, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  console.log(JSON.stringify(await p.evaluate(DUMP), null, 1));
  await shot(p, (process.env.TAG || "cookA") + "-doc-top");
  await p.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await p.waitForTimeout(1200);
  await shot(p, (process.env.TAG || "cookA") + "-doc-bottom");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
