/**
 * Плакат / наклейка с QR-кодом для заполнения без входа (client-safe:
 * только типы, без node-импортов — см. memory `client-safe-lib-split`).
 */
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
   * кладём: их названия почти повторяют организацию, и строка задваивалась
   * («д/с №68, МБОУ СОШ №8 · Детский сад №68, МБОУ СОШ №8»).
   */
  subtitle: string;
  norms: string[];
  url: string;
  /** SVG, собранный на сервере библиотекой qrcode — безопасно встраивать. */
  svg: string;
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
