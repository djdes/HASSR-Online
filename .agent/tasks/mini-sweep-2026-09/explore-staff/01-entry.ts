import { openTelegramSession } from "../tg-session";
import { shot, DUMP } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  console.log("USER", JSON.stringify(s.user));
  console.log("LANDED", s.page.url());
  const d: any = await s.page.evaluate(DUMP);
  console.log(JSON.stringify(d, null, 1));
  await shot(s.page, "cookA-home-360");
  await shot(s.page, "cookA-home-360-full", true);
  const ev: any = await s.page.evaluate(`({back:window.__tgHost.backVisible, main:window.__tgHost.mainButton, header:window.__tgHost.headerColor, bg:window.__tgHost.bgColor, events:window.__tgHost.events.map(e=>e.type)})`);
  console.log("TG", JSON.stringify(ev));
  console.log("ERRORS", JSON.stringify(s.errors, null, 1));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
