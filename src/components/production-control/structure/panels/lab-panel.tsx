import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { parsePpkRecords } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { LabClient } from "@/app/(dashboard)/production-control/sanitation/lab/lab-client";
import type { PpkPanelProps } from "../item-panel";
import { PanelSection } from "./panel-ui";

/**
 * 3.6 «Лабораторно-инструментальные исследования в рамках ППК»: из блока
 * «Лабораторные исследования» — план и график, договор, протоколы, акты.
 */
export async function LabPanel({ scope }: PpkPanelProps) {
  const [rows, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "lab-plan" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.lab"),
  ]);
  const initial = parsePpkRecords("lab-plan", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  return (
    <div className="space-y-8">
      <LabClient initial={initial} header={<div className="mb-4"><PpkCreateButton label={t("add")} /></div>} />
      <div className="grid gap-8 md:grid-cols-2">
        <PanelSection title={t("contract")}>
          <PpkFolder folder="lab-contract" canManage />
        </PanelSection>
        <PanelSection title={t("protocols")}>
          <PpkFolder folder="lab-protocols" canManage />
        </PanelSection>
        <PanelSection title={t("acts")} className="md:col-span-2">
          <PpkFolder folder="lab-acts" canManage />
        </PanelSection>
      </div>
    </div>
  );
}
