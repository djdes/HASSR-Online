import { openTelegramSession } from "../tg-session";
import { shot, DUMP } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.waitForTimeout(8000);
  console.log("URL", p.url());
  console.log(JSON.stringify(await p.evaluate(DUMP), null, 1));
  await shot(p, "cookA-today-loaded");
  await shot(p, "cookA-today-loaded-full", true);
  // active nav marker
  console.log("NAVACT", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('nav a')].map(a=>({h:a.getAttribute('href'),cls:a.className,aria:a.getAttribute('aria-current'),color:getComputedStyle(a).color}))`), null, 1));
  console.log("ERRORS", JSON.stringify(s.errors, null, 1));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
