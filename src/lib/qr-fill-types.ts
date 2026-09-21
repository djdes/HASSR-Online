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
  /** Контекст под организацией: цех, точка или краткая инструкция. */
  subtitle: string;
  norms: string[];
  url: string;
  /** SVG, собранный на сервере библиотекой qrcode — безопасно встраивать. */
  svg: string;
};

/**
 * Строка под заголовком: «Организация · контекст». Одна на все три места
 * рендера (страница плакатов, наклейки, превью в диалоге) — иначе печатный
 * лист и превью разойдутся. Контекст, совпавший с названием организации
 * (например, единственная точка названа как заведение), не дублируем.
 */
export function posterSubtitleLine(poster: Pick<QrPoster, "orgName" | "subtitle">): string {
  const org = poster.orgName.trim();
  const context = poster.subtitle.trim();
  if (!org) return context;
  if (!context || context.toLowerCase() === org.toLowerCase()) return org;
  return `${org} · ${context}`;
}

/** Раскладка страницы печати: плакат на лист или наклейки сеткой. */
export type QrPosterLayout = "poster" | "sheet";
