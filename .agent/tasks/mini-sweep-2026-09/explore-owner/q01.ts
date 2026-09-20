import { db } from "../tg-session";
async function main() {
  const docs: any[] = await db.journalDocument.findMany({ where: { organizationId: "e2e-org-a" }, include: { template: { select: { code: true } } }, take: 80, orderBy: { createdAt: "desc" } });
  console.log("docs", docs.length);
  for (const d of docs) console.log(" " + d.id + " | " + d.template?.code + " | " + d.dateFrom?.toISOString?.().slice(0,10) + ".." + d.dateTo?.toISOString?.().slice(0,10) + " | vs=" + d.verificationStatus + " | " + (d.responsibleTitle||""));
  await db.$disconnect();
}
main().then(()=>process.exit(0), e=>{console.error(e);process.exit(1);});
