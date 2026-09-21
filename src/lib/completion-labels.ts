/**
 * Человеческие подписи к полям, которые сотрудник заполняет в задаче.
 *
 * Раньше заведующая видела в блоке «Введённые данные» сырые ключи из
 * базы: «allHealthy ✓», «actionTaken», «polarCompoundsPercent». Понять,
 * что именно проверил сотрудник, по ним нельзя.
 *
 * Источник подписей — формы задач (`app/mini/claim/[id]/page.tsx`) и
 * ячейки журналов-документов. Где у одного ключа в разных журналах
 * разные уточнения («Действия», «Что сделано», «Принятые меры»),
 * берём общую формулировку: подпись должна подходить любому журналу.
 */

const COMPLETION_FIELD_LABELS: Record<string, string> = {
  // --- Общие ---------------------------------------------------------
  accepted: "Принято",
  actionTaken: "Принятые меры",
  actions: "Корректирующие действия",
  agent: "Средство",
  area: "Помещение",
  areaName: "Помещение или зона",
  areaTreated: "Обработанная зона",
  comment: "Комментарий",
  completedBy: "Кто выполнил",
  completedSteps: "Что сделано",
  correctiveAction: "Корректирующее действие",
  date: "Дата",
  description: "Описание",
  findings: "Выявленные нарушения",
  location: "Место хранения",
  method: "Метод",
  nextDate: "Следующая проверка",
  notes: "Примечания",
  performerName: "Исполнитель",
  purpose: "Назначение",
  quantity: "Количество",
  reason: "Причина",
  responsible: "Ответственный",
  result: "Результат",
  score: "Результат",
  signature: "Подпись",
  status: "Статус",
  summary: "Резюме",
  time: "Время",
  topic: "Тема",

  // --- Здоровье и гигиена --------------------------------------------
  allHealthy: "Все здоровы",
  healthStatus: "Здоровье",
  cleaned: "Убрано",
  temperatureAbove37: "Температура выше 37 °C",

  // --- Температуры ---------------------------------------------------
  temperature: "Температура",
  temperatureC: "Температура",
  startTemp: "Температура в начале",
  endTemp: "Температура в конце",
  rinseTemp: "Температура ополаскивания",
  humidity: "Влажность",
  durationMinutes: "Время охлаждения, мин",

  // --- Продукты и партии ---------------------------------------------
  product: "Продукт",
  productName: "Продукт",
  productBatch: "Партия или продукт",
  batchNumber: "Номер партии",
  lotNumber: "Партия",
  supplier: "Поставщик",
  expirationDate: "Срок годности",
  dish: "Блюдо или партия",
  appearanceOk: "Внешний вид в норме",
  tasteOk: "Вкус в норме",
  colorAcceptable: "Цвет приемлемый",
  rejectionReason: "Причина отказа",
  disposalMethod: "Способ утилизации",
  destinationTraced: "Прослежен путь до потребителя",

  // --- Оборудование ---------------------------------------------------
  equipmentName: "Оборудование",
  contractorName: "Подрядчик или специалист",
  workType: "Тип работ",
  runtimeHours: "Наработка, часов",
  totalHours: "Общий ресурс, часов",
  costRub: "Стоимость, ₽",
  lampOk: "Лампа исправна",
  replaced: "Масло заменено",
  polarCompoundsPercent: "Полярные соединения, %",

  // --- Уборка и дезинфекция -------------------------------------------
  disinfectantName: "Дезсредство",
  concentration: "Концентрация",
  volumeLiters: "Объём, литров",
  treatmentType: "Тип обработки",

  // --- Происшествия и жалобы -------------------------------------------
  severity: "Насколько серьёзно",
  complaintText: "Текст жалобы",
  source: "Источник",

  // --- СИЗ, стекло, металл ---------------------------------------------
  ppeName: "Тип СИЗ",
  recipient: "Кому выдано",
  itemName: "Наименование",
  material: "Материал",
  checkedItems: "Что проверено",
  damaged: "Найдены повреждения",
  metalDetected: "Металл обнаружен",

  // --- Аудит и обучение -------------------------------------------------
  auditTopic: "Тема аудита",
  auditorName: "Аудитор",
  nextAuditDate: "Дата следующего аудита",
  controllerName: "Контролёр",
};

