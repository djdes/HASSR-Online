/**
 * Плакат / наклейка с QR-кодом для заполнения без входа (client-safe:
 * только типы, без node-импортов — см. memory `client-safe-lib-split`).
 */
import type { QrPosterPointLine } from "@/lib/qr-poster-point";
import type { EquipmentPlate } from "@/lib/qr-plate";

export type QrFillKind = "equipment" | "room" | "journal";

export type QrPoster = {
  id: string;
  kind: QrFillKind;
  title: string;
  /**
   * Краткое название организации — то же, что в шапке журналов
   * (`resolveOrgJournalName`). Стоит на КАЖДОМ плакате любого вида: код со
   * стены должен читаться как документ конкретного заведения, а не «просто
   * холодильник». Меняется только контекст (`subtitle`), организация — нет.
   */
  orgName: string;
  /**
   * Вторая строка под организацией: краткая инструкция (плакаты журналов)
   * или пусто у объектов — у них там печатается норма. Точку и цех сюда НЕ
   * кладём: у точки своя строка (`point`), а цех почти повторял организацию
   * («д/с №68, МБОУ СОШ №8 · Детский сад №68, МБОУ СОШ №8»).
   */
  subtitle: string;
  /**
   * Торговая точка, для которой напечатан код (2026-10-28, как на памятках):
   * своя точка объекта или документа, иначе точка печати — `qr-poster-point.ts`.
   * Печатается отдельной строкой под шапкой листа; нет — строки нет.
   */
  point?: QrPosterPointLine | null;
  norms: string[];
  url: string;
  /** SVG, собранный на сервере библиотекой qrcode — безопасно встраивать. */
  svg: string;
  /**
   * Подсказка руководителю на экране (не печатается): что будет при
   * сканировании плаката журнала без документа на сегодня.
   */
  notice?: string | null;
  /** Код журнала (плакаты журналов). */
  journalCode?: string | null;
  /** Документ дополнительного QR (плакат одного документа). */
  documentId?: string | null;
  /**
   * Последний день действия дополнительного QR (`YYYY-MM-DD`, у бессрочного
   * документа `2099-12-31`). Нет — код бессрочный (основной QR, объекты).
   */
  validUntil?: string | null;
  /** Период документа для подписи: «01.09–30.09.2026». */
  periodLabel?: string | null;
  /**
   * Наклейка оборудования без замера температуры: УФ-лампа («Я включил /
   * Я выключил») или фритюрница (начало и окончание жарки). Нет — замер.
   */
  equipmentKind?: "uv" | "fryer" | null;
  /** Данные таблички на оборудование (ХОЛОД/МОРОЗ); нет — у ламп, фритюрниц и оборудования без температуры. */
  plate?: EquipmentPlate | null;
};

/** Запрошенный в `ids=` плакат, который собрать не вышло, — и почему. */
export type QrPosterMissing = {
  id: string;
  /** Что это было — название журнала или сам id. */
  label: string;
  reason: string;
};

/**
 * Вторая строка плаката: краткая инструкция и/или норма. Первая строка —
 * всегда `orgName`, один раз. Функция одна на все три места рендера
 * (плакат, наклейка, превью в диалоге) — иначе печатный лист и превью
 * разойдутся.
 */
export function posterDetailLine(poster: Pick<QrPoster, "subtitle" | "norms">): string {
  const parts = [
    poster.subtitle.trim(),
    poster.norms.length > 0 ? `норма ${poster.norms.join(", ")}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Раскладка страницы печати: плакат на лист или наклейки сеткой. */
export type QrPosterLayout = "poster" | "sheet";

/** Формат печати карточки: плакат A4, половина листа A5, наклейка 12 на лист, табличка на оборудование 4 на лист. */
export type QrPrintFormat = "a4" | "a5" | "sticker" | "plate";

export const QR_PRINT_FORMATS: ReadonlyArray<{ value: QrPrintFormat; label: string; hint: string }> = [
  { value: "a4", label: "A4", hint: "Плакат на весь лист — на стену или дверь" },
  { value: "a5", label: "A5", hint: "Полплаката — два на листе, лист режется пополам" },
  { value: "sticker", label: "Наклейка", hint: "Маленький код — 12 на листе, на дверцу или лампу" },
  { value: "plate", label: "Табличка", hint: "Табличка на холодильник или морозильник: ХОЛОД/МОРОЗ, режим, номер — 4 на листе A4" },
];

/** Форматы для карточки: табличка — только у оборудования с температурой (`withPlate`). */
export function qrPrintFormatOptions(withPlate: boolean) {
  return QR_PRINT_FORMATS.filter((option) => withPlate || option.value !== "plate");
}

/**
 * Группа карточки на странице QR-кодов:
 *   • main   — основные QR журнала, работают всегда (отмечены);
 *   • extra  — дополнительные QR одного документа, со сроком (не отмечены);
 *   • object — наклейки на холодильники, помещения, лампы (отмечены).
 */
export type QrPosterGroup = "main" | "extra" | "object";

/** Карточка страницы QR-кодов: плакат + как её показать и напечатать. */
export type QrPosterItem = {
  /** Уникальный ключ — тот же, что `poster.id` (`код`, `код:документ`, `hygiene@verify`, id объекта). */
  key: string;
  group: QrPosterGroup;
  poster: QrPoster;
  defaultSelected: boolean;
  defaultFormat: QrPrintFormat;
  /** Название карточки на экране (журнал, документ, объект). */
  label: string;
  /** Вторая строка: период документа, точка, норма объекта. */
  sublabel?: string | null;
  /** Одна строка на экране: кто сканирует и что будет. */
  caption: string;
  /** Срок кода истёк — строка видна, но отметить её нельзя. */
  expired?: boolean;
  /** Точка документа или основного QR — в подписи. */
  buildingName?: string | null;
  /** Строка документа, из которого открыли страницу, — первой в списке. */
  highlighted?: boolean;
};

/** `2026-09-30` → `30.09.2026`; бессрочный — «бессрочно». */
export function formatQrValidUntil(validUntil: string): string {
  if (validUntil >= "2099-01-01") return "бессрочно";
  const [year, month, day] = validUntil.split("-");
  return `${day}.${month}.${year}`;
}
