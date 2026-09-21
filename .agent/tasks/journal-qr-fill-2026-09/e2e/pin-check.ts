import { db } from "@/lib/db";
(async () => {
  const u = await db.user.findFirst({ where: { email: "e2e-fill-guide@wesetup.local" }, select: { id: true, name: true, qrPinHash: true, qrPinEncrypted: true, organizationId: true, isActive: true } });
  console.log(JSON.stringify({ id: u?.id, name: u?.name, hasHash: Boolean(u?.qrPinHash), hasEnc: Boolean(u?.qrPinEncrypted), org: u?.organizationId, active: u?.isActive }));
  await db.$disconnect();
})();
