/**
 * Главы QR-ролика на лендинге и тексты, которые в них видны.
 *
 * Правило одно: в кадре только то, что продукт делает сегодня. Названия
 * журналов берутся из каталога, подписи граф — из генераторов PDF, тексты
 * кнопок и экранов — из настоящих QR-форм. Тест `qr-player.test.ts`
 * сверяет каждую строку из `UI` с файлом, откуда она взята: поменяли
 * форму — тест подскажет поправить ролик.
 */
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";

export const FPS = 30;
export const CHAPTER_SECONDS = 6;
const CHAPTER_FRAMES = CHAPTER_SECONDS * FPS;

export type ChapterId = "fridge" | "locker" | "uv" | "fryer" | "forgot" | "sensor";

export function journalName(code: string): string {
  const item = ACTIVE_JOURNAL_CATALOG.find((entry) => entry.code === code);
  if (!item) throw new Error(`Журнал ${code} не найден в каталоге`);
  return item.name;
}

/** Журналы в кадре — имена ровно из каталога. */
export const JOURNALS = {
  cold: journalName("cold_equipment_control"),
  hygiene: journalName("hygiene"),
  health: journalName("health_check"),
  uv: journalName("uv_lamp_runtime"),
  fryer: journalName("fryer_oil"),
} as const;

export type Chapter = {
  id: ChapterId;
  /** Вкладка-глава над сценой. */
  chip: string;
  /** Где висит наклейка / что происходит — строка над сценой. */
  place: string;
  /** Журнал в кадре — ровно как в каталоге. */
  journal: string;
  /** Полная подпись: раскадровка reduced-motion и скринридер. */
  caption: string;
  /** Короткая видимая подпись под сценой — одна строка. */
  short: string;
  from: number;
  duration: number;
};

const CHAPTER_DRAFTS: Array<Omit<Chapter, "from" | "duration">> = [
  {
    id: "fridge",
    chip: "Холодильник",
    place: "Наклейка на дверце холодильника",
    journal: journalName("cold_equipment_control"),
    caption:
      "Повар сканирует наклейку на холодильнике, вводит PIN и температуру. Значение встаёт в журнал в графу сегодняшнего дня, рядом — код ответственного.",
    short: "PIN и температура — запись в графе сегодняшнего дня.",
  },
  {
    id: "locker",
    chip: "Раздевалка",
    place: "QR у термометра в раздевалке",
    journal: journalName("hygiene"),
    caption:
      "Перед сменой сотрудник меряет температуру и подписывает три графы. Запись сразу в гигиенический журнал и журнал здоровья, заведующая ставит допуск.",
    short: "Замер и три подписи перед сменой — допуск к работе.",
  },
  {
    id: "uv",
    chip: "УФ-лампа",
    place: "Наклейка на бактерицидной лампе",
    journal: journalName("uv_lamp_runtime"),
    caption:
      "Две кнопки: «Я включил» и «Я выключил». Время работы и остаток ресурса лампы считаются сами.",
    short: "«Я включил» / «Я выключил» — ресурс лампы считается сам.",
  },
  {
    id: "fryer",
    chip: "Фритюр",
    place: "Наклейка на фритюрнице",
    journal: journalName("fryer_oil"),
    caption:
      "Форма на фритюрнице спрашивает вид жира, продукцию и оценку качества по пятибалльной шкале. Строка ложится в журнал учёта фритюрных жиров.",
    short: "Жир, продукция, оценка — строка в журнале фритюрных жиров.",
  },
  {
    id: "forgot",
    chip: "Забыли?",
    place: "Журнал сегодня не заполнен",
    journal: journalName("cold_equipment_control"),
    caption:
      "Не заполнили — руководитель получит напоминание в Telegram в 12:00, в 17:00 ещё и письмо, в 21:00 — «СРОЧНО».",
    short: "Не заполнили — напоминания в 12:00, 17:00 и 21:00.",
  },
  {
    id: "sensor",
    chip: "Датчики",
    place: "Wi-Fi датчик в холодильной витрине",
    journal: journalName("cold_equipment_control"),
    caption:
      "Wi-Fi датчик раз в час сам пишет температуру в журнал. Вышла за норму — ответственный получает уведомление.",
    short: "Датчик пишет температуру сам, о нарушении — уведомление.",
  },
];

export const CHAPTERS: Chapter[] = CHAPTER_DRAFTS.map((draft, index) => ({
  ...draft,
  from: index * CHAPTER_FRAMES,
  duration: CHAPTER_FRAMES,
}));

