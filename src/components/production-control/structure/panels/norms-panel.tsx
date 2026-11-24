import { getTranslations } from "next-intl/server";
import { NormDocumentsBody } from "@/components/production-control/norm-documents-body";
import type { PpkPanelProps } from "../item-panel";
import { SourceLink } from "./panel-ui";

/**
 * 1.7 «Список основной нормативной документации»: перечень подтягивается из
 * отмеченных галочками документов каталога и своих документов блока
 * «Нормативные документы» — тот же редактор.
 */
export async function NormsPanel({ scope }: PpkPanelProps) {
  const t = await getTranslations("productionControl");
  return (
    <div className="space-y-6">
      <NormDocumentsBody scope={scope} />
      <SourceLink href="/sanpin">{t("norms.sanpinLink")}</SourceLink>
    </div>
  );
}