/**
 * Служебный ключ — в интерфейсе не показываем.
 *
 * Такие ключи ставит не человек, а система: `_autoSeeded` — метка
 * пустой строки, созданной ночным сидером. Для заведующей это шум.
 *
 * `pipelineCompleted` сюда же: «✓» напротив внутреннего флага ничего
 * не сообщает — шаги показываются отдельным списком.
 */
export function isInternalCompletionKey(key: string): boolean {
  return key.startsWith("_") || key === "pipelineCompleted";
}

/** Подпись поля. Неизвестный ключ показываем как есть — лучше, чем ничего. */
export function completionEntryLabel(key: string): string {
  return COMPLETION_FIELD_LABELS[key] ?? key;
}

/* ---------- разбор снимка «что заполнил сотрудник» ---------- */

export type CompletionStep = {
  title: string;
  done: boolean;
  checklist: { item: string; done: boolean }[];
  photos: string[];
};

export type CompletionView = {
  /** Пропущено «сегодня не требуется» + причина. */
  skippedReason: string | null;
  /** Шаги пошаговой инструкции — списком с галочками. */
  steps: CompletionStep[];
  /** Обычные поля «подпись → значение». */
  fields: { key: string; label: string; value: string }[];
};

/**
 * Раскладывает `completionData` на понятные человеку части.
 *
 * Раньше блок «Введённые данные» печатал `String(v)` для любого
 * значения, и заведующая видела «steps [object Object],[object Object]»,
 * «pipelineCompleted ✓» и «skipped ✓». Теперь:
 *   • шаги — списком «✓ Возьми термометр / ✗ Запиши значение»;
 *   • пропуск — строкой «Пропущено: <причина>»;
 *   • объект или массив без понятной раскладки просто не печатаем —
 *     мусор хуже пустоты.
 */
export function buildCompletionView(
  data: Record<string, unknown> | null | undefined
): CompletionView {
  const view: CompletionView = { skippedReason: null, steps: [], fields: [] };
  if (!data) return view;

  if (data.skipped === true) {
    const reason =
      typeof data.reason === "string" && data.reason.trim()
        ? data.reason.trim()
        : "причина не указана";
    view.skippedReason = reason;
  }

  if (Array.isArray(data.steps)) {
    for (const raw of data.steps) {
      if (!raw || typeof raw !== "object") continue;
      const step = raw as Record<string, unknown>;
      const title =
        typeof step.title === "string" && step.title.trim()
          ? step.title.trim()
          : typeof step.id === "string"
            ? step.id
            : "Шаг";
      view.steps.push({
        title,
        done: step.done === true,
        checklist: Array.isArray(step.checklist)
          ? (step.checklist as unknown[])
              .filter(
                (c): c is Record<string, unknown> => !!c && typeof c === "object"
              )
              .map((c) => ({
                item: typeof c.item === "string" ? c.item : "",
                done: c.done === true,
              }))
              .filter((c) => c.item)
          : [],
        photos: Array.isArray(step.photos)
          ? (step.photos as unknown[]).filter(
              (p): p is string => typeof p === "string" && p.length > 0
            )
          : [],
      });
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (isInternalCompletionKey(key)) continue;
    if (key === "steps") continue;
    // Пропуск уже показан отдельной строкой.
    if (key === "skipped" || (key === "reason" && view.skippedReason)) continue;
    if (value === null || value === undefined || value === "") continue;
    // Объект или массив без своей раскладки не печатаем: «[object
    // Object]» ничего не сообщает.
    if (typeof value === "object") continue;
    view.fields.push({
      key,
      label: completionEntryLabel(key),
      value: typeof value === "boolean" ? (value ? "✓" : "✗") : String(value),
    });
  }

  return view;
}
