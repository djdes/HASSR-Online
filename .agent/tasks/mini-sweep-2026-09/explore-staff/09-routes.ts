import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const ROUTES = (process.env.ROUTES || "").split(",").filter(Boolean);
(async () => {
  const role = process.env.ROLE || "cookA";
  const theme = (process.env.THEME as any) || "light";
  const w = Number(process.env.W || 360), h = Number(process.env.H || 640);
  const s = await openTelegramSession({ role, width: w, height: h, theme });
  const p = s.page;
  const out: any[] = [];
  for (const r0 of ROUTES) {
    const r = r0.startsWith("/") ? r0 : "/" + r0;
    const before = s.errors.length;
    let status = 0;
    const resp = await p.goto(s.base + r, { waitUntil: "load", timeout: 300000 }).catch((e) => { console.log("GOTO ERR", r, String(e).slice(0, 100)); return null; });
    if (resp) status = resp.status();
    await p.waitForTimeout(3500);
    const info: any = await p.evaluate(String.raw`(()=>{const t=(e)=>(e.innerText||"").replace(/\s+/g," ").trim();
      return {url:location.pathname, nav:[...document.querySelectorAll('nav a')].map(a=>a.getAttribute('href')).join("|"), body:t(document.body).slice(0,600), sh:document.documentElement.scrollHeight, sw:document.documentElement.scrollWidth};})()`);
    const shotName = `${role}-${theme}-${w}-${r.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40)}`;
    await shot(p, shotName);
    out.push({ req: r, status, landed: info.url, hasNav: info.nav, sw: info.sw, body: info.body, newErrors: s.errors.slice(before) });
    console.log(JSON.stringify(out[out.length - 1], null, 1));
  }
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 800)); process.exit(1); });
