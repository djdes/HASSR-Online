import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) console.log("NAV ->", f.url().replace(s.base, "")); });
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  const b = p.getByRole("button", { name: /Заполнить: Иван Повар/ });
  const box = await b.boundingBox();
  console.log("CTA box", JSON.stringify(box));
  await b.click();
  for (let i = 0; i < 5; i++) { await p.waitForTimeout(1500); console.log(i, p.url().replace(s.base, "")); }
  await shot(p, "cookA-cta-click-result");
  console.log("ERRORS", JSON.stringify(s.errors, null, 1));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
