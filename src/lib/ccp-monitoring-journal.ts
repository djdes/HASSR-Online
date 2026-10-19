/**
 * Журнал «Мониторинг ККТ» (`ccp_monitoring`) — журнал записей: каждое
 * измерение в критической контрольной точке плана ХАССП — отдельная
 * `JournalEntry` с полями ниже. Блок ППК «ККТ» сверяет эти записи с
 * пределами точек (`src/lib/ppk/ccp-monitoring.ts`), поэтому ключи полей
 * менять нельзя.
 *
 * Поля — один источник для сида шаблона (`prisma/seed.ts`) и образца
 * бланка (`journal-sample-fixtures.ts`).
 */
export const CCP_MONITORING_TEMPLATE_CODE = "ccp_monitoring";

export const CCP_MONITORING_FIELDS = [
  { key: "ccpName", label: "Название ККТ", type: "text", required: true },
  { key: "controlParameter", label: "Параметр контроля", type: "text", required: true },
  { key: "criticalLimit", label: "Критический предел", type: "text", required: true },
  { key: "actualValue", label: "Фактическое значение", type: "text", required: true },
  { key: "withinLimit", label: "В пределах нормы", type: "boolean", required: true },
  {
    key: "correctiveAction",
    label: "Корректирующее действие",
    type: "text",
    required: false,
    showIf: { field: "withinLimit", equals: false },
  },
] as const;
