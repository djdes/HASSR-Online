import { db } from "@/lib/db";
import { parsePpkRecords } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadProductionPulled } from "@/lib/ppk/structure-facts.server";
import type { PpkPanelProps } from "../item-panel";
import { ProductionInfoForm } from "./production-info-form";

/**
 * 1.4 «Общая информация о производстве»: наименование и адрес — из сведений
 * об объекте, численность — по сотрудникам объекта, остальное — шаблон с
 * обязательными для ППК полями (одна запись на объект).
 */
export async function ProductionInfoPanel({ scope }: PpkPanelProps) {
  const [row, pulled, staff] = await Promise.all([
    db.ppkRecord.findFirst({
      where: { ...ppkWhere(scope), block: "production-info" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
    }),
    loadProductionPulled(scope),
    loadPpkStaff(scope),
  ]);
  const record = row ? (parsePpkRecords("production-info", [row])[0] ?? null) : null;
  return (
    <ProductionInfoForm
      record={record ? { id: record.id, data: record.data } : null}
      pulled={pulled}
      staffCount={staff.length}
      objectHref={scope.buildingId ? "/settings/buildings" : "/settings/organization/documents"}
    />
  );
}
