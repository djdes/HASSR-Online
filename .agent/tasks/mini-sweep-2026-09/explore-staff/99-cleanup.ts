import { db } from "../tg-session";
(async () => {
  const d = await db.journalDocument.deleteMany({ where: { organizationId: "e2e-org-b", title: { startsWith: "СЕКРЕТ Беты" } } });
  console.log("deleted org-B doc:", d.count);
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0, 300)); });
