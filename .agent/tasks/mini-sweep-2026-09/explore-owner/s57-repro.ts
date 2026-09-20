import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const DOC = "cmu6pg3d50001309mb4xv4ipl", CODE = "cold_equipment_control"; // 18..18 doc
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
let posts = 0;
p.on("request", r => { if (r.method()!=="GET" && /entries/.test(r.url())) posts++; });
// use the month doc but a different equipment card
await p.goto(`${s.base}/journals/cold_equipment_control/documents/cmu8hkgnh001tic9md21uf2nx`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(16000);
const inputs = p.locator('input[placeholder="—"]');
console.log("REPRO A: Enter does not commit");
await inputs.nth(1).click(); await p.waitForTimeout(300);
await p.keyboard.press("Control+a"); await p.keyboard.type("3.5", { delay: 120 });
const before = posts;
await p.keyboard.press("Enter");
await p.waitForTimeout(5000);
console.log("  requests after Enter: " + (posts-before) + "  field=" + await inputs.nth(1).inputValue());
const e1: any = await db.journalDocumentEntry.findFirst({ where: { documentId: "cmu8hkgnh001tic9md21uf2nx", date: new Date("2026-09-21T00:00:00Z") } });
console.log("  db 09-21 = " + JSON.stringify(e1?.data));
console.log("REPRO B: minus stepper on empty field of a 2..6 fridge");
await p.reload({ waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(11000);
const p2 = p.locator('input[placeholder="—"]');
console.log("  values before: " + JSON.stringify([await p2.nth(0).inputValue(), await p2.nth(1).inputValue(), await p2.nth(2).inputValue()]));
await p.getByRole("button", { name: "Уменьшить" }).nth(1).click();
await p.waitForTimeout(4000);
console.log("  after one minus tap, field1 = " + await p2.nth(1).inputValue());
const e2: any = await db.journalDocumentEntry.findFirst({ where: { documentId: "cmu8hkgnh001tic9md21uf2nx", date: new Date("2026-09-21T00:00:00Z") } });
console.log("  db 09-21 = " + JSON.stringify(e2?.data));
await shot(p, "repro-b");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
