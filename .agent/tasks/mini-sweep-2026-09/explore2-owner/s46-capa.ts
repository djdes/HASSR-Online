import { openTelegramSession, db } from "../tg-session";
import { shot, go, FIELDS, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  const posts: string[] = [];
  page.on("response", async r => { if (r.request().method()==="POST" && r.url().includes("/api")) posts.push(r.status()+" "+r.url().slice(-40)); });
  try {
    await go(page, s.base + "/capa/new", 9000);
    await shot(page, "46-capa-new", true);
    console.log("FIELDS", JSON.stringify(await page.evaluate(FIELDS), null, 1));
    console.log("TEXT", (await page.evaluate(`document.body.innerText`) as string).slice(0, 1500));
    // Срок по приоритету (#88)
    const sels = page.locator("select");
    const n = await sels.count(); console.log("selects", n);
    for (let i=0;i<n;i++) console.log("  sel",i, JSON.stringify(await sels.nth(i).inputValue()), JSON.stringify(await page.evaluate(`[...document.querySelectorAll('select')][${i}].options[0].text + ' | ' + [...document.querySelectorAll('select')][${i}].options.length`)));
    const numBefore = await page.evaluate(`[...document.querySelectorAll('input[type=number]')].map(i=>i.value)`);
    console.log("NUM-BEFORE", JSON.stringify(numBefore));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();
