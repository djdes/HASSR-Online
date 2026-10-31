import { loadReportTable } from "@/lib/report-export-data";
import { renderJournalPDF } from "@/lib/report-pdf";
import type { Locale } from "@/i18n/locales";
import { translatorFor } from "@/i18n/translator";

/**
 * PDF-выгрузка журнала за период (/reports → «Скачать PDF»).
 *
 * Содержимое то же, что у Excel: строки собирает `loadReportTable`
 * (документные записи + легаси `JournalEntry`). Раньше здесь читался
 * только легаси `JournalEntry` и PDF всегда выходил пустым, а штатный
 * шрифт jsPDF не знает кириллицы — отсюда регистрация DejaVu.
 */
export async function generateJournalPDF(params: {
  templateCode: string;
  organizationId: string;
  organizationName: string;
  dateFrom: string;
  dateTo: string;
  areaId?: string;
  locale?: Locale;
  /** Торговая точка из шапки; null — вся организация (колонка «Точка»). */
  pointId?: string | null;
}): Promise<Buffer> {
  const { templateCode, organizationId, organizationName, dateFrom, dateTo, areaId } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);

  const loaded = await loadReportTable({
    templateCode,
    organizationId,
    dateFrom,
    dateTo,
    areaId,
    locale,
    pointId: params.pointId ?? null,
  });
  if (!loaded) {
    throw new Error(t("reports.errors.templateNotFound"));
  }
  const { templateName, timeZone, table, emptyMessage } = loaded;

  return renderJournalPDF({ organizationName, templateName, dateFrom, dateTo, timeZone, table, emptyMessage, locale });
}
