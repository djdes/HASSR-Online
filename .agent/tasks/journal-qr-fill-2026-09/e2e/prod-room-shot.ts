// Прод: страница замера помещения организации владельца — ±, имя в две строки, полоса объектов.
import path from "node:path";
import { chromium } from "playwright";
import { db } from "@/lib/db";
import { mintQrFillToken } from "@/lib/qr-fill-token";
const ORG = "cmtwzhw9700w73vts4z0z254u";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e/shots");
(async () => {
  const room = await db.room.findFirst({ where: { building: { organizationId: ORG } }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } });
  const eq = await db.equipment.findFirst({ where: { area: { organizationId: ORG } }, select: { id: true, name: true } });
  await db.$disconnect();
  console.log("room:", room?.name, room?.id, "equipment:", eq?.name, eq?.id);
  if (process.env.IDS_ONLY) return;
  const tokens: Record<string, string | undefined> = { room: process.env.ROOM_TOKEN, equipment: process.env.EQ_TOKEN };
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const [kind, obj] of [["room", room], ["equipment", eq]] as const) {
    if (!obj) continue;
    const url = `https://wesetup.ru/${kind}-fill/${obj.id}?token=${encodeURIComponent(tokens[kind] ?? mintQrFillToken(kind, obj.id))}`;
    const started = Date.now();
    const res = await page.goto(url, { waitUntil: "load", timeout: 120_000 });
    console.log(kind, "status:", res?.status(), "load ms:", Date.now() - started);
    await page.waitForTimeout(1500);
    const sign = page.getByRole("button", { name: "Сменить знак" });
    console.log(kind, "sign buttons:", await sign.count());
    const strip = page.locator("[aria-current=true]").first();
    console.log(kind, "strip:", (await strip.count()) ? (await strip.locator("xpath=..").innerText()).replace(/\s+/g, " ").slice(0, 160) : "(нет соседей)");
    await page.screenshot({ path: path.join(ROOT, `prod-${kind}-fill.png`), fullPage: true });
  }
  await browser.close();
})();
