import { openTelegramSession, SHOT } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  await s.page.goto(s.base + "/journals", { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(3000);
  const html = await s.page.evaluate(`document.querySelector('header') ? document.querySelector('header').outerHTML.slice(0,4000) : 'no header'`);
  console.log(html);
  await s.close();
})();
