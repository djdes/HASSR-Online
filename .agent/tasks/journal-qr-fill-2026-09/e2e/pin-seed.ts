/* eslint-disable no-console */
// Ставит (set <pin>) или снимает (clear) PIN тестовому сотруднику e2e-fill-guide.
import { db } from "@/lib/db";
import { setEmployeeQrPin } from "@/lib/qr-fill-actor";
(async () => {
  const user = await db.user.findFirstOrThrow({ where: { email: "e2e-fill-guide@wesetup.local" }, select: { id: true } });
  const mode = process.argv[2];
  if (mode === "set") {
    const error = await setEmployeeQrPin(user.id, process.argv[3] ?? "2580");
    console.log(error ?? "pin set");
  } else {
    await setEmployeeQrPin(user.id, null);
    console.log("pin cleared");
  }
  await db.$disconnect();
})();
