import { redirect } from "next/navigation";

/**
 * Бывшая «Нагрузка сотрудников» (распределение задач по весу журналов).
 * Владелец убрал определение нагрузки (2026-11-23); старые ссылки и закладки
 * ведут к «Ответственным за журналы».
 */
export default function WorkloadBalanceRemovedPage() {
  redirect("/settings/journal-responsibles");
}
