export { openTelegramSession, db, state, BASE } from "../tg-session";
import fs from "node:fs";
export const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
export function out(name: string, data: unknown) {
  fs.writeFileSync(SHOT + "/" + name, typeof data === "string" ? data : JSON.stringify(data, null, 2));
}
