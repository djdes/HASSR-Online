import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES, FIELDS, dump } from "./lib";
import { chromium } from "playwright";

(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  await go(page, s.base + "/settings/users", 5000);
  const p0 = await probe(page);
  console.log("overflow=", p0.overflow, "wide=", JSON.stringify(p0.wide));

  // --- открыть "Пригласить по QR"
  await page.getByRole("button", { name: "Пригласить по QR" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "03-qr-dialog");
  const geo = await page.evaluate(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('[role=dialog],[data-slot=dialog-content],[class*=fixed]')) {
      const r = el.getBoundingClientRect();
      if (r.width<40||r.height<40) continue;
      out.push({ tag: el.tagName, cls: String(el.className).slice(0,90), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return { win: { w: innerWidth, h: innerHeight }, scrollY: scrollY, docH: document.documentElement.scrollHeight, boxes: out };
  })()`);
  console.log("QR-DIALOG-GEO", JSON.stringify(geo, null, 1));
  const c: string[] = await page.evaluate(CLICKABLES);
  console.log("QR-CLICK", JSON.stringify(c.filter(x=>!x.includes("->/")), null, 1).slice(0,3000));
  const f = await page.evaluate(FIELDS);
  console.log("QR-FIELDS", JSON.stringify(f, null, 1).slice(0,2000));
  const txt = await page.evaluate(`document.body.innerText.slice(0,1500)`);
  console.log("QR-TEXT", txt);
  await s.close();
})();
