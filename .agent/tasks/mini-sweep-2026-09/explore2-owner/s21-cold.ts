import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
const DOC = "cmu6pg3d50001309mb4xv4ipl";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, `${s.base}/journals/cold_equipment_control/documents/${DOC}`, 9000);
    await shot(page, "21-cold-doc", true);
    const t = await page.evaluate(`document.body.innerText`) as string;
    console.log("HAS-ZZ2", t.includes("ZZ2 Холодильник"));
    console.log("TEXT", t.slice(0, 2500));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).slice(0, 35), null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8), null, 1));
  await s.close();
})();
