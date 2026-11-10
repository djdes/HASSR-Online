// AC11(б): a device that delivers offline records and went silent for more than a day —
// management is told once; a device that never delivered anything is not reported.
//   npx tsx .agent/tasks/offline-app-phase2-2026-11/e2e/silent-device.ts
import "dotenv/config";

import { db } from "@/lib/db";
import { notifySilentOfflineDevices } from "@/lib/offline/devices.server";

async function main() {
  let failed = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const user = await db.user.findFirst({ where: { email: "admin@haccp.local" }, select: { id: true, organizationId: true } });
  if (!user) throw new Error("Нет демо-пользователя");
  await db.offlineDevice.deleteMany({ where: { deviceKey: { startsWith: "e2e-silent-" } } });
  await db.notification.deleteMany({ where: { kind: "offline-device-silent" } });
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);
  const make = (deviceKey: string, deliveredCount: number, lastSeenAt: Date) =>
    db.offlineDevice.create({ data: { organizationId: user.organizationId, userId: user.id, deviceKey, label: "Планшет на кухне", deliveredCount, lastSeenAt } });
  await make("e2e-silent-kitchen-tablet-1", 5, hoursAgo(30));
  await make("e2e-silent-personal-phone-1", 0, hoursAgo(30));
  await make("e2e-silent-fresh-tablet-0001", 5, hoursAgo(2));
  await make("e2e-silent-forgotten-000001", 5, hoursAgo(20 * 24));

  const first = await notifySilentOfflineDevices();
  const notifications = await db.notification.findMany({ where: { kind: "offline-device-silent" }, select: { title: true, items: true, userId: true } });
  check("only the tablet that works offline and is silent for a day is reported", first === 1, `reported ${first}`);
  check("management gets the notification", notifications.length >= 1 && notifications.every((item) => item.title.includes("не выходило на связь")), `${notifications.length} notification(s): ${notifications[0]?.title ?? ""}`);
  const second = await notifySilentOfflineDevices();
  check("the same silence is not reported twice", second === 0, `reported ${second}`);
  // The tablet comes back and goes silent again — that is a new silence.
  const tablet = await db.offlineDevice.findFirst({ where: { deviceKey: "e2e-silent-kitchen-tablet-1" }, select: { id: true } });
  await db.offlineDevice.update({ where: { id: tablet!.id }, data: { lastSeenAt: hoursAgo(26), staleNotifiedAt: hoursAgo(40) } });
  check("a new silence after coming back is reported again", (await notifySilentOfflineDevices()) === 1);

  await db.offlineDevice.deleteMany({ where: { deviceKey: { startsWith: "e2e-silent-" } } });
  await db.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
