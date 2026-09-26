// Ids для обхода sweep-app.ts: документы разных журналов, помещение, оборудование орг A.
import fs from "node:fs";
import { db } from "./server-db";
(async () => {
  const org = "e2e-org-a";
  const docs = await db.journalDocument.findMany({ where: { organizationId: org, status: "active" }, include: { template: { select: { code: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  const seen = new Set<string>(); const picked: string[] = []; const codes: string[] = [];
  for (const want of ["hygiene", "cold_equipment_control", "general_cleaning", "finished_product", "climate_control", "fryer_oil", "incoming_control"]) {
    const d = docs.find((x) => x.template.code === want);
    if (d && !seen.has(want)) { seen.add(want); picked.push(`/journals/${want}/documents/${d.id}`); codes.push(want); }
  }
  const room = await db.room.findFirst({ where: { building: { organizationId: org } } }).catch(() => null);
  const eq = await db.equipment.findFirst({ where: { area: { organizationId: org } } }).catch(() => null);
  const out = { org, docs: picked.slice(0, 4), codes: codes.slice(0, 4), room: room?.id ?? null, equipment: eq?.id ?? null, allCodes: [...new Set(docs.map((d) => d.template.code))] };
  fs.writeFileSync("d:/wt/tmp/sweep/ids.json", JSON.stringify(out, null, 1)); console.log(out); await db.$disconnect();
})();
