/* eslint-disable no-console */
// Режим QR-форм тестовой организации и PIN тестового сотрудника.
//   npx tsx set-mode.ts public|pin|auth [--pin=2580] [--clear-pin]
import { db } from "@/lib/db";
import { setEmployeeQrPin } from "@/lib/qr-fill-actor";

const ORG = "cmoe6rpt4000097ts71yb922y";
const EMAIL = "e2e-fill-guide@wesetup.local";

(async () => {
  const mode = process.argv[2];
  if (mode === "public" || mode === "pin" || mode === "auth") {
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: mode } });
    console.log("qrFillMode =", mode);
  }
  for (const flag of ["--enable=", "--disable="]) {
    const arg = process.argv.find((a) => a.startsWith(flag));
    if (!arg) continue;
    const code = arg.slice(flag.length);
    const org = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { disabledJournalCodes: true } });
    const current = org.disabledJournalCodes as string[];
    const next = flag === "--enable=" ? current.filter((c) => c !== code) : Array.from(new Set([...current, code]));
    await db.organization.update({ where: { id: ORG }, data: { disabledJournalCodes: next } });
    console.log(flag, code, "→ disabled:", next.length);
  }
  const user = await db.user.findFirstOrThrow({ where: { organizationId: ORG, email: EMAIL }, select: { id: true, name: true } });
  const pinArg = process.argv.find((a) => a.startsWith("--pin="));
  if (pinArg) console.log("setPin:", await setEmployeeQrPin(user.id, pinArg.slice(6)) ?? "ok", user.name);
  if (process.argv.includes("--clear-pin")) console.log("clearPin:", await setEmployeeQrPin(user.id, null) ?? "ok");
  await db.$disconnect();
})();
