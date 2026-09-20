import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  for (const r of ["/settings", "/dashboard", "/settings/users"]) {
    await p.goto(s.base + r, { waitUntil: "load", timeout: 300000 });
    for (let i = 0; i < 5; i++) {
      await p.waitForTimeout(3000);
      const t = ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ").slice(0, 200);
      console.log(r, i * 3 + "s", p.url().replace(s.base, ""), "|", t);
    }
    await shot(p, "blank-" + r.replace(/\W+/g, "_"));
  }
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 500)); process.exit(1); });
