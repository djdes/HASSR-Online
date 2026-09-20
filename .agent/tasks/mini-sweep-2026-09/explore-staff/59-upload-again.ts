import { openTelegramSession } from "../tg-session";
import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-staff/";
(async () => {
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  const png = SHOT + "tiny.png";
  if (!fs.existsSync(png)) fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  for (let i = 0; i < 2; i++) {
    const r = await p.request.post(s.base + "/api/mini/attachments", {
      multipart: { file: { name: "photo.png", mimeType: "image/png", buffer: fs.readFileSync(png) } },
    });
    console.log("attempt", i, r.status(), (await r.text()).slice(0, 200));
  }
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
