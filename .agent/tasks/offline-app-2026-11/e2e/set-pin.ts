// Gives one demo employee a QR PIN for the offline end-to-end run.
//   npx tsx .agent/tasks/offline-app-2026-11/e2e/set-pin.ts "Волкова Анна Дмитриевна" 4821
import "dotenv/config";

import { db } from "@/lib/db";
import { setEmployeeQrPin } from "@/lib/qr-fill-actor";

async function main() {
  const [name = "Волкова Анна Дмитриевна", pin = "4821"] = process.argv.slice(2);
  const user = await db.user.findFirst({ where: { name }, select: { id: true, name: true } });
  if (!user) throw new Error(`Нет сотрудника «${name}»`);
  const error = await setEmployeeQrPin(user.id, pin);
  if (error) throw new Error(error);
  const saved = await db.user.findUnique({ where: { id: user.id }, select: { qrPinHash: true, qrPinEncrypted: true } });
  console.log(JSON.stringify({ employee: user.name, pinSet: Boolean(saved?.qrPinHash), canVerifyOffline: Boolean(saved?.qrPinEncrypted) }));
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
