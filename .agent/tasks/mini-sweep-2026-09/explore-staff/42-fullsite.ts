import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(6000);
  await p.getByText("Открыть полную версию сайта").click();
  await p.waitForTimeout(15000);
  console.log("url", p.url().replace(s.base, ""));
  console.log("TXT", (await T(p)).slice(0, 700));
  await shot(p, "fullsite-settled");
  console.log("nav present?", await p.locator('a[data-nav-href]').count());
  // any way back?
  console.log("links", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('a,button')].map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter(t=>/прилож|мобиль|мини|верну/i.test(t))`)));
  // reload keeps full-site?
  await p.reload({ waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(10000);
  console.log("after reload", p.url().replace(s.base, ""), "| nav", await p.locator('a[data-nav-href]').count());
  await shot(p, "fullsite-reload");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
