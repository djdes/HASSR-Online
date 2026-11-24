import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { parsePpkRecords } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import type { PpkPanelProps } from "../item-panel";
import { ContractsClient } from "./contracts-client";
import { PanelSection, SourceLink } from "./panel-ui";

/**
 * 1.3 «Перечень основных договоров»: «Реестра договоров» в системе нет —
 * перечень ведётся здесь (наименование, контрагент, номер, дата, видимость
 * проверяющему), файлы договоров и актов — папкой. Договоры лаборатории и
 * дезслужбы, загруженные раньше в своих разделах, показаны здесь же.
 */
export async function ContractsPanel({ scope }: PpkPanelProps) {
  const [rows, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "contracts" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.structure.contracts"),
  ]);
  const initial = parsePpkRecords("contracts", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  return (
    <div className="space-y-8">
      <ContractsClient initial={initial} />
      <PanelSection title={t("filesTitle")} hint={t("filesHint")}>
        <PpkFolder folder="contracts" canManage />
      </PanelSection>
      <div className="grid gap-8 md:grid-cols-2">
        <PanelSection
          title={t("labContract")}
          actions={<SourceLink href="/production-control/sanitation/lab">{t("openLab")}</SourceLink>}
        >
          <PpkFolder folder="lab-contract" canManage />
        </PanelSection>
        <PanelSection
          title={t("pestContract")}
          actions={<SourceLink href="/production-control/sanitation/pest-control">{t("openPest")}</SourceLink>}
        >
          <PpkFolder folder="pest-contract" canManage />
        </PanelSection>
      </div>
    </div>
  );
}
