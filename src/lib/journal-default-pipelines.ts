/**
 * Дефолтные определения колонок для bulk-seed pipeline'а.
 *
 * Многие журналы хранят свою data-структуру в `JournalDocument.config`
 * (JSON document-based design), а `JournalTemplate.fields[]` оставляют
 * пустым. Это значит что seed-all-pipeline пропускает их с
 * `skippedNoFields`.
 *
 * Этот регистр заполняет gap: для каждого такого журнала
 * прописываем sensible defaults, по которым bulk-seed создаст
 * pinned-узлы. Менеджер потом отредактирует через UI.
 *
 * Формат — тот же что у `JournalTemplate.fields[]`:
 *   { key: string, label: string, type: "text"|"number"|"boolean"|"select"|"date", required?: boolean, options?: [{value,label}] }
 *
 * Если для журнала тут есть запись и `template.fields[]` пустой —
 * берём отсюда. Если `template.fields[]` непустой — он побеждает
 * (legacy field-based журналы свою конфигурацию уже знают).
 *
 * Чтобы добавить journal сюда:
 *   1. Открой `<code>-document.ts` и найди *Row type
 *   2. Конвертируй каждое поле в TaskFormField-shape
 *   3. Поставь sensible required: true для самых важных
 *   4. Закоммить — bulk-seed для всех орг следующий раз подхватит
 */

