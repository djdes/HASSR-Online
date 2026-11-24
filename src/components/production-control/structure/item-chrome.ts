import { getTranslations } from "next-intl/server";
import { ppkBlock, ppkBlockHref } from "@/lib/ppk/registry";
import type { PpkStructureItem } from "@/lib/ppk/structure";

/** Шапка пункта: номер как в документе, название, откуда данные и ссылка на раздел. */
export type PpkItemChrome = {
  number: string;
  title: string;
  source: string;
  /** Страница блока раздела с тем же содержанием («Открыть раздел»). */
  sectionHref: string | null;
  sectionLabel: string;
};

export async function ppkItemChrome(item: PpkStructureItem): Promise<PpkItemChrome> {
  const t = await getTranslations("productionControl.structure");
  return {
    number: item.section === "appendix" ? t("appendixNumber", { n: item.number }) : item.number,
    title: t(`items.${item.id}.title`),
    source: t(`items.${item.id}.source`),
    sectionHref: item.block ? ppkBlockHref(ppkBlock(item.block)) : null,
    sectionLabel: t("openSection"),
  };
}
