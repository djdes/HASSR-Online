/**
 * Дополнительные блоки страницы журнала `/journals-info/<код>` (спеки
 * journal-page-engagement-2026-11, journal-page-content-all-2026-11):
 * образец заполнения строками, тематические разделы и штрафы. Русский
 * контент: на en/uz страницах блоки не показываются.
 */
export type JournalPageContent = {
  /** Образец заполнения строками — как выглядят записи за смену/период. */
  sample?: { caption: string; columns: string[]; rows: string[][] };
  sections?: Array<{ heading: string; paragraphs?: string[]; bullets?: string[] }>;
  fines?: { intro: string; items: string[]; note?: string };
};
