import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { parsePpkRecords } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { PRP_TEMPLATES } from "@/lib/ppk/structure-templates";
import type { PpkPanelProps } from "../item-panel";
import { PanelNote, SourceLink } from "./panel-ui";
import { PrpTableClient } from "./prp-table-client";

/**
 * 3.1–3.4: таблицы программ обязательных предварительных мероприятий —
 * свои строки, правка и «Заполнить типовыми». 3.3: пока своих строк нет,
 * в программу идёт типовой перечень аварийных ситуаций.
 */
export async function PrpTablePanel({ item, scope }: PpkPanelProps) {
  const block = item.table!;
  const [rows, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.structure.prp"),
  ]);
  const initial = parsePpkRecords(block, rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  return (
    <div className="space-y-4">
      <PanelNote>
        {t(`notes.${block}`)}
        {block === "prp-disinfection" ? (
          <>
            {" "}
            <SourceLink href="/production-control/sanitation/pest-control">{t("openPestPlan")}</SourceLink>
          </>
        ) : null}
      </PanelNote>
      <PrpTableClient block={block} initial={initial} template={[...PRP_TEMPLATES[block]]} />
    </div>
  );
}
