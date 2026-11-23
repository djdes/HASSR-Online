type BuildTasksflowJournalUiInput = {
  code: string;
  label: string;
  hasAdapter: boolean;
};

export type TasksflowJournalUi = {
  subjectLabel: string;
  subjectPlural: string;
  modeRowLabel: string;
  modeRowHint: string;
  modeFreeLabel: string;
  modeFreeHint: string;
  rowSearchPlaceholder: string;
  rowListTitle: string;
  rowEmptyState: string;
  titleLabel: string;
  titlePlaceholder: string;
  titleHint: string;
  documentLabel: string;
  documentPlaceholder: string;
  workerLabel: string;
  workerPlaceholder: string;
  workerHint: string;
  submitLabel: string;
  reviewTitle: string;
  reviewRowHint: string;
  reviewFreeHint: string;
};

const CLEANING_CODES = new Set([
  "cleaning",
  "general_cleaning",
  "equipment_cleaning",
  "cleaning_ventilation_checklist",
  "sanitary_day_control",
  "disinfectant_usage",
  "pest_control",
  "ppe_issuance",
]);

const STAFF_CODES = new Set([
  "health_check",
  "med_books",
  "staff_training",
  "training_plan",
]);

const EQUIPMENT_CODES = new Set([
  "climate_control",
  "cold_equipment_control",
  "equipment_calibration",
  "equipment_maintenance",
  "uv_lamp_runtime",
]);

const PRODUCT_CODES = new Set([
  "incoming_control",
  "incoming_raw_materials_control",
  "finished_product",
  "fryer_oil",
  "intensive_cooling",
  "product_writeoff",
  "perishable_rejection",
  "traceability_test",
  "metal_impurity",
]);

function buildGenericUi(label: string): TasksflowJournalUi {
  return {
    subjectLabel: "Строка журнала",
    subjectPlural: "строкам",
    modeRowLabel: "По строке журнала",
    modeRowHint:
      "Выберите готовую строку журнала и создайте задачу на ее основе.",
    modeFreeLabel: "Свободная задача",
    modeFreeHint:
      "Сформулируйте свою задачу и привяжите ее к нужному документу журнала.",
    rowSearchPlaceholder: "Поиск по строкам, документам и журналу…",
    rowListTitle: "Строки журнала",
    rowEmptyState: "По строкам ничего не найдено.",
    titleLabel: "Что нужно сделать",
    titlePlaceholder: `Например: Проверить запись в «${label}»`,
    titleHint: "Текст задачи можно оставить стандартным или уточнить вручную.",
    documentLabel: "Документ журнала",
    documentPlaceholder: "Выберите документ журнала",
    workerLabel: "Сотрудник",
    workerPlaceholder: "Кому назначить задачу",
    workerHint: "Сотрудник получит задачу в программном модуле.",
    submitLabel: `Создать задачу для «${label}»`,
    reviewTitle: "Проверка перед созданием",
    reviewRowHint:
      "Исполнитель и расписание подтянутся автоматически из выбранной строки журнала.",
    reviewFreeHint:
      "После выполнения WeSetup добавит запись в выбранный документ журнала.",
  };
}

export function buildTasksflowJournalUi({
  code,
  label,
  hasAdapter,
}: BuildTasksflowJournalUiInput): TasksflowJournalUi {
  const base = buildGenericUi(label);

  if (CLEANING_CODES.has(code)) {
    return {
      ...base,
      subjectLabel: "Зона уборки",
      subjectPlural: "зонам",
      rowSearchPlaceholder: "Поиск по зонам уборки, сотрудникам и документам…",
      rowListTitle: "Зоны и строки уборки",
      titlePlaceholder: "Например: Протереть холодильную витрину",
      submitLabel: "Создать задачу по уборке",
      reviewRowHint:
        "Исполнитель и период подтянутся из выбранной строки графика уборки.",
    };
  }

  if (STAFF_CODES.has(code)) {
    return {
      ...base,
      subjectLabel: "Сотрудник",
      subjectPlural: "сотрудникам",
      rowSearchPlaceholder:
        "Поиск по сотрудникам, документам и журналу здоровья…",
      rowListTitle: "Сотрудники и записи журнала",
      titlePlaceholder: "Например: Провести предсменный осмотр",
      submitLabel: `Создать задачу по «${label}»`,
      reviewRowHint:
        "Сотрудник и нужная запись подтянутся автоматически из выбранной строки.",
    };
  }

  if (EQUIPMENT_CODES.has(code)) {
    return {
      ...base,
      subjectLabel: "Оборудование",
      subjectPlural: "оборудованию",
      rowSearchPlaceholder:
        "Поиск по оборудованию, документам и журналу контроля…",
      rowListTitle: "Оборудование и контрольные строки",
      titlePlaceholder: "Например: Проверить температурный режим",
      submitLabel: `Создать задачу по «${label}»`,
    };
  }

  if (PRODUCT_CODES.has(code)) {
    return {
      ...base,
      subjectLabel: "Позиция контроля",
      subjectPlural: "позициям контроля",
      rowSearchPlaceholder:
        "Поиск по позициям контроля, документам и журналу…",
      rowListTitle: "Позиции контроля",
      titlePlaceholder: "Например: Проверить и зафиксировать показатель",
      submitLabel: `Создать задачу по «${label}»`,
    };
  }

  if (!hasAdapter) {
    return {
      ...base,
      modeFreeHint:
        "Сформулируйте свою задачу и привяжите ее к активному документу журнала.",
    };
  }

  return base;
}
