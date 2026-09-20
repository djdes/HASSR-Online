/* eslint-disable no-console */
// Временные строки в тестовом бракераже для проверки печати (add N | remove).
import { db } from "@/lib/db";
import { createFinishedProductRow } from "@/lib/finished-product-document";
const DOC = "cmt6j45tj0i0c82tstt9fjbvg";
(async () => {
  const mode = process.argv[2];
  const d = await db.journalDocument.findUniqueOrThrow({ where: { id: DOC }, select: { config: true } });
  const config = (d.config ?? {}) as Record<string, unknown>;
  let rows = (Array.isArray(config.rows) ? config.rows : []) as Array<Record<string, unknown>>;
  if (mode === "add") {
    const n = Number(process.argv[3] ?? 20);
    for (let i = 0; i < n; i += 1) {
      rows.push(createFinishedProductRow({
        productName: `E2E Печать ${i + 1}: щи из свежей капусты с картофелем со сметаной и курами (тушка)`,
        productionDateTime: "2026-09-18 12:35", rejectionTime: "2026-09-18 12:40", releasePermissionTime: "2026-09-18 12:45",
        organoleptic: "Отлично", productTemp: "71", responsiblePerson: "Абдухалилова Шайирахон Фахритдиновна", inspectorName: "Репешко Ирина Васильевна", releaseAllowed: "yes",
      }) as unknown as Record<string, unknown>);
    }
  } else {
    rows = rows.filter((r) => !String(r.productName ?? "").startsWith(mode === "purge-e2e" ? "E2E" : "E2E Печать"));
  }
  await db.journalDocument.update({ where: { id: DOC }, data: { config: { ...config, rows } as never } });
  console.log(mode, "rows:", rows.length);
  await db.$disconnect();
})();