export type DefaultField = {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "date";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

export const DEFAULT_PIPELINE_FIELDS: Record<string, DefaultField[]> = {
  // src/lib/perishable-rejection-document.ts → PerishableRejectionRow
  perishable_rejection: [
    { key: "arrivalDate", label: "Дата приёмки", type: "date", required: true },
    { key: "arrivalTime", label: "Время приёмки", type: "text" },
    { key: "productName", label: "Наименование продукта", type: "text", required: true },
    { key: "productionDate", label: "Дата изготовления", type: "date", required: true },
    { key: "manufacturer", label: "Изготовитель", type: "text", required: true },
    { key: "supplier", label: "Поставщик", type: "text", required: true },
    { key: "packaging", label: "Упаковка", type: "text" },
    { key: "quantity", label: "Количество", type: "text", required: true },
    { key: "documentNumber", label: "Номер документа", type: "text" },
    {
      key: "organolepticResult",
      label: "Органолептика",
      type: "select",
      required: true,
      options: [
        { value: "compliant", label: "Соответствует" },
        { value: "non_compliant", label: "Не соответствует" },
        { value: "good_quality", label: "Доброкачественно" },
        { value: "poor_quality", label: "Недоброкачественно" },
      ],
    },
    {
      key: "storageCondition",
      label: "Условия хранения",
      type: "select",
      required: true,
      options: [
        { value: "2_6", label: "+2…+6°C" },
        { value: "minus2_2", label: "-2…+2°C" },
        { value: "minus18", label: "-18°C и ниже" },
      ],
    },
    { key: "expiryDate", label: "Срок годности", type: "date" },
    { key: "actualSaleDate", label: "Дата фактической реализации", type: "date" },
    { key: "actualSaleTime", label: "Время фактической реализации", type: "text" },
    { key: "responsiblePerson", label: "Ответственный", type: "text", required: true },
    { key: "note", label: "Примечание", type: "text" },
  ],

  // src/lib/glass-items-list-document.ts (если есть) — список стеклянных
  // предметов по участкам; колонки: участок, предмет, количество
  glass_items_list: [
    { key: "areaName", label: "Цех / участок", type: "text", required: true },
    { key: "itemName", label: "Наименование изделия", type: "text", required: true },
    { key: "quantity", label: "Количество", type: "number", required: true },
    { key: "note", label: "Примечание", type: "text" },
  ],

  // СИЗ: кто, что, сколько, размер, дата
  ppe_issuance: [
    { key: "employeeName", label: "Сотрудник", type: "text", required: true },
    { key: "ppeName", label: "Наименование СИЗ", type: "text", required: true },
    { key: "size", label: "Размер", type: "text" },
    { key: "quantity", label: "Количество", type: "text", required: true },
    { key: "issueDate", label: "Дата выдачи", type: "date", required: true },
    { key: "signature", label: "Подпись получателя", type: "text" },
    { key: "note", label: "Примечание", type: "text" },
  ],

  // Аварии: дата, описание, ответственный, корректирующие действия
  accident_journal: [
    { key: "incidentDate", label: "Дата происшествия", type: "date", required: true },
    { key: "incidentTime", label: "Время", type: "text" },
    { key: "description", label: "Описание происшествия", type: "text", required: true },
    { key: "cause", label: "Причина", type: "text" },
    { key: "actions", label: "Корректирующие действия", type: "text", required: true },
    { key: "responsiblePerson", label: "Ответственный", type: "text", required: true },
    { key: "resolved", label: "Устранено", type: "boolean" },
  ],

  // Сан. день — чек-лист
  sanitary_day_control: [
    { key: "areaName", label: "Зона / помещение", type: "text", required: true },
    { key: "cleaningDone", label: "Уборка выполнена", type: "boolean", required: true },
    { key: "disinfectantUsed", label: "Использованное средство", type: "text" },
    { key: "responsiblePerson", label: "Ответственный", type: "text", required: true },
    { key: "note", label: "Примечание", type: "text" },
  ],

  // Контроль металлопримесей
  metal_impurity: [
    { key: "checkDate", label: "Дата проверки", type: "date", required: true },
    { key: "productName", label: "Сырьё / продукт", type: "text", required: true },
    {
      key: "result",
      label: "Результат",
      type: "select",
      required: true,
      options: [
        { value: "passed", label: "Прошёл" },
        { value: "failed", label: "Не прошёл" },
      ],
    },
    { key: "responsiblePerson", label: "Ответственный", type: "text", required: true },
    { key: "note", label: "Примечание", type: "text" },
  ],

  // Контроль стекла (события — повреждения)
  glass_control: [
    { key: "checkDate", label: "Дата проверки", type: "date", required: true },
    {
      key: "damagesDetected",
      label: "Повреждения обнаружены?",
      type: "select",
      required: true,
      options: [
        { value: "yes", label: "Да" },
        { value: "no", label: "Нет" },
      ],
    },
    { key: "itemName", label: "Наименование изделия (если повреждения есть)", type: "text" },
    { key: "quantity", label: "Количество", type: "text" },
    { key: "damageInfo", label: "Описание повреждений", type: "text" },
    { key: "responsiblePerson", label: "Ответственный", type: "text", required: true },
  ],

  // Медкнижки: реестр срок-действий
  med_books: [
    { key: "employeeName", label: "Сотрудник", type: "text", required: true },
    { key: "issueDate", label: "Дата выдачи", type: "date", required: true },
    { key: "validUntil", label: "Действует до", type: "date", required: true },
    { key: "checkupDate", label: "Дата последнего осмотра", type: "date" },
    { key: "note", label: "Примечание", type: "text" },
  ],

  // Аудит-планы / протоколы / отчёты — комплексные документы
  // (multi-row sections), для них дефолтный pipeline = базовый skeleton
  audit_plan: [
    { key: "auditDate", label: "Дата аудита", type: "date", required: true },
    { key: "subdivision", label: "Подразделение", type: "text", required: true },
    { key: "responsiblePerson", label: "Ответственный аудитор", type: "text", required: true },
    { key: "note", label: "Примечание", type: "text" },
  ],

  audit_protocol: [
    { key: "auditDate", label: "Дата аудита", type: "date", required: true },
    { key: "auditedObject", label: "Проверяемый объект", type: "text", required: true },
    { key: "basisTitle", label: "Основание проверки", type: "text" },
    { key: "responsiblePerson", label: "Аудитор", type: "text", required: true },
  ],

  audit_report: [
    { key: "documentDate", label: "Дата отчёта", type: "date", required: true },
    {
      key: "auditType",
      label: "Тип проверки",
      type: "select",
      options: [
        { value: "planned", label: "Плановая" },
        { value: "unplanned", label: "Внеплановая" },
      ],
    },
    { key: "auditedObject", label: "Проверяемый объект", type: "text", required: true },
    { key: "auditors", label: "Аудиторы (через запятую)", type: "text", required: true },
  ],

  // src/lib/fryer-oil-document.ts → FryerOilEntryData
  fryer_oil: [
    { key: "startDate", label: "Дата начала использования", type: "date", required: true },
    { key: "fatType", label: "Тип жира", type: "text", required: true },
    { key: "equipmentType", label: "Оборудование", type: "text", required: true },
    { key: "productType", label: "Тип продукции", type: "text" },
    { key: "qualityStart", label: "Качество в начале (1-5)", type: "number", required: true },
    { key: "qualityEnd", label: "Качество в конце (1-5)", type: "number" },
    { key: "carryoverKg", label: "Остаток, кг", type: "number" },
    { key: "disposedKg", label: "Утилизировано, кг", type: "number" },
    { key: "controllerName", label: "Контролёр", type: "text", required: true },
  ],

  // src/lib/breakdown-history-document.ts → BreakdownRow
  breakdown_history: [
    { key: "startDate", label: "Дата начала", type: "date", required: true },
    { key: "equipmentName", label: "Оборудование", type: "text", required: true },
    { key: "breakdownDescription", label: "Описание поломки", type: "text", required: true },
    { key: "repairPerformed", label: "Что сделали для ремонта", type: "text" },
    { key: "partsReplaced", label: "Заменённые детали", type: "text" },
    { key: "endDate", label: "Дата окончания", type: "date" },
    { key: "downtimeHours", label: "Простой, часов", type: "text" },
    { key: "responsiblePerson", label: "Ответственный", type: "text", required: true },
  ],

  // src/lib/intensive-cooling-document.ts → IntensiveCoolingRow
  intensive_cooling: [
    { key: "productionDate", label: "Дата приготовления", type: "date", required: true },
    { key: "dishName", label: "Блюдо", type: "text", required: true },
    { key: "startTemperature", label: "Температура в начале (°C)", type: "text", required: true },
    { key: "endTemperature", label: "Температура в конце (°C)", type: "text", required: true },
    { key: "correctiveAction", label: "Корректирующее действие", type: "text" },
    { key: "comment", label: "Комментарий", type: "text" },
    { key: "responsibleTitle", label: "Ответственный", type: "text", required: true },
  ],

  // src/lib/equipment-cleaning-document.ts → EquipmentCleaningRowData
  equipment_cleaning: [
    { key: "washDate", label: "Дата мойки", type: "date", required: true },
    { key: "washTime", label: "Время", type: "text" },
    { key: "equipmentName", label: "Оборудование", type: "text", required: true },
    { key: "detergentName", label: "Моющее средство", type: "text", required: true },
    { key: "detergentConcentration", label: "Концентрация моющего", type: "text" },
    { key: "disinfectantName", label: "Дезинфицирующее средство", type: "text" },
    { key: "disinfectantConcentration", label: "Концентрация дезсредства", type: "text" },
    { key: "rinseTemperature", label: "Температура ополаскивания (°C)", type: "text" },
    {
      key: "rinseResult",
      label: "Результат контроля",
      type: "select",
      options: [
        { value: "compliant", label: "Соответствует" },
        { value: "non_compliant", label: "Не соответствует" },
      ],
    },
    { key: "washerName", label: "Кто мыл", type: "text", required: true },
    { key: "controllerName", label: "Контролёр", type: "text", required: true },
  ],

  // План обучения — справочный план (не event-based журнал, но всё-таки
  // pipeline даёт менеджеру что-то configurable). Если орга считает
  // pipeline для plan'а ненужным — может удалить узлы через UI.
  training_plan: [
    { key: "year", label: "Год", type: "text", required: true },
    { key: "documentDate", label: "Дата документа", type: "date", required: true },
    { key: "approveRole", label: "Должность утверждающего", type: "text", required: true },
    { key: "approveEmployee", label: "Утверждающий (ФИО)", type: "text" },
  ],

  // Входной контроль сырья (отдельный от incoming_control template).
  // Колонки эквивалентны journal'у incoming_control из seed.ts.
  incoming_raw_materials_control: [
    { key: "productName", label: "Наименование продукта", type: "text", required: true },
    { key: "supplier", label: "Поставщик", type: "text", required: true },
    { key: "manufactureDate", label: "Дата изготовления", type: "date", required: true },
    { key: "expiryDate", label: "Срок годности", type: "date", required: true },
    { key: "quantity", label: "Количество", type: "number", required: true },
    {
      key: "unit",
      label: "Единица измерения",
      type: "select",
      required: true,
      options: [
        { value: "kg", label: "кг" },
        { value: "l", label: "л" },
        { value: "pcs", label: "шт" },
      ],
    },
    { key: "temperatureOnArrival", label: "Температура при приёмке (°C)", type: "number" },
    {
      key: "packagingCondition",
      label: "Состояние упаковки",
      type: "select",
      required: true,
      options: [
        { value: "intact", label: "Целая" },
        { value: "damaged", label: "Повреждена" },
      ],
    },
    {
      key: "decision",
      label: "Решение",
      type: "select",
      required: true,
      options: [
        { value: "accepted", label: "Принято" },
        { value: "rejected", label: "Отклонено" },
      ],
    },
    { key: "notes", label: "Примечание", type: "text" },
  ],
};

/**
 * Журналы у которых есть СВОЙ per-journal TasksFlow-адаптер
 * (`src/lib/tasksflow-adapters/<code>.ts`). Они строят pipeline сами,
 * не через generic-адаптер. Поэтому им НЕ нужен pipeline-tree —
 * bulk-seed-all их пропускает silently (не добавляет в skippedNoFields,
 * чтобы пользователь не получал ложное уведомление).
 *
 * Если поведение поменяется (нужен redundant pipeline-tree поверх
 * адаптера) — убери код из этого set'а.
 */
export const PIPELINE_EXEMPT_JOURNALS = new Set<string>([
  // Document-based grid journals со своим адаптером, который сам
  // эмитит pipeline под конкретные роли в смене.
  "cleaning",
  "cleaning_ventilation_checklist",
  "climate_control",
  "cold_equipment_control",
  "general_cleaning",
  // Personnel-grid журналы (employee × day) со своим UI и адаптером.
  "hygiene",
  "health_check",
]);

/**
 * Возвращает поля для journal-кода: либо из `template.fields[]` если
 * непустые, либо из дефолтного регистра, либо null если нечего сидить.
 *
 * Журналы из `PIPELINE_EXEMPT_JOURNALS` всегда возвращают `null`
 * (pipeline-tree им не нужен — у них свой адаптер).
 */
export function resolvePipelineFields(
  templateCode: string,
  templateFields: unknown[]
): DefaultField[] | null {
  if (PIPELINE_EXEMPT_JOURNALS.has(templateCode)) return null;

  const valid = templateFields.filter(
    (f) =>
      f &&
      typeof f === "object" &&
      typeof (f as { key?: unknown }).key === "string"
  );
  if (valid.length > 0) return valid as DefaultField[];

  const defaults = DEFAULT_PIPELINE_FIELDS[templateCode];
  if (defaults && defaults.length > 0) return defaults;

  return null;
}
