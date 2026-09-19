/* eslint-disable no-console */
import { db } from "@/lib/db";
(async () => {
  const d = await db.journalDocument.findUnique({ where: { id: "cmt6j45tj0i0c82tstt9fjbvg" }, select: { config: true } });
  const rows = (((d?.config as Record<string, unknown>)?.rows ?? []) as Array<Record<string, string>>);
  const filter = process.argv[2] ?? "E2E";
  console.log(JSON.stringify(rows.filter((r) => String(r.productName).includes(filter)).map((r) => ({ id: r.id, name: r.productName, temp: r.productTemp, rej: r.rejectionTime, prod: r.productionDateTime, src: r.sourceRowKey })), null, 1));
  console.log("total rows:", rows.length);
  await db.$disconnect();
})();
