import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
import fs from "node:fs";
const AUDIT = fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09/explore-staff/audit.js", "utf8");
(async () => {
  const role = process.env.ROLE || "cookA", theme = (process.env.THEME as any) || "light";
  const w = Number(process.env.W || 360), h = Number(process.env.H || 640);
  const s = await openTelegramSession({ role, width: w, height: h, theme });
  const p = s.page;
  for (const u of (process.env.ROUTES || "").split(",").filter(Boolean).map((x) => (x.startsWith("/") ? x : "/" + x))) {
    await p.goto(s.base + u, { waitUntil: "load", timeout: 300000 });
    await p.waitForTimeout(7000);
    const a: any = await p.evaluate(AUDIT);
    console.log("=== " + u + " [" + theme + " " + w + "x" + h + "]");
    console.log(JSON.stringify(a));
    await shot(p, `aud-${theme}-${w}-${u.replace(/\W+/g, "_").slice(0, 30)}`);
  }
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