export const DURATION_IN_FRAMES = CHAPTERS.length * CHAPTER_FRAMES;

export function chapterAt(frame: number): { chapter: Chapter; index: number; local: number } {
  const clamped = Math.min(Math.max(0, Math.floor(frame)), DURATION_IN_FRAMES - 1);
  const index = Math.floor(clamped / CHAPTER_FRAMES);
  const chapter = CHAPTERS[index];
  return { chapter, index, local: clamped - chapter.from };
}

/** Последний кадр главы — итог сцены: из них раскадровка при reduced-motion. */
export function finalFrameOf(index: number): number {
  const chapter = CHAPTERS[index];
  return chapter.from + chapter.duration - 1;
}

/* ---------------------------------------------------------------------
 * «Попробуйте сами»
 * ------------------------------------------------------------------- */

/** Норма холодильника в сцене — как у оборудования «от 2 до 6 °C». */
export const FRIDGE_NORM = { min: 2, max: 6 } as const;
export const FRIDGE_RANGE = { min: -2, max: 12, step: 0.5, initial: 4 } as const;

export function fridgeOutOfRange(value: number): boolean {
  return value < FRIDGE_NORM.min || value > FRIDGE_NORM.max;
}

/** Термометр в раздевалке. «Выше 37» — это от 37,1. */
export const BODY_RANGE = { min: 35.8, max: 38, step: 0.1, initial: 36.6 } as const;

export function bodyFever(value: number): boolean {
  return Math.round(value * 10) > 370;
}

export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",").replace("-", "−");
}

/** Момент сцены (в секундах), когда запись уже сохранена и видна в журнале. */
export const RESULT_SECONDS = 5.6;

/* ---------------------------------------------------------------------
 * Тексты экранов — дословно из продукта. Источник каждой строки — в
 * `UI_SOURCES` (проверяется тестом).
 * ------------------------------------------------------------------- */

export const UI = {
  // src/lib/journal-fill-html.ts
  whoFills: "Кто заполняет",
  pinLabel: "Ваш PIN",
  pinHint: "PIN подтверждает, что запись делаете именно вы.",
  pinContinue: "Продолжить",
  entrySaved: "Отметка записана",
  // src/app/equipment-fill/[equipmentId]/equipment-fill-client.tsx
  equipment: "Оборудование",
  // src/components/qr-fill/employee-picker.tsx
  equipmentWho: "Кто снимает показания",
  saveReading: "Сохранить замер",
  written: "Записано",
  tempOut: "Температура вне нормы",
  managerWillKnow: "Руководитель получит уведомление.",
  readingOutDone: "Показание вне нормы — руководителю отправлено уведомление.",
  // src/lib/temperature-deviations.ts
  deviationTitle: "Температура вышла за норму",
  // src/lib/health-qr-html.ts
  sign: "Подписываю:",
  signButton: "Подписать",
  notAdmitted: "Сегодня вы не допущены к работе",
  headKnows: "Заведующий производством уже получил уведомление",
  // src/lib/health-qr-flow.ts
  admitted: "Допущен к работе",
  // src/lib/hygiene-declaration-notify.ts
  notAdmittedNotice: "не допущен(а) к работе",
  // src/app/equipment-fill/[equipmentId]/uv-lamp-client.tsx
  uvWho: "Кто включает и выключает",
  uvOn: "Я включил облучатель",
  uvOff: "Я выключил облучатель",
  uvOnDone: "Облучатель включён",
  uvOffDone: "Облучатель выключен",
  uvRemaining: "Осталось ресурса",
  // src/lib/tasksflow-adapters/generic.ts
  genericSubmit: "Готово — записать в журнал",
  // src/app/api/cron/compliance/route.ts
  remindSoft: "Напоминание",
  remindWarn: "Внимание",
  remindUrgent: "СРОЧНО",
  remindBody: "незаполненные журналы за сегодня",
} as const;

