import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
async function main() {
  console.log("SCOPES:", JSON.stringify(await db.managerScope.findMany({ where: { organizationId: "e2e-org-a" } })));
  await db.$disconnect();
}
main();
