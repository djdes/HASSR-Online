import { openTelegramSession } from "../tg-session";
import { shot, DUMP } from "./lib";
const sleep = (p: any, ms: number) => p.waitForTimeout(ms);
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await sleep(p, 8000);
  // 1. Take "Проверка здоровья смены"
  const card = p.locator("div").filter({ hasText: /Проверка здоровья смены/ }).last();
  const btn = p.getByRole("button", { name: "Взять" }).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await sleep(p, 3500);
  console.log("AFTER-CLAIM URL", p.url());
  console.log("AFTER-CLAIM", JSON.stringify(await p.evaluate(DUMP), null, 1).slice(0, 4000));
  await shot(p, "cookA-after-claim");
  // 2. try to take a second one
  const second = p.getByRole("button", { name: "Взять" }).first();
  const cnt = await p.getByRole("button", { name: "Взять" }).count();
  console.log("ВЗЯТЬ buttons left:", cnt);
  if (cnt > 0) {
    console.log("second btn disabled?", await second.isDisabled(), "title:", await second.getAttribute("title"));
    await second.scrollIntoViewIfNeeded();
    await second.click({ force: true }).catch((e) => console.log("click err", String(e).slice(0, 120)));
    await sleep(p, 3000);
    console.log("AFTER-2ND URL", p.url());
    await shot(p, "cookA-after-second-claim");
    console.log("BODY2", (await p.evaluate(`document.body.innerText`) as string).replace(/[ \t\n\r]+/g, " ").slice(0, 1200));
  }
  console.log("ERRORS", JSON.stringify(s.errors, null, 1));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 800)); process.exit(1); });