export const UI_SOURCES: Record<keyof typeof UI, string> = {
  whoFills: "src/lib/journal-fill-html.ts",
  pinLabel: "src/lib/journal-fill-html.ts",
  pinHint: "src/lib/journal-fill-html.ts",
  pinContinue: "src/lib/journal-fill-html.ts",
  entrySaved: "src/lib/journal-fill-html.ts",
  equipment: "src/app/equipment-fill/[equipmentId]/equipment-fill-client.tsx",
  equipmentWho: "src/components/qr-fill/employee-picker.tsx",
  saveReading: "src/app/equipment-fill/[equipmentId]/equipment-fill-client.tsx",
  written: "src/app/equipment-fill/[equipmentId]/equipment-fill-client.tsx",
  tempOut: "src/app/equipment-fill/[equipmentId]/equipment-fill-client.tsx",
  managerWillKnow: "src/app/equipment-fill/[equipmentId]/equipment-fill-client.tsx",
  readingOutDone: "src/app/equipment-fill/[equipmentId]/equipment-fill-client.tsx",
  deviationTitle: "src/lib/temperature-deviations.ts",
  sign: "src/lib/health-qr-html.ts",
  signButton: "src/lib/health-qr-html.ts",
  notAdmitted: "src/lib/health-qr-html.ts",
  headKnows: "src/lib/health-qr-html.ts",
  admitted: "src/lib/health-qr-flow.ts",
  notAdmittedNotice: "src/lib/hygiene-declaration-notify.ts",
  uvWho: "src/app/equipment-fill/[equipmentId]/uv-lamp-client.tsx",
  uvOn: "src/app/equipment-fill/[equipmentId]/uv-lamp-client.tsx",
  uvOff: "src/app/equipment-fill/[equipmentId]/uv-lamp-client.tsx",
  uvOnDone: "src/app/equipment-fill/[equipmentId]/uv-lamp-client.tsx",
  uvOffDone: "src/app/equipment-fill/[equipmentId]/uv-lamp-client.tsx",
  uvRemaining: "src/app/equipment-fill/[equipmentId]/uv-lamp-client.tsx",
  genericSubmit: "src/lib/tasksflow-adapters/generic.ts",
  remindSoft: "src/app/api/cron/compliance/route.ts",
  remindWarn: "src/app/api/cron/compliance/route.ts",
  remindUrgent: "src/app/api/cron/compliance/route.ts",
  remindBody: "src/app/api/cron/compliance/route.ts",
};

/**
 * Поля QR-формы фритюра — колонки `DEFAULT_PIPELINE_FIELDS.fryer_oil`
 * (`src/lib/journal-default-pipelines.ts`), из которых собирается форма.
 */
export const FRYER_FIELDS = {
  fat: "Тип жира",
  equipment: "Оборудование",
  product: "Тип продукции",
  qualityStart: "Качество в начале (1-5)",
} as const;

/** Подписи граф бумажных бланков — как печатает `src/lib/document-pdf.ts`. */
export const PDF = {
  stamp: "СИСТЕМА ХАССП",
  coldName: "Наименование или номер ХК",
  coldTemp: "Температура °C",
  coldResponsible: "Ответственный за снятие показателей",
  uvDate: "Дата",
  uvOn: "Время ВКЛ",
  uvOff: "Время ВЫКЛ",
  uvTotal: "Итого продолжительность работы, минут",
  uvWho: "ФИО ответственного лица",
  uvStampLabel: "Журнал учета работы ультрафиолетовой бактерицидной установки",
  fryerStart: "Дата, время начала использования фритюрного жира",
  fryerFat: "Вид фритюрного жира",
  fryerQualityStart: "Органолептическая оценка качества жира на начало жарки",
  fryerEquipment: "Тип жарочного оборудования",
  fryerProduct: "Вид продукции",
  fryerEnd: "Время окончания фритюрной жарки",
  fryerQualityEnd: "Органолептическая оценка качества жира по окончании жарки",
  fryerLeftover: "Использование оставшегося жира",
  fryerCarry: "Переходящий остаток, кг",
  fryerDisposed: "Утилизированный, кг",
  fryerController: "Должность, ФИО контролера",
} as const;

/** Люди и объекты сцены — условные. */
export const DEMO = {
  org: "Столовая «Берёзка»",
  cook: { name: "Иванова Анна", short: "Иванова А.", position: "Повар" },
  others: [
    { name: "Петров Олег", position: "Повар" },
    { name: "Сидорова Мария", position: "Су-шеф" },
  ],
  head: { name: "Козлова Елена", position: "Заведующая производством" },
  fridge: "Холодильник №1",
  vitrine: "Витрина холодильная",
  lamp: "Бактерицидная установка №1",
  lampLifetime: 8000,
  lampUsed: 587.5,
  fryer: "Фритюрница №1",
  fat: "Подсолнечное масло",
  product: "Картофель фри",
} as const;
