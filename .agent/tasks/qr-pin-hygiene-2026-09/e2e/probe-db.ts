// Только чтение: dev-сервер на 3020 смотрит в ту же ЛОКАЛЬНУЮ e2e-базу?
// Страница наклейки e2e-холодильника должна открыться с его названием
// (на другой базе такого id нет → 404). Ничего не пишет.
// Запуск: npx tsx .agent/tasks/qr-pin-hygiene-2026-09/e2e/probe-db.ts
import fs from "node:fs";
import path from "node:path";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const fridge = await db.equipment.findFirst({
    where: { area: { organizationId: "e2e-org-a" }, type: { in: ["refrigerator", "freezer"] } },
    select: { id: true, name: true },
  });
  const lamps = await db.equipment.count({ where: { area: { organizationId: "e2e-org-a" }, type: "uv_lamp" } });
  const rooms = await db.room.count({ where: { building: { organizationId: "e2e-org-a" } } });
  const hasTable = await db.qrPinRequest.count().then(() => true).catch((e: unknown) => String(e).slice(0, 200));
  console.log(JSON.stringify({ fridge, lamps, rooms, qrPinRequestTable: hasTable }));
  if (!fridge) throw new Error("нет e2e-холодильника");
  const token = mintQrFillToken("equipment", fridge.id);
  const res = await fetch(`${BASE}/equipment-fill/${fridge.id}?token=${encodeURIComponent(token)}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  console.log(
    JSON.stringify({
      status: res.status,
      containsName: html.includes(fridge.name),
      invalidLink: html.includes("недействительна"),
      text: text.slice(0, 400),
    })
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
