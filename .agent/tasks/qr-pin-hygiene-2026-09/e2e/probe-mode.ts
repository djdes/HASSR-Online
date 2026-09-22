// Только чтение: режим QR в e2e-организации и наличие данных для смоука.
import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

async function main() {
  const org = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { qrFillMode: true, name: true } });
  const pending = await db.qrPinRequest.count({ where: { organizationId: "e2e-org-a" } });
  console.log(JSON.stringify({ org, qrPinRequestsInOrg: pending }));
  await db.$disconnect();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
