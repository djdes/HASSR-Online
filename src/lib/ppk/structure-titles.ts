/**
 * Русские названия пунктов структуры ППК для печати и реестра редакций:
 * печатная программа и номера редакций — документ на русском, как остальные
 * PDF раздела. Тексты берутся из словаря `ru.json` (один источник с окнами).
 */
import ru from "@/i18n/messages/ru.json";
import type { PpkItemId, PpkStructureItem, PpkStructureSection } from "./structure";

const STRUCTURE = ru.productionControl.structure;

/** Название пункта: «Общая информация об организации». */
export function ppkItemTitleRu(id: PpkItemId): string {
  return (STRUCTURE.items as Record<string, { title: string }>)[id]?.title ?? id;
}

/** Заголовок пункта в печати: «1.1. Общая информация…»; приложение — «Приложение №1 «…»». */
export function ppkItemHeadingRu(item: Pick<PpkStructureItem, "id" | "number" | "section">): string {
  const title = ppkItemTitleRu(item.id);
  if (item.section === "appendix") return `${STRUCTURE.appendixNumber.replace("{n}", item.number)} «${title}»`;
  return `${item.number}. ${title}`;
}

/** Заголовок раздела: «1. Первичная информация…»; у приложений номера нет. */
export function ppkSectionHeadingRu(section: Pick<PpkStructureSection, "key" | "number">): string {
  const title = (STRUCTURE.sections as Record<string, string>)[section.key] ?? section.key;
  return section.number ? `${section.number}. ${title}` : title;
}
