import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES, FIELDS } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    // сначала проверим прокрутку диалога «Добавить ХК» на прошлом экране
    await go(page, `${s.base}/journals/cold_equipment_control`, 9000);
    await shot(page, "24-cold-list", true);
    console.log("LIST-TEXT", (await page.evaluate(`document.body.innerText`) as string).slice(0, 1800));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).slice(0, 30), null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
