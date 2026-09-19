/**
 * Плакат / наклейка с QR-кодом для заполнения без входа (client-safe:
 * только типы, без node-импортов — см. memory `client-safe-lib-split`).
 */
export type QrFillKind = "equipment" | "room" | "journal";

export type QrPoster = {
  id: string;
  kind: QrFillKind;
  title: string;
  subtitle: string;
  norms: string[];
  url: string;
  /** SVG, собранный на сервере библиотекой qrcode — безопасно встраивать. */
  svg: string;
};

/** Раскладка страницы печати: плакат на лист или наклейки сеткой. */
export type QrPosterLayout = "poster" | "sheet";
