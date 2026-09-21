import type { NameSuggestionScope } from "@/lib/name-suggestions";

/**
 * Подсказки Wesetup поверх формы адаптера для QR-ввода (client-safe).
 *
 * DSL форм (`tasksflow-adapters/task-form.ts`) читает и TasksFlow, поэтому
 * его не расширяем: что считать наименованием (память по организации),
 * какому времени дать быстрые сдвиги, какие значения подставить по
 * умолчанию — живёт здесь, по коду журнала.
 */
export type JournalFillHints = {
  /** Поле → область памяти наименований (подсказки + чипы недавних). */
  nameFields?: Record<string, NameSuggestionScope>;
  /** Поле времени → сдвиг по умолчанию в минутах назад (0 = сейчас). */
  timeDefaults?: Record<string, number>;
  /** Поля времени, под которыми показываем чипы «−15 … −1 ч». */
  timeOffsetFields?: string[];
  /** Значения по умолчанию, если адаптер не задал своих. */
  defaults?: Record<string, string | number | boolean>;
  /** Поле температуры, подставляемое из памяти по наименованию. */
  tempField?: { nameKey: string; tempKey: string };
  /** Строчный журнал: каждая запись по QR — новая строка («Добавить ещё»). */
  append?: boolean;
  /** Текстовое поле → готовые варианты одним касанием (своё значение тоже можно). */
  choices?: Record<string, readonly string[]>;
  /** Поле-список → ряд крупных кнопок вместо выпадающего списка: значение → короткая подпись. */
  segmented?: Record<string, Record<string, string>>;
};

export const ORGANOLEPTIC_CHOICES = ["Отлично", "Хорошо", "Удовлетворительно", "Неудовлетворительно"] as const;

export const TIME_OFFSET_CHIPS = [
  { minutes: 15, label: "−15 мин" },
  { minutes: 30, label: "−30 мин" },
  { minutes: 45, label: "−45 мин" },
  { minutes: 60, label: "−1 ч" },
] as const;

const HINTS: Record<string, JournalFillHints> = {
  hygiene: {
    // Почти всегда «здоров»: стоит по умолчанию, остальное — одним касанием.
    defaults: { status: "healthy" },
    segmented: { status: { healthy: "Здоров", day_off: "Выходной", sick_leave: "Болен", vacation: "Отпуск", suspended: "Отстранён" } },
  },
  finished_product: {
    append: true,
    nameFields: { productName: "dish" },
    timeDefaults: { productionTime: 30 },
    timeOffsetFields: ["productionTime"],
    defaults: { organoleptic: "Отлично" },
    choices: { organoleptic: ORGANOLEPTIC_CHOICES },
    tempField: { nameKey: "productName", tempKey: "productTemp" },
  },
  intensive_cooling: {
    append: true,
    nameFields: { dishName: "dish" },
    timeOffsetFields: ["productionTime"],
  },
  perishable_rejection: {
    append: true,
    nameFields: { productName: "product", manufacturer: "partner", supplier: "partner" },
  },
  incoming_control: {
    append: true,
    nameFields: { productName: "product", manufacturer: "partner", supplier: "partner" },
  },
  incoming_raw_materials_control: {
    append: true,
    nameFields: { productName: "product", manufacturer: "partner", supplier: "partner" },
  },
  product_writeoff: {
    append: true,
    nameFields: { productName: "product" },
  },
};

export function journalFillHints(code: string): JournalFillHints {
  return HINTS[code] ?? {};
}

/** «ЧЧ:ММ» для момента `minutesAgo` минут назад (локальное время телефона). */
export function timeMinutesAgo(minutesAgo: number, now: Date = new Date()): string {
  const dt = new Date(now.getTime() - minutesAgo * 60_000);
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}
