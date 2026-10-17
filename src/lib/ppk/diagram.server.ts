import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PPK_RECORD_SCHEMAS, type ControlPointData, type DiagramData } from "./records";

/** Схема своей организации нужного блока; чужая, битая или несуществующая — 404. */
export async function loadDiagramRecord(
  organizationId: string,
  block: "flowchart" | "floor-plan",
  id: string,
): Promise<{ id: string; data: DiagramData; updatedAt: Date }> {
  const row = await db.ppkRecord.findFirst({
    where: { id, organizationId, block },
    select: { id: true, data: true, updatedAt: true },
  });
  if (!row) notFound();
  const parsed = PPK_RECORD_SCHEMAS[block].safeParse(row.data);
  if (!parsed.success) notFound();
  return { id: row.id, data: parsed.data as DiagramData, updatedAt: row.updatedAt };
}

/** Номера ККТ и ОПП организации — для выбора на этапе блок-схемы. */
export async function loadControlNumbers(organizationId: string): Promise<string[]> {
  const rows = await db.ppkRecord.findMany({
    where: { organizationId, block: "control-points" },
    select: { data: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const numbers: string[] = [];
  for (const row of rows) {
    const parsed = PPK_RECORD_SCHEMAS["control-points"].safeParse(row.data);
    if (!parsed.success) continue;
    const point = parsed.data as ControlPointData;
    if ((point.kind === "ccp" || point.kind === "oprp") && point.number && !numbers.includes(point.number)) {
      numbers.push(point.number);
    }
  }
  return numbers;
}
