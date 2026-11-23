import { redirect } from "next/navigation";

/**
 * Бывшая «Сложность журналов» — веса для расчёта нагрузки сотрудников.
 * Определение нагрузки убрано (владелец, 2026-11-23); старые ссылки и закладки
 * ведут к «Ответственным за журналы».
 */
export default function JournalDifficultyRemovedPage() {
  redirect("/settings/journal-responsibles");
}
