import type { Prisma } from "@prisma/client";
import { jsPDF } from "jspdf";
import type { CellDef, CellHookData, RowInput, UserOptions } from "jspdf-autotable";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";
import { JOURNAL_LINE_WIDTH, journalAutoTable, reserveJournalTableBottom } from "@/lib/pdf-journal-table";
import {
  JOURNAL_FOOTER_TEXT_BAND_BRANDED_MM,
  JOURNAL_FOOTER_TEXT_BAND_MM,
  JOURNAL_SHEET_MARGIN_MM,
  JOURNAL_TITLE_HEADER_GAP_MM,
  journalCapHeightMm,
  journalDescentMm,
  journalSheetTopBaseline,
} from "@/lib/pdf-journal-sheet";
import { getCalendarDayKind } from "@/lib/production-calendar-data";
import { renamedJournalDocumentTitle } from "@/lib/journal-title-renames";
import {
  resolveApprover,
  resolveResponsible,
  type PersonDisplayUser,
} from "@/lib/approver-display";
import { db } from "@/lib/db";
import { withBuildingLabel } from "@/lib/building-scope";
import { resolveColumns, type ResolvedJournalColumn } from "@/lib/journal-columns";
import { readHeaderTitleOverride } from "@/lib/journal-header-title";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { isAutoSeededEntry } from "@/lib/journal-entry-filters";
import { isPerpetualDateTo, resolveDisplayDateTo } from "@/lib/journal-period";
import { orgTodayKey } from "@/lib/timezone";
import { formatPositionWithName } from "@/lib/position-name-label";
import { getUserDisplayName } from "@/lib/user-display-name";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  getClimateDocumentTitle,
  getClimateFilePrefix,
  getClimatePeriodicityText,
  applyRoomDirectoryToClimateConfig,
  normalizeClimateDocumentConfig,
  normalizeClimateEntryData,
  type ClimateDocumentConfig,
} from "@/lib/climate-document";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  getColdEquipmentDocumentTitle,
  getColdEquipmentFilePrefix,
  normalizeColdEquipmentDocumentConfig,
  expandColdEquipmentReadingSlots,
  normalizeColdEquipmentEntryData,
  COLD_EQUIPMENT_LEGAL_BASIS,
  COLD_EQUIPMENT_STATUS_SHORT,
  type ColdEquipmentStatus,
} from "@/lib/cold-equipment-document";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  CLEANING_LEGEND,
  displayLegendLine,
  displayMatrixValue,
  getCleaningDocumentTitle,
  getCleaningFilePrefix,
  buildCleaningSignatureResolver,
  listCleaningCodeEntries,
  listControlCodeEntries,
  listCleaningRoomCompletions,
  listDeletedCleaningRoomsWithMarks,
  normalizeCleaningDocumentConfig,
  resolveRoomCleaners,
  resolveRoomControllers,
  CLEANING_ROW_LABELS,
  CLEANING_SIGNATURE_ROW_ID,
  CONTROL_SIGNATURE_ROW_ID,
} from "@/lib/cleaning-document";
import { applyRoomResponsiblesToConfig } from "@/lib/cleaning-room-responsibles";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  finishedProductCellText,
  getFinishedProductDocumentTitle,
  getFinishedProductFilePrefix,
  normalizeFinishedProductDocumentConfig,
} from "@/lib/finished-product-document";
import {
  PERISHABLE_LEGACY_SIGNATURES_TITLE,
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  getPerishableRejectionDocumentTitle,
  getPerishableRejectionFilePrefix,
  normalizePerishableRejectionConfig,
  perishableCellText,
  perishableLegacySignatureLines,
  perishablePrintColumns,
  type PerishableRejectionRow,
} from "@/lib/perishable-rejection-document";
import {
  PRODUCT_WRITEOFF_DOCUMENT_TITLE,
  PRODUCT_WRITEOFF_TEMPLATE_CODE,
  formatProductWriteoffDateLong,
  getProductWriteoffFilePrefix,
  normalizeProductWriteoffConfig,
} from "@/lib/product-writeoff-document";
import { normalizeJournalStaffBoundConfig } from "@/lib/journal-staff-binding";
import {
  GLASS_LIST_TEMPLATE_CODE,
  formatGlassListDateLong,
  getGlassListFilePrefix,
  normalizeGlassListConfig,
} from "@/lib/glass-list-document";
import {
  GLASS_CONTROL_TEMPLATE_CODE,
  buildGlassControlPdfRows,
  formatRuDateDash as formatGlassRuDateDash,
  getGlassControlFilePrefix,
  GLASS_CONTROL_PAGE_TITLE,
  normalizeGlassControlConfig,
} from "@/lib/glass-control-document";
import {
  formatPestControlRowDate,
  normalizePestControlEntryData,
  PEST_CONTROL_DOCUMENT_TITLE,
  PEST_CONTROL_TEMPLATE_CODE,
} from "@/lib/pest-control-document";
import {
  CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE,
  CLEANING_VENTILATION_CHECKLIST_TITLE,
  getCleaningVentilationFilePrefix,
} from "@/lib/cleaning-ventilation-checklist-document";
import { drawCleaningVentilationChecklistPdf } from "@/lib/cleaning-ventilation-checklist-pdf";
import {
  SANITARY_DAY_CHECKLIST_TEMPLATE_CODE,
  SANITARY_DAY_CHECKLIST_TITLE,
  getSdcFilePrefix,
} from "@/lib/sanitary-day-checklist-document";
import { drawSanitaryDayChecklistPdf } from "@/lib/sanitary-day-checklist-pdf";
import {
  getTrackedDocumentTitle,
  isTrackedDocumentTemplate,
  type TrackedDocumentTemplateCode,
} from "@/lib/tracked-document";
import {
  TRACEABILITY_DOCUMENT_TEMPLATE_CODE,
  formatTraceabilityQuantity,
  normalizeTraceabilityDocumentConfig,
} from "@/lib/traceability-document";
import {
  UV_LAMP_RUNTIME_TEMPLATE_CODE,
  UV_LAMP_RUNTIME_PAGE_TITLE,
  formatControlFrequencyLabel,
  formatRuDateDash,
  getDisinfectionConditionLabel,
  getDisinfectionObjectLabel,
  getRadiationModeLabel,
  calculateMonthlyHours,
  calculateEntryDurationMinutes as calculateUvEntryDurationMinutes,
  listUvRuntimeSessions,
  formatMonthLabel as formatUvMonthLabel,
  normalizeUvRuntimeDocumentConfig,
  normalizeUvRuntimeEntryData,
} from "@/lib/uv-lamp-runtime-document";
import {
  FRYER_OIL_TEMPLATE_CODE,
  normalizeFryerOilDocumentConfig,
  normalizeFryerOilEntryData,
  getFryerOilDocumentTitle,
  getFryerOilFilePrefix,
  formatTime as formatFryerTime,
  formatQualityLabel as formatFryerQuality,
  formatDateRu as formatFryerDateRu,
  QUALITY_ASSESSMENT_TABLE,
  type FryerOilDocumentConfig,
} from "@/lib/fryer-oil-document";
import {
  SANITATION_DAY_TEMPLATE_CODE,
  SANITATION_DAY_DOCUMENT_TITLE,
  SANITATION_MONTHS,
  applyRoomDirectoryToSanitationConfig,
  normalizeSanitationDayConfig,
} from "@/lib/sanitation-day-document";
import {
  getRegisterDocumentFilePrefix,
  getRegisterDocumentTitle,
  isRegisterDocumentTemplate,
  normalizeRegisterDocumentConfig,
  parseRegisterFields,
  type RegisterField,
} from "@/lib/register-document";
import {
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODES,
  COMPLIANCE_LABELS,
  getIncomingControlColumns,
  PRODUCT_ACCEPTANCE_DOCUMENT_TITLE,
  getAcceptanceDocumentTitle,
  getIncomingControlRowValues,
  normalizeAcceptanceDocumentConfig,
} from "@/lib/acceptance-document";
import {
  PPE_ISSUANCE_DOCUMENT_TITLE,
  PPE_ISSUANCE_TEMPLATE_CODE,
  formatPpeIssuanceDate,
  getPpeIssuanceIssuerLabel,
  getPpeIssuanceRecipientLabel,
  normalizePpeIssuanceConfig,
} from "@/lib/ppe-issuance-document";
import {
  TRAINING_PLAN_TEMPLATE_CODE,
  TRAINING_PLAN_HEADING,
  normalizeTrainingPlanConfig,
} from "@/lib/training-plan-document";
import {
  AUDIT_PLAN_DOCUMENT_TITLE,
  AUDIT_PLAN_TEMPLATE_CODE,
  getAuditPlanPrintDateLabel,
  normalizeAuditPlanConfig,
} from "@/lib/audit-plan-document";
import {
  AUDIT_PROTOCOL_DOCUMENT_TITLE,
  AUDIT_PROTOCOL_TEMPLATE_CODE,
  normalizeAuditProtocolConfig,
} from "@/lib/audit-protocol-document";
import {
  AUDIT_REPORT_DOCUMENT_TITLE,
  AUDIT_REPORT_TEMPLATE_CODE,
  normalizeAuditReportConfig,
} from "@/lib/audit-report-document";
import {
  METAL_IMPURITY_DOCUMENT_TITLE,
  METAL_IMPURITY_TEMPLATE_CODE,
  getMetalImpurityOptionName,
  getMetalImpurityValuePerKg,
  normalizeMetalImpurityConfig,
} from "@/lib/metal-impurity-document";
import {
  BREAKDOWN_HISTORY_TEMPLATE_CODE,
  BREAKDOWN_HISTORY_HEADING,
  normalizeBreakdownHistoryDocumentConfig,
} from "@/lib/breakdown-history-document";
import {
  ACCIDENT_DOCUMENT_TEMPLATE_CODE,
  ACCIDENT_DOCUMENT_HEADING,
  normalizeAccidentDocumentConfig,
} from "@/lib/accident-document";
import {
  formatIntensiveCoolingDate,
  formatTemperatureLabel as formatIntensiveCoolingTemperatureLabel,
  getIntensiveCoolingFilePrefix,
  INTENSIVE_COOLING_DOCUMENT_TITLE,
  INTENSIVE_COOLING_TEMPLATE_CODE,
  normalizeIntensiveCoolingConfig,
  type IntensiveCoolingConfig,
} from "@/lib/intensive-cooling-document";
import {
  EQUIPMENT_CALIBRATION_DOCUMENT_TITLE,
  EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
  calculateNextCalibrationDate,
  formatCalibrationDate,
  formatCalibrationDateLong,
  normalizeEquipmentCalibrationConfig,
} from "@/lib/equipment-calibration-document";
import {
  EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE,
  EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
  MONTH_KEYS as EQUIPMENT_MAINTENANCE_MONTH_KEYS,
  MONTH_LABELS as EQUIPMENT_MAINTENANCE_MONTH_LABELS,
  normalizeEquipmentMaintenanceConfig,
} from "@/lib/equipment-maintenance-document";
import { withResolvedEquipmentNames } from "@/lib/equipment-directory-link";
import {
  STAFF_TRAINING_FULL_TITLE,
  STAFF_TRAINING_TEMPLATE_CODE,
  normalizeStaffTrainingConfig,
} from "@/lib/staff-training-document";
import {
  buildHygieneExampleEmployees,
  buildDateKeys,
  formatMonthLabel,
  getDayNumber,
  getHealthDocumentTitle,
  getHygieneDocumentTitle,
  getHygieneUserPositionLabel,
  getStatusMeta,
  getWeekdayShort,
  HYGIENE_REGISTER_LEGEND,
  HYGIENE_REGISTER_NOTES,
  HYGIENE_REGISTER_PERIODICITY,
  HEALTH_REGISTER_NOTES,
  HEALTH_REGISTER_REMINDER,
  normalizeHealthEntryData,
  normalizeHygieneEntryData,
  toDateKey,
} from "@/lib/hygiene-document";
import {
  HYGIENE_V2_COLUMNS,
  HYGIENE_V2_FORM_CAPTION,
  buildHygieneV2Rows,
  hygieneV2PdfMark,
  readHygieneFormVersion,
} from "@/lib/hygiene-v2";
import { readControlPeriodicity } from "@/lib/control-periodicity";
import { getRowEmployeeTitle, getUserDisplayTitle } from "@/lib/user-roles";
import {
  registerPageLabelSlot,
  resetPageLabelSlots,
  stampJournalPageNumbers,
  stampPartnerPdfFooter,
  centeredBaselines,
  drawTextCenteredInBox,
  journalLineHeightMm,
  type PdfFooterBrand,
} from "@/lib/pdf-page-labels";
import { getVisibleOrgBranding } from "@/lib/partners/branding";
import { journalDocumentPdfQr, journalPdfQrOrigin } from "@/lib/journal-pdf-qr-link";
import { loadOrderScansForPdf } from "@/lib/journal-order-scans-db";
import { appendOrderScansToPdf, type OrderScanForPdf } from "@/lib/journal-order-scans-pdf";
import {
  journalQrCellHeight,
  journalQrCellWidth,
  journalQrTileOf,
  prepareJournalQr,
  registerJournalQrSlot,
  stampJournalQr,
  trackPdfInk,
  type JournalPdfQr,
  type JournalQrPlacement,
} from "@/lib/pdf-journal-qr";
import {
  EQUIPMENT_CLEANING_DOCUMENT_TITLE,
  EQUIPMENT_CLEANING_TEMPLATE_CODE,
  getEquipmentCleaningResultLabel,
  normalizeEquipmentCleaningConfig,
  normalizeEquipmentCleaningRowData,
  resolveEquipmentCleaningRowName,
} from "@/lib/equipment-cleaning-document";
import {
  DISINFECTANT_DOCUMENT_TITLE,
  DISINFECTANT_TEMPLATE_CODE,
  computeNeedPerMonth,
  computeNeedPerTreatment,
  computeNeedPerYear,
  formatNumber as formatDisinfectantNumber,
  formatQuantityWithUnit,
  normalizeDisinfectantConfig,
  resolveSolutionPerTreatment,
  sumDisinfectantQuantities,
} from "@/lib/disinfectant-document";
import {
  EXAMINATION_REFERENCE_DATA,
  formatMedBookDate,
  MED_BOOK_DOCUMENT_TITLE,
  MED_BOOK_PRELIMINARY_PERIODIC_ROWS,
  MED_BOOK_TEMPLATE_CODE,
  MED_BOOK_VACCINATION_RULES,
  normalizeMedBookConfig,
  normalizeMedBookEntryData,
  VACCINATION_REFERENCE_DATA,
  VACCINATION_TYPE_LABELS,
} from "@/lib/med-book-document";

/**
 * Шрифт для PDF — «JournalUnicode» из репозитория (Liberation Serif —
 * метрически Times New Roman — с настоящим жирным, см. `pdf-journal-font.ts`).
 * Без файла jsPDF откатывается на helvetica, а она не знает кириллицы.
 */
function loadUnicodeFont(doc: jsPDF) {
  return registerJournalUnicodeFont(doc);
}

function makeCellKey(employeeId: string, dateKey: string) {
  return `${employeeId}:${dateKey}`;
}

function drawCenteredText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  maxWidth: number
) {
  // По центру ячейки по обеим осям; интервал — от текущего кегля.
  drawTextCenteredInBox(doc, text, { x, y, width, height, maxWidth });
}

/** Название бланка мед. книжек в штампе ХАССП — как на экране. */
const MED_BOOK_PAPER_TITLE = "ЖУРНАЛ УЧЁТА МЕДИЦИНСКИХ КНИЖЕК СОТРУДНИКОВ";

function drawMedBookPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeMedBookConfig>;
  entries: Array<{ employeeId: string; date: Date; data: unknown }>;
  users: Array<{ id: string; name: string; role: string; email: string | null }>;
}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const groupedEntries = new Map<string, { employeeId: string; data: ReturnType<typeof normalizeMedBookEntryData> }>();

  for (const entry of params.entries) {
    groupedEntries.set(entry.employeeId, {
      employeeId: entry.employeeId,
      data: normalizeMedBookEntryData(entry.data),
    });
  }

  const rows = Array.from(groupedEntries.values()).map((entry, index) => {
    const user = params.users.find((item) => item.id === entry.employeeId);
    return {
      index: index + 1,
      name: user?.name || "Сотрудник",
      data: entry.data,
    };
  });

  // Q1-B/H: раньше журнал печатал только две центрированные строки —
  // без шапки ХАССП, «Периодичность контроля» и «Начат/Окончен», а
  // заголовок брался из document.title («Мед. книжки»). Печатаем общую
  // шапку и каноничное «Медицинские книжки».
  drawTitle(doc, MED_BOOK_DOCUMENT_TITLE);
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    // В штампе — экранное название бланка, а не короткое «Медицинские
    // книжки» (см. med_books-2-doc.png).
    journalLabel: MED_BOOK_PAPER_TITLE,
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
    repeatOnPages: true,
  });

  const medTitleY = afterHeader(headerBottom, 58);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text(MED_BOOK_DOCUMENT_TITLE.toUpperCase(), pageWidth / 2, medTitleY, { align: "center" });

  autoTable(doc, {
    startY: medTitleY + 6,
    // Групповая шапка над колонками специалистов — как на экране.
    head: [
      [
        { content: "№ п/п", rowSpan: 2, styles: { halign: "center" as const, valign: "middle" as const } },
        { content: "Ф.И.О. сотрудника", rowSpan: 2, styles: { halign: "center" as const, valign: "middle" as const } },
        { content: "Должность", rowSpan: 2, styles: { halign: "center" as const, valign: "middle" as const } },
        // Номер медкнижки вводится в журнале, но в печать не попадал —
        // инспектор проверяет именно его.
        { content: "№ мед. книжки", rowSpan: 2, styles: { halign: "center" as const, valign: "middle" as const } },
        {
          content: "Наименование специалиста / исследования:",
          colSpan: Math.max(params.config.examinations.length, 1),
          styles: { halign: "center" as const, valign: "middle" as const },
        },
      ],
      params.config.examinations.length > 0
        ? params.config.examinations.map((column) => ({
            content: column,
            styles: { halign: "center" as const, valign: "middle" as const },
          }))
        : [{ content: "", styles: { halign: "center" as const } }],
    ],
    body: rows.length > 0
      ? rows.map((row) => [
          String(row.index),
          row.name,
          row.data.positionTitle || "",
          row.data.medBookNumber || "",
          ...params.config.examinations.map((column) => {
            const exam = row.data.examinations[column];
            if (!exam?.date) return "";
            return exam.expiryDate
              ? `${formatMedBookDate(exam.date)} / до ${formatMedBookDate(exam.expiryDate)}`
              : formatMedBookDate(exam.date);
          }),
        ])
      // Пустой бланк — ОДНА строка, как на экране (было три-четыре).
      : ensurePlainRows(4 + params.config.examinations.length, 1),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.4,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [236, 236, 236],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });

  autoTable(doc, {
    startY: (((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY) || medTitleY + 6) + 8,
    head: [[
      "Предварительные осмотры",
      "Периодические осмотры",
    ]],
    body: MED_BOOK_PRELIMINARY_PERIODIC_ROWS.map((row) => [row.preliminary, row.periodic]),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.8,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: [236, 236, 236],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      // Резерв под повтор штампа ХАССП на страницах 2..N.
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    pageBreak: "auto",
  });

  autoTable(doc, {
    startY: (((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY) || 80) + 8,
    head: [[
      "Наименование специалиста / исследования",
      "Периодичность",
      "Примечание",
    ]],
    body: EXAMINATION_REFERENCE_DATA.map((item) => [item.name, item.periodicity, item.note || "—"]),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.8,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: [236, 236, 236],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      // Резерв под повтор штампа ХАССП на страницах 2..N.
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    pageBreak: "auto",
  });

  /**
   * Раздел «Прививки» — опция документа (M2 аудита): тумблер «включить
   * "Прививки"» в диалоге создания пишет `config.includeVaccinations`.
   * PDF читает флаг тем же правилом, что и веб (`!== false`): у старых
   * документов ключа в config нет, и страница прививок у них остаётся.
   */
  if (params.config.includeVaccinations === false) return;

  doc.addPage();
  // Страница «Прививки» — с той же полной шапкой ХАССП, что и первая.
  const vaccinationsHeaderBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: MED_BOOK_PAPER_TITLE,
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
  });
  const vaccinationsTitleY = afterHeader(vaccinationsHeaderBottom, 58);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(16);
  doc.text("Прививки", pageWidth / 2, vaccinationsTitleY, { align: "center" });

  autoTable(doc, {
    startY: vaccinationsTitleY + 8,
    // Групповая шапка над колонками прививок — как на экране.
    head: [
      [
        { content: "№ п/п", rowSpan: 2, styles: { halign: "center" as const, valign: "middle" as const } },
        { content: "Ф.И.О. сотрудника", rowSpan: 2, styles: { halign: "center" as const, valign: "middle" as const } },
        { content: "Должность", rowSpan: 2, styles: { halign: "center" as const, valign: "middle" as const } },
        {
          content: "Наименование прививки:",
          colSpan: Math.max(params.config.vaccinations.length, 1),
          styles: { halign: "center" as const, valign: "middle" as const },
        },
        { content: "Примечание", rowSpan: 2, styles: { halign: "center" as const, valign: "middle" as const } },
      ],
      params.config.vaccinations.length > 0
        ? params.config.vaccinations.map((column) => ({
            content: column,
            styles: { halign: "center" as const, valign: "middle" as const },
          }))
        : [{ content: "", styles: { halign: "center" as const } }],
    ],
    body: rows.length > 0
      ? rows.map((row) => [
          String(row.index),
          row.name,
          row.data.positionTitle || "",
          ...params.config.vaccinations.map((column) => {
            const vaccination = row.data.vaccinations[column];
            if (!vaccination) return "";
            if (vaccination.type !== "done") {
              return VACCINATION_TYPE_LABELS[vaccination.type];
            }
            const parts = [
              vaccination.dose ? `${vaccination.dose}:` : null,
              vaccination.date ? formatMedBookDate(vaccination.date) : null,
              vaccination.expiryDate ? `до ${formatMedBookDate(vaccination.expiryDate)}` : null,
            ].filter(Boolean);
            return parts.join(" ");
          }),
          row.data.note || "",
        ])
      : ensurePlainRows(4 + params.config.vaccinations.length, 1),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.4,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [236, 236, 236],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });

  autoTable(doc, {
    startY: (((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY) || 24) + 8,
    head: [[
      "Наименование прививки",
      "Периодичность",
    ]],
    body: VACCINATION_REFERENCE_DATA.map((item) => [item.name, item.periodicity]),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.8,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: [236, 236, 236],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      // Резерв под повтор штампа ХАССП на страницах 2..N.
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    pageBreak: "auto",
  });

  let noteY = (((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY) || 40) + 8;
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(9);
  for (const rule of MED_BOOK_VACCINATION_RULES) {
    const lines = doc.splitTextToSize(rule, pageWidth - PDF_SHEET_MARGIN * 2) as string[];
    // Правило целиком над нижним полем; не влезает — на новую страницу
    // (под повтор штампа ХАССП: раньше текст начинался на 16 мм и ложился
    // под штамп, который повторяется на всех страницах 2..N).
    noteY = placeTextBlock(doc, noteY, (lines.length - 1) * 4.5);
    doc.text(lines, PDF_SHEET_MARGIN, noteY);
    noteY += lines.length * 4.5 + 2;
  }
}

/**
 * Текст «Периодичность контроля» текущего рендера PDF.
 *
 * `drawJournalHeader` вызывается из ~16 узкоспециализированных
 * `draw<Journal>Pdf`-функций, каждая со своим params-контрактом; тащить
 * новое поле через все шестнадцать — большой диффузный диф ради одной
 * строки. Значение выставляется синхронно в `generateJournalDocumentPdf`
 * ПОСЛЕ всех `await` и сбрасывается в `finally`, поэтому параллельные
 * запросы не пересекаются: вся отрисовка jsPDF синхронна.
 */
let activeControlPeriodicity = "";

/**
 * Статус документа текущего рендера (`draft` | `active` | `closed`).
 *
 * «Окончен …» в шапке ХАССП печатается ТОЛЬКО у закрытого журнала —
 * у открытого там подчёркнутый пропуск под ручную запись (эталон).
 * Значение выставляется там же, где `activeControlPeriodicity`.
 */
let activeDocumentStatus = "";

/**
 * Название документа, заданное в шапке документа (`config.headerTitle`).
 * Пусто — у каждого бланка своё стандартное название. Выставляется там же,
 * где `activeControlPeriodicity`.
 */
let activeHeaderTitle = "";

/**
 * Название журнала из шаблона (`JournalTemplate.name`). Экранная шапка
 * печатает именно его, а PDF подставлял НАЗВАНИЕ ДОКУМЕНТА — инспектор
 * получал бланк с «ПРОВЕРКА FRYER_OIL» вместо названия журнала.
 */
let activeJournalName = "";

/** Название бланка в шапке: своё из шапки документа или стандартное. */
function headerTitleOr(standard: string): string {
  return activeHeaderTitle.trim() || standard;
}

/** Название журнала для шапки: из шаблона, иначе переданный запасной вариант. */
function journalNameOr(fallback: string): string {
  return activeJournalName.trim() || fallback;
}

/**
 * Поля «Начат … / Окончен …» шапки ХАССП передаются ТОЛЬКО явными
 * параметрами `drawJournalHeader`/`drawClimateMetaTable`. Модульных
 * дефолтов (`activeDocumentDateFrom/To`) больше нет: они «залипали»
 * между рендерами и печатали период чужого документа (реверификация r5:
 * general_cleaning с «Начат 01-08-2026» вместо 01-01-2026).
 */

/**
 * Поле бланка (мм) — ОДНО на все четыре стороны листа (`pdf-journal-sheet.ts`):
 * сверху шапка ХАССП (или крупный заголовок), слева и справа шапка и
 * таблицы, снизу таблица (плюс полоса под «СТР. X ИЗ N»). Штамп ХАССП и
 * таблица журнала обязаны иметь ОДНУ ширину — иначе на листе видна
 * «ступенька»; QR — ячейкой внутри шапки справа, ширину штампа не меняет.
 */
const PDF_SHEET_MARGIN = JOURNAL_SHEET_MARGIN_MM;

/**
 * Где стояла шапка ХАССП до выравнивания полей (мм от верха листа): под
 * крупный заголовок, который у половины бланков в печать не идёт. Старые
 * фиксированные координаты бланков (заголовки, «УТВЕРЖДАЮ», начало таблиц)
 * посчитаны от неё — `legacyY` переносит их к шапке на её новом месте.
 */
const LEGACY_HEADER_TOP = 28;

/**
 * Верх последней нарисованной шапки ХАССП (мм) — от него `legacyY`
 * пересчитывает старые координаты. Сбрасывается в начале рендера.
 */
let lastHeaderTop = LEGACY_HEADER_TOP;

/**
 * Низ крупного заголовка бланка (`drawTitle`) по страницам: шапка ХАССП
 * встаёт под ним, а на странице без заголовка — на верхнее поле листа.
 */
const titleBottomByPage = new Map<number, number>();

/**
 * Полоса подвала над нижним полем листа (мм): «СТР. X ИЗ N» на странице без
 * шапки или подвал партнёра в две строки. Таблицы и текст бланка доходят
 * до неё — нижнего резерва под QR больше нет (QR — в шапке).
 */
let activeFooterTextBandMm = JOURNAL_FOOTER_TEXT_BAND_MM;

/**
 * Художник шапки текущего документа: `drawJournalHeader` запоминает,
 * чем рисовать шапку, а `repeatJournalHeaderOnPages` повторяет её на
 * страницах 2..N (штамп ХАССП обязан быть на КАЖДОЙ странице).
 */
let activePageHeaderPainter: ((doc: jsPDF) => void) | null = null;

/**
 * Низ повторённой шапки на страницах 2..N (мм от верха листа) — резерв
 * `margin.top` у autoTable. На продолжениях шапка стоит на верхнем поле
 * (крупного заголовка там нет), поэтому это поле листа + высота шапки.
 */
let activePageHeaderHeight = 0;

/** Страницы, на которых шапка уже нарисована (без повторного оверлея). */
const pagesWithJournalHeader = new Set<number>();

function currentPageNumber(doc: jsPDF): number {
  return (
    (doc as jsPDF & { getCurrentPageInfo?: () => { pageNumber: number } }).getCurrentPageInfo?.()
      .pageNumber ?? doc.getNumberOfPages()
  );
}

/**
 * Старая фиксированная координата бланка (при шапке на 28 мм) → та же
 * точка относительно шапки на её нынешнем месте. Весь блок под шапкой
 * поднимается вместе с ней, промежутки между строками не меняются.
 */
function legacyY(y: number): number {
  return y - (LEGACY_HEADER_TOP - lastHeaderTop);
}

/** Нижняя граница содержимого страницы (мм от верха листа): поле листа + полоса подвала. */
function contentBottom(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight() - PDF_SHEET_MARGIN - activeFooterTextBandMm;
}

/**
 * Базовая линия первой строки текста на новой странице-продолжении:
 * под повтором штампа ХАССП (если он есть у документа) или от верхнего
 * поля листа. Кегль — текущий.
 */
function continuationTextBaseline(doc: jsPDF): number {
  const top = activePageHeaderPainter ? activePageHeaderHeight + HEADER_TITLE_GAP : PDF_SHEET_MARGIN;
  return top + journalCapHeightMm(doc);
}

/**
 * Текстовый блок под таблицей — целиком над нижним полем. `baseline` —
 * базовая линия первой строки, `linesSpan` — от неё до базовой линии
 * последней. Не помещается — новая страница, блок с её верха. Возвращает
 * базовую линию первой строки.
 */
function placeTextBlock(doc: jsPDF, baseline: number, linesSpan: number): number {
  if (baseline + linesSpan + journalDescentMm(doc) <= contentBottom(doc)) return baseline;
  doc.addPage();
  return continuationTextBaseline(doc);
}

/**
 * Начало блока «заголовок + список» под таблицей: помещается на страницу
 * целиком — как `placeTextBlock` для всего блока; длиннее страницы — на
 * этой странице хватает места хотя бы под `headSpan` (заголовок с первой
 * строкой), остальное вызывающий переносит построчно.
 */
function placeBlockStart(doc: jsPDF, baseline: number, blockSpan: number, headSpan: number): number {
  const pageSpan = contentBottom(doc) - continuationTextBaseline(doc) - journalDescentMm(doc);
  return placeTextBlock(doc, baseline, blockSpan <= pageSpan ? blockSpan : headSpan);
}

/**
 * Строки одна под другой (подписи): короткий список — одним блоком над
 * нижним полем листа (не помещается — целиком на новую страницу), список
 * длиннее страницы — строка за строкой с переносом на следующие страницы.
 * Раньше длинный список уходил за нижний край листа. Шрифт — текущий.
 */
function drawTextLinesInFrame(doc: jsPDF, lines: string[], x: number, firstBaseline: number, step: number) {
  if (lines.length === 0) return;
  const span = (lines.length - 1) * step;
  const pageSpan = contentBottom(doc) - continuationTextBaseline(doc);
  let y = span <= pageSpan ? placeTextBlock(doc, firstBaseline, span) : firstBaseline;
  for (const line of lines) {
    y = placeTextBlock(doc, y, 0);
    doc.text(line, x, y);
    y += step;
  }
}

/**
 * Таблица бланка: `journalAutoTable` + верх продолжения. Если у документа
 * шапка повторяется на страницах 2..N, таблица без своего `margin.top`
 * продолжается под этим повтором (иначе штамп ложился на строки таблицы).
 */
function autoTable(doc: jsPDF, options: UserOptions): void {
  const margin = options.margin;
  const needsTop =
    activePageHeaderPainter !== null &&
    (margin === undefined || (typeof margin === "object" && !Array.isArray(margin) && margin.top === undefined));
  journalAutoTable(
    doc,
    needsTop
      ? { ...options, margin: { ...(margin ?? {}), top: activePageHeaderHeight + HEADER_TITLE_GAP } }
      : options,
  );
}

/**
 * Страница-приложение «Подписи сотрудников (общий планшет)».
 *
 * Инспектору важно, что записи вносили сами сотрудники, а не один человек
 * за всех. Таблица: сотрудник · как подтверждал личность · планшет ·
 * сколько входов · первый и последний за период. Добавляется только когда
 * такие подписи есть — обычный бланк не меняется.
 */
function appendSignaturesPage(doc: jsPDF, fontName: string, lines: PdfSignatureLine[]) {
  doc.addPage("a4", "landscape");
  doc.setFont(fontName, "bold");
  doc.setFontSize(13);
  // Верх заголовка — на верхнем поле листа (раньше базовая линия на 16 мм).
  const titleY = journalSheetTopBaseline(doc);
  doc.text("Приложение. Подписи сотрудников через общий планшет", PDF_SHEET_MARGIN, titleY);
  doc.setFont(fontName, "normal");
  doc.setFontSize(9);
  doc.text(
    "Каждый вход подтверждён личным ПИН сотрудника на планшете организации; запись журнала внесена под этим входом.",
    PDF_SHEET_MARGIN,
    titleY + 6,
  );
  const fmt = (d: Date) => d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  autoTable(doc, {
    startY: titleY + 11,
    head: [["Сотрудник", "Подтверждение", "Планшет", "Входов", "С фото", "Первый", "Последний"]],
    body: lines.map((l) => [l.employeeName, l.method, l.device ?? "—", String(l.count), String(l.photos), fmt(l.firstAt), fmt(l.lastAt)]),
    theme: "grid",
    styles: { font: fontName, fontSize: 9, cellPadding: 2 },
    // Шапка — серая с чёрным текстом, как у таблиц бланка (ч/б принтеры).
    headStyles: { fillColor: [242, 242, 242], textColor: [0, 0, 0], font: fontName, fontStyle: "bold" },
    // Приложение добавляется после повтора штампа — своей шапки у его
    // страниц нет, продолжение таблицы начинается от верхнего поля.
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN, top: PDF_SHEET_MARGIN },
  });
}

function repeatJournalHeaderOnPages(doc: jsPDF) {
  const painter = activePageHeaderPainter;
  if (!painter) return;
  const total = doc.getNumberOfPages();
  for (let page = 2; page <= total; page += 1) {
    if (pagesWithJournalHeader.has(page)) continue;
    doc.setPage(page);
    painter(doc);
  }
  doc.setPage(total);
}

/** Дату «Окончен» печатаем только у закрытого документа. */
function resolveFinishedDate(value: Date | string | null | undefined) {
  if (activeDocumentStatus && activeDocumentStatus !== "closed") return null;
  return value ?? null;
}

/**
 * Форматирует дату для строки «Начат / Окончен» шапки ХАССП.
 * Единый формат всех PDF — ДД-ММ-ГГГГ (аудит: раньше местами точки).
 */
function formatHeaderDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return String(value);
  return `${day}-${month}-${year}`;
}

/**
 * Единая шапка ХАССП для всех PDF журналов.
 *
 * Геометрия (аудит Q1-B) — правится ТОЛЬКО здесь, все журналы её шарят:
 *   ┌──────────────┬────────────────────────┬────────────┬────────┐
 *   │              │     СИСТЕМА ХАССП      │ Начат ...  │ ▀▄ ▀▄▀ │  ← row 1
 *   │ Организация  ├────────────────────────┼────────────┤ ▄▀ QR  │
 *   │              │  ЖУРНАЛ ... (жирный)   │ СТР. X/Y   │▓полоса▓│  ← row 2
 *   ├──────────────┼────────────────────────┴────────────┴────────┤
 *   │ Периодичность│ <объединённое значение, без вертикалей>      │  ← row 3
 *   └──────────────┴──────────────────────────────────────────────┘
 *
 * QR (2026-09-27) — фирменная ч/б плитка в своей ячейке справа, на высоту
 * row1+row2, у документа с QR (`prepareJournalQr`): линии ячейки — рамка
 * кода, снизу чёрная полоса «Отсканировать». Рамка шапки той же ширины, что
 * таблица, — сужается средняя колонка; строки row1+row2 не ниже ячейки QR
 * (20 мм — шапка не растёт; плотный адрес — до +3,6 мм, см. `journalQrTile`).
 * Плитку рисует `stampJournalQr` в конце — по ячейке, которую шапка
 * регистрирует на каждой своей странице.
 *
 * Ключевые инварианты:
 *   • горизонталь над строкой периодичности идёт на ВСЮ ширину (раньше
 *     начиналась от x+leftWidth, из-за чего ячейка логотипа сливалась
 *     с периодичностью);
 *   • правая вертикаль (x+leftWidth+middleWidth) обрывается на границе
 *     row2 — она не должна перечёркивать объединённое значение
 *     периодичности;
 *   • высота row3 считается по фактическому числу строк текста, а не
 *     фиксированные 18 мм, иначе длинная формулировка вылезала на
 *     заголовок журнала.
 *
 * @returns Y нижней границы шапки (мм) — заголовок журнала рисуется
 *          строго ПОСЛЕ неё с отступом (см. HEADER_TITLE_GAP).
 */
/** Кегль реквизитов организации в шапке ХАССП (pt). */
const ORG_FONT_SIZE = 9;

function drawJournalHeader(doc: jsPDF, params: {
  organizationName: string;
  journalLabel: string;
  withPeriodicity: boolean;
  /** Дата начала журнала — печатается как «Начат …» в правой колонке. */
  startedDate: Date | string | null;
  /** Дата окончания — «Окончен …»; пусто → печатается линия для ручной записи. */
  finishedDate: Date | string | null;
  /**
   * Левое/правое поле штампа (мм). ОБЯЗАНО совпадать с `margin.left/right`
   * таблицы журнала, иначе на листе «ступенька» (аудит r5, п.2).
   */
  marginX?: number;
  /**
   * Верхняя координата штампа (мм). По умолчанию — верхнее поле листа, а
   * на странице с крупным заголовком (`drawTitle`) — под ним.
   */
  top?: number;
  /**
   * Своя «Периодичность контроля» — у бланков, где экран берёт её из
   * другого поля документа (стекло: `config.controlFrequency`).
   */
  periodicityText?: string;
  /**
   * Повторять штамп на страницах 2..N. Включать только там, где у
   * autoTable зарезервирован `margin.top` под шапку.
   */
  repeatOnPages?: boolean;
}): number {
  const { organizationName, journalLabel } = params;
  // Back-compat: у документов без сохранённого текста гигиена/здоровье
  // печатают прежнюю жёстко зашитую формулировку.
  const periodicityText =
    params.periodicityText?.trim() ||
    activeControlPeriodicity.trim() ||
    (params.withPeriodicity ? HYGIENE_REGISTER_PERIODICITY.join(" ") : "");
  const withPeriodicity = Boolean(periodicityText);
  const pageWidth = doc.internal.pageSize.getWidth();
  const x = params.marginX ?? PDF_SHEET_MARGIN;
  // Раньше по умолчанию 28 мм — место под крупный заголовок даже там, где
  // его нет: верхнее поле выходило вдвое больше боковых.
  const titleBottom = titleBottomByPage.get(currentPageNumber(doc));
  const y =
    params.top ?? (titleBottom !== undefined ? titleBottom + JOURNAL_TITLE_HEADER_GAP_MM : PDF_SHEET_MARGIN);
  lastHeaderTop = y;
  const width = pageWidth - x * 2;
  const leftWidth = 56;
  // «Начат 01-08-2026» шире, чем «СТР. 1 ИЗ 1» — правая колонка одна и та
  // же во всех журналах, чтобы шапки были единообразны.
  const rightWidth = 42;
  // Ячейка QR — правее «Начат / Окончен · СТР. X ИЗ N», по ширине плитки.
  const qrTile = journalQrTileOf(doc);
  const qrWidth = qrTile ? journalQrCellWidth(qrTile) : 0;
  const qrLeft = x + width - qrWidth;
  const middleWidth = width - leftWidth - rightWidth - qrWidth;
  const journalTitle = headerTitleOr(journalLabel).toUpperCase();

  // Высоты строк — по фактическому числу строк текста (кегль 10): длинное
  // название журнала или организации раздвигает строку, а не вылезает
  // за рамку. Минимум — 10 мм, как было.
  doc.setFontSize(10);
  const lineHeight = journalLineHeightMm(doc);
  const rowHeightFor = (lines: number, height = lineHeight) => Math.max(10, lines * height + 2.8);
  doc.setFont("JournalUnicode", "bold");
  const titleLines = (doc.splitTextToSize(journalTitle, middleWidth - 8) as string[]).length;
  // Организация — жирным 9 pt: жирный шире обычного, а 4 строки реквизитов
  // («название · ИНН · адрес») должны по-прежнему влезать в 20 мм.
  doc.setFontSize(ORG_FONT_SIZE);
  const orgLines = (doc.splitTextToSize(organizationName, leftWidth - 6) as string[]).length;
  const orgHeight = rowHeightFor(orgLines, journalLineHeightMm(doc));
  doc.setFontSize(10);
  const topHeight = 10;
  // row1+row2 — не ниже ячейки QR (плитка по высоте строк шапки).
  const secondHeight = Math.max(
    rowHeightFor(titleLines),
    orgHeight - topHeight,
    qrTile ? journalQrCellHeight(qrTile) - topHeight : 0,
  );
  const gridBottom = y + topHeight + secondHeight;

  doc.setFont("JournalUnicode", "normal");
  const periodicityLines = withPeriodicity
    ? (doc.splitTextToSize(periodicityText, width - leftWidth - 8) as string[])
    : [];
  doc.setFont("JournalUnicode", "bold");
  const periodicityLabelLines = (doc.splitTextToSize("Периодичность контроля", leftWidth - 6) as string[]).length;
  doc.setFont("JournalUnicode", "normal");
  // Строка не ниже двух строк подписи «Периодичность / контроля».
  const periodicityHeight = withPeriodicity
    ? rowHeightFor(Math.max(periodicityLines.length, periodicityLabelLines))
    : 0;
  const totalHeight = topHeight + secondHeight + periodicityHeight;

  // Одна толщина всех линий шапки — та же, что у рамок таблиц бланка;
  // каждая внутренняя линия рисуется один раз и упирается в рамку.
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(JOURNAL_LINE_WIDTH);
  doc.rect(x, y, width, totalHeight);
  // Вертикаль «организация | остальное» — на всю высоту: в row3 она
  // отделяет label «Периодичность контроля» от значения.
  doc.line(x + leftWidth, y, x + leftWidth, y + totalHeight);
  // Вертикаль «журнал | Начат/СТР» — только по сетке row1+row2.
  doc.line(x + leftWidth + middleWidth, y, x + leftWidth + middleWidth, gridBottom);
  // Вертикаль «Начат/СТР | QR» — тоже по row1+row2; горизонталь между
  // row1 и row2 упирается в ячейку QR.
  if (qrTile) doc.line(qrLeft, y, qrLeft, gridBottom);
  doc.line(x + leftWidth, y + topHeight, qrLeft, y + topHeight);
  if (withPeriodicity) {
    // Полная горизонталь над строкой периодичности (включая участок
    // под ячейкой организации) — иначе шапка «протекает» вниз.
    doc.line(x, gridBottom, x + width, gridBottom);
  }

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(ORG_FONT_SIZE);
  drawCenteredText(doc, organizationName, x + 3, y, leftWidth - 6, topHeight + secondHeight, leftWidth - 6);
  doc.setFontSize(10);
  drawCenteredText(doc, "СИСТЕМА ХАССП", x + leftWidth, y, middleWidth, topHeight, middleWidth - 8);
  drawCenteredText(doc, journalTitle, x + leftWidth, y + topHeight, middleWidth, secondHeight, middleWidth - 8);

  // «Начат / Окончен»: подписи жирным, значения обычным, в одну колонку;
  // пара строк — по центру ячейки.
  const started = formatHeaderDate(params.startedDate);
  const finished = formatHeaderDate(resolveFinishedDate(params.finishedDate));
  doc.setFontSize(9);
  const labelX = x + leftWidth + middleWidth + 3;
  doc.setFont("JournalUnicode", "bold");
  const valueX = labelX + Math.max(doc.getTextWidth("Начат"), doc.getTextWidth("Окончен")) + 2;
  const [startedY, finishedY] = centeredBaselines(doc, y + topHeight / 2, 2);
  doc.text("Начат", labelX, startedY);
  doc.text("Окончен", labelX, finishedY);
  doc.setFont("JournalUnicode", "normal");
  doc.text(started, valueX, startedY);
  // Линия «Окончен ______» не должна вылезать за правую рамку своей
  // ячейки (аудит r5, п.2; правее — ячейка QR): подчёркивание подрезаем.
  doc.text(
    finished || fitUnderscoreLabel(doc, "", qrLeft - 3 - valueX),
    valueX,
    finishedY
  );
  doc.setFontSize(10);
  registerPageLabelSlot(doc, {
    x: x + leftWidth + middleWidth,
    y: y + topHeight,
    width: rightWidth,
    height: secondHeight,
    maxWidth: rightWidth - 6,
    fontSize: 10,
    fontStyle: "bold",
  });
  if (qrTile) registerJournalQrSlot(doc, { x0: qrLeft, y0: y, x1: x + width, y1: gridBottom });

  if (withPeriodicity) {
    doc.setFont("JournalUnicode", "bold");
    drawCenteredText(doc, "Периодичность контроля", x + 3, gridBottom, leftWidth - 6, periodicityHeight, leftWidth - 6);

    doc.setFont("JournalUnicode", "normal");
    // Значение — единая объединённая ячейка leftWidth → width, без
    // пересекающих вертикалей; строки — по центру ячейки по вертикали.
    const baselines = centeredBaselines(doc, gridBottom + periodicityHeight / 2, periodicityLines.length);
    periodicityLines.forEach((chunk, index) => {
      doc.text(chunk, x + leftWidth + 4, baselines[index]);
    });
  }

  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(10);

  pagesWithJournalHeader.add(currentPageNumber(doc));

  if (params.repeatOnPages) {
    const repeatParams = { ...params, repeatOnPages: false };
    activePageHeaderPainter = (target) => {
      drawJournalHeader(target, repeatParams);
    };
    // На страницах 2..N крупного заголовка нет — повтор встаёт на верхнее
    // поле листа (или на заданный `top`), таблица продолжается под ним.
    activePageHeaderHeight = (params.top ?? PDF_SHEET_MARGIN) + totalHeight;
  }

  return y + totalHeight;
}

/**
 * «Окончен  ______» — длина подчёркивания подгоняется под доступную
 * ширину ячейки, чтобы линия не вылезала за правую рамку штампа.
 */
function fitUnderscoreLabel(doc: jsPDF, label: string, maxWidth: number) {
  const labelWidth = doc.getTextWidth(label);
  const unitWidth = doc.getTextWidth("_") || 1;
  const count = Math.max(3, Math.floor((maxWidth - labelWidth) / unitWidth));
  return `${label}${"_".repeat(count)}`;
}

/**
 * Отступ (мм) между нижней границей шапки и заголовком журнала.
 * ≥8pt по требованию аудита Q1-B (8pt ≈ 2.82мм; берём с запасом).
 */
const HEADER_TITLE_GAP = 6;

/**
 * Y для первого блока под шапкой. Если шапка низкая — сохраняем историческую
 * координату (чтобы не ломать вёрстку журналов), если высокая (длинная
 * периодичность) — сдвигаем вниз, чтобы текст не лёг на заголовок.
 * Историческая координата считана при шапке на 28 мм — `legacyY` поднимает
 * её вместе с шапкой, отступ под шапкой остаётся прежним.
 */
function afterHeader(headerBottom: number, fallbackY: number) {
  return Math.max(legacyY(fallbackY), headerBottom + HEADER_TITLE_GAP);
}

/**
 * Фиксированные ширины столбцов → те же пропорции на всю ширину листа
 * между полями `marginX`. Таблицы с жёсткими ширинами были уже штампа
 * ХАССП, и правый край таблицы не совпадал с рамкой шапки.
 */
function fitColumnWidths(doc: jsPDF, widths: number[], marginX = PDF_SHEET_MARGIN) {
  const available = doc.internal.pageSize.getWidth() - marginX * 2;
  const total = widths.reduce((sum, value) => sum + value, 0) || 1;
  // Чуть меньше единицы: сумма дробных ширин не должна превысить лист.
  const scale = (available / total) * 0.99999;
  return Object.fromEntries(
    widths.map((value, index) => [index, { cellWidth: value * scale }])
  ) as Record<number, { cellWidth: number }>;
}

/** Месяцы в родительном падеже — «01 января», как на экране и в печати. */
const RU_MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/**
 * Дата утверждения бланка: «« 01 » января 2026 г.».
 * Раньше здесь стоял `toLocaleDateString({ month: "long" })`, который в
 * ru-RU даёт ИМЕНИТЕЛЬНЫЙ падеж («январь») и расходился с экраном.
 */
function formatApprovalDateLong(dateKey: string, year: number | string) {
  const day = String(dateKey || "").slice(8, 10);
  const monthIndex = Number(String(dateKey || "").slice(5, 7)) - 1;
  const month = RU_MONTHS_GENITIVE[monthIndex] ?? "";
  // Год — из САМОЙ даты утверждения. Раньше брался «год плана», и при
  // дате документа 01.03.2027 бланк печатал «« 01 » марта 2026 г.».
  // `year` остаётся запасным вариантом для дат без года.
  const dateYear = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))
    ? String(dateKey).slice(0, 4)
    : String(year);
  return `« ${day} » ${month} ${dateYear} г.`;
}

/**
 * Центр строки даты под подписью «УТВЕРЖДАЮ»: как было — на 6 мм левее
 * правого края блока, но строка не выходит за правое поле листа (блок
 * «УТВЕРЖДАЮ» теперь стоит вровень с рамкой шапки, а дата шире 12 мм).
 * Шрифт и кегль — текущие.
 */
function approvalDateCenterX(doc: jsPDF, text: string, rightEdge: number): number {
  return Math.min(rightEdge - 6, rightEdge - doc.getTextWidth(text) / 2);
}

function drawTitle(doc: jsPDF, title: string) {
  // Название журнала — жирным (замечание владельца по печати).
  doc.setFont("JournalUnicode", "bold");
  // Auto-shrink long h1 so titles like "Журнал учёта температурного режима
  // холодильного и морозильного оборудования" don't get truncated by the right
  // page edge. We measure the rendered width and pick a font size that fits.
  const pageWidth = doc.internal.pageSize.getWidth();
  // Ширина — прежняя (кегль заголовка не меняется): заголовок кончается
  // заметно левее правой рамки шапки, жирный шире обычного.
  const maxWidth = pageWidth - 14 - 24;
  const sizes = [26, 22, 18, 16, 14];
  let chosen = sizes[sizes.length - 1];
  for (const size of sizes) {
    doc.setFontSize(size);
    if (doc.getTextWidth(title) <= maxWidth) {
      chosen = size;
      break;
    }
  }
  doc.setFontSize(chosen);
  drawSheetTitleLine(doc, title);
  doc.setFont("JournalUnicode", "normal");
}

/**
 * Крупный заголовок бланка в верхнем левом углу: верх прописных — на
 * верхнем поле листа, слева — по левому полю (вровень с рамкой шапки).
 * Раньше базовая линия стояла на 15 мм, шапка под ним — на 28 мм.
 * Запоминает низ заголовка: шапка ХАССП этой страницы встаёт под ним.
 * Шрифт и кегль — текущие.
 */
function drawSheetTitleLine(doc: jsPDF, title: string) {
  const baseline = journalSheetTopBaseline(doc);
  doc.text(title, PDF_SHEET_MARGIN, baseline);
  titleBottomByPage.set(currentPageNumber(doc), baseline + journalDescentMm(doc));
}

/** `config.printEmptyRows` документа → неотрицательное число. */
function readPrintEmptyRows(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return 0;
  const value = (config as { printEmptyRows?: unknown }).printEmptyRows;
  return typeof value === "number" ? Math.max(0, value) : 0;
}

function getPrintableUsers(
  users: {
    id: string;
    name: string;
    role: string;
    email?: string | null;
    /** Экранная должность (jobPosition → positionTitle → роль). */
    positionTitle?: string | null;
  }[],
  employeeIds: string[],
  /**
   * «Добавлять пустых строк при печати» (config.printEmptyRows). Настройка
   * жила только в журнале здоровья; в гигиеническом её теперь тоже можно
   * задать при создании документа (Z1 аудита), поэтому бланк должен
   * печатать соответствующее число пустых строк.
   */
  printEmptyRows = 0
) {
  const uniqueIds = [...new Set(employeeIds)];
  const matched = users.filter((user) => uniqueIds.includes(user.id));
  // Тот же фолбэк, что на экране (hygiene-document-client): если ни одна
  // строка документа не сматчилась с активным ростером — печатаем весь
  // ростер, иначе бланк выходит безымянным.
  const rosterUsers = matched.length > 0 ? matched : users;

  return buildHygieneExampleEmployees(
    rosterUsers,
    Math.max(rosterUsers.length + printEmptyRows, 7)
  ).map(
    (user) => ({
      id: user.id,
      number: user.number,
      name: user.name || "",
      position: user.position || "",
    })
  );
}

/**
 * Ставит пробелы вокруг «/» между буквами, чтобы jsPDF переносил строку
 * по разделителю, а не разрывал слово («Принять/От-клонить» → «Принять /
 * Отклонить»). Даты и дроби вида 1/2 не трогаем — только буквы.
 */
function softenSlashBreaks(text: string): string {
  return text.replace(/([А-Яа-яA-Za-zЁё])\/([А-Яа-яA-Za-zЁё])/g, "$1 / $2");
}

/**
 * Отображение ячейки уборки в PDF — РОВНО как на экране:
 * кириллические «Т»/«Г» и «/-/». Латинские T/G в легенде расходились
 * и с ячейками, и с экраном.
 */
function displayCleaningPdfValue(value: string): string {
  return displayMatrixValue(value);
}

/**
 * Заливки производственного календаря на бумаге — те же, что на экране
 * (`journal-grid.ts`): выходной/праздник #d4d4d4, сокращённый #ebebeb.
 * Раньше PDF печатал колонки выходных белыми, и бланк расходился и с
 * экраном, и с печатью браузера.
 *
 * Только серые (2026-09-27): у заведений ч/б принтеры, а прежние розовый
 * (#f8d7d4) и бежевый (#fdeeda) на ч/б листе выходили почти одинаково
 * бледными. Светлота разная — выходной заметно темнее сокращённого, тот —
 * темнее белого рабочего дня (тест `print-colors.test.ts`).
 */
export const PDF_DAY_OFF_FILL: [number, number, number] = [212, 212, 212];
export const PDF_DAY_SHORT_FILL: [number, number, number] = [235, 235, 235];

/** Серая заливка ячейки-отметки «просрочено» (график поверки). */
const PDF_OVERDUE_FILL: [number, number, number] = [212, 212, 212];

/** Легенда дней под таблицей — как `CleaningDayColorLegend` на экране. */
const PDF_DAY_LEGEND: { fill: [number, number, number]; label: string }[] = [
  { fill: PDF_DAY_OFF_FILL, label: "Выходной или праздник" },
  { fill: PDF_DAY_SHORT_FILL, label: "Сокращённый день" },
  { fill: [255, 255, 255], label: "Рабочий день" },
];

/**
 * Hook для autoTable: подкрашивает колонки выходных/праздников.
 * `firstDateColumnIndex` — индекс колонки первой даты в таблице.
 */
function makeDayColumnTintHook(dateKeys: string[], firstDateColumnIndex: number) {
  return (data: CellHookData) => {
    // Объединённые ячейки («Месяц август 2026 г.») тонировать нельзя —
    // они перекрывают весь диапазон дат.
    if ((data.cell.colSpan ?? 1) > 1) return;
    const index = data.column.index - firstDateColumnIndex;
    if (index < 0 || index >= dateKeys.length) return;
    const kind = getCalendarDayKind(dateKeys[index]).kind;
    if (kind === "weekend" || kind === "holiday") {
      data.cell.styles.fillColor = PDF_DAY_OFF_FILL;
    } else if (kind === "short") {
      data.cell.styles.fillColor = PDF_DAY_SHORT_FILL;
    }
  };
}

/** Рисует строку легенды дней (образцы заливок). Возвращает Y под ней. */
function drawDayColorLegend(doc: jsPDF, x: number, y: number): number {
  const prevSize = doc.getFontSize();
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(8);
  let cursorX = x;
  PDF_DAY_LEGEND.forEach((item) => {
    doc.setFillColor(item.fill[0], item.fill[1], item.fill[2]);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.rect(cursorX, y - 2.6, 3.4, 3.4, "FD");
    doc.text(item.label, cursorX + 4.8, y);
    cursorX += 4.8 + doc.getTextWidth(item.label) + 8;
  });
  doc.setFontSize(prevSize);
  return y + 4;
}

/**
 * Легенда журнала уборки для бумаги. `displayLegendLine` чинит только
 * ведущий «/», а коды в config.legend хранятся ЛАТИНСКИМИ ('T'/'G') —
 * в сетке они печатались кириллицей, а в легенде оставались латиницей.
 */
function displayCleaningLegendLine(line: string): string {
  const normalized = displayLegendLine(line);
  return normalized
    .replace(/^T(?=\s*[—-])/, "Т")
    .replace(/^G(?=\s*[—-])/, "Г");
}

function centerCell(content: string): CellDef {
  return {
    content,
    styles: { halign: "center", valign: "middle" },
  };
}

function ensurePdfBodyRows(body: RowInput[], columnCount: number, minRows = 3): RowInput[] {
  if (body.length > 0) return body;
  return Array.from({ length: minRows }, () =>
    Array.from({ length: columnCount }, () => centerCell(""))
  );
}

function ensurePlainRows(columnCount: number, minRows = 3): string[][] {
  return Array.from({ length: minRows }, () =>
    Array.from({ length: columnCount }, () => "")
  );
}

/**
 * Render a number for table cells without floating-point noise like
 * "2.300000000000003" or "0.6000000000001%" leaking into the PDF.
 * Trims trailing zeros and at most 2 decimals.
 */
function formatNumberShort(value: unknown, fractionDigits = 2): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  const fixed = num.toFixed(fractionDigits);
  return fixed.replace(/\.?0+$/, "");
}

function formatDateTime(
  date: string | Date | null | undefined,
  hour?: number | null,
  minute?: number | null
) {
  if (!date) return "";

  const dateValue =
    date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  const [year, month, day] = dateValue.split("-");
  if (!year || !month || !day) return String(date);

  const hh = typeof hour === "number" ? String(hour).padStart(2, "0") : "";
  const mm = typeof minute === "number" ? String(minute).padStart(2, "0") : "";
  const timePart = hh && mm ? ` ${hh}:${mm}` : "";

  return `${day}-${month}-${year}${timePart}`;
}

/**
 * Дата для ячеек PDF — всегда ДД-ММ-ГГГГ. Экранные хелперы
 * (например getClimateDateLabel) печатают точки — в печатных бланках
 * они расходятся с шапкой «Начат / Окончен».
 */
function formatPdfDate(value: Date | string | null | undefined) {
  return formatHeaderDate(value);
}

function buildHygieneHead(dateKeys: string[], monthLabel: string): RowInput[] {
  return [
    [
      { content: "№ п/п", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Ф.И.О. работника", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Должность", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      {
        content: `Месяц ${monthLabel}`,
        colSpan: dateKeys.length,
        styles: { halign: "center", valign: "middle" },
      },
    ],
    dateKeys.map((dateKey) => ({
      content: String(getDayNumber(dateKey)),
      styles: { halign: "center" },
    })),
  ];
}

function buildHealthHead(dateKeys: string[], monthLabel: string): RowInput[] {
  return [
    [
      // Экранная колонка чекбоксов в печать не идёт.
      { content: "№\nп/п", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Ф.И.О. работника", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Должность", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      {
        content: `Месяц ${monthLabel}`,
        colSpan: dateKeys.length,
        styles: { halign: "center", valign: "middle" },
      },
      { content: "Принятые меры", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
    ],
    dateKeys.map((dateKey) => ({
      content: `${getDayNumber(dateKey)}\n${getWeekdayShort(dateKey)}.`,
      styles: { halign: "center" },
    })),
  ];
}

function getHealthMeasuresText(
  employeeId: string,
  dateKeys: string[],
  entryMap: Record<string, Record<string, unknown>>
) {
  return dateKeys
    .flatMap((dateKey) => {
      const measures = normalizeHealthEntryData(
        entryMap[makeCellKey(employeeId, dateKey)]
      ).measures?.trim();

      if (!measures) return [];

      return [`${getDayNumber(dateKey)} ${getWeekdayShort(dateKey)}. - ${measures}`];
    })
    .join("\n");
}

function buildHygieneBody(params: {
  users: { id: string; name: string; role: string; positionTitle?: string | null }[];
  employeeIds: string[];
  dateKeys: string[];
  responsibleTitle: string | null;
  entryMap: Record<string, Record<string, unknown>>;
  printEmptyRows?: number;
}): RowInput[] {
  const printableUsers = getPrintableUsers(
    params.users,
    params.employeeIds,
    params.printEmptyRows || 0
  );
  const rows: RowInput[] = [];

  printableUsers.forEach((employee) => {
    rows.push([
      { content: String(employee.number), rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: employee.name, styles: { halign: "center" } },
      { content: employee.position, styles: { halign: "center" } },
      ...params.dateKeys.map((dateKey) => {
        const entry = normalizeHygieneEntryData(params.entryMap[makeCellKey(employee.id, dateKey)]);
        return centerCell(getStatusMeta(entry.status)?.code || "");
      }),
    ]);

    rows.push([
      {
        content: "Температура сотрудника более 37°C?",
        colSpan: 2,
        styles: { halign: "center", valign: "middle" },
      },
      ...params.dateKeys.map((dateKey) => {
        const entry = normalizeHygieneEntryData(params.entryMap[makeCellKey(employee.id, dateKey)]);
        let value = "";
        if (entry.temperatureAbove37 === true) value = "да";
        if (entry.temperatureAbove37 === false) value = "нет";
        if (entry.temperatureAbove37 === null && entry.status === "day_off") value = "-";
        return centerCell(value);
      }),
    ]);
  });

  rows.push([
    {
      content: "Должность ответственного за контроль",
      colSpan: 2,
      styles: { halign: "center", valign: "middle" },
    },
    centerCell(params.responsibleTitle || ""),
    ...params.dateKeys.map(() => centerCell("")),
  ]);

  return rows;
}

function buildHealthBody(params: {
  users: { id: string; name: string; role: string; positionTitle?: string | null }[];
  employeeIds: string[];
  dateKeys: string[];
  entryMap: Record<string, Record<string, unknown>>;
  printEmptyRows?: number;
}): RowInput[] {
  const uniqueIds = [...new Set(params.employeeIds)];
  const rosterUsers = params.users.filter((user) => uniqueIds.includes(user.id));
  // Ровно как на экране (health-document-client): сотрудники + пустые
  // строки под печать, без «пола» в 5 строк — он дорисовывал бланку
  // безымянные строки-призраки.
  const printableUsers = buildHygieneExampleEmployees(
    rosterUsers,
    Math.max(rosterUsers.length + (params.printEmptyRows || 0), 1)
  );

  const rows: RowInput[] = printableUsers.map((employee) => [
    centerCell(employee.name ? String(employee.number) : ""),
    centerCell(employee.name || ""),
    centerCell(employee.position || ""),
    ...params.dateKeys.map((dateKey) => {
      const entry = normalizeHealthEntryData(params.entryMap[makeCellKey(employee.id, dateKey)]);
      return centerCell(entry.signed ? "+" : "");
    }),
    {
      content: getHealthMeasuresText(employee.id, params.dateKeys, params.entryMap),
      styles: { halign: "left" as const, valign: "middle" as const },
    },
  ]);

  // Хвостовая пустая строка — как на экране.
  rows.push([
    centerCell(""),
    centerCell(""),
    centerCell(""),
    ...params.dateKeys.map(() => centerCell("")),
    centerCell(""),
  ]);

  return rows;
}

function drawHygienePdf(doc: jsPDF, params: {
  organizationName: string;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  title: string;
  monthLabel: string;
  dateKeys: string[];
  users: { id: string; name: string; role: string; positionTitle?: string | null }[];
  employeeIds: string[];
  responsibleTitle: string | null;
  entryMap: Record<string, Record<string, unknown>>;
  printEmptyRows?: number;
}) {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Экранный серый H1 над рамкой шапки в печать не идёт — название
  // журнала уже есть в шапке ХАССП и отдельным заголовком ниже.
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "Гигиенический журнал (сотрудники)",
    withPeriodicity: true,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
    repeatOnPages: true,
  });

  const hygieneTitleY = afterHeader(headerBottom, 74);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text(params.title.toUpperCase(), pageWidth / 2, hygieneTitleY, { align: "center" });

  autoTable(doc, {
    startY: hygieneTitleY + 6,
    head: buildHygieneHead(params.dateKeys, params.monthLabel),
    body: buildHygieneBody(params),
    // Колонки выходных/праздников — серые, как на экране и в печати.
    didParseCell: makeDayColumnTintHook(params.dateKeys, 3),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.5,
      cellPadding: 1.4,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 30 },
      2: { cellWidth: 34 },
    },
  });

  doc.addPage("a4", "landscape");
  const page2HeaderBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "Гигиенический журнал (сотрудники)",
    withPeriodicity: true,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
  });

  // Блок «В журнал регистрируются результаты» печатается целиком
  // на одной странице: раньше список рвался между стр. 1 и 2.
  let cursorY = afterHeader(page2HeaderBottom, 84);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(9);
  doc.text("В журнал регистрируются результаты:", PDF_SHEET_MARGIN, cursorY);
  doc.setFont("JournalUnicode", "normal");
  cursorY = renderWrappedTextBlock(
    doc,
    HYGIENE_REGISTER_NOTES.map((note) => `- ${note}`),
    PDF_SHEET_MARGIN,
    cursorY + 6,
    pageWidth - PDF_SHEET_MARGIN * 2,
    5
  );
  cursorY += 8;
  doc.setFont("JournalUnicode", "bold");
  doc.text(
    "Список работников, отмеченных в журнале на день осмотра, должен соответствовать числу работников на этот день в смену",
    PDF_SHEET_MARGIN,
    cursorY
  );

  cursorY += 12;
  doc.setFont("JournalUnicode", "italic");
  doc.text("Условные обозначения:", PDF_SHEET_MARGIN, cursorY);
  cursorY += 5;
  renderWrappedTextBlock(doc, HYGIENE_REGISTER_LEGEND, PDF_SHEET_MARGIN, cursorY, pageWidth - PDF_SHEET_MARGIN * 2, 5);
}

/** Минимум строк в бланке новой формы: пустые строки — под ручное заполнение. */
const HYGIENE_V2_MIN_PDF_ROWS = 20;

/**
 * Гигиенический журнал по форме Приложения №1 СанПиН (документы с
 * `config.hygieneFormVersion = 2`): строка — сотрудник в день, три
 * подписи сотрудника, результат осмотра и подпись ответственного.
 */
function drawHygieneV2Pdf(doc: jsPDF, params: {
  organizationName: string;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  dateKeys: string[];
  users: { id: string; name: string; role: string; email?: string | null; positionTitle?: string | null }[];
  entries: Array<{ employeeId: string; date: Date; data: unknown }>;
}) {
  const pageWidth = doc.internal.pageSize.getWidth();

  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "Гигиенический журнал (сотрудники)",
    withPeriodicity: true,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
    repeatOnPages: true,
  });

  // Как на форме заказчика: справа над заголовком — «Рекомендуемая форма
  // в соответствии с Приложением №1 …». Высокая шапка (длинная
  // периодичность) сдвигает обе строки вниз, а не кладёт их на рамку.
  const captionY = afterHeader(headerBottom, 66);
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  doc.text(HYGIENE_V2_FORM_CAPTION, pageWidth - PDF_SHEET_MARGIN, captionY, { align: "right" });

  const titleY = Math.max(legacyY(74), captionY + 8);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text("ГИГИЕНИЧЕСКИЙ ЖУРНАЛ (СОТРУДНИКИ)", pageWidth / 2, titleY, { align: "center" });

  const rows = buildHygieneV2Rows({
    employees: params.users.map((user) => ({
      id: user.id,
      name: user.name,
      position: getHygieneUserPositionLabel(user),
    })),
    entries: params.entries.map((entry) => ({
      employeeId: entry.employeeId,
      dateKey: toDateKey(entry.date),
      data: entry.data,
    })),
    dateKeys: params.dateKeys,
  });

  // Графы подписи — «да»/«нет» (см. hygieneV2PdfMark: запасные шрифты не
  // знают ✓/✗).
  const body: RowInput[] = rows.map((row) => [
    centerCell(String(row.n)),
    centerCell(row.date),
    { content: row.name, styles: { halign: "left", valign: "middle" } },
    { content: row.position, styles: { halign: "left", valign: "middle" } },
    centerCell(hygieneV2PdfMark(row.temperature)),
    centerCell(hygieneV2PdfMark(row.infection)),
    centerCell(hygieneV2PdfMark(row.respiratorySkin)),
    centerCell(row.result),
    centerCell(row.verifier),
  ]);
  // Пустые строки под ручное заполнение — бланк должен быть пригоден и
  // на бумаге.
  while (body.length < HYGIENE_V2_MIN_PDF_ROWS) {
    body.push(HYGIENE_V2_COLUMNS.map(() => centerCell("")));
  }

  autoTable(doc, {
    startY: titleY + 6,
    head: [HYGIENE_V2_COLUMNS.map((column) => centerCell(column.label))],
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8,
      cellPadding: 1.6,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      minCellHeight: 8,
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 7,
      lineColor: [0, 0, 0],
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 22 },
      2: { cellWidth: 42 },
      3: { cellWidth: 32 },
      4: { cellWidth: 26 },
      5: { cellWidth: 32 },
      6: { cellWidth: 36 },
      7: { cellWidth: 28 },
    },
  });
}

function drawHealthPdf(doc: jsPDF, params: {
  organizationName: string;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  title: string;
  monthLabel: string;
  dateKeys: string[];
  users: { id: string; name: string; role: string; positionTitle?: string | null }[];
  employeeIds: string[];
  entryMap: Record<string, Record<string, unknown>>;
  printEmptyRows?: number;
}) {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Экранный серый H1 над рамкой шапки в печать не идёт — название
  // журнала уже есть в шапке ХАССП и отдельным заголовком ниже.
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "Журнал здоровья",
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
    repeatOnPages: true,
  });

  const healthTitleY = afterHeader(headerBottom, 70);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text(params.title.toUpperCase(), pageWidth / 2, healthTitleY, { align: "center" });

  autoTable(doc, {
    startY: healthTitleY + 6,
    head: buildHealthHead(params.dateKeys, params.monthLabel),
    // Колонки выходных/праздников — серые, как на экране и в печати.
    didParseCell: makeDayColumnTintHook(params.dateKeys, 3),
    body: buildHealthBody(params),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.3,
      cellPadding: 1.4,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 32 },
      2: { cellWidth: 28 },
      [params.dateKeys.length + 3]: { cellWidth: 32 },
    },
  });

  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 150;
  // Примечания и напоминание — одним блоком над нижним полем листа: у
  // длинного журнала таблица доходит до низа, и блок уезжал за край листа.
  // Начертание — как было (после таблицы — жирное заголовка), кегль 9.
  doc.setFontSize(9);
  const notesWidth = pageWidth - PDF_SHEET_MARGIN * 2;
  const notesLines = HEALTH_REGISTER_NOTES.reduce(
    (count, note) => count + (doc.splitTextToSize(note, notesWidth) as string[]).length,
    0
  );
  // От первой строки примечаний до строки напоминания: строки по 5 мм + 8.
  const notesY = placeTextBlock(doc, finalY + 10, notesLines * 5 + 8);
  let cursorY = renderWrappedTextBlock(doc, HEALTH_REGISTER_NOTES, PDF_SHEET_MARGIN, notesY, notesWidth, 5);
  cursorY += 8;
  doc.setFont("JournalUnicode", "bold");
  doc.text(HEALTH_REGISTER_REMINDER, PDF_SHEET_MARGIN, cursorY);
}

/**
 * Штамп ХАССП для «табличных» журналов. Раньше это была ВТОРАЯ, своя
 * геометрия (x=36мм, ширина pageWidth-72) — на листе она давала
 * «ступеньку» относительно таблицы журнала (margin 10/14мм) и
 * расходилась со шапкой `drawJournalHeader`. Теперь это тонкая обёртка
 * над единственной реализацией шапки.
 */
function drawClimateMetaTable(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  marginX?: number;
  repeatOnPages?: boolean;
  /** Своя формулировка в шапке — у бланков, где она не равна названию журнала. */
  journalLabel?: string;
}) {
  // drawTitle() sets a large font size; reset it for header table.
  doc.setFontSize(10);
  return drawJournalHeader(doc, {
    organizationName: params.organizationName,
    // По умолчанию — название журнала (как на экране), а не название
    // документа: иначе в шапке печаталось «ПРОВЕРКА AUDIT_PLAN».
    journalLabel: params.journalLabel ?? journalNameOr(params.title),
    withPeriodicity: false,
    startedDate: params.dateFrom ?? null,
    finishedDate: params.dateTo ?? null,
    marginX: params.marginX,
    repeatOnPages: params.repeatOnPages,
  });
}

/**
 * Блок «Нормы условий» — как на экране (climate-document-client):
 * это СТРОКИ бумажной шапки с левой подписью-колонкой, вложенной
 * шапкой «ПОМЕЩЕНИЕ / ТЕМПЕРАТУРА °C / ВЛАЖНОСТЬ, %» и отдельной
 * строкой «Частота контроля». Раньше PDF печатал плоскую таблицу из
 * трёх колонок без левой подписи — структура расходилась с экраном.
 */
const CLIMATE_NORMS_LABEL_WIDTH = 56;

function buildClimateNormsBody(config: ClimateDocumentConfig): RowInput[] {
  const rooms = config.rooms.filter(
    (room) => room.temperature.enabled || room.humidity.enabled
  );
  const labelStyles = {
    halign: "center" as const,
    valign: "middle" as const,
    fontStyle: "bold" as const,
    fillColor: [242, 242, 242] as [number, number, number],
  };
  const subHeadStyles = {
    halign: "center" as const,
    valign: "middle" as const,
    fontStyle: "bold" as const,
    fillColor: [242, 242, 242] as [number, number, number],
  };

  const rows: RowInput[] = [];
  rows.push([
    {
      content: "Нормы условий",
      rowSpan: rooms.length + 1,
      styles: labelStyles,
    },
    { content: "ПОМЕЩЕНИЕ", styles: { ...subHeadStyles, halign: "left" as const } },
    { content: "ТЕМПЕРАТУРА °C", styles: subHeadStyles },
    { content: "ВЛАЖНОСТЬ, %", styles: subHeadStyles },
  ]);

  rooms.forEach((room) => {
    rows.push([
      {
        content: room.name,
        styles: { halign: "left" as const, valign: "middle" as const },
      },
      centerCell(
        room.temperature.enabled
          ? `от ${room.temperature.min ?? "—"}°C до ${room.temperature.max ?? "—"}°C`
          : "—"
      ),
      centerCell(
        room.humidity.enabled
          ? `от ${room.humidity.min ?? "—"}% до ${room.humidity.max ?? "—"}%`
          : "—"
      ),
    ]);
  });

  rows.push([
    {
      content: "Частота контроля",
      styles: { ...labelStyles, halign: "left" as const },
    },
    {
      content: getClimatePeriodicityText(config),
      colSpan: 3,
      styles: { halign: "center" as const, valign: "middle" as const },
    },
  ]);

  return rows;
}

function buildClimateHead(config: ClimateDocumentConfig): RowInput[] {
  const rooms = config.rooms.filter(
    (room) => room.temperature.enabled || room.humidity.enabled
  );
  const totalColumns = rooms.reduce((total, room) => {
    const metricCount = Number(room.temperature.enabled) + Number(room.humidity.enabled);
    return total + config.controlTimes.length * metricCount;
  }, 0);

  return [
    [
      { content: "Дата", rowSpan: 4, styles: { halign: "center", valign: "middle" } },
      {
        content: "Точки контроля",
        colSpan: totalColumns,
        styles: { halign: "center", valign: "middle" },
      },
      {
        content: "Фамилия ответственного лица",
        rowSpan: 4,
        styles: { halign: "center", valign: "middle" },
      },
    ],
    rooms.flatMap((room) => {
      const metricCount = Number(room.temperature.enabled) + Number(room.humidity.enabled);
      return [
        {
          content: room.name,
          colSpan: config.controlTimes.length * metricCount,
          styles: { halign: "center", valign: "middle" },
        },
      ];
    }),
    // Экран печатает время ОДНОЙ объединённой шапкой над парой
    // «T, °C | ВВ, %», а не повторяет «10:00» в каждой подколонке.
    rooms.flatMap((room) => {
      const metricCount = Number(room.temperature.enabled) + Number(room.humidity.enabled);
      return config.controlTimes.map((time) => ({
        content: time,
        colSpan: metricCount,
        styles: { halign: "center" as const, valign: "middle" as const },
      }));
    }),
    rooms.flatMap((room) =>
      config.controlTimes.flatMap(() => {
        const cells: CellDef[] = [];
        if (room.temperature.enabled) {
          cells.push({
            content: "T, °C",
            styles: { halign: "center", valign: "middle" },
          });
        }
        if (room.humidity.enabled) {
          cells.push({
            content: "ВВ, %",
            styles: { halign: "center", valign: "middle" },
          });
        }
        return cells;
      })
    ),
  ];
}

/** Пользователь бланка: `positionTitle` загрузчик уже вычислил (getUserDisplayTitle). */
type PdfPositionUser = {
  id: string;
  name: string;
  role: string;
  positionTitle?: string | null;
};

/**
 * «Имя + должность» в ячейке бланка. У аккаунта без ФИО загрузчик ставит
 * должность вместо имени — второй раз её не печатаем («Повар, Повар»).
 */
function joinPdfNameAndTitle(name: string, title: string, separator: string) {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle === name.trim()) return name;
  return `${name}${separator}${cleanTitle}`;
}

function buildClimateBody(params: {
  config: ClimateDocumentConfig;
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: PdfPositionUser[];
}): RowInput[] {
  const rooms = params.config.rooms.filter(
    (room) => room.temperature.enabled || room.humidity.enabled
  );
  const userMap = Object.fromEntries(params.users.map((user) => [user.id, user]));

  return params.entries.map((entry) => {
    const normalized = normalizeClimateEntryData(entry.data);
    const user = userMap[entry.employeeId];

    return [
      centerCell(formatPdfDate(entry.date)),
      ...rooms.flatMap((room) =>
        params.config.controlTimes.flatMap((time) => {
          const measurement = normalized.measurements[room.id]?.[time];
          const cells: CellDef[] = [];

          if (room.temperature.enabled) {
            cells.push(
              centerCell(
                measurement?.temperature != null ? String(measurement.temperature) : ""
              )
            );
          }
          if (room.humidity.enabled) {
            cells.push(
              centerCell(
                measurement?.humidity != null ? String(measurement.humidity) : ""
              )
            );
          }

          return cells;
        })
      ),
      {
        // Должность этого сотрудника (загрузчик уже положил её в positionTitle),
        // а не копия из строки: туда попадала должность документа.
        content: user
          ? joinPdfNameAndTitle(
              user.name,
              getRowEmployeeTitle(user, normalized.responsibleTitle),
              "\n"
            )
          : normalized.responsibleTitle || "",
        styles: { halign: "center" as const, valign: "middle" as const },
      },
    ];
  });
}

function drawClimatePdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ClimateDocumentConfig;
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: PdfPositionUser[];
}) {
  // Экранный H1 над штампом в бланк не идёт — название журнала уже
  // стоит в штампе ХАССП и отдельным заголовком над таблицей.
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    marginX: PDF_SHEET_MARGIN,
    repeatOnPages: true,
  });
  const climateColumnCount =
    2 +
    params.config.rooms
      .filter((room) => room.temperature.enabled || room.humidity.enabled)
      .reduce((total, room) => {
        const metricCount =
          Number(room.temperature.enabled) + Number(room.humidity.enabled);
        return total + params.config.controlTimes.length * metricCount;
      }, 0);

  // «Нормы условий» — продолжение штампа: тот же margin, стык без зазора,
  // левая колонка-подпись одной ширины со столбцом организации в штампе.
  autoTable(doc, {
    startY: metaBottom,
    body: buildClimateNormsBody(params.config),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8,
      cellPadding: 1.8,
      lineColor: [0, 0, 0],
      lineWidth: 0.25,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    columnStyles: {
      0: { cellWidth: CLIMATE_NORMS_LABEL_WIDTH },
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });

  const normsEndY =
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 96;

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text(params.title.toUpperCase(), doc.internal.pageSize.getWidth() / 2, normsEndY + 12, {
    align: "center",
  });

  autoTable(doc, {
    startY: normsEndY + 18,
    head: buildClimateHead(params.config),
    body: ensurePdfBodyRows(buildClimateBody(params), climateColumnCount),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7, // было 6,5: у шрифта с засечками строчные ниже (2026-09-28)
      cellPadding: 0.8,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
      // Без lineWidth autoTable не рисует вертикали между подколонками
      // шапки (10:00 T | 10:00 ВВ | 17:00 T | 17:00 ВВ).
      lineWidth: 0.1,
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      // Резерв под повтор штампа ХАССП на страницах 2..N.
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
  });

}

/** Строка основания под названием холодильного журнала: кегль (pt) и шаг от базовой линии названия, мм. */
const COLD_EQUIPMENT_BASIS_FONT_SIZE = 8;
const COLD_EQUIPMENT_BASIS_STEP_MM = 4.4;
/** От базовой линии строки основания до таблицы, мм (у названия без неё было 6). */
const COLD_EQUIPMENT_BASIS_TABLE_GAP_MM = 4.2;

/**
 * Журнал учёта температурного режима холодильного и морозильного
 * оборудования (форма Приложения № 2 к СанПиН 2.3/2.4.4282-26).
 *
 * Раньше PDF печатал ТРАНСПОНИРОВАННУЮ таблицу (строки = даты,
 * колонки = оборудование) — она не совпадала ни с экраном, ни с печатью
 * браузера. Форма приведена к экранной (cold-equipment-document-client):
 *   строки   = единицы оборудования (с нормой рядом с названием);
 *   колонки  = дни месяца с днём недели под числом;
 *   строка   «Температура °C» — объединённая на всю ширину;
 *   строка   «Ответственный за снятие показателей | С1 - ФИО» с кодами
 *            в те дни, где ЕСТЬ фактические замеры.
 */
function drawColdEquipmentPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeColdEquipmentDocumentConfig>;
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: PdfPositionUser[];
  monthLabel: string;
}) {
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    marginX: PDF_SHEET_MARGIN,
    repeatOnPages: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  // Строки бланка: оборудование × замер за день (режим «2 раза в день»).
  const equipment = expandColdEquipmentReadingSlots(params.config);
  const dateKeys = buildDateKeys(params.dateFrom, params.dateTo);

  const titleY = afterHeader(metaBottom, 60);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  doc.text(params.title.toUpperCase(), pageWidth / 2, titleY, { align: "center" });
  // Основание формы — мелко по центру под названием, только на первой
  // (титульной) странице: журнал ведётся по Приложению № 2 к СанПиН.
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(COLD_EQUIPMENT_BASIS_FONT_SIZE);
  const basisY = titleY + COLD_EQUIPMENT_BASIS_STEP_MM;
  doc.text(COLD_EQUIPMENT_LEGAL_BASIS, pageWidth / 2, basisY, { align: "center" });

  // (dateKey → запись дня): у журнала одна строка на дату.
  const rowByDate = new Map<string, { employeeId: string; temperatures: Record<string, number | null>; statuses: Record<string, ColdEquipmentStatus> }>();
  params.entries.forEach((entry) => {
    const dateKey = toDateKey(entry.date);
    const data = normalizeColdEquipmentEntryData(entry.data);
    // За день могли писать разные сотрудники (замеры по QR) — сливаем значения.
    const current = rowByDate.get(dateKey);
    const temperatures = { ...(current?.temperatures ?? {}) };
    Object.entries(data.temperatures).forEach(([key, value]) => {
      if (value != null || !(key in temperatures)) temperatures[key] = value;
    });
    rowByDate.set(dateKey, {
      employeeId: current?.employeeId ?? entry.employeeId,
      temperatures,
      // «обсл»/«рем» вместо температуры — печатаются как есть.
      statuses: { ...(current?.statuses ?? {}), ...(data.statuses ?? {}) },
    });
  });

  // Коды С1/С2 — ровно как на экране (buildResponsibleCodes):
  // нумеруются исполнители, реально встретившиеся в строках журнала.
  const usedIds: string[] = [];
  dateKeys.forEach((dateKey) => {
    const employeeId = rowByDate.get(dateKey)?.employeeId;
    if (employeeId && !usedIds.includes(employeeId)) usedIds.push(employeeId);
  });
  const codeById = new Map(usedIds.map((id, index) => [id, `С${index + 1}`]));
  const userNameById = new Map(params.users.map((user) => [user.id, user.name]));
  const responsibleLabel =
    usedIds
      .map((id) => `${codeById.get(id)} - ${userNameById.get(id) ?? "—"}`)
      .join("\n") || "Не назначен";

  const head: RowInput[] = [
    [
      {
        content: "Наименование или номер ХК",
        colSpan: 2,
        rowSpan: 2,
        styles: { halign: "center" as const, valign: "middle" as const },
      },
      {
        content: `Месяц ${params.monthLabel}`,
        colSpan: Math.max(dateKeys.length, 1),
        styles: { halign: "center" as const, valign: "middle" as const },
      },
    ],
    dateKeys.length > 0
      ? dateKeys.map((dateKey) => ({
          content: `${getDayNumber(dateKey)}\n${getWeekdayShort(dateKey).toUpperCase()}`,
          styles: { halign: "center" as const, valign: "middle" as const },
        }))
      : [centerCell("")],
  ];

  const body: RowInput[] = [];
  body.push([
    {
      content: "Температура °C",
      colSpan: dateKeys.length + 2,
      styles: {
        halign: "center" as const,
        valign: "middle" as const,
        fontStyle: "bold" as const,
      },
    },
  ]);

  equipment.forEach((item) => {
    const norm =
      item.min != null || item.max != null
        ? `  от ${item.min ?? "—"}°C до ${item.max ?? "—"}°C`
        : "";
    body.push([
      {
        content: `${item.name}${norm}${item.slotLabel ? `  · ${item.slotLabel}` : ""}`,
        colSpan: 2,
        styles: { halign: "left" as const, valign: "middle" as const },
      },
      ...dateKeys.map((dateKey) => {
        const status = rowByDate.get(dateKey)?.statuses[item.slotKey];
        return centerCell(
          status
            ? COLD_EQUIPMENT_STATUS_SHORT[status]
            : formatNumberShort(rowByDate.get(dateKey)?.temperatures?.[item.slotKey])
        );
      }),
    ]);
  });

  body.push([
    {
      content: "Ответственный за снятие показателей",
      styles: { halign: "center" as const, valign: "middle" as const },
    },
    {
      content: responsibleLabel,
      styles: { halign: "left" as const, valign: "middle" as const },
    },
    ...dateKeys.map((dateKey) => {
      const row = rowByDate.get(dateKey);
      // Подпись С1 ставится ТОЛЬКО в дни с фактическими замерами —
      // иначе пустой журнал выглядел бы подписанным задним числом.
      const hasMeasurements = row
        ? Object.values(row.temperatures).some((value) => value != null) ||
          Object.keys(row.statuses).length > 0
        : false;
      return centerCell(
        hasMeasurements ? codeById.get(row?.employeeId ?? "") || "" : ""
      );
    }),
  ]);

  if (equipment.length === 0) {
    body.splice(1, 0, [
      { content: "—", colSpan: 2, styles: { halign: "left" as const } },
      ...dateKeys.map(() => centerCell("")),
    ]);
  }

  const dayWidth =
    dateKeys.length > 0 ? Math.max(6.5, Math.min(12, 170 / dateKeys.length)) : 12;

  autoTable(doc, {
    startY: basisY + COLD_EQUIPMENT_BASIS_TABLE_GAP_MM,
    head,
    body,
    theme: "grid",
    rowPageBreak: "avoid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.5,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    bodyStyles: { lineWidth: 0.2 },
    // Прежние пропорции на всю ширину между полями — край в край со
    // штампом: за 14 дней таблица была на 31 мм уже шапки, за 31 день —
    // на 2,5 мм шире листа.
    columnStyles: fitColumnWidths(doc, [34, 44, ...dateKeys.map(() => dayWidth)]),
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
  });
}

function drawCleaningPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  /** roomId → имя помещения (для rooms-mode). */
  roomNamesById?: Record<string, string>;
  /** roomId → средства и шаги уборки из Room (для rooms-mode, C7). */
  roomDetailsById?: Record<
    string,
    { name: string; detergent: string; currentScope: string[]; generalScope: string[] }
  >;
  /** userId → инициалы (для rooms-mode, инициалы cleaner-а / контролёра). */
  userInitialsById?: Record<string, string>;
  /** Полные имена (rooms-mode) — для легенды «С1 - Иванова». */
  userNamesById?: Record<string, string>;
}) {
  const config = normalizeCleaningDocumentConfig(params.config);

  const dateKeys = buildDateKeys(params.dateFrom, params.dateTo);
  const pageWidth = doc.internal.pageSize.getWidth();
  const monthDate =
    dateKeys[0]
      ? new Date(`${dateKeys[0]}T00:00:00.000Z`)
      : params.dateFrom instanceof Date
        ? params.dateFrom
        : new Date(`${String(params.dateFrom).slice(0, 10)}T00:00:00.000Z`);
  const monthLabel = monthDate.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  }).replace(" г.", " г.");
  const normalizedMonthLabel = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const journalTitle = params.title || getCleaningDocumentTitle();

  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    // В шапке — название ЖУРНАЛА, а не документа: у уборки сюда уезжало
    // имя документа заглавными («ZZ3 CLEANING»).
    journalLabel: journalNameOr(journalTitle),
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
    repeatOnPages: true,
  });

  // Заголовок журнала — строго ПОСЛЕ шапки. Раньше стоял на фиксированных
  // 54мм и «Периодичность контроля» (высота 18мм, низ шапки 66мм)
  // перечёркивала «ЖУРНАЛ УБОРКИ».
  const cleaningTitleY = afterHeader(headerBottom, 54);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  doc.text(journalTitle.toUpperCase(), pageWidth / 2, cleaningTitleY, { align: "center" });

  const isRoomsMode =
    config.cleaningMode === "rooms" &&
    !!params.roomNamesById &&
    !!params.userInitialsById;

  // Helper для rooms-mode: ищем cleaning_room entry по (roomId, dateKey)
  // и возвращаем инициалы cleaner-а или "" если ещё не убирался.
  function roomsModeCellValue(roomId: string, dateKey: string): string {
    // Приоритет как на экране (cellValue): ручная отметка Т/Г/«/» из matrix
    // важнее completion. Без этого журнал, заполненный руками, печатался
    // пустым — в бланк попадали только инициалы закрывших TF-задачу.
    // Sentinel «—» (менеджер явно очистил клетку) тоже возвращаем как есть:
    // displayMatrixValue у вызывающего превратит его в пустоту, а completion
    // при этом не всплывёт.
    const matrixValue = config.matrix[roomId]?.[dateKey];
    if (
      matrixValue === "T" ||
      matrixValue === "G" ||
      matrixValue === "/" ||
      matrixValue === "—"
    ) {
      return matrixValue;
    }
    if (!params.userInitialsById) return "";
    for (const e of params.entries) {
      for (const c of listCleaningRoomCompletions(e.data)) {
        if (c.roomId === roomId && c.dateKey === dateKey) {
          return params.userInitialsById[c.cleanerUserId] ?? "";
        }
      }
    }
    return "";
  }
  function roomsModeControllerCellValue(
    roomId: string,
    dateKey: string
  ): string {
    if (!params.userInitialsById) return "";
    for (const e of params.entries) {
      for (const c of listCleaningRoomCompletions(e.data)) {
        if (c.roomId === roomId && c.dateKey === dateKey && c.controllerUserId) {
          return params.userInitialsById[c.controllerUserId] ?? "";
        }
      }
    }
    return "";
  }

  // --- D-аудит: строки подписей «Ответственный за уборку / за контроль» ---
  //
  // Раньше PDF читал `config.matrix[responsible.id][dateKey]` — такого
  // ключа не существует, поэтому в печати эти строки были пустыми, хотя
  // на экране стояли коды С1/С2. Экран (cleaning-document-client)
  // считает их так:
  //   1) ручной/авто-override в matrix[__cleaning_signature__ |
  //      __control_signature__][dateKey] (с обрезкой маркера «auto:»
  //      и фильтром устаревших С-кодов);
  //   2) иначе — вычисляем из completion-entries (kind="cleaning_room").
  // Повторяем ровно эту логику, чтобы печать совпадала с экраном.
  // Единый список с экраном (rooms-mode: пул; иначе cleaningResponsibles).
  const cleaningResponsibleList = listCleaningCodeEntries(config, params.userNamesById);
  const controlResponsibleList = listControlCodeEntries(config, params.userNamesById);
  // Тот же резолвер, что у экрана: «uid:<id>» и легаси «СN» через
  // закреплённую карту кодов — печать не расходится с экраном.
  const cleaningSignatures = buildCleaningSignatureResolver(cleaningResponsibleList);
  const controlSignatures = buildCleaningSignatureResolver(controlResponsibleList);
  const cleanerCodeById = new Map(
    cleaningResponsibleList
      .filter((item) => item.userId)
      .map((item) => [String(item.userId), item.code])
  );

  function hasCompletion(dateKey: string) {
    return params.entries.some((entry) =>
      listCleaningRoomCompletions(entry.data).some((c) => c.dateKey === dateKey)
    );
  }

  function cleaningCodeForDay(dateKey: string): string {
    const manual = cleaningSignatures.readManual(
      config.matrix[CLEANING_SIGNATURE_ROW_ID]?.[dateKey]
    );
    if (manual !== null) return manual;
    const codes = new Set<string>();
    for (const entry of params.entries) {
      for (const c of listCleaningRoomCompletions(entry.data)) {
        if (c.dateKey !== dateKey) continue;
        const code = cleanerCodeById.get(c.cleanerUserId);
        if (code) codes.add(code);
      }
    }
    return Array.from(codes).sort().join(",");
  }

  function controlCodeForDay(dateKey: string): string {
    const manual = controlSignatures.readManual(
      config.matrix[CONTROL_SIGNATURE_ROW_ID]?.[dateKey]
    );
    if (manual !== null) return manual;
    if (controlResponsibleList.length === 0) return "";
    if (!hasCompletion(dateKey)) return "";
    return controlResponsibleList.map((item) => item.code).join(",");
  }

  /** Одна сгруппированная строка подписей, как на экране. */
  function buildSignatureRow(
    label: string,
    list: { code: string; userName?: string | null }[],
    codeForDay: (dateKey: string) => string
  ): RowInput {
    return [
      {
        content: label,
        styles: { halign: "center" as const, valign: "middle" as const },
      },
      {
        content:
          list.length > 0
            ? list.map((item) => `${item.code} - ${item.userName || "—"}`).join("\n")
            : "—",
        styles: { halign: "center" as const, valign: "middle" as const },
      },
      ...dateKeys.map((dateKey) => centerCell(codeForDay(dateKey))),
    ];
  }

  const signatureRows: RowInput[] = [
    ...(cleaningResponsibleList.length > 0
      ? [buildSignatureRow(CLEANING_ROW_LABELS.cleaning, cleaningResponsibleList, cleaningCodeForDay)]
      : []),
    ...(controlResponsibleList.length > 0
      ? [buildSignatureRow(CLEANING_ROW_LABELS.control, controlResponsibleList, controlCodeForDay)]
      : []),
  ];

  const matrixRows: RowInput[] = isRoomsMode
    ? [...buildRoomsModeMatrixRows(), ...signatureRows]
    : [
        ...config.rooms.map((room) => [
          {
            content: room.name,
            styles: { halign: "center" as const, valign: "middle" as const },
          },
          {
            content: room.detergent || "—",
            styles: { halign: "center" as const, valign: "middle" as const },
          },
          ...dateKeys.map((dateKey) =>
            centerCell(displayCleaningPdfValue(config.matrix[room.id]?.[dateKey] || ""))
          ),
        ]),
        ...signatureRows,
      ];

  function buildRoomsModeMatrixRows(): RowInput[] {
    // Удалённое из справочника помещение печатаем так же, как показывает
    // экран: с отметками — строкой «… (помещение удалено)», без отметок —
    // не печатаем вовсе (раньше выходила безымянная строка «Помещение»).
    const knownRoomIds = new Set(Object.keys(params.roomNamesById ?? {}));
    const deletedNameById = new Map(
      listDeletedCleaningRoomsWithMarks(config, knownRoomIds).map((item) => [
        item.id,
        item.name,
      ])
    );
    const selectedRoomIds = ((config.selectedRoomIds ?? []) as string[]).filter(
      // Справочник не передали (образцы бланков) — печатаем как раньше.
      (roomId) =>
        knownRoomIds.size === 0 ||
        knownRoomIds.has(roomId) ||
        deletedNameById.has(roomId)
    );
    if (selectedRoomIds.length === 0) return [];
    const detergentByRoom = new Map<string, string>();
    config.rooms.forEach((r) => detergentByRoom.set(r.id, r.detergent || ""));
    // Room (БД) приоритетнее config.rooms — см. C7.
    for (const [roomId, details] of Object.entries(params.roomDetailsById ?? {})) {
      if (details.detergent) detergentByRoom.set(roomId, details.detergent);
    }
    const namesMap = params.roomNamesById ?? {};

    // Код уборщика зоны в названии: «Холодный цех (С2)». Гонка/несколько
    // уборщиков → «(С1, С3)».
    const roomCodes = (roomId: string) =>
      resolveRoomCleaners(config, roomId)
        .map((uid) => cleanerCodeById.get(uid))
        .filter((code): code is string => Boolean(code));
    // Проверяющие помещения (только когда назначены самому помещению —
    // контролёр документа и так стоит в строке «Контролёр»).
    const roomVerifierLine = (roomId: string) => {
      if (!config.verifierByRoomId?.[roomId]?.length) return "";
      const names = resolveRoomControllers(config, roomId)
        .map((uid) => params.userNamesById?.[uid])
        .filter((name): name is string => Boolean(name));
      return names.length > 0 ? `\nПроверяет: ${names.join(", ")}` : "";
    };
    const roomRows: RowInput[] = selectedRoomIds.map((roomId) => [
      {
        content: `${namesMap[roomId] ?? deletedNameById.get(roomId) ?? "Помещение"}${
          roomCodes(roomId).length > 0 ? ` (${roomCodes(roomId).join(", ")})` : ""
        }${roomVerifierLine(roomId)}`,
        styles: { halign: "center" as const, valign: "middle" as const },
      },
      {
        content: detergentByRoom.get(roomId) || "—",
        styles: { halign: "center" as const, valign: "middle" as const },
      },
      ...dateKeys.map((dateKey) =>
        centerCell(displayMatrixValue(roomsModeCellValue(roomId, dateKey)))
      ),
    ]);

    // Строки подписей строятся общим кодом ниже (signatureRows) — здесь
    // возвращаем только помещения.
    return roomRows;
  }

  if (matrixRows.length === 0) {
    matrixRows.push([
      centerCell("—"),
      centerCell("—"),
      ...dateKeys.map(() => centerCell("")),
    ]);
  }

  const matrixHead: RowInput[] = [
    [
      {
        content: "Наименование помещения",
        rowSpan: 2,
        styles: { halign: "center" as const, valign: "middle" as const },
      },
      {
        content: "Моющие и дезинфицирующие средства",
        rowSpan: 2,
        styles: { halign: "center" as const, valign: "middle" as const },
      },
      {
        content: `Месяц ${normalizedMonthLabel}`,
        colSpan: Math.max(dateKeys.length, 1),
        styles: { halign: "center" as const, valign: "middle" as const },
      },
    ],
    dateKeys.length > 0
      ? dateKeys.map((dateKey) => centerCell(String(Number(dateKey.slice(-2)))))
      : [centerCell("")],
  ];

  // Ширины ОБЯЗАНЫ уместиться в лист: при 30 днях сумма 56+44+30×8 = 340 мм
  // не влезала в печатную область (265 мм), и autoTable обрезал последние
  // колонки — в бланке пропадали числа 24-30 вместе с отметками уборки.
  const cleaningUsableWidth = doc.internal.pageSize.getWidth() - PDF_SHEET_MARGIN * 2;
  const cleaningNameWidth = dateKeys.length > 20 ? 40 : 56;
  const cleaningDetergentWidth = dateKeys.length > 20 ? 32 : 44;
  const baseDayWidth =
    dateKeys.length > 0
      ? Math.max(
          4.5,
          Math.min(
            12,
            (cleaningUsableWidth - cleaningNameWidth - cleaningDetergentWidth) /
              dateKeys.length
          )
        )
      : 12;
  // Те же пропорции на всю ширину между полями — край в край со штампом
  // (при 14 днях дневные колонки упирались в предел 12 мм, и таблица была
  // уже шапки).
  const fittedWidths = fitColumnWidths(doc, [
    cleaningNameWidth,
    cleaningDetergentWidth,
    ...dateKeys.map(() => baseDayWidth),
  ]);
  const dayWidth = dateKeys.length > 0 ? fittedWidths[2].cellWidth : baseDayWidth;
  const columnStyles: Record<number, { cellWidth: number; cellPadding?: number }> = {
    0: { cellWidth: fittedWidths[0].cellWidth },
    1: { cellWidth: fittedWidths[1].cellWidth },
  };
  dateKeys.forEach((_, index) => {
    columnStyles[index + 2] = {
      cellWidth: dayWidth,
      // Узкая дневная колонка: широкие поля съедали место под «Т»/«Г».
      cellPadding: dayWidth < 9 ? 0.5 : 1.8,
    };
  });

  autoTable(doc, {
    startY: cleaningTitleY + 6,
    head: matrixHead,
    body: matrixRows,
    // D-аудит: строку помещения нельзя рвать между страницами — при
    // переносе она уезжает целиком на следующую страницу.
    rowPageBreak: "avoid",
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      // Узкие дневные колонки (месяц целиком) — мельче кегль, иначе
      // двузначное число дня переносилось по цифрам: «1» / «0».
      fontSize: dayWidth < 9 ? 7 : 8,
      cellPadding: 1.8,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: dayWidth < 9 ? 7 : 8,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    bodyStyles: {
      lineWidth: 0.2,
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      // Резерв под повтор штампа ХАССП на страницах 2..N.
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    columnStyles,
    // Заливка колонок выходных/праздников — как на экране и в печати.
    didParseCell: makeDayColumnTintHook(dateKeys, 2),
  });

  const afterMatrixY = (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 140;
  // Легенда — те же строки, что на экране: «/-/» вместо легаси-«/»
  // и КИРИЛЛИЧЕСКИЕ коды Т/Г (в config.legend они хранятся латиницей).
  const legendLines = (config.legend.length > 0 ? config.legend : [...CLEANING_LEGEND]).map(
    (line) => displayCleaningLegendLine(line)
  );
  const legendWidth = pageWidth - PDF_SHEET_MARGIN * 2;
  // Строки легенды печатаются курсивом 9 pt (renderWrappedTextBlock) —
  // считаем их так же; кегль подписей до легенды не трогаем.
  const legendFontSize = doc.getFontSize();
  doc.setFont("JournalUnicode", "italic");
  doc.setFontSize(9);
  const legendLineCount = legendLines.reduce(
    (count, line) => count + (doc.splitTextToSize(line, legendWidth) as string[]).length,
    0
  );
  doc.setFontSize(legendFontSize);
  // Цветовая легенда дней + «Условные обозначения» — одним блоком над
  // нижним полем листа (у длинной таблицы блок уходил за край листа).
  const dayLegendBaseline = placeTextBlock(doc, afterMatrixY + 6, 15 + Math.max(0, legendLineCount - 1) * 4.8);
  // Строка цветовой легенды дней — как `CleaningDayColorLegend` на экране.
  const dayLegendY = drawDayColorLegend(doc, PDF_SHEET_MARGIN, dayLegendBaseline);
  doc.setFont("JournalUnicode", "italic");
  const legendY = dayLegendY + 6;
  doc.text("Условные обозначения:", PDF_SHEET_MARGIN, legendY);
  const afterLegendY = renderWrappedTextBlock(
    doc,
    legendLines,
    PDF_SHEET_MARGIN,
    legendY + 5,
    legendWidth,
    4.8
  );
  doc.setFont("JournalUnicode", "normal");

  // C7: в rooms-mode справочник строится по выбранным Room, а не по
  // (теперь пустому) config.rooms.
  const referenceSource =
    isRoomsMode && params.roomDetailsById
      ? (config.selectedRoomIds ?? [])
          .map((roomId) => params.roomDetailsById?.[roomId])
          .filter(
            (item): item is {
              name: string;
              detergent: string;
              currentScope: string[];
              generalScope: string[];
            } => Boolean(item),
          )
      : config.rooms;
  const referenceRows: RowInput[] = referenceSource.map((room) => [
    {
      content: room.name,
      styles: { halign: "left" as const, valign: "middle" as const },
    },
    {
      content: room.currentScope.join(", "),
      styles: { halign: "left" as const, valign: "middle" as const },
    },
    {
      content: room.generalScope.join(", "),
      styles: { halign: "left" as const, valign: "middle" as const },
    },
  ]);

  // Минимум под шапку сводной + две строки: иначе начинаем с новой
  // страницы, чтобы внизу листа не висела строка-сирота.
  const SUMMARY_MIN_BLOCK = 24;
  let summaryStartY = afterLegendY + 6;
  if (summaryStartY + SUMMARY_MIN_BLOCK > contentBottom(doc)) {
    doc.addPage("a4", "landscape");
    summaryStartY = activePageHeaderHeight
      ? activePageHeaderHeight + HEADER_TITLE_GAP
      : PDF_SHEET_MARGIN;
  }

  autoTable(doc, {
    startY: summaryStartY,
    head: [[
      centerCell("Наименование помещения"),
      centerCell("Текущая уборка"),
      centerCell("Генеральная уборка"),
    ]],
    body: referenceRows.length > 0 ? referenceRows : [[centerCell("—"), centerCell("—"), centerCell("—")]],
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8,
      cellPadding: 1.8,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    bodyStyles: {
      lineWidth: 0.2,
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    // Сводную таблицу РАЗРЕШЕНО рвать между страницами (раньше
    // `pageBreak: "avoid"` выбрасывал её целиком на стр. 2, оставляя
    // полпустой первый лист). Сироты не будет: если до низа осталось
    // меньше, чем шапка + две строки, блок начинается с новой страницы
    // (см. summaryStartY ниже).
    rowPageBreak: "avoid",
    // Прежние пропорции 48 : 96 : 96 — на всю ширину между полями.
    columnStyles: fitColumnWidths(doc, [48, 96, 96]),
  });
}

/**
 * Колонки печати бракеражей — те же, что в таблице документа
 * (`resolveColumns`): скрытые не печатаются, переименованные печатаются под
 * своим названием. У печати свои короткие стандартные подписи — они
 * остаются, пока колонку не переименовали.
 */
function pdfColumns(code: string, config: unknown) {
  const byKey = new Map<string, ResolvedJournalColumn>(
    resolveColumns(code, config).map((column) => [column.key, column])
  );
  return {
    visible: (key: string) => byKey.get(key)?.hidden !== true,
    // Подпись колонки — как в таблице (стандартная из реестра или своя):
    // иначе новые названия формы Приложения 4 не доезжали бы до печати.
    label: (key: string, printDefault: string) => byKey.get(key)?.label ?? printDefault,
    /** Свои колонки организации — печатаются после колонок бланка. */
    custom: () =>
      [...byKey.values()].filter((column) => column.custom !== null && !column.hidden),
    /** Место колонки в порядке показа (для сортировки печатных колонок). */
    rank: (key: string) => {
      const index = [...byKey.keys()].indexOf(key);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    },
    /** Видимые колонки в порядке показа. */
    ordered: () => [...byKey.values()].filter((column) => !column.hidden),
  };
}

function drawFinishedProductPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeFinishedProductDocumentConfig>;
}) {
  drawTitle(doc, getFinishedProductDocumentTitle());
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  // Колонки — ровно как в таблице документа: видимые, в заданном порядке,
  // с подписями формы Приложения 4 (или своими). Текст ячейки — тот же, что
  // у карточки на телефоне (`finishedProductCellText`).
  const columns = pdfColumns("finished_product", params.config);
  const printColumns = columns.ordered();
  const headRow: RowInput = [centerCell("№"), ...printColumns.map((column) => centerCell(column.label))];
  const head: RowInput[] = [headRow];

  const body: RowInput[] = params.config.rows.map((row, index) => [
    centerCell(String(index + 1)),
    ...printColumns.map((column) => {
      const text = finishedProductCellText(row, column.key);
      return column.key === "name" || column.key === "corrective" || column.key === "note"
        ? { content: text, styles: { halign: "left" as const, valign: "middle" as const } }
        : centerCell(text);
    }),
  ]);

  autoTable(doc, {
    startY: afterHeader(metaBottom, 66),
    head,
    body: ensurePdfBodyRows(body, headRow.length),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.1,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    // F-аудит: пустая строка бланка должна быть ~22pt (≈7.8мм) высотой,
    // иначе в неё физически нечего вписать от руки.
    bodyStyles: { minCellHeight: 7.8 },
  });

  const tableEndY = (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 66;
  const hasFooterNote = Boolean(params.config.footerNote);
  const members = params.config.commissionMembers;
  const noteOffset = hasFooterNote ? 13 : 0;
  // Примечание и подписи комиссии — одним блоком над нижним полем листа
  // (у длинного журнала таблица доходит до низа, и блок уходил за край).
  let finishedFooterY = tableEndY;
  if (hasFooterNote || members.length > 0) {
    doc.setFontSize(9);
    // Длинный состав комиссии — с переносом: на этой странице хотя бы
    // примечание, заголовок и первая подпись.
    const firstMemberOffset = 8 + noteOffset + (noteOffset ? 8 : 0) + 6 + 1;
    const lastLineOffset = members.length > 0 ? firstMemberOffset + (members.length - 1) * 7 : 13;
    finishedFooterY =
      placeBlockStart(doc, tableEndY + 8, lastLineOffset - 8, (members.length > 0 ? firstMemberOffset : 13) - 8) - 8;
  }

  // «Примечание: …» под таблицей — как на эталоне (finished_product-grid.png).
  if (params.config.footerNote) {
    doc.setFont("JournalUnicode", "bold");
    doc.setFontSize(9);
    doc.text("Примечание:", PDF_SHEET_MARGIN, finishedFooterY + 8);
    doc.setFont("JournalUnicode", "normal");
    doc.text(params.config.footerNote, PDF_SHEET_MARGIN, finishedFooterY + 13);
  }

  // Состав бракеражной комиссии — подписи под таблицей. Печатаем, только
  // если состав задан: пустых линеек в бланке быть не должно.
  if (members.length > 0) {
    let signY = finishedFooterY + 8 + noteOffset + (noteOffset ? 8 : 0);
    doc.setFont("JournalUnicode", "bold");
    doc.setFontSize(9);
    doc.text("Состав бракеражной комиссии:", PDF_SHEET_MARGIN, signY);
    doc.setFont("JournalUnicode", "normal");
    signY += 6;
    for (const member of members) {
      signY = placeTextBlock(doc, signY, 1);
      doc.text(`${member.role}: ${member.employeeName}`, PDF_SHEET_MARGIN + 4, signY);
      doc.line(95, signY + 1, 140, signY + 1);
      signY += 7;
    }
  }

  // Заголовок-ссылку «Рекомендации по организации контроля…» в печати
  // не показываем: на экране это кликабельная ссылка на гайд, а на
  // бумаге оставалась висячая подчёркнутая строка без содержимого.
}

function drawEquipmentMaintenancePdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeEquipmentMaintenanceConfig>;
}) {
  drawTitle(doc, params.title || EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE);
  // Штамп ХАССП, как на экране: раньше здесь была своя строка
  // «Организация — Начат — Окончен» без названия журнала и без «СТР.».
  const maintenanceHeaderBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title || EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE,
    dateFrom: params.dateFrom,
    dateTo: resolveFinishedDate(params.dateTo),
    marginX: PDF_SHEET_MARGIN,
  });

  // Расшифровка «Тип» — на экране она отдельной строкой над таблицей,
  // без неё в печати буквы A/B в колонке «Тип» ничего не значат.
  const maintenanceLegendY = afterHeader(maintenanceHeaderBottom, 30);
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  doc.text(
    "Тип профилактического обслуживания:  A = Ежемесячно   B = Ежегодно",
    PDF_SHEET_MARGIN,
    maintenanceLegendY
  );

  autoTable(doc, {
    startY: maintenanceLegendY + 4,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head: [[
      "№",
      "Оборудование / вид работ",
      "Тип",
      ...EQUIPMENT_MAINTENANCE_MONTH_KEYS.map((key) => EQUIPMENT_MAINTENANCE_MONTH_LABELS[key]),
    ]],
    body:
      params.config.rows.flatMap((row, index) => [
        [
          String(index + 1),
          [row.equipmentName, row.workType].filter(Boolean).join("\n"),
          row.maintenanceType,
          ...EQUIPMENT_MAINTENANCE_MONTH_KEYS.map((key) => row.plan[key] || "-"),
        ],
        [
          "",
          "Факт",
          "",
          ...EQUIPMENT_MAINTENANCE_MONTH_KEYS.map((key) => row.fact[key] || ""),
        ],
      ]) || [],
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.1,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      valign: "middle",
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 68 },
      2: { cellWidth: 12, halign: "center" },
    },
  });

  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  // Строка «Ответственный» — над нижним полем листа (не за краем).
  const finalY = placeTextBlock(
    doc,
    (((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY) || 40) + 8,
    0
  );
  doc.text(
    `Ответственный: ${[params.config.responsibleRole, params.config.responsibleEmployee].filter(Boolean).join(", ")}`,
    PDF_SHEET_MARGIN,
    finalY
  );
}

function drawStaffTrainingPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeStaffTrainingConfig>;
}) {
  drawTitle(doc, params.title || STAFF_TRAINING_FULL_TITLE);
  // Штамп ХАССП, как на экране: раньше здесь была своя строка
  // «Организация — Начат — Окончен» без названия журнала и без «СТР.».
  const trainingHeaderBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title || STAFF_TRAINING_FULL_TITLE,
    dateFrom: params.dateFrom,
    dateTo: resolveFinishedDate(params.dateTo),
    marginX: PDF_SHEET_MARGIN,
  });

  autoTable(doc, {
    startY: afterHeader(trainingHeaderBottom, 30),
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    // Полные экранные формулировки граф: «Сотрудник» / «Вид» / «Причина»
    // не говорили инспектору, что именно в колонке.
    head: [[
      "Дата",
      "Ф.И.О. инструктируемого",
      "Профессия / должность инструктируемого",
      "Тема инструктажа (обучения)",
      "Вид инструктажа (первичный / повторный / внеплановый)",
      "Причина проведения внепланового инструктажа",
      "Ф.И.О. / должность инструктирующего",
      "Результат аттестации после обучения (удовл. / не удовл.)",
    ]],
    body: (params.config.rows.length > 0
      ? params.config.rows
      : [{ date: "", employeeName: "", employeePosition: "", topic: "", trainingType: "", unscheduledReason: "", instructorName: "", attestationResult: "" }]
    ).map((row) => {
      const trainingTypeMap: Record<string, string> = {
        primary: "Первичный",
        repeated: "Повторный",
        repeat: "Повторный",
        unscheduled: "Внеплановый",
      };
      const topicMap: Record<string, string> = {
        safety: "Охрана труда",
        duties: "Должностные обязанности",
        kkt: "ККТ",
        sanitation: "Санитария и гигиена",
        fire: "Пожарная безопасность",
      };
      const trainingType = row.trainingType
        ? (trainingTypeMap[row.trainingType] || row.trainingType)
        : "";
      const topic = row.topic ? (topicMap[row.topic] || row.topic) : "";
      return [
        row.date || "",
        row.employeeName || "",
        row.employeePosition || "",
        topic,
        trainingType,
        row.unscheduledReason || "",
        row.instructorName || "",
        row.attestationResult === "passed" ? "удовл." : row.attestationResult === "failed" ? "не удовл." : "",
      ];
    }),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.2,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      valign: "middle",
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      // Мелкий кегль шапки — полные формулировки граф ломаются по словам.
      fontSize: 7, // было 6,4: у шрифта с засечками строчные ниже (2026-09-28)
      halign: "center",
      valign: "middle",
    },
    // Прежние пропорции на всю ширину между полями — край в край со штампом
    // (сумма 262 мм была на 15 мм уже шапки).
    columnStyles: (() => {
      const widths = fitColumnWidths(doc, [22, 38, 34, 38, 24, 48, 36, 22]);
      return { ...widths, 7: { ...widths[7], halign: "center" as const } };
    })(),
  });
}

type TrackedField = {
  key: string;
  label: string;
  type: string;
  options: { value: string; label: string }[];
};

function getTrackedFields(fields: unknown): TrackedField[] {
  if (!Array.isArray(fields)) return [];

  return fields
    .map((field) => {
      const item = field as Record<string, unknown>;
      return {
        key: typeof item.key === "string" ? item.key : "",
        label: typeof item.label === "string" ? item.label : "",
        type: typeof item.type === "string" ? item.type : "text",
        options: Array.isArray(item.options)
          ? (item.options as Array<Record<string, unknown>>)
              .map((option) => ({
                value: typeof option.value === "string" ? option.value : "",
                label: typeof option.label === "string" ? option.label : "",
              }))
              .filter((option) => option.value !== "")
          : [],
      };
    })
    .filter((field) => field.key !== "");
}

function getTrackedFieldValue(
  field: TrackedField,
  value: unknown,
  resolvers?: {
    users?: { id: string; name: string }[];
    equipment?: { id: string; name: string }[];
  }
) {
  if (value == null || value === "") return "";
  if (field.type === "boolean") {
    return value === true || value === "true" || value === "yes" ? "Да" : "Нет";
  }

  if (field.type === "select") {
    const stringValue = String(value);
    return field.options.find((option) => option.value === stringValue)?.label || stringValue;
  }

  if (field.type === "employee") {
    const id = String(value);
    return resolvers?.users?.find((u) => u.id === id)?.name || id;
  }

  if (field.type === "equipment") {
    const id = String(value);
    return resolvers?.equipment?.find((e) => e.id === id)?.name || id;
  }

  if (field.type === "date") {
    const s = String(value);
    const [y, m, d] = s.slice(0, 10).split("-");
    return y && m && d ? `${d}-${m}-${y}` : s;
  }

  return String(value);
}

function getRegisterFieldValue(
  field: RegisterField,
  value: string,
  users: { id: string; name: string; role: string }[],
  equipment: { id: string; name: string }[]
) {
  if (!value) return "";

  if (field.type === "employee") {
    return users.find((user) => user.id === value)?.name || value;
  }

  if (field.type === "equipment") {
    return equipment.find((item) => item.id === value)?.name || value;
  }

  if (field.type === "select") {
    return field.options.find((option) => option.value === value)?.label || value;
  }

  // Дата хранится как `ГГГГ-ММ-ДД`; экран (formatComplaintDate) печатает
  // ДД-ММ-ГГГГ, а PDF отдавал сырой ISO — инспектор видел разные даты.
  if (field.type === "date") {
    return formatPdfDate(value) || value;
  }

  return value;
}

function isRegisterFieldVisible(
  field: RegisterField,
  values: Record<string, string>
) {
  if (!field.showIf) return true;
  return values[field.showIf.field] === field.showIf.equals;
}

function getTrackedFilePrefix(templateCode: string) {
  return `journal-${templateCode.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
}

function formatAcceptanceDateRu(dateKey: string) {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-");
  if (!y || !m || !d) return dateKey;
  return `${d}-${m}-${y}`;
}

function formatTraceabilityDateRu(dateKey: string) {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-");
  if (!y || !m || !d) return dateKey;
  return `${d}-${m}-${y}`;
}

/**
 * PDF журнала ПРИЁМКИ И ВХОДНОГО КОНТРОЛЯ ПРОДУКЦИИ (`incoming_control`) —
 * 11 колонок эталона, тот же состав, что на экране.
 */
function drawIncomingControlPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  config: ReturnType<typeof normalizeAcceptanceDocumentConfig>;
  users: PdfPositionUser[];
}) {
  const cfg = params.config;
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  // В шапке — название журнала, как на экране: раньше сюда попадало
  // название документа («ПРОВЕРКА INCOMING_CONTROL»).
  const journalLabel = journalNameOr(
    params.title || PRODUCT_ACCEPTANCE_DOCUMENT_TITLE
  ).toUpperCase();

  drawTitle(doc, params.title || PRODUCT_ACCEPTANCE_DOCUMENT_TITLE);
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel,
    withPeriodicity: false,
    // «Начат / Окончен» теперь внутри шапки — отдельный блок на
    // фиксированных 54/60мм перекрывался строкой периодичности.
    startedDate: params.dateFrom,
    finishedDate: null,
  });

  const acceptanceTitleY = afterHeader(headerBottom, 62);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  doc.text(journalLabel, centerX, acceptanceTitleY, { align: "center" });

  // Опциональная 12-я колонка «Соответствие внешнего вида упаковки…»
  // (config.showPackagingCompliance, I1 аудита) — та же функция колонок,
  // что и на экране, поэтому печать и таблица не расходятся.
  const incomingControlColumns = getIncomingControlColumns(
    cfg.showPackagingCompliance
  );
  // G-аудит: «Принять/Отклонить» в узкой колонке ломалось внутри слова
  // («От-клонить»). Ставим пробелы вокруг «/» — splitTextToSize рвёт по
  // пробелу, слова остаются целыми. Сам общий лейбл не трогаем (его
  // использует экран).
  const head: RowInput[] = [
    incomingControlColumns.map((column) => centerCell(softenSlashBreaks(column))),
  ];

  const userMap = new Map(params.users.map((u) => [u.id, u.name]));
  const body: RowInput[] = cfg.rows.map((row) => {
    const values = getIncomingControlRowValues(row);
    return [
      centerCell(values.deliveryDate),
      centerCell(values.productName),
      centerCell(values.shelfLifeDate),
      centerCell(values.manufacturerSupplier),
      centerCell(values.accompanyingDocs),
      centerCell(values.batchInfo),
      centerCell(values.productTemperature),
      centerCell(values.documentCompliance),
      ...(cfg.showPackagingCompliance
        ? [centerCell(COMPLIANCE_LABELS[row.packagingCompliance])]
        : []),
      centerCell(values.acceptanceDecision),
      centerCell(values.correctiveActions),
      centerCell(userMap.get(row.responsibleUserId) || ""),
    ] as CellDef[];
  });

  autoTable(doc, {
    startY: acceptanceTitleY + 8,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head,
    body: ensurePdfBodyRows(body, incomingControlColumns.length),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7, // было 6: у шрифта с засечками строчные ниже (2026-09-28)
      cellPadding: 1,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      fontStyle: "bold",
      fontSize: 6.5, // было 5,5: у шрифта с засечками строчные ниже (2026-09-28)
    },
    bodyStyles: { lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 20 },
      2: { cellWidth: 20 },
      8: { cellWidth: 14 },
    },
  });
}

function drawAcceptancePdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  config: ReturnType<typeof normalizeAcceptanceDocumentConfig>;
  users: PdfPositionUser[];
}) {
  const cfg = params.config;
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;

  drawTitle(doc, params.title || getAcceptanceDocumentTitle(ACCEPTANCE_DOCUMENT_TEMPLATE_CODE));
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: journalNameOr(
      params.title || "Журнал приемки и входного контроля продукции"
    ).toUpperCase(),
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
  });

  const acceptanceTitleY = afterHeader(headerBottom, 62);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  doc.text((params.title || "Журнал приемки и входного контроля продукции").toUpperCase(), centerX, acceptanceTitleY, { align: "center" });

  const headRow1: CellDef[] = [
    { content: "Дата, время\nпоступления\nпродукции,\nтовара", styles: { halign: "center", valign: "middle" } },
    { content: "Наименование\nпродукции", styles: { halign: "center", valign: "middle" } },
    { content: "Производитель/\nпоставщик", styles: { halign: "center", valign: "middle" } },
    { content: "Условия\nтранспорти\nровки", styles: { halign: "center", valign: "middle" } },
    { content: "Соответствие\nупаковки,\nмаркировки,\nтоваросопроводи\nтельной\nдокументации", styles: { halign: "center", valign: "middle" } },
    { content: "Результаты\nорганолепти\nческой\nоценки\nдоброка\nчественности", styles: { halign: "center", valign: "middle" } },
    { content: "Предельный\nсрок\nреализации\n(дата, час)", styles: { halign: "center", valign: "middle" } },
    { content: "Примечания", styles: { halign: "center", valign: "middle" } },
    { content: "Ответственный", styles: { halign: "center", valign: "middle" } },
  ];

  const head: RowInput[] = [headRow1];

  const userMap = new Map(params.users.map((u) => [u.id, u.name]));

  const rows = cfg.rows;

  const body: RowInput[] = rows.map((row) => {
    const deliveryDateStr = formatAcceptanceDateRu((row as Record<string, string>).deliveryDate || (row as Record<string, string>).dateSupply || "");
    const deliveryTime = (row as Record<string, string>).deliveryHour ? `\n${(row as Record<string, string>).deliveryHour}:${(row as Record<string, string>).deliveryMinute || "00"}` : "";
    const expiryDateStr = formatAcceptanceDateRu(row.expiryDate || "");
    const expiryTime = (row as Record<string, string>).expiryHour ? `\n${(row as Record<string, string>).expiryHour}:${(row as Record<string, string>).expiryMinute || "00"}` : "";

    const transport = (row as Record<string, string>).transportCondition === "unsatisfactory" ? "Не удовл." : "Удовл.";
    const packaging = ((row as Record<string, string>).packagingCompliance === "non_compliant" || (row as Record<string, string>).packagingCompliance === "no") ? "Не соотв." : "Соответствует";
    const organoleptic = ((row as Record<string, string>).organolepticResult === "unsatisfactory" || (row as Record<string, string>).decision === "reject") ? "Не удовл." : "Удовл.";

    const cells: CellDef[] = [
      centerCell(deliveryDateStr + deliveryTime),
      centerCell(row.productName),
      centerCell([row.manufacturer, row.supplier].filter(Boolean).join(" / ")),
      centerCell(transport),
      centerCell(packaging),
      centerCell(organoleptic),
      centerCell(expiryDateStr + expiryTime),
      centerCell((row as Record<string, string>).note || (row as Record<string, string>).correctiveAction || ""),
      centerCell(userMap.get(row.responsibleUserId) || ""),
    ];

    return cells;
  });

  if (body.length === 0) {
    for (let i = 0; i < 3; i++) {
      body.push(Array(9).fill(centerCell("")));
    }
  }

  const baseColCount = 9;
  const monthColWidth = (pageWidth - PDF_SHEET_MARGIN * 2) / baseColCount;

  autoTable(doc, {
    startY: acceptanceTitleY + 8,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head,
    body: ensurePdfBodyRows(body, 9),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7, // было 6,5: у шрифта с засечками строчные ниже (2026-09-28)
      cellPadding: 1,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      fontStyle: "bold",
      fontSize: 6.5, // было 6: у шрифта с засечками строчные ниже (2026-09-28)
    },
    bodyStyles: {
      lineWidth: 0.2,
    },
  });
}

function drawPpeIssuancePdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  config: ReturnType<typeof normalizePpeIssuanceConfig>;
  users: PdfPositionUser[];
}) {
  const cfg = params.config;
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  const dateFromStr =
    params.dateFrom instanceof Date
      ? formatPpeIssuanceDate(params.dateFrom.toISOString().slice(0, 10))
      : formatPpeIssuanceDate(String(params.dateFrom).slice(0, 10));

  drawTitle(doc, params.title || PPE_ISSUANCE_DOCUMENT_TITLE);
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ЖУРНАЛ УЧЕТА ВЫДАЧИ СИЗ",
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
  });

  const ppeTitleY = afterHeader(headerBottom, 62);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  doc.text("ЖУРНАЛ УЧЕТА ВЫДАЧИ СИЗ", centerX, ppeTitleY, { align: "center" });

  const head: RowInput[] = [[
    { content: "Дата выдачи СИЗ", styles: { halign: "center" as const, valign: "middle" as const } },
    { content: "Количество масок, выданных на 1 рабочую неделю", styles: { halign: "center" as const, valign: "middle" as const } },
    ...(cfg.showGloves ? [{ content: "Количество пар перчаток, выданных на 1 рабочую неделю", styles: { halign: "center" as const, valign: "middle" as const } }] : []),
    ...(cfg.showShoes ? [{ content: "Количество пар обуви, выданных на 1 рабочую неделю", styles: { halign: "center" as const, valign: "middle" as const } }] : []),
    ...(cfg.showClothing ? [{ content: "Количество комплектов одежды, выданных на 1 рабочую неделю", styles: { halign: "center" as const, valign: "middle" as const } }] : []),
    ...(cfg.showCaps ? [{ content: "Количество шапочек, выданных на 1 рабочую неделю", styles: { halign: "center" as const, valign: "middle" as const } }] : []),
    { content: "Должность и ФИО лица, получившего СИЗ", styles: { halign: "center" as const, valign: "middle" as const } },
    { content: "ФИО лица, выдавшего СИЗ", styles: { halign: "center" as const, valign: "middle" as const } },
  ]];

  const body: RowInput[] = cfg.rows.map((row) => [
    centerCell(formatPpeIssuanceDate(row.issueDate)),
    centerCell(String(row.maskCount || "")),
    ...(cfg.showGloves ? [centerCell(String(row.gloveCount || ""))] : []),
    ...(cfg.showShoes ? [centerCell(String(row.shoePairsCount || ""))] : []),
    ...(cfg.showClothing ? [centerCell(String(row.clothingSetsCount || ""))] : []),
    ...(cfg.showCaps ? [centerCell(String(row.capCount || ""))] : []),
    centerCell(getPpeIssuanceRecipientLabel(row, params.users)),
    centerCell(getPpeIssuanceIssuerLabel(row, params.users)),
  ]);

  if (body.length === 0) {
    for (let i = 0; i < 3; i++) {
      body.push(Array(head[0].length).fill(centerCell("")));
    }
  }

  autoTable(doc, {
    startY: ppeTitleY + 8,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head,
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7, // было 6,5: у шрифта с засечками строчные ниже (2026-09-28)
      cellPadding: 1,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      fontStyle: "bold",
      fontSize: 6.5, // было 6: у шрифта с засечками строчные ниже (2026-09-28)
    },
    bodyStyles: {
      lineWidth: 0.2,
    },
  });
}

function drawProductWriteoffPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date;
  config: ReturnType<typeof normalizeProductWriteoffConfig>;
}) {
  drawTitle(doc, params.title);
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    // В шапке — название ЖУРНАЛА, а не документа: раньше сюда уезжало
    // «АКТ ЗАБРАКОВКИ №5» / имя документа заглавными.
    journalLabel: journalNameOr(
      params.config.documentName || params.title || PRODUCT_WRITEOFF_DOCUMENT_TITLE
    ),
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
  });

  const writeoffTitleY = afterHeader(headerBottom, 72);
  const dateLabel = formatProductWriteoffDateLong(params.config.documentDate || params.dateFrom);
  const pageWidth = doc.internal.pageSize.getWidth();
  // Текст акта — между полями листа, как шапка и таблица; «АКТ» — по центру
  // листа (раньше x = 105 — середина КНИЖНОГО листа, а бланк альбомный,
  // и текст стоял с отступом 24 мм шириной 160 мм).
  const textLeft = PDF_SHEET_MARGIN;
  const textWidth = pageWidth - PDF_SHEET_MARGIN * 2;
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(16);
  doc.text("АКТ", pageWidth / 2, writeoffTitleY, { align: "center" });
  doc.text(`№ ${params.config.actNumber || "1"} от ${dateLabel}`, pageWidth / 2, writeoffTitleY + 8, { align: "center" });

  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(11);
  let cursorY = writeoffTitleY + 20;
  doc.text("Комиссия в составе:", textLeft, cursorY);
  cursorY += 7;
  if (params.config.commissionMembers.length === 0) {
    doc.text("________________", textLeft + 6, cursorY);
    cursorY += 7;
  } else {
    params.config.commissionMembers.forEach((member) => {
      doc.text(`${member.role} ${member.employeeName}`, textLeft + 6, cursorY);
      cursorY += 6;
    });
  }

  const introLines = doc.splitTextToSize(
    `Составила настоящий АКТ о том, что ${dateLabel} на предприятии выявлены ТМЦ с несоответствиями по качеству и (или) безопасности согласно списку ниже.`,
    textWidth
  ) as string[];
  cursorY += 4;
  introLines.forEach((line) => {
    doc.text(line, textLeft, cursorY);
    cursorY += 5;
  });

  const supplierLines = doc.splitTextToSize(
    `Указанные ТМЦ были выработаны ${params.config.supplierName || "________________"} и поставлены...`,
    textWidth
  ) as string[];
  supplierLines.forEach((line) => {
    doc.text(line, textLeft, cursorY);
    cursorY += 5;
  });

  cursorY += 3;
  doc.text("Комиссия постановила выполнить в отношении выявленных ТМЦ следующие действия:", textLeft, cursorY);

  autoTable(doc, {
    startY: cursorY + 5,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 9,
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      valign: "middle",
      textColor: [0, 0, 0],
    },
    headStyles: {
      font: "JournalUnicode",
      fontStyle: "bold",
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      halign: "center",
    },
    head: [[
      "№ п/п",
      "Наименование ТМЦ",
      "№ партии, дата выработки",
      "Количество (кг, шт)",
      "Описание несоответствия",
      "Действия с ТМЦ",
    ]],
    body: (
      params.config.rows.length > 0
        ? params.config.rows
        : Array.from({ length: 3 }, () => ({
            productName: "",
            batchNumber: "",
            productionDate: "",
            quantity: "",
            discrepancyDescription: "",
            action: "",
          }))
    ).map((row, index) => [
      String(index + 1),
      row.productName,
      [row.batchNumber, row.productionDate].filter(Boolean).join("\n"),
      row.quantity,
      row.discrepancyDescription,
      row.action,
    ]),
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    // Прежние пропорции на всю ширину между полями — край в край со штампом
    // (таблица 180 мм стояла от 24 мм, правее оставалось 93 мм пустоты).
    columnStyles: (() => {
      const widths = fitColumnWidths(doc, [12, 34, 30, 24, 40, 40]);
      const center = (index: number) => ({ ...widths[index], halign: "center" as const });
      return { ...widths, 0: center(0), 2: center(2), 3: center(3), 4: center(4), 5: center(5) };
    })(),
  });

  const signers = params.config.commissionMembers.length > 0 ? params.config.commissionMembers : [{ employeeName: "" }];
  // Подписи комиссии — над нижним полем листа: блоком, если помещается,
  // иначе заголовок с первой подписью, остальные — с переносом.
  const finalY = placeBlockStart(
    doc,
    ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || cursorY) + 14,
    8 + (signers.length - 1) * 8 + 1,
    8 + 1
  );
  doc.text("Подписи членов комиссии:", textLeft, finalY);
  let signY = finalY + 8;
  signers.forEach((member) => {
    signY = placeTextBlock(doc, signY, 1);
    doc.text(member.employeeName || "________________", textLeft + 6, signY);
    doc.line(textLeft + 38, signY + 1, textLeft + 88, signY + 1);
    signY += 8;
  });
}

function drawPerishableRejectionPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date;
  config: ReturnType<typeof normalizePerishableRejectionConfig>;
}) {
  drawTitle(doc, params.title);
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    // В шапке — название журнала, как на экране (раньше уезжало
    // название документа, напр. «E2E КОЛОНКИ СКОРОПОРТ»).
    journalLabel: journalNameOr(params.title),
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
  });

  // «Начат» уехал в шапку — под ней сразу заголовок журнала, как на экране.
  const perishableTitleY = afterHeader(headerBottom, 64);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  doc.text(params.title.toUpperCase(), doc.internal.pageSize.getWidth() / 2, perishableTitleY, {
    align: "center",
  });
  doc.setFont("JournalUnicode", "normal");

  // Пустой бланк: экран показывает РОВНО одну пустую строку и не
  // подставляет дефолты «Соответствует» / «от +2 до +6» — печать
  // повторяет это, иначе инспектор видит «оценку» там, где записи нет.
  const isBlankForm = params.config.rows.length === 0;
  const rows: PerishableRejectionRow[] = isBlankForm
    ? [
        {
          id: "",
          arrivalDate: "",
          arrivalTime: "",
          productName: "",
          productionDate: "",
          manufacturer: "",
          supplier: "",
          packaging: "",
          quantity: "",
          documentNumber: "",
          organolepticResult: "" as unknown as "compliant",
          storageCondition: "" as unknown as "2_6",
          expiryDate: "",
          expiryTime: "",
          actualSaleDate: "",
          actualSaleTime: "",
          responsiblePerson: "",
          note: "",
        },
      ]
    : params.config.rows;

  // Графы — ровно как в таблице документа (`perishablePrintColumns`: форма
  // приложения № 5 СанПиН или свой набор организации; свои колонки — на
  // своих местах, как на экране). Текст ячейки — тот же, что на экране и в
  // карточке (`perishableCellText`). Ширины подгоняются под лист: раньше
  // сумма фиксированных ширин была 295 мм при 277 мм листа, и правая графа
  // («Подпись бракеражной комиссии», которой у скоропорта нет) уходила за
  // край. `softenSlashBreaks` разбивает «А/Б» в своих подписях на
  // переносимые слова — иначе autoTable рвал длинный токен посимвольно.
  const printColumns = perishablePrintColumns(params.config);
  const perishableMarginX = PDF_SHEET_MARGIN;
  const perishableWidths = fitColumnWidths(
    doc,
    printColumns.map((column) => column.width),
    perishableMarginX
  );
  const perishableHeadPadding = 1;
  const perishableHeads = printColumns.map((column) => softenSlashBreaks(column.head));
  // Кегль шапки — самый крупный (до 7 pt; не мельче 6,2 — у шрифта с засечками
  // строчные ниже), при котором каждое слово шапки
  // помещается в свою графу: слова вроде «продовольственного» не рвутся
  // («ветеринарно-санитарной» переносится после дефиса, см. ниже).
  const perishableHeadFontSize = fitHeadFontSize(
    doc,
    perishableHeads.map((text, index) => ({
      text,
      width: (perishableWidths[index]?.cellWidth ?? 0) - perishableHeadPadding * 2,
    })),
    { max: 7, min: 6.2 }
  );

  autoTable(doc, {
    startY: perishableTitleY + 8,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: { top: 1.2, bottom: 1.2, left: 1, right: 1 },
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      valign: "middle",
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      font: "JournalUnicode",
      fontStyle: "bold",
      fontSize: perishableHeadFontSize,
      cellPadding: perishableHeadPadding,
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      halign: "center",
      valign: "middle",
    },
    margin: { left: perishableMarginX, right: perishableMarginX },
    // Колонки «№» нет ни на экране, ни в печати браузера.
    head: [perishableHeads],
    body: rows.map((row) =>
      printColumns.map((column) => perishableCellText(row, column.key, { joiner: "\n" }))
    ),
    columnStyles: Object.fromEntries(
      printColumns.map((column, index) => [
        index,
        { cellWidth: perishableWidths[index]?.cellWidth, halign: column.halign },
      ])
    ),
    // Ширина — из подогнанных ширин графы: у ячеек шапки `columnStyles` не
    // применяются, и `styles.cellWidth` там «auto».
    didParseCell: (data) => breakWideHyphenatedWords(doc, data, perishableWidths[data.column.index]?.cellWidth ?? 0),
  });

  // Подписи прежней бракеражной комиссии (у скоропорта её больше нет, графы
  // в форме приложения № 5 для них нет) — отдельным блоком под таблицей,
  // чтобы подписанные ранее записи не потеряли подписи в печати.
  const legacySignatures = perishableLegacySignatureLines(params.config.rows);
  if (legacySignatures.length > 0) {
    const tableEnd =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? perishableTitleY + 8;
    autoTable(doc, {
      startY: tableEnd + 5,
      theme: "plain",
      // Заголовок блока не остаётся один внизу листа: не помещается весь
      // блок — он целиком переходит на следующий лист.
      pageBreak: "avoid",
      margin: { left: perishableMarginX, right: perishableMarginX },
      styles: {
        font: "JournalUnicode",
        fontSize: 7,
        cellPadding: 0.8,
        textColor: [0, 0, 0],
        overflow: "linebreak",
      },
      headStyles: {
        font: "JournalUnicode",
        fontStyle: "bold",
        fontSize: 7.5,
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
      },
      head: [[PERISHABLE_LEGACY_SIGNATURES_TITLE]],
      body: legacySignatures.map((line) => [line]),
    });
  }
}

/**
 * Кусочки слова, между которыми можно перенести строку: после дефиса
 * («ветеринарно-» + «санитарной»). Слово без дефиса — один кусок.
 */
function hyphenParts(word: string): string[] {
  return word.split(/(?<=[^\s-]-)(?=[^\s-])/);
}

/**
 * Кегль шапки таблицы, при котором самое длинное слово каждой графы
 * помещается в её ширину (`width` — без полей ячейки, мм). autoTable иначе
 * рвёт не влезающее слово посимвольно («орган|олептической»). Слово с
 * дефисом должно поместиться кусками: перенос после дефиса даёт
 * `breakWideHyphenatedWords`.
 */
function fitHeadFontSize(
  doc: jsPDF,
  cells: Array<{ text: string; width: number }>,
  range: { max: number; min: number }
): number {
  doc.setFont("JournalUnicode", "bold");
  const scale = doc.internal.scaleFactor;
  for (let size = range.max; size >= range.min - 1e-6; size = Math.round((size - 0.2) * 10) / 10) {
    const fits = cells.every(({ text, width }) =>
      text
        .split(/\s+/)
        .flatMap(hyphenParts)
        .every((part) => !part || (doc.getStringUnitWidth(part) * size) / scale <= width - 0.2)
    );
    if (fits) return size;
  }
  return range.min;
}

/**
 * Слово шире графы autoTable рвёт посимвольно («Поставк|а-Юг»). Если в таком
 * слове есть дефис — даём перенос после дефиса. Пробел ставим только в
 * слова, которые в графу целиком всё равно не помещаются, поэтому лишнего
 * пробела в строке не бывает: строка всё равно перенесётся именно там.
 */
function breakWideHyphenatedWords(doc: jsPDF, data: CellHookData, width: number) {
  const styles = data.cell.styles;
  if (width <= 0) return;
  const available = width - data.cell.padding("horizontal") - 0.2;
  doc.setFont(styles.font, styles.fontStyle);
  const measure = (text: string) => (doc.getStringUnitWidth(text) * styles.fontSize) / doc.internal.scaleFactor;
  const lines = Array.isArray(data.cell.text) ? data.cell.text : [String(data.cell.text ?? "")];
  data.cell.text = lines.map((line) =>
    line
      .split(" ")
      .map((word) => (word.includes("-") && measure(word) > available ? hyphenParts(word).join(" ") : word))
      .join(" ")
  );
}

function drawGlassListPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date;
  config: ReturnType<typeof normalizeGlassListConfig>;
  responsibleName: string;
}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const config = params.config;
  const documentDate = config.documentDate || params.dateFrom.toISOString().slice(0, 10);

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(22);
  drawSheetTitleLine(doc, params.title || "Перечень изделий");

  // Общая шапка ХАССП — той же ширины, что таблица перечня (между полями
  // листа; раньше поля перечня были 42 мм).
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ПЕРЕЧЕНЬ ИЗДЕЛИЙ ИЗ СТЕКЛА И ХРУПКОГО ПЛАСТИКА",
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
  });
  // Блок «УТВЕРЖДАЮ» и таблица сдвигаются вниз, если шапка выросла.
  // Прежний зазор: рамка шапки (низ 56 мм) → «УТВЕРЖДАЮ» (72 мм) = 16 мм.
  const approveY = Math.max(legacyY(72), headerBottom + 16);
  const approveRight = pageWidth - PDF_SHEET_MARGIN;

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  doc.text("УТВЕРЖДАЮ", approveRight, approveY, { align: "right" });
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(11);
  doc.text(config.responsibleTitle || "Управляющий", approveRight, approveY + 8, { align: "right" });
  doc.text(`____________________ ${params.responsibleName}`, approveRight, approveY + 16, { align: "right" });
  doc.text(`«${formatGlassListDateLong(documentDate)}» г.`, approveRight, approveY + 24, { align: "right" });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text(
    "ПЕРЕЧЕНЬ ИЗДЕЛИЙ ИЗ СТЕКЛА И ХРУПКОГО ПЛАСТИКА",
    pageWidth / 2,
    approveY + 34,
    { align: "center" }
  );

  autoTable(doc, {
    startY: approveY + 42,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head: [[
      "",
      "Место расположения\n(участок)",
      "Наименование объекта контроля (предмета)",
      "Кол-во",
    ]],
    body: (config.rows.length > 0 ? config.rows : Array.from({ length: 3 }, (_, index) => ({ id: `empty-${index}`, location: "", itemName: "", quantity: "" }))).map(
      (row) => ["", row.location || config.location || "", row.itemName || "", row.quantity || ""]
    ),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 10,
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [239, 239, 239],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      halign: "center",
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    // Прежние пропорции 8 : 34 : 94 : 18 — на всю ширину между полями.
    columnStyles: Object.fromEntries(
      Object.entries(fitColumnWidths(doc, [8, 34, 94, 18])).map(([index, style]) => [
        index,
        { ...style, halign: "center" as const },
      ])
    ),
  });
}

function formatBreakdownDateRu(dateKey: string) {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-");
  if (!y || !m || !d) return dateKey;
  return `${d}-${m}-${y}`;
}

function formatAccidentDateTime(date: string, hour: string, minute: string) {
  return `${formatBreakdownDateRu(date)}\n${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function drawBreakdownHistoryPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  config: ReturnType<typeof normalizeBreakdownHistoryDocumentConfig>;
}) {
  const cfg = params.config;
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;

  drawTitle(doc, params.title || BREAKDOWN_HISTORY_HEADING);

  // Общая шапка ХАССП — той же ширины, что таблица (между полями листа).
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "КАРТОЧКА ИСТОРИИ ПОЛОМОК",
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
  });
  const breakdownTitleY = afterHeader(headerBottom, 0) + 6;

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  doc.text("КАРТОЧКА ИСТОРИИ ПОЛОМОК", centerX, breakdownTitleY, { align: "center" });

  const head: RowInput[] = [[
    { content: "Дата и\nвремя\nначала\nработ", styles: { halign: "center", valign: "middle" } },
    { content: "Наименование\nоборудования", styles: { halign: "center", valign: "middle" } },
    { content: "Описание поломки", styles: { halign: "center", valign: "middle" } },
    { content: "Выполненный ремонт", styles: { halign: "center", valign: "middle" } },
    { content: "Замена частей (если\nпроизведена)", styles: { halign: "center", valign: "middle" } },
    { content: "Дата и\nвремя\nокончания\nработ", styles: { halign: "center", valign: "middle" } },
    { content: "Часы\nпрост\nоя", styles: { halign: "center", valign: "middle" } },
    { content: "ФИО лица отв\nетственного\nза ремонт", styles: { halign: "center", valign: "middle" } },
  ]];

  const body: RowInput[] = cfg.rows.map((row) => {
    const startTime = row.startHour && row.startMinute ? `${row.startHour}:${row.startMinute}` : "";
    const endTime = row.endHour && row.endMinute ? `${row.endHour}:${row.endMinute}` : "";
    return [
      centerCell(`${formatBreakdownDateRu(row.startDate)}\n${startTime}`),
      centerCell(row.equipmentName),
      centerCell(row.breakdownDescription),
      centerCell(row.repairPerformed),
      centerCell(row.partsReplaced),
      centerCell(`${formatBreakdownDateRu(row.endDate)}\n${endTime}`),
      centerCell(row.downtimeHours),
      centerCell(row.responsiblePerson),
    ];
  });

  if (body.length === 0) {
    for (let i = 0; i < 3; i++) body.push(Array(8).fill(centerCell("")));
  }

  autoTable(doc, {
    startY: breakdownTitleY + 6,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head,
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      fontStyle: "bold",
    },
    bodyStyles: { lineWidth: 0.2 },
  });
}

function drawAccidentPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  config: ReturnType<typeof normalizeAccidentDocumentConfig>;
}) {
  const cfg = params.config;
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;

  drawTitle(doc, params.title || ACCIDENT_DOCUMENT_HEADING);

  // Общая шапка ХАССП — той же ширины, что таблица (поля 10 мм).
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ЖУРНАЛ УЧЕТА АВАРИЙ",
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
    marginX: PDF_SHEET_MARGIN,
  });
  const accidentTitleY = afterHeader(headerBottom, 0) + 6;

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  doc.text("ЖУРНАЛ УЧЕТА АВАРИЙ", centerX, accidentTitleY, { align: "center" });

  const head: RowInput[] = [[
    { content: "", styles: { halign: "center", valign: "middle" } },
    { content: "№ п/п", styles: { halign: "center", valign: "middle" } },
    { content: "Дата и время аварии", styles: { halign: "center", valign: "middle" } },
    { content: "Наименование помещения, в котором зафиксирована авария", styles: { halign: "center", valign: "middle" } },
    { content: "Описание аварии (причины, возникновения, предпринятые действия для ликвидации аварии и т.д.)", styles: { halign: "center", valign: "middle" } },
    { content: "Наличие «потенциально небезопасной» пищевой продукции, предпринятые действия с продукцией", styles: { halign: "center", valign: "middle" } },
    { content: "Дата и время ликвидации аварии, допуск к работе", styles: { halign: "center", valign: "middle" } },
    { content: "ФИО лиц, ответственных за ликвидацию аварии и ее последствий", styles: { halign: "center", valign: "middle" } },
    { content: "Мероприятия (корректирующие действия), предпринятые комиссией для исключения возникновения аварии", styles: { halign: "center", valign: "middle" } },
  ]];

  const body: RowInput[] = cfg.rows.map((row, index) => [
    centerCell(""),
    centerCell(String(index + 1)),
    centerCell(formatAccidentDateTime(row.accidentDate, row.accidentHour, row.accidentMinute)),
    centerCell(row.locationName),
    centerCell(row.accidentDescription),
    centerCell(row.affectedProducts),
    centerCell(formatAccidentDateTime(row.resolvedDate, row.resolvedHour, row.resolvedMinute)),
    centerCell(row.responsiblePeople),
    centerCell(row.correctiveActions),
  ]);

  if (body.length === 0) {
    body.push(Array(9).fill(centerCell("")));
  } else {
    body.push([centerCell(""), ...Array(8).fill(centerCell(""))]);
  }

  autoTable(doc, {
    startY: accidentTitleY + 6,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head,
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      fontStyle: "bold",
    },
    bodyStyles: { lineWidth: 0.2 },
    // Пропорции столбцов — прежние, но в сумме на всю ширину листа:
    // таблица совпадает по краям со штампом ХАССП.
    columnStyles: fitColumnWidths(doc, [8, 14, 24, 30, 44, 38, 28, 30, 42], PDF_SHEET_MARGIN),
  });
}

function drawEquipmentCalibrationPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  config: ReturnType<typeof normalizeEquipmentCalibrationConfig>;
  /** Ростер организации: должность и ФИО в «УТВЕРЖДАЮ» — из карточки человека. */
  users?: readonly PersonDisplayUser[];
}) {
  const cfg = params.config;
  // «УТВЕРЖДАЮ»: должность и ФИО одного человека, как на экране.
  // Сохранённые строки — только если человека нет в ростере.
  const approver = resolveApprover(cfg, params.users);
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  const headerRight = pageWidth - PDF_SHEET_MARGIN;

  drawTitle(doc, params.title || EQUIPMENT_CALIBRATION_DOCUMENT_TITLE);
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ГРАФИК ПОВЕРКИ СРЕДСТВ ИЗМЕРЕНИЙ",
    withPeriodicity: false,
    startedDate: params.dateFrom ?? null,
    finishedDate: params.dateTo ?? null,
  });

  const approvalY = afterHeader(headerBottom, 60);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("УТВЕРЖДАЮ", headerRight, approvalY, { align: "right" });
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  doc.text(approver.title, headerRight, approvalY + 6, { align: "right" });
  doc.line(headerRight - 52, approvalY + 10, headerRight, approvalY + 10);
  doc.text(approver.name, headerRight, approvalY + 14, { align: "right" });
  const calibrationDateLabel = formatCalibrationDateLong(cfg.documentDate);
  doc.text(calibrationDateLabel, approvalDateCenterX(doc, calibrationDateLabel, headerRight), approvalY + 20, {
    align: "center",
  });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  const calibrationTitleY = Math.max(legacyY(90), approvalY + 30);
  doc.text(`График поверки средств измерений на ${cfg.year} г.`, centerX, calibrationTitleY, {
    align: "center",
  });

  const head: RowInput[] = [
    [
      { content: "№ п/п", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      {
        content:
          "Идентификаторы СИ\n(наименование, тип, заводское обозначение, номер, место расположения)",
        rowSpan: 2,
        styles: { halign: "center", valign: "middle" },
      },
      {
        content: "Метрологические характеристики",
        colSpan: 2,
        styles: { halign: "center", valign: "middle" },
      },
      {
        content: "Межповерочный\nинтервал",
        rowSpan: 2,
        styles: { halign: "center", valign: "middle" },
      },
      {
        content: "Дата\nпоследней\nповерки",
        rowSpan: 2,
        styles: { halign: "center", valign: "middle" },
      },
      {
        content: "Сроки проведения\nочередной\nповерки",
        rowSpan: 2,
        styles: { halign: "center", valign: "middle" },
      },
      { content: "Примечание", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
    ],
    [
      {
        content: "Назначение\n(измеряемые\nпараметры)",
        styles: { halign: "center", valign: "middle" },
      },
      {
        content: "Предел (диапазон)\nизмерений",
        styles: { halign: "center", valign: "middle" },
      },
    ],
  ];

  const body: RowInput[] = cfg.rows.map((row, index) => {
    const nextDate = calculateNextCalibrationDate(
      row.lastCalibrationDate,
      row.calibrationInterval
    );
    const isOverdue =
      nextDate !== "" && new Date(`${nextDate}T00:00:00.000Z`) < new Date();

    return [
      centerCell(String(index + 1)),
      centerCell(
        [row.equipmentName, row.equipmentNumber, row.location].filter(Boolean).join(", ")
      ),
      centerCell(row.purpose),
      centerCell(row.measurementRange),
      centerCell(`${row.calibrationInterval} мес.`),
      centerCell(formatCalibrationDate(row.lastCalibrationDate)),
      {
        content: formatCalibrationDate(nextDate),
        // Просроченная поверка: было красным — на ч/б принтере это просто
        // тёмно-серый текст. Отметка без цвета — жирный на серой заливке.
        styles: {
          halign: "center",
          valign: "middle",
          textColor: [0, 0, 0],
          fontStyle: isOverdue ? "bold" : "normal",
          ...(isOverdue ? { fillColor: PDF_OVERDUE_FILL } : {}),
        },
      },
      centerCell(row.note),
    ];
  });

  if (body.length === 0) {
    body.push(Array(8).fill(centerCell("")));
  }

  autoTable(doc, {
    startY: calibrationTitleY + 6,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head,
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      fontStyle: "bold",
    },
    bodyStyles: { lineWidth: 0.2 },
    // Прежние пропорции на всю ширину между полями — край в край со штампом
    // (сумма 222 мм была на 27 мм уже шапки).
    columnStyles: fitColumnWidths(doc, [12, 48, 28, 30, 26, 22, 22, 34]),
  });
}

function drawTrainingPlanPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  config: ReturnType<typeof normalizeTrainingPlanConfig>;
  /** Ростер организации: должность и ФИО в «УТВЕРЖДАЮ» — из карточки человека. */
  users?: readonly PersonDisplayUser[];
}) {
  const cfg = params.config;
  // «УТВЕРЖДАЮ»: должность и ФИО одного человека, как на экране.
  // Сохранённые строки — только если человека нет в ростере.
  const approver = resolveApprover(cfg, params.users);
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  const headerRight = pageWidth - PDF_SHEET_MARGIN;

  drawTitle(doc, params.title || "План обучения");
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ПЛАН ОБУЧЕНИЯ ПЕРСОНАЛА",
    withPeriodicity: false,
    startedDate: params.dateFrom ?? null,
    finishedDate: params.dateTo ?? null,
  });

  const approvalY = afterHeader(headerBottom, 60);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("УТВЕРЖДАЮ", headerRight, approvalY, { align: "right" });
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  doc.text(approver.title, headerRight, approvalY + 6, { align: "right" });
  doc.line(headerRight - 52, approvalY + 10, headerRight, approvalY + 10);
  doc.text(approver.name, headerRight, approvalY + 14, { align: "right" });
  const approvalDateLabel = formatApprovalDateLong(cfg.documentDate, cfg.year);
  doc.text(
    approvalDateLabel,
    approvalDateCenterX(doc, approvalDateLabel, headerRight),
    approvalY + 20,
    { align: "center" }
  );

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  const trainingPlanTitleY = Math.max(legacyY(90), approvalY + 30);
  doc.text(`ПЛАН ОБУЧЕНИЯ ПЕРСОНАЛА НА ${cfg.year} Г.`, centerX, trainingPlanTitleY, { align: "center" });

  const topics = cfg.topics;
  const head: RowInput[] = [
    [
      { content: "№ п/п", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      {
        content: "Должностная единица,\nподлежащая обучению",
        rowSpan: 2,
        styles: { halign: "center", valign: "middle" },
      },
      {
        content: "Требуется обучение по теме:",
        colSpan: topics.length,
        styles: { halign: "center", valign: "middle" },
      },
    ],
    topics.map((topic) => ({ content: topic.name, styles: { halign: "center", valign: "middle" } })),
  ];

  const body: RowInput[] = cfg.rows.map((row, index) => [
    centerCell(String(index + 1)),
    centerCell(row.positionName),
    ...topics.map((topic) => {
      const cell = row.cells[topic.id];
      if (!cell || !cell.required) return centerCell("");
      return centerCell(cell.date ? `✓ ${cell.date}` : "✓");
    }),
  ]);

  if (body.length === 0) {
    for (let i = 0; i < 3; i++) {
      body.push(Array(2 + topics.length).fill(centerCell("")));
    }
  }

  autoTable(doc, {
    startY: trainingPlanTitleY + 6,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head,
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      fontStyle: "bold",
    },
    bodyStyles: { lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 46 },
    },
  });
}

function drawSanitationDayPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  config: ReturnType<typeof normalizeSanitationDayConfig>;
  /** Ростер организации: должность и ФИО в шапке — из карточки человека. */
  users?: readonly PersonDisplayUser[];
}) {
  const cfg = params.config;
  // «УТВЕРЖДАЮ» и «Ответственный»: должность и ФИО одного человека, как
  // на экране. Сохранённые строки — только если человека нет в ростере.
  const approver = resolveApprover(cfg, params.users);
  const responsible = resolveResponsible(cfg, params.users);
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;

  // --- Поля бланка: штамп ХАССП, блок «УТВЕРЖДАЮ» и таблица журнала
  // обязаны иметь ОДНУ ширину (иначе на листе «ступенька», аудит r5 п.2) —
  // между полями листа. Раньше таблица 244 мм стояла по центру с полями
  // 27 мм и на 1 мм не влезала в них.
  const roomColWidth = 60;
  const typeColWidth = 22;
  const monthColWidth = 13.5;
  const tableMargin = PDF_SHEET_MARGIN;
  const marginLeft = tableMargin;
  const headerRight = pageWidth - tableMargin;
  const fittedWidths = fitColumnWidths(doc, [
    roomColWidth,
    typeColWidth,
    ...SANITATION_MONTHS.map(() => monthColWidth),
  ]);

  // --- Title ---
  drawTitle(doc, params.title || SANITATION_DAY_DOCUMENT_TITLE);

  // --- Header table ---
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ГРАФИК И УЧЕТ ГЕНЕРАЛЬНЫХ УБОРОК",
    withPeriodicity: false,
    startedDate: params.dateFrom ?? null,
    finishedDate: params.dateTo ?? null,
  });

  // --- Approval block (right-aligned to header edge) ---
  const approvalY = afterHeader(headerBottom, 60);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("УТВЕРЖДАЮ", headerRight, approvalY, { align: "right" });
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  doc.text(approver.title, headerRight, approvalY + 6, { align: "right" });
  doc.line(headerRight - 52, approvalY + 10, headerRight, approvalY + 10);
  doc.text(approver.name, headerRight, approvalY + 14, { align: "right" });
  const approvalDateLabel = formatApprovalDateLong(cfg.documentDate, cfg.year);
  doc.text(
    approvalDateLabel,
    approvalDateCenterX(doc, approvalDateLabel, headerRight),
    approvalY + 20,
    { align: "center" }
  );

  // --- Centered subtitle ---
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  const sanitationTitleY = Math.max(legacyY(90), approvalY + 30);
  doc.text(
    `График и учет генеральных уборок на предприятии в ${cfg.year} г.`,
    centerX,
    sanitationTitleY,
    { align: "center" }
  );

  // --- Data table (centered on page) ---
  const head: RowInput[] = [
    [
      { content: "Помещение", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      // Экран печатает над колонкой «План/Факт» заголовок «Вид».
      { content: "Вид", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      {
        content: "График",
        colSpan: SANITATION_MONTHS.length,
        styles: { halign: "center", valign: "middle" },
      },
    ],
    SANITATION_MONTHS.map((item) => ({ content: item.short, styles: { halign: "center" } })),
  ];

  // Ячейка месяца: с 2026-09-22 уборок в месяце может быть несколько
  // («04, 11, 18, 25») — от трёх дат кегль на пункт меньше, чтобы даты
  // помещались в колонку месяца, не раздувая строку.
  const monthCell = (text: string): CellDef => {
    const value = text || "";
    const tokens = value.split(",").filter((token) => token.trim()).length;
    return tokens >= 3
      ? { content: value, styles: { halign: "center", valign: "middle", fontSize: 7 } }
      : centerCell(value);
  };

  const body: RowInput[] = [];
  for (const row of cfg.rows) {
    body.push([
      { content: row.roomName || "", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "План", styles: { halign: "center", valign: "middle" } },
      ...SANITATION_MONTHS.map((month) => monthCell(row.plan[month.key] || "")),
    ]);
    body.push([
      { content: "Факт", styles: { halign: "center", valign: "middle" } },
      ...SANITATION_MONTHS.map((month) => monthCell(row.fact[month.key] || "")),
    ]);
  }

  body.push([
    {
      // Без сотрудника печаталось «Ответственный: Управляющий, » — запятая
      // с пустотой. Разделитель — только между непустыми частями.
      content: `Ответственный: ${formatPositionWithName(
        responsible.title,
        responsible.name,
        { separator: ", ", emptyValue: "—" }
      )}`,
      colSpan: 2,
      styles: { halign: "left", valign: "middle" },
    },
    ...SANITATION_MONTHS.map(() => centerCell("")),
  ]);

  if (cfg.rows.length === 0) {
    body.unshift(
      [
        { content: "", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
        { content: "План", styles: { halign: "center", valign: "middle" } },
        ...SANITATION_MONTHS.map(() => centerCell("")),
      ],
      [
        { content: "Факт", styles: { halign: "center", valign: "middle" } },
        ...SANITATION_MONTHS.map(() => centerCell("")),
      ]
    );
  }

  autoTable(doc, {
    startY: sanitationTitleY + 6,
    margin: { left: tableMargin, right: tableMargin },
    head,
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      fontStyle: "bold",
    },
    bodyStyles: {
      lineWidth: 0.2,
    },
    // Прежние пропорции (помещение 60 : вид 22 : месяц 13,5) на всю ширину.
    columnStyles: fittedWidths,
  });
}

function drawTrackedPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  fields: TrackedField[];
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: PdfPositionUser[];
}) {
  drawTitle(doc, params.title);
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });


  const userMap = Object.fromEntries(params.users.map((user) => [user.id, user.name]));

  const head: RowInput[] = [[
    centerCell("Дата"),
    centerCell("Ответственный"),
    ...params.fields.map((field) => centerCell(field.label)),
  ]];

  const body: RowInput[] = params.entries.map((entry) => [
    centerCell(formatPdfDate(entry.date)),
    centerCell(userMap[entry.employeeId] || ""),
    ...params.fields.map((field) =>
      centerCell(getTrackedFieldValue(field, entry.data[field.key], { users: params.users }))
    ),
  ]);

  autoTable(doc, {
    startY: afterHeader(metaBottom, 66),
    head,
    body: ensurePdfBodyRows(body, params.fields.length + 2),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.1,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });
}

function drawPestControlPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string | null;
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: PdfPositionUser[];
}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const startDate =
    params.dateFrom instanceof Date
      ? params.dateFrom.toISOString().slice(0, 10)
      : String(params.dateFrom).slice(0, 10);
  const endDate =
    params.dateTo instanceof Date
      ? params.dateTo.toISOString().slice(0, 10)
      : typeof params.dateTo === "string"
        ? params.dateTo.slice(0, 10)
        : "";
  const pestUserById = new Map(params.users.map((user) => [user.id, user]));

  drawTitle(doc, params.title || PEST_CONTROL_DOCUMENT_TITLE);

  // В шапке — официальное название ЖУРНАЛА, как у остальных бланков.
  // Раньше сюда уезжало название документа, и инспектор видел
  // «ZZ5 PEST_CONTROL» вместо «Журнал учёта дезинсекции и дератизации».
  const pestJournalLabel = journalNameOr(PEST_CONTROL_DOCUMENT_TITLE);
  // Общая шапка ХАССП — той же ширины, что таблица (между полями листа;
  // раньше поля были 24 мм). Даты — ДД-ММ-ГГГГ; дата окончания печатается
  // ВМЕСТО прочерка.
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: pestJournalLabel,
    withPeriodicity: false,
    startedDate: startDate,
    finishedDate: endDate || null,
  });
  // Прежний зазор: рамка шапки (низ 48 мм) → заголовок (58 мм) = 10 мм.
  const pestTitleY = Math.max(legacyY(58), headerBottom + 10);

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text(pestJournalLabel.toUpperCase(), pageWidth / 2, pestTitleY, { align: "center" });
  // Название документа — отдельной строкой и только если оно отличается
  // от названия журнала (у бланка «ZZ5 pest_control» это заголовок
  // документа, а не журнала).
  const pestDocumentName = (params.title || "").trim();
  if (pestDocumentName && pestDocumentName !== pestJournalLabel) {
    doc.setFont("JournalUnicode", "normal");
    doc.setFontSize(10);
    doc.text(pestDocumentName, pageWidth / 2, pestTitleY + 6, { align: "center" });
  }

  // Порядок — как на экране (дата, затем время): запросом строки
  // приходят в порядке (employeeId, date), и печать шла вразнобой.
  const bodyRows = [...params.entries]
    .map((entry) => ({
      entry,
      normalized: normalizePestControlEntryData(
        entry.data,
        entry.date.toISOString().slice(0, 10),
        params.users,
        entry.employeeId
      ),
    }))
    .sort((left, right) => {
      const keyOf = (item: typeof left) =>
        `${item.normalized.performedDate || ""}T${
          item.normalized.timeSpecified
            ? `${item.normalized.performedHour || "00"}:${item.normalized.performedMinute || "00"}`
            : "00:00"
        }`;
      const diff = keyOf(left).localeCompare(keyOf(right));
      return diff !== 0 ? diff : left.entry.date.getTime() - right.entry.date.getTime();
    })
    .map(({ entry, normalized }) => {
      const acceptedUser =
        pestUserById.get(normalized.acceptedEmployeeId) ||
        pestUserById.get(entry.employeeId);
      const acceptedEmployeeName = acceptedUser?.name || "";
      // Должность принявшего — из его карточки, не копия из записи.
      const acceptedTitle = getRowEmployeeTitle(acceptedUser, normalized.acceptedRole);

      return [
        "",
        formatPestControlRowDate(
          normalized.performedDate,
          normalized.performedHour,
          normalized.performedMinute,
          normalized.timeSpecified
        ),
        normalized.event,
        normalized.areaOrVolume,
        normalized.treatmentProduct,
        normalized.note,
        normalized.performedBy,
        [acceptedTitle === acceptedEmployeeName ? "" : acceptedTitle, acceptedEmployeeName]
          .filter(Boolean)
          .join(", "),
      ];
    });

  if (bodyRows.length === 0) {
    bodyRows.push(...Array.from({ length: 3 }, () => ["", "", "", "", "", "", "", ""]));
  } else {
    bodyRows.push(["", "", "", "", "", "", "", ""]);
  }

  autoTable(doc, {
    startY: pestTitleY + 8,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    head: [[
      "",
      "Дата и время\nпроведения",
      "Мероприятие\n(вид, место)",
      "Площадь и\n(или) объем",
      "Средство обработки",
      "Примечание",
      "Кем проведено",
      "ФИО принявшего\nработы",
    ]],
    body: bodyRows,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8.6,
      cellPadding: 1.6,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    bodyStyles: {
      halign: "center",
      valign: "middle",
    },
    // Прежние пропорции на всю ширину между полями — край в край со штампом.
    columnStyles: fitColumnWidths(doc, [7, 24, 34, 22, 31, 56, 31, 33]),
  });
}

function drawEquipmentCleaningPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date;
  entries: Array<{
    id: string;
    date: Date;
    data: Record<string, unknown>;
  }>;
  fieldVariant: "rinse_temperature" | "rinse_completeness";
  /** Справочник «Оборудование»: имя связанной единицы берём оттуда. */
  equipmentDirectory?: { id: string; name: string }[];
  /** Для должности контролёра из его карточки (не копии из строки). */
  users?: PdfPositionUser[];
}) {
  const marginX = PDF_SHEET_MARGIN;
  const currentFont = doc.getFont().fontName || "helvetica";

  drawTitle(doc, params.title || EQUIPMENT_CLEANING_DOCUMENT_TITLE);

  // Общая шапка ХАССП (раньше — своя таблица-штамп без строки
  // периодичности) той же ширины, что таблица журнала.
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ЖУРНАЛ МОЙКИ И ДЕЗИНФЕКЦИИ ОБОРУДОВАНИЯ",
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
    marginX,
  });
  const titleY = afterHeader(headerBottom, 0) + 6;
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  // По центру листа (раньше x = 105 — середина КНИЖНОГО листа, а бланк альбомный).
  doc.text("ЖУРНАЛ МОЙКИ И ДЕЗИНФЕКЦИИ ОБОРУДОВАНИЯ", doc.internal.pageSize.getWidth() / 2, titleY, {
    align: "center",
  });
  doc.setFont(currentFont, "normal");

  // Порядок — как на экране (дата+время). Запросом строки приходят
  // в порядке (employeeId, date), и печать расходилась с бланком.
  const sortedEntries = [...params.entries].sort((left, right) => {
    const leftData = normalizeEquipmentCleaningRowData(left.data);
    const rightData = normalizeEquipmentCleaningRowData(right.data);
    return `${leftData.washDate}T${leftData.washTime}`.localeCompare(
      `${rightData.washDate}T${rightData.washTime}`
    );
  });

  const body = sortedEntries.map((entry) => {
    const data = normalizeEquipmentCleaningRowData(entry.data);
    return [
      `${formatRuDateDash(data.washDate)}\n${data.washTime}`,
      resolveEquipmentCleaningRowName(data, params.equipmentDirectory ?? []),
      data.detergentName,
      typeof data.detergentConcentration === "number"
        ? `${formatNumberShort(data.detergentConcentration)}%`
        : data.detergentConcentration,
      data.disinfectantName,
      typeof data.disinfectantConcentration === "number"
        ? `${formatNumberShort(data.disinfectantConcentration)}%`
        : data.disinfectantConcentration,
      params.fieldVariant === "rinse_temperature"
        ? formatNumberShort(data.rinseTemperature) || "—"
        : getEquipmentCleaningResultLabel(data.rinseResult),
      data.washerName,
      [
        getRowEmployeeTitle(
          params.users?.find((user) => user.id === data.controllerUserId),
          data.controllerPosition
        ),
        data.controllerName,
      ]
        .filter(Boolean)
        .join(", "),
    ];
  });

  autoTable(doc, {
    startY: titleY + 6,
    margin: { left: marginX, right: marginX },
    theme: "grid",
    tableLineColor: [0, 0, 0],
    tableLineWidth: 0.2,
    styles: {
      font: currentFont,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      cellPadding: 1.8,
      halign: "center",
      valign: "middle",
      fontSize: 9,
    },
    head: [[
      "Дата и время мойки",
      "Наименование оборудования",
      "Наименование моющего раствора",
      "Концентрация моющего раствора, %",
      "Наименование дезинфицирующего раствора",
      "Концентрация дезинфицирующего раствора, %",
      params.fieldVariant === "rinse_temperature"
        ? "Ополаскивание, °C"
        : "Полнота смываемости дез. ср-ва с оборудования и инвентаря",
      "Мойщик (ФИО)",
      "Контролирующее лицо (должность, ФИО)",
    ]],
    body: body.length > 0 ? body : ensurePlainRows(9),
  });
}

function drawDisinfectantPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeDisinfectantConfig>;
}) {
  const cfg = params.config;
  const currentFont = doc.getFont().fontName || "helvetica";
  const pageWidth = doc.internal.pageSize.getWidth();
  const dateFromLabel = toDateKey(params.dateFrom).split("-").reverse().join(".");
  const dateToLabel = toDateKey(params.dateTo).split("-").reverse().join(".");

  doc.setFont(currentFont, "bold");
  doc.setFontSize(14);
  // Верх первой строки — на верхнем поле листа (раньше базовая линия на
  // 16 мм); строки ниже — с прежними промежутками.
  const orgY = journalSheetTopBaseline(doc);
  doc.text(params.organizationName, pageWidth / 2, orgY, { align: "center" });
  doc.setFontSize(12);
  doc.text(params.title || DISINFECTANT_DOCUMENT_TITLE, pageWidth / 2, orgY + 8, {
    align: "center",
  });
  doc.setFont(currentFont, "normal");
  doc.setFontSize(9);
  doc.text(`Период: ${dateFromLabel} - ${dateToLabel}`, PDF_SHEET_MARGIN, orgY + 16);
  doc.text(
    `Ответственный: ${cfg.responsibleRole}${cfg.responsibleEmployee ? `, ${cfg.responsibleEmployee}` : ""}`,
    PDF_SHEET_MARGIN,
    orgY + 22
  );

  autoTable(doc, {
    startY: orgY + 30,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    theme: "grid",
    styles: {
      font: currentFont,
      fontSize: 8,
      cellPadding: 1.6,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    // Колонка «Расход на кв.м» есть на экране — в печати её не было.
    head: [[
      "Подразделение / объект",
      "Площадь / емкость",
      "Вид обработки",
      "Кратность в месяц",
      "Дез. средство",
      "Концентрация, %",
      "Расход раствора на кв.м, л",
      "Раствор на обработку",
      "Потребность на обработку",
      "Потребность в месяц",
      "Потребность в год",
    ]],
    body:
      cfg.subdivisions.length > 0
        ? [
            ...cfg.subdivisions.map((row) => [
              row.name || "—",
              row.byCapacity ? "На емкость" : row.area ? formatDisinfectantNumber(row.area, 2) : "—",
              row.treatmentType === "general" ? "Генеральная" : "Текущая",
              String(row.frequencyPerMonth || 0),
              row.disinfectantName || "—",
              formatDisinfectantNumber(row.concentration, 3) || "—",
              formatDisinfectantNumber(row.solutionConsumptionPerSqm, 3) || "—",
              formatDisinfectantNumber(resolveSolutionPerTreatment(row), 3) || "—",
              formatDisinfectantNumber(computeNeedPerTreatment(row), 3) || "—",
              formatDisinfectantNumber(computeNeedPerMonth(row), 3) || "—",
              formatDisinfectantNumber(computeNeedPerYear(row), 3) || "—",
            ]),
            // Строка итогов — как на экране («Общая потребность дез. средства»).
            [
              {
                content: "Общая потребность дез. средства",
                colSpan: 8,
                styles: { halign: "right" as const, fontStyle: "bold" as const },
              },
              {
                content: formatDisinfectantNumber(
                  cfg.subdivisions.reduce((sum, row) => sum + computeNeedPerTreatment(row), 0),
                  3
                ),
                styles: { fontStyle: "bold" as const },
              },
              {
                content: formatDisinfectantNumber(
                  cfg.subdivisions.reduce((sum, row) => sum + computeNeedPerMonth(row), 0),
                  3
                ),
                styles: { fontStyle: "bold" as const },
              },
              {
                content: formatDisinfectantNumber(
                  cfg.subdivisions.reduce((sum, row) => sum + computeNeedPerYear(row), 0),
                  3
                ),
                styles: { fontStyle: "bold" as const },
              },
            ],
          ]
        : [["—", "—", "—", "—", "—", "—", "—", "—", "—", "—", "—"]],
  });

  autoTable(doc, {
    startY:
      (((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY) || 46) + 8,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    theme: "grid",
    styles: {
      font: currentFont,
      fontSize: 8,
      cellPadding: 1.6,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    head: [[
      "Дата получения",
      "Наименование дез. средства",
      "Количество",
      "Срок годности",
      "Ответственный",
    ]],
    body:
      cfg.receipts.length > 0
        ? [
            ...cfg.receipts.map((row) => [
              // Формат как на экране (дд-мм-гггг), а не ISO из БД.
              row.date ? formatRuDateDash(row.date) : "—",
              row.disinfectantName || "—",
              // Ноль на экране пуст — в печати был «0 кг».
              formatQuantityWithUnit(row.quantity, row.unit),
              row.expiryDate ? formatRuDateDash(row.expiryDate) : "—",
              [row.responsibleRole, row.responsibleEmployee].filter(Boolean).join(", ") || "—",
            ]),
            // «Итого» по единицам — как на экране.
            [
              {
                content: "Итого:",
                colSpan: 2,
                styles: { halign: "right" as const, fontStyle: "bold" as const },
              },
              {
                content: sumDisinfectantQuantities(
                  cfg.receipts.map((row) => ({ quantity: row.quantity, unit: row.unit }))
                ),
                styles: { fontStyle: "bold" as const },
              },
              { content: "", colSpan: 2 },
            ],
          ]
        : [["—", "—", "—", "—", "—"]],
  });

  autoTable(doc, {
    startY:
      (((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY) || 80) + 8,
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    theme: "grid",
    styles: {
      font: currentFont,
      fontSize: 8,
      cellPadding: 1.6,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    head: [[
      "Период",
      "Наименование дез. средства",
      "Получено",
      "Израсходовано",
      "Остаток",
      "Ответственный",
    ]],
    body:
      cfg.consumptions.length > 0
        ? cfg.consumptions.map((row) => [
            // Формат как на экране (дд-мм-гггг), а не ISO из БД.
            [row.periodFrom, row.periodTo]
              .filter(Boolean)
              .map((value) => formatRuDateDash(value))
              .join(" - ") || "—",
            row.disinfectantName || "—",
            // Ноль на экране пуст — в печати был «0 кг».
            formatQuantityWithUnit(row.totalReceived, row.totalReceivedUnit),
            formatQuantityWithUnit(row.totalConsumed, row.totalConsumedUnit),
            formatQuantityWithUnit(row.remainder, row.remainderUnit),
            [row.responsibleRole, row.responsibleEmployee].filter(Boolean).join(", ") || "—",
          ])
        : [["—", "—", "—", "—", "—", "—"]],
  });
}

function drawTraceabilityPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  config: ReturnType<typeof normalizeTraceabilityDocumentConfig>;
}) {
  const cfg = params.config;
  const showShock = cfg.showShockTempField;
  const dateFromStr =
    params.dateFrom instanceof Date
      ? formatTraceabilityDateRu(params.dateFrom.toISOString().slice(0, 10))
      : formatTraceabilityDateRu(String(params.dateFrom).slice(0, 10));

  drawTitle(doc, cfg.documentTitle || params.title);
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ЖУРНАЛ ПРОСЛЕЖИВАЕМОСТИ ПРОДУКЦИИ",
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const traceTitleY = afterHeader(headerBottom, 62);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  doc.text("ЖУРНАЛ ПРОСЛЕЖИВАЕМОСТИ ПРОДУКЦИИ", pageWidth / 2, traceTitleY, { align: "center" });

  const head: RowInput[] = [
    [
      { content: "Дата", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Поступило в цех сырья", colSpan: 3, styles: { halign: "center", valign: "middle" } },
      { content: "Выпущено цехом", colSpan: showShock ? 3 : 2, styles: { halign: "center", valign: "middle" } },
      { content: "ФИО ответственного", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
    ],
    [
      centerCell("Наименование сырья"),
      centerCell("Номер партии ПФ\nДата фасовки"),
      centerCell("Кол-во\nшт./кг."),
      centerCell("Наименование ПФ"),
      centerCell("Кол-во фасовок\nшт./кг."),
      ...(showShock ? [centerCell("T °C продукта\nпосле шоковой\nзаморозки")] : []),
    ],
  ];

  const body: RowInput[] = cfg.rows.map((row) => {
    const incomingQty = [formatTraceabilityQuantity(row.incoming.quantityPieces), formatTraceabilityQuantity(row.incoming.quantityKg)]
      .filter(Boolean)
      .join(" / ");
    const outgoingQty = [formatTraceabilityQuantity(row.outgoing.quantityPacksPieces), formatTraceabilityQuantity(row.outgoing.quantityPacksKg)]
      .filter(Boolean)
      .join(" / ");

    const cells: RowInput = [
      centerCell(formatTraceabilityDateRu(row.date)),
      centerCell(row.incoming.rawMaterialName),
      centerCell(
        [row.incoming.batchNumber, formatTraceabilityDateRu(row.incoming.packagingDate)]
          .filter(Boolean)
          .join("\n")
      ),
      centerCell(incomingQty),
      centerCell(row.outgoing.productName),
      centerCell(outgoingQty),
    ];

    if (showShock) {
      cells.push(centerCell(formatTraceabilityQuantity(row.outgoing.shockTemp)));
    }

    cells.push(centerCell(row.responsibleEmployee || ""));
    return cells;
  });

  autoTable(doc, {
    startY: traceTitleY + 8,
    head,
    body: ensurePdfBodyRows(body, showShock ? 8 : 7),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.5,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });
}

function drawUvRuntimePdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeUvRuntimeDocumentConfig>;
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: PdfPositionUser[];
}) {
  drawTitle(doc, "Журнал учета работы УФ бактерицидной установки");
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    // В шапке ХАССП — НАЗВАНИЕ ЖУРНАЛА, как на экране. Раньше
    // туда шёл document.title («Бактерицидная установка №1 | Журнал
    // учета работы») — номер установки живёт отдельной строкой ниже.
    title: "Журнал учета работы ультрафиолетовой бактерицидной установки",
    journalLabel: "Журнал учета работы ультрафиолетовой бактерицидной установки",
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    marginX: PDF_SHEET_MARGIN,
    repeatOnPages: true,
  });

  // Подзаголовок бланка — три строки, как на экране:
  //   БАКТЕРИЦИДНАЯ УСТАНОВКА №N
  //   Журнал учета работы УФ бактерицидной установки
  //   <цех на подчёркнутой линии> / (наименование цеха / участка применения)
  const uvSubtitleY = afterHeader(metaBottom, 66);
  const uvPageWidth = doc.internal.pageSize.getWidth();
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  doc.text(
    `БАКТЕРИЦИДНАЯ УСТАНОВКА №${params.config.lampNumber}`,
    uvPageWidth / 2,
    uvSubtitleY,
    { align: "center" }
  );
  doc.setFontSize(10);
  doc.text(UV_LAMP_RUNTIME_PAGE_TITLE, uvPageWidth / 2, uvSubtitleY + 6, {
    align: "center",
  });
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  // Пустой цех — пустая подчёркнутая линия под ручную запись.
  const uvAreaLineWidth = 90;
  if (params.config.areaName) {
    doc.text(params.config.areaName, uvPageWidth / 2, uvSubtitleY + 11.5, {
      align: "center",
    });
  }
  doc.setLineWidth(0.2);
  doc.line(
    uvPageWidth / 2 - uvAreaLineWidth / 2,
    uvSubtitleY + 13,
    uvPageWidth / 2 + uvAreaLineWidth / 2,
    uvSubtitleY + 13
  );
  doc.setFontSize(7.5);
  doc.text(
    "(наименование цеха / участка применения)",
    uvPageWidth / 2,
    uvSubtitleY + 17,
    { align: "center" }
  );

  // Specification table
  const spec = params.config.spec;
  const specHead: RowInput[] = [[{
    content: "Спецификация ультрафиолетовой бактерицидной установки",
    colSpan: 4,
    styles: { halign: "center", fontStyle: "bold" },
  }]];
  const specBody: RowInput[] = [
    [
      { content: "Объект обеззараживания (воздух или поверхность, или то и другое)", styles: { fontStyle: "bold" } },
      centerCell(getDisinfectionObjectLabel(spec)),
      { content: "Ресурс рабочего времени (срок замены отработавших ламп), часов", styles: { fontStyle: "bold" } },
      centerCell(String(spec.lampLifetimeHours)),
    ],
    [
      { content: "Вид микроорганизма (санитарно-показательный или иной)", styles: { fontStyle: "bold" } },
      centerCell(spec.microorganismType),
      { content: "Дата ввода установки в эксплуатацию", styles: { fontStyle: "bold" } },
      centerCell(spec.commissioningDate ? formatRuDateDash(spec.commissioningDate) : "—"),
    ],
    [
      { content: "Режим облучения (непрерывный или повторно-кратковременный)", styles: { fontStyle: "bold" } },
      centerCell(getRadiationModeLabel(spec.radiationMode)),
      { content: "Минимальный интервал между сеансами (для повторно-кратковременной)", styles: { fontStyle: "bold" } },
      centerCell(spec.minIntervalBetweenSessions || "—"),
    ],
    [
      { content: "Условия обеззараживания (в присутствии или отсутствии людей)", styles: { fontStyle: "bold" } },
      centerCell(getDisinfectionConditionLabel(spec.disinfectionCondition)),
      { content: "Частота контроля работы установки (частота включений)", styles: { fontStyle: "bold" } },
      centerCell(formatControlFrequencyLabel(spec.controlFrequency)),
    ],
  ];

  autoTable(doc, {
    startY: uvSubtitleY + 21,
    head: specHead,
    body: specBody,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.5,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });

  // Промежутки между таблицами бланка — 3 мм (было 5 и 6): пустой бланк
  // установки занимает лист целиком и иначе не помещался на одну страницу.
  const UV_TABLE_GAP = 3;
  const specEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + UV_TABLE_GAP;

  const userMap = Object.fromEntries(params.users.map((user) => [user.id, user.name]));
  const rows = [...params.entries].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Порядок блоков — как на экране: сводная «по месяцам» идёт ДО
  // журнала наработки (раньше PDF печатал её последней).
  // C-аудит: блок «Суммарное количество отработанных часов … по месяцам».
  // На экране он есть всегда (эталон печатает бланк даже пустым — шесть
  // строк под запись от руки), в PDF его не было вовсе.
  const monthly = calculateMonthlyHours(
    rows.map((entry) => ({
      date: entry.date instanceof Date ? toDateKey(entry.date) : String(entry.date).slice(0, 10),
      data: normalizeUvRuntimeEntryData(entry.data),
    })),
    spec.lampLifetimeHours
  );
  const uvMonthlyMinRows = 6;
  const uvHalf = Math.max(uvMonthlyMinRows, Math.ceil(monthly.length / 2));
  const uvLeft = monthly.slice(0, uvHalf);
  const uvRight = monthly.slice(uvHalf);
  const formatUvHours = (value: number) => value.toFixed(2).replace(".", ",");
  const monthlyBody: RowInput[] = Array.from({ length: uvHalf }, (_, index) => {
    const left = uvLeft[index];
    const right = uvRight[index];
    return [
      { content: left ? formatUvMonthLabel(left.month) : "", styles: { halign: "left" as const } },
      centerCell(left ? formatUvHours(left.hours) : ""),
      centerCell(left ? formatUvHours(left.remaining) : ""),
      { content: right ? formatUvMonthLabel(right.month) : "", styles: { halign: "left" as const } },
      centerCell(right ? formatUvHours(right.hours) : ""),
      centerCell(right ? formatUvHours(right.remaining) : ""),
    ];
  });

  autoTable(doc, {
    startY: specEndY,
    head: [
      [{
        content: "Суммарное количество отработанных часов бактерицидной установкой по месяцам",
        colSpan: 6,
        styles: { halign: "center" as const, fontStyle: "bold" as const },
      }],
      [
        { content: "Месяц, год", styles: { halign: "left" as const } },
        centerCell("Количество часов"),
        centerCell("Остаточное количество часов"),
        { content: "Месяц, год", styles: { halign: "left" as const } },
        centerCell("Количество часов"),
        centerCell("Остаточное количество часов"),
      ],
    ],
    body: monthlyBody,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.5,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      minCellHeight: 6,
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    rowPageBreak: "avoid",
  });

  const monthlyEndY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + UV_TABLE_GAP;


  const head: RowInput[] = [[
    centerCell("№"),
    centerCell("Дата"),
    centerCell("Время ВКЛ"),
    centerCell("Время ВЫКЛ"),
    centerCell("Итого продолжительность работы, минут"),
    centerCell("ФИО ответственного лица"),
  ]];

  const body: RowInput[] = rows.map((entry, index) => {
    const data = normalizeUvRuntimeEntryData(entry.data);
    // Регламент допускает 2-3 сеанса за смену — печатаем все, а «Итого»
    // считаем по сумме, иначе бумага расходится с экраном.
    const sessions = listUvRuntimeSessions(data);
    const duration = calculateUvEntryDurationMinutes(data);
    return [
      centerCell(String(index + 1)),
      centerCell(formatRuDateDash(entry.date)),
      centerCell(sessions.map((session) => session.startTime || "—").join("\n")),
      centerCell(sessions.map((session) => session.endTime || "—").join("\n")),
      centerCell(duration !== null ? String(duration) : ""),
      centerCell(userMap[entry.employeeId] || ""),
    ];
  });

  autoTable(doc, {
    startY: monthlyEndY,
    head,
    // Пустые строки-заглушки — только у совсем пустого журнала. Раньше их
    // дописывали и к одной реальной записи, и лишняя пустая строка
    // выталкивалась на вторую страницу — там печаталась голая шапка таблицы.
    body: body.length > 0 ? body : ensurePdfBodyRows([], 6, 2),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: {
      left: PDF_SHEET_MARGIN,
      right: PDF_SHEET_MARGIN,
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    // Суммарная ширина = ширине листа: правый край всех блоков бланка
    // (штамп, спецификация, сводная, наработка) должен совпадать.
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 32 },
      2: { cellWidth: 44 },
      3: { cellWidth: 44 },
      4: { cellWidth: 55 },
      5: { cellWidth: 90 },
    },
  });

}

function buildVisibleUvRuntimeEntries(
  entries: Array<{ employeeId: string; date: Date | string; data: Record<string, unknown> }>,
  dateFrom: Date,
  dateTo: Date
) {
  const fromKey = toDateKey(dateFrom);
  const toKey = toDateKey(dateTo);
  const byDate = new Map<string, { employeeId: string; date: Date | string; data: Record<string, unknown> }>();

  for (const entry of entries) {
    const dateKey = entry.date instanceof Date ? toDateKey(entry.date) : String(entry.date).slice(0, 10);
    if (dateKey < fromKey || dateKey > toKey) {
      continue;
    }

    byDate.set(dateKey, entry);
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, entry]) => ({
      ...entry,
      date:
        entry.date instanceof Date
          ? entry.date
          : new Date(`${String(entry.date).slice(0, 10)}T00:00:00.000Z`),
    }));
}

function drawRegisterPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  fields: RegisterField[];
  config: ReturnType<typeof normalizeRegisterDocumentConfig>;
  users: PdfPositionUser[];
  equipment: { id: string; name: string }[];
}) {
  drawTitle(doc, params.title);
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  const head: RowInput[] = [[
    centerCell("№"),
    ...params.fields.map((field) => centerCell(field.label)),
  ]];

  const body: RowInput[] = params.config.rows.map((row, index) => [
    centerCell(String(index + 1)),
    ...params.fields.map((field) =>
      centerCell(
        isRegisterFieldVisible(field, row.values)
          ? getRegisterFieldValue(
              field,
              row.values[field.key] || "",
              params.users,
              params.equipment
            )
          : ""
      )
    ),
  ]);

  autoTable(doc, {
    startY: afterHeader(metaBottom, 66),
    head,
    body: ensurePdfBodyRows(body, params.fields.length + 1),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.1,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });
}

function drawAuditPlanPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeAuditPlanConfig>;
  /** Ростер организации: должность и ФИО в «УТВЕРЖДАЮ» — из карточки человека. */
  users?: readonly PersonDisplayUser[];
}) {
  // «УТВЕРЖДАЮ»: должность и ФИО одного человека, как на экране.
  // Сохранённые строки — только если человека нет в ростере.
  const approver = resolveApprover(params.config, params.users);
  drawTitle(doc, params.title);
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  // Блок «УТВЕРЖДАЮ» есть на экране (audit-plan-document-client), а в
  // печати терялся — инспектор получал план без утверждающего лица.
  let approveBottom = metaBottom;
  {
    const lines = [
      "УТВЕРЖДАЮ",
      approver.title,
      approver.name,
      getAuditPlanPrintDateLabel(params.config.documentDate),
    ].filter((line) => Boolean(line && line.trim()));
    const right = doc.internal.pageSize.getWidth() - PDF_SHEET_MARGIN;
    let y = afterHeader(metaBottom, 66) - 4;
    doc.setFont("JournalUnicode", "normal");
    doc.setFontSize(9);
    lines.forEach((line, index) => {
      doc.setFont("JournalUnicode", index === 0 ? "bold" : "normal");
      doc.text(line, right, y, { align: "right" });
      y += 4.4;
    });
    doc.setFont("JournalUnicode", "normal");
    approveBottom = y;
  }

  const head: RowInput[] = [[
    centerCell("№"),
    centerCell("Требование"),
    centerCell("Контроль"),
    ...params.config.columns.map((column) => centerCell(`${column.title}\n${column.auditorName}`)),
  ]];

  const body: RowInput[] = [];
  params.config.sections.forEach((section) => {
    body.push([
      {
        content: section.title,
        colSpan: 3 + Math.max(params.config.columns.length, 1),
        styles: { fontStyle: "bold", halign: "left", fillColor: [245, 245, 245] },
      },
    ]);

    params.config.rows
      .filter((row) => row.sectionId === section.id)
      .forEach((row) => {
        // Нумерация сквозная по всему плану, как на экране: раньше печать
        // начинала счёт заново в каждом разделе и номера расходились.
        const rowNumber =
          params.config.rows.findIndex((item) => item.id === row.id) + 1;
        body.push([
          centerCell(String(rowNumber)),
          centerCell(row.text),
          centerCell(row.checked ? "Да" : ""),
          ...params.config.columns.map((column) => centerCell(row.values[column.id] || "")),
        ]);
      });
  });

  autoTable(doc, {
    startY: approveBottom + 3,
    head,
    body: body.length > 0 ? body : [[{ content: "", colSpan: 3 + Math.max(params.config.columns.length, 1) }]],
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.5,
      cellPadding: 1.3,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });
}

function drawAuditProtocolPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeAuditProtocolConfig>;
}) {
  drawTitle(doc, params.title);
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  const body: RowInput[] = [];
  params.config.sections.forEach((section) => {
    body.push([
      { content: section.title, colSpan: 5, styles: { fontStyle: "bold", halign: "left", fillColor: [245, 245, 245] } },
    ]);
    params.config.rows
      .filter((row) => row.sectionId === section.id)
      .forEach((row, index) => {
        body.push([
          centerCell(String(index + 1)),
          centerCell(row.text),
          centerCell(row.result === "yes" ? "Да" : ""),
          centerCell(row.result === "no" ? "Нет" : ""),
          centerCell(row.note || ""),
        ]);
      });
  });

  // Основание и план, по которому составлен протокол: у инспектора
  // должно быть видно, откуда взяты требования.
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  const protocolMetaBottom = renderWrappedTextBlock(
    doc,
    [
      `Основание проверки: ${params.config.basisTitle || "—"}`,
      `Проверяемый объект: ${params.config.auditedObject || "—"}`,
      ...(params.config.sourcePlanTitle
        ? [`Составлен по плану: ${params.config.sourcePlanTitle}`]
        : []),
    ],
    PDF_SHEET_MARGIN,
    afterHeader(metaBottom, 62),
    doc.internal.pageSize.getWidth() - PDF_SHEET_MARGIN * 2,
    5
  );

  autoTable(doc, {
    startY: protocolMetaBottom + 4,
    head: [[centerCell("№"), centerCell("Требование"), centerCell("Да"), centerCell("Нет"), centerCell("Примечание")]],
    body: body.length > 0 ? body : [[{ content: "", colSpan: 5 }]],
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8,
      cellPadding: 1.4,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    // Прежние пропорции на всю ширину между полями — край в край со штампом
    // (сумма 264 мм была на 13 мм уже шапки).
    columnStyles: fitColumnWidths(doc, [12, 120, 16, 16, 100]),
  });

  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  // Подписи — над нижним полем листа, от левого поля.
  drawTextLinesInFrame(
    doc,
    params.config.signatures.map(
      (signature) =>
        `${signature.role || "Подпись"}: ${signature.name}${signature.signedAt ? `, ${formatRuDateDash(signature.signedAt)}` : ""}`
    ),
    PDF_SHEET_MARGIN,
    ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 66) + 10,
    6
  );
}

function drawAuditReportPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeAuditReportConfig>;
}) {
  drawTitle(doc, params.title);
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  doc.setFont("JournalUnicode", "normal");
  let cursorY = afterHeader(metaBottom, 64);
  cursorY = renderWrappedTextBlock(
    doc,
    [
      `Основание: ${params.config.basisTitle || "—"}`,
      `Объект аудита: ${params.config.auditedObject || "—"}`,
      `Аудиторы: ${(params.config.auditors || []).join(", ") || "—"}`,
      ...(params.config.sourceProtocolTitle
        ? [`По протоколу: ${params.config.sourceProtocolTitle}`]
        : []),
      `Итог: ${params.config.summary || "—"}`,
      `Рекомендации: ${params.config.recommendations || "—"}`,
    ],
    PDF_SHEET_MARGIN,
    cursorY,
    doc.internal.pageSize.getWidth() - PDF_SHEET_MARGIN * 2,
    5
  ) + 4;

  autoTable(doc, {
    startY: cursorY,
    head: [[
      centerCell("№"),
      centerCell("Несоответствие"),
      centerCell("Исправление"),
      centerCell("Корректирующие действия"),
      centerCell("Ответственный"),
      centerCell("Срок план"),
      centerCell("Срок факт"),
    ]],
    body: ensurePdfBodyRows(
      params.config.findings.map((finding, index) => [
        centerCell(String(index + 1)),
        centerCell(finding.nonConformity || ""),
        centerCell(finding.correctionActions || ""),
        centerCell(finding.correctiveActions || ""),
        centerCell([finding.responsiblePosition, finding.responsibleName].filter(Boolean).join(", ")),
        centerCell(finding.dueDatePlan ? formatRuDateDash(finding.dueDatePlan) : ""),
        centerCell(finding.dueDateFact ? formatRuDateDash(finding.dueDateFact) : ""),
      ]),
      7
    ),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.5,
      cellPadding: 1.3,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });

  // Подписи — над нижним полем листа, от левого поля.
  drawTextLinesInFrame(
    doc,
    params.config.signatures.map(
      (signature) =>
        `${signature.role || "Подпись"}: ${[signature.position, signature.name].filter(Boolean).join(", ")}${signature.signedAt ? `, ${formatRuDateDash(signature.signedAt)}` : ""}`
    ),
    PDF_SHEET_MARGIN,
    ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || cursorY) + 10,
    6
  );
}

function drawMetalImpurityPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeMetalImpurityConfig>;
}) {
  drawTitle(doc, params.title);
  const metaBottom = drawClimateMetaTable(doc, {
    organizationName: params.organizationName,
    title: params.title,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  autoTable(doc, {
    startY: afterHeader(metaBottom, 66),
    body: [[
      { content: "Ответственный", styles: { fontStyle: "bold" } },
      { content: `${params.config.responsiblePosition}: ${params.config.responsibleEmployee}`, colSpan: 8 },
    ]],
    theme: "grid",
    styles: { font: "JournalUnicode", fontSize: 9, lineColor: [0, 0, 0], textColor: [0, 0, 0] },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });

  autoTable(doc, {
    startY: (((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY) || 66) + 4,
    head: [[
      centerCell("№"),
      centerCell("Дата"),
      centerCell("Материал"),
      centerCell("Поставщик"),
      centerCell("Количество, кг"),
      centerCell("Металлопримеси, г"),
      centerCell("г/т"),
      centerCell("Характеристика"),
      centerCell("Ответственный"),
    ]],
    body: ensurePdfBodyRows(
      params.config.rows.map((row, index) => [
        centerCell(String(index + 1)),
        centerCell(row.date ? formatRuDateDash(row.date) : ""),
        centerCell(getMetalImpurityOptionName(params.config.materials, row.materialId)),
        centerCell(getMetalImpurityOptionName(params.config.suppliers, row.supplierId)),
        centerCell(row.consumedQuantityKg || ""),
        centerCell(row.impurityQuantityG || ""),
        centerCell(getMetalImpurityValuePerKg(row.impurityQuantityG, row.consumedQuantityKg) || ""),
        centerCell(row.impurityCharacteristic || ""),
        centerCell([row.responsibleRole, row.responsibleName].filter(Boolean).join(", ")),
      ]),
      9
    ),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.5,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
  });
}

function renderWrappedTextBlock(
  doc: jsPDF,
  lines: string[],
  x: number,
  y: number,
  width: number,
  lineHeight: number
) {
  let cursorY = y;
  doc.setFontSize(9);

  lines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, width) as string[];
    wrapped.forEach((chunk) => {
      doc.text(chunk, x, cursorY);
      cursorY += lineHeight;
    });
  });

  return cursorY;
}

function drawIntensiveCoolingPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  config: IntensiveCoolingConfig;
  users: PdfPositionUser[];
}) {
  const pageWidth = doc.internal.pageSize.getWidth();

  drawTitle(doc, params.title);

  // Общая шапка ХАССП той же ширины, что таблица (поля 10 мм): раньше
  // своя шапка была уже таблицы, а «СТР. 1 ИЗ 1» наезжала на рамку.
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: INTENSIVE_COOLING_DOCUMENT_TITLE,
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
    marginX: PDF_SHEET_MARGIN,
  });
  const coolingTitleY = afterHeader(headerBottom, 0) + 6;

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(13);
  doc.text(INTENSIVE_COOLING_DOCUMENT_TITLE.toUpperCase(), pageWidth / 2, coolingTitleY, {
    align: "center",
  });

  const head: RowInput[] = [[
    centerCell(""),
    centerCell("Дата и время изготовления блюда"),
    centerCell("Наименование блюда"),
    centerCell("Температура в начале процесса охлаждения"),
    centerCell("Температура через 1 час"),
    centerCell("Корректирующие действия"),
    centerCell("Комментарий"),
    centerCell("Лицо, проводившее контроль интенсивного охлаждения (должность, ФИО)"),
  ]];

  const body: RowInput[] =
    params.config.rows.length > 0
      ? params.config.rows.map((row) => {
          const user = params.users.find((item) => item.id === row.responsibleUserId);
          // «(должность, ФИО)» — должность этого сотрудника, не копия строки.
          const title = getRowEmployeeTitle(user, row.responsibleTitle);
          const responsibleLabel = [title === user?.name ? "" : title, user?.name]
            .filter(Boolean)
            .join(", ");

          return [
            centerCell(""),
            centerCell(
              `${formatIntensiveCoolingDate(row.productionDate)}\n${row.productionHour || "00"}:${row.productionMinute || "00"}`
            ),
            centerCell(row.dishName || "—"),
            centerCell(formatIntensiveCoolingTemperatureLabel(row.startTemperature)),
            centerCell(formatIntensiveCoolingTemperatureLabel(row.endTemperature)),
            centerCell(row.correctiveAction || "—"),
            centerCell(row.comment || "—"),
            centerCell(responsibleLabel || "—"),
          ];
        })
      : ensurePdfBodyRows([], 8);

  autoTable(doc, {
    startY: coolingTitleY + 6,
    head,
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7.2,
      cellPadding: 1.4,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
      halign: "center",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN },
    // Прежние пропорции на всю ширину между полями — край в край со штампом.
    columnStyles: fitColumnWidths(doc, [12, 34, 34, 28, 24, 62, 28, 42], PDF_SHEET_MARGIN),
  });
}

function drawFryerOilPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: FryerOilDocumentConfig;
  entries: { employeeId: string; date: Date | string; data: Record<string, unknown> }[];
}) {
  const pageWidth = doc.internal.pageSize.getWidth();

  drawTitle(doc, getFryerOilDocumentTitle());

  // Q1-B: своя урезанная шапка (без «Периодичность контроля» и без
  // «Начат/Окончен») заменена на общую drawJournalHeader — теперь
  // фритюрный журнал печатает ту же шапку, что и остальные.
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: journalNameOr(params.title),
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
    repeatOnPages: true,
  });

  /** Верх контента на страницах-продолжениях: строго под штампом. */
  const fryerContinuationTop = activePageHeaderHeight + HEADER_TITLE_GAP;

  // Centered title below header
  const fryerTitleY = afterHeader(headerBottom, 58);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  doc.text(params.title.toUpperCase(), pageWidth / 2, fryerTitleY, { align: "center" });

  // Main data table
  // Head: row 1 has all columns, but columns 8-9 span under a merged "Использование оставшегося жира" header
  const head: RowInput[] = [
    [
      { content: "Дата, время начала использования фритюрного жира", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Вид фритюрного жира", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Органолептическая оценка качества жира на начало жарки", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Тип жарочного оборудования", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Вид продукции", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Время окончания фритюрной жарки", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Органолептическая оценка качества жира по окончании жарки", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Использование оставшегося жира", colSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Должность, ФИО контролера", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
    ],
    [
      { content: "Переходящий остаток, кг", styles: { halign: "center", valign: "middle" } },
      { content: "Утилизированный, кг", styles: { halign: "center", valign: "middle" } },
    ],
  ];

  const body: RowInput[] = params.entries.map((entry) => {
    const data = normalizeFryerOilEntryData(entry.data);
    const startDateStr = data.startDate
      ? formatFryerDateRu(data.startDate)
      : (entry.date instanceof Date
          ? formatFryerDateRu(entry.date.toISOString().slice(0, 10))
          : formatFryerDateRu(String(entry.date).slice(0, 10)));
    const startTimeStr = formatFryerTime(data.startHour, data.startMinute);
    const endTimeStr = formatFryerTime(data.endHour, data.endMinute);
    const qualityStartLabel = formatFryerQuality(data.qualityStart);
    const qualityEndLabel = formatFryerQuality(data.qualityEnd);

    // Пустая ячейка на экране и в печати — «-», а не пустое место.
    const dash = (value: string) => centerCell(value.trim() ? value : "-");

    return [
      dash(`${startDateStr}\n${startTimeStr}`),
      dash(data.fatType),
      dash(qualityStartLabel),
      dash(data.equipmentType),
      dash(data.productType),
      dash(endTimeStr),
      dash(qualityEndLabel),
      dash(data.carryoverKg > 0 ? formatNumberShort(data.carryoverKg, 3) : ""),
      dash(data.disposedKg > 0 ? formatNumberShort(data.disposedKg, 3) : ""),
      dash(data.controllerName),
    ];
  });

  // Add empty rows if no entries
  if (body.length === 0) {
    for (let i = 0; i < 5; i++) {
      body.push(Array(10).fill(centerCell("")));
    }
  }

  autoTable(doc, {
    startY: fryerTitleY + 6,
    head,
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN, top: fryerContinuationTop },
    // Строка данных (дата + время двумя строками) не должна
    // рваться между страницами.
    rowPageBreak: "avoid",
  });

  const dataTableEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Appendix — quality assessment methodology
  const appendixStartY = dataTableEndY + 10;

  // Check if we need a new page for the appendix: заголовок приложения и
  // начало таблицы оценок — над нижним полем листа.
  const appendixY =
    appendixStartY + 8 > contentBottom(doc)
      ? (() => {
          doc.addPage();
          // Не 20мм: на новой странице сверху повторяется штамп ХАССП.
          return fryerContinuationTop + 4;
        })()
      : appendixStartY;

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("Приложение. Методика определения качества фритюрного жира.", PDF_SHEET_MARGIN, appendixY);

  // Quality indicators table — структура РОВНО как на экране
  // (fryer-oil-document-client): над четырьмя колонками одна
  // объединяющая ячейка «Оценка», подписи — строчными,
  // колонки «Коэффициент значимости» нет.
  const indicatorHead: RowInput[] = [
    [
      { content: "Показатели качества", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Оценка", colSpan: 4, styles: { halign: "center", valign: "middle" } },
    ],
    [
      { content: "отлично", styles: { halign: "center", valign: "middle" } },
      { content: "хорошо", styles: { halign: "center", valign: "middle" } },
      { content: "удовлетворительно", styles: { halign: "center", valign: "middle" } },
      { content: "неудовлетворительно", styles: { halign: "center", valign: "middle" } },
    ],
  ];

  const indicatorBody: RowInput[] = QUALITY_ASSESSMENT_TABLE.indicators.map((ind) => [
    centerCell(ind.name),
    centerCell(ind.scores[5]),
    centerCell(ind.scores[4]),
    centerCell(ind.scores[3]),
    centerCell(ind.scores[2]),
  ]);

  autoTable(doc, {
    startY: appendixY + 5,
    head: indicatorHead,
    body: indicatorBody,
    // E-аудит: колонка «Показатель качества» расползалась до ~181pt,
    // на эталоне она узкая (~65-95pt ≈ 23-34мм), а место отдано
    // описаниям оценок.
    columnStyles: {
      0: { cellWidth: 30 },
    },
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN, top: fryerContinuationTop },
  });

  const indicatorsEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Grading table
  const gradingHead: RowInput[] = [[
    { content: "Качество фритюра", styles: { halign: "center", valign: "middle" } },
    { content: "Бальная оценка", styles: { halign: "center", valign: "middle" } },
  ]];
  const gradingBody: RowInput[] = QUALITY_ASSESSMENT_TABLE.gradingTable.map((row) => [
    centerCell(row.label),
    centerCell(String(row.score)),
  ]);

  autoTable(doc, {
    startY: indicatorsEndY + 5,
    head: gradingHead,
    body: gradingBody,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    margin: { left: PDF_SHEET_MARGIN, right: 200, top: fryerContinuationTop },
  });

  const gradingEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Formula example (Y3: формула + расшифровка числителя/знаменателя,
  // как на эталоне — раньше печаталась одна строка без расшифровки).
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  // Экранная формулировка: заголовок — отдельной строкой,
  // формула — следующей, дальше расшифровка.
  const formulaLines = [
    "Пример расчета среднего балла:",
    QUALITY_ASSESSMENT_TABLE.formulaExample,
    ...QUALITY_ASSESSMENT_TABLE.formulaExplanation,
  ];
  // E-аудит: блок «Пример расчёта» вылезал за нижний край листа и глифы
  // терялись. Если он не помещается целиком — переносим на новую страницу.
  const formulaBlockHeight = 7 + formulaLines.length * 4.5;
  let formulaY = gradingEndY;
  if (formulaY + formulaBlockHeight > contentBottom(doc)) {
    doc.addPage();
    formulaY = fryerContinuationTop;
  }
  formulaLines.forEach((line, index) => {
    doc.text(line, PDF_SHEET_MARGIN, formulaY + 7 + index * 4.5);
  });
}

function drawGlassControlPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date;
  dateTo: Date;
  status: string;
  responsibleName: string;
  config: ReturnType<typeof normalizeGlassControlConfig>;
  entries: Array<{ date: Date; employeeId: string; data: Record<string, unknown> }>;
  users: PdfPositionUser[];
}) {
  const pageWidth = doc.internal.pageSize.getWidth();

  drawTitle(doc, params.title);
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: GLASS_CONTROL_PAGE_TITLE,
    withPeriodicity: false,
    // Экран печатает в шапке «Частоту контроля» документа, а не общий
    // текст периодичности шаблона — печать обязана совпадать.
    periodicityText: params.config.controlFrequency,
    // Раньше «Начат/Окончен» печатались абсолютными координатами прямо
    // поверх правой ячейки шапки — теперь это её штатная часть.
    startedDate: params.dateFrom,
    finishedDate: params.status === "closed" ? params.dateTo : null,
    repeatOnPages: true,
  });

  // Отдельная строка «Частота контроля» убрана: то же значение теперь
  // стоит в шапке ХАССП, как на экране, и дублировалось на бланке.
  // Пустые заготовки строк печатаются ПУСТЫМИ — см.
  // buildGlassControlPdfRows. Раньше здесь нормализация достраивала
  // `damagesDetected:false`, и бланк утверждал, что осмотр проведён.
  const bodyRows: RowInput[] = buildGlassControlPdfRows({
    entries: params.entries,
    formatDate: formatGlassRuDateDash,
    resolveUserName: (employeeId) =>
      params.users.find((user) => user.id === employeeId)?.name ||
      params.responsibleName,
  });

  if (bodyRows.length === 0) {
    bodyRows.push(...ensurePlainRows(7));
  } else {
    bodyRows.push(["", "", "", "", "", "", ""]);
  }

  autoTable(doc, {
    startY: afterHeader(headerBottom, 50),
    head: [[
      "Дата",
      "Да",
      "Нет",
      "Наименование",
      "Кол-во",
      "Информация о повреждениях / замены",
      "Фамилия ответственного лица",
    ]],
    body: bodyRows,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 8.5,
      cellPadding: 1.6,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineColor: [0, 0, 0],
    },
    // Резерв под повтор штампа ХАССП на страницах 2..N — иначе вторая
    // страница бланка уходила инспектору без шапки.
    margin: { left: PDF_SHEET_MARGIN, right: PDF_SHEET_MARGIN, top: activePageHeaderHeight + HEADER_TITLE_GAP },
    // Прежние пропорции на всю ширину между полями — край в край со штампом
    // (сумма 192 мм была на 77 мм уже шапки).
    columnStyles: (() => {
      const widths = fitColumnWidths(doc, [24, 12, 12, 42, 16, 58, 28]);
      const center = (index: number) => ({ ...widths[index], halign: "center" as const });
      return { ...widths, 0: center(0), 1: center(1), 2: center(2), 4: center(4), 6: center(6) };
    })(),
  });
}

/**
 * Документ в том виде, в каком его ждёт рендерер.
 *
 * Выведен из Prisma, а не переписан руками: тело рендера трогает
 * десятки полей, и структурный тип «на глаз» разъехался бы со схемой
 * при первой же миграции. Образцы журналов для лендинга собирают
 * объект этой же формы — см. src/lib/journal-sample-fixtures.ts.
 */
export type JournalDocumentForPdf = Prisma.JournalDocumentGetPayload<{
  include: {
    template: true;
    organization: {
      select: {
        name: true;
        journalShortName: true;
        legalProfileJson: true;
        inn: true;
        address: true;
        phone: true;
      };
    };
    /// Точка документа — печатается под названием организации.
    building: { select: { name: true; address: true; journalName: true } };
    entries: true;
  };
}>;

/**
 * Что нужно рендереру PDF, кроме самого документа.
 *
 * Тип структурный, а не Prisma-payload: по этим же данным собираются
 * образцы журналов для публичного лендинга, где ни организации, ни
 * пользователей в БД нет.
 */
export type JournalDocumentPdfUser = {
  id: string;
  name: string;
  role: string;
  email: string;
  positionTitle: string;
};

export type JournalDocumentPdfInput = {
  document: JournalDocumentForPdf;
  users: JournalDocumentPdfUser[];
  equipment: { id: string; name: string }[];
  /// Помещения организации. Нужны только журналу уборки в rooms-mode —
  /// у остальных пустой список, лишнего запроса не делаем. detergent и
  /// scope нужны для колонки «средства» и справочника под бланком (C7).
  rooms: {
    id: string;
    name: string;
    detergent?: string | null;
    currentScope?: unknown;
    generalScope?: unknown;
    /// 2026-09-04: кто убирает / кто проверяет — коды у комнат и строка
    /// «Проверяет» в rooms-mode.
    cleanerUserIds?: string[];
    verifierUserIds?: string[];
    /// Нормы климата (Room.climateNorms) — печать климата по справочнику.
    climateNorms?: unknown;
  }[];
  /// White-label партнёра: подпись в подвале каждой страницы + плашка
  /// «Работает на платформе WeSetup». `null`/undefined — организация без
  /// партнёра или скрыла брендинг, подвал не печатается.
  branding?: PdfFooterBrand | null;
  /// Подписи сотрудников через общий планшет (ПИН) за период документа —
  /// печатаются отдельной страницей-приложением. Пусто → страницы нет.
  signatures?: PdfSignatureLine[];
  /// Фирменный QR в шапке ХАССП справа — на каждой странице с шапкой
  /// (`pdf-journal-qr.ts`). Нет поля — бланк печатается без QR, как раньше.
  qr?: JournalPdfQr | null;
  /// Сканы приказов к журналу (гигиена, бракераж готовой продукции) —
  /// страницы после журнала, без QR-штампа. Добавляет
  /// `generateJournalDocumentPdf`; чистый рендер их не трогает.
  orderScans?: OrderScanForPdf[];
};

export type PdfSignatureLine = {
  employeeName: string;
  method: string;
  device: string | null;
  count: number;
  /// Сколько входов с фотофиксацией (кадр приложен к подписи).
  photos: number;
  firstAt: Date;
  lastAt: Date;
};

/**
 * Загрузка входных данных из БД. Единственная часть генерации, которая
 * ходит в базу, — вынесена отдельно, чтобы `renderJournalDocumentPdf`
 * оставался чистым и его можно было позвать на выдуманных данных.
 */
export async function loadJournalDocumentPdfInput(params: {
  documentId: string;
  organizationId: string;
}): Promise<JournalDocumentPdfInput> {
  const { documentId, organizationId } = params;

  const document = await db.journalDocument.findUnique({
    where: { id: documentId },
    include: {
      template: true,
      organization: {
        select: {
          name: true,
          journalShortName: true,
          legalProfileJson: true,
          inn: true,
          address: true,
          phone: true,
        },
      },
      building: { select: { name: true, address: true, journalName: true } },
      // ВАЖНО: берём ВСЕ строки, включая `_autoSeeded` плейсхолдеры.
      // Экран документа (page.tsx) рендерит их как структуру таблицы
      // (ростер сотрудников в гигиене/здоровье, дневные строки в
      // климате/холодильниках/фритюре), поэтому PDF, который их
      // отфильтровывал, печатал 2-6 пустых строк-заглушек вместо
      // реальной сетки. Ниже (см. `entries`) data плейсхолдера
      // приводится к `{}` — строка остаётся, но «заполненной» не
      // считается ни в одном нормализаторе.
      entries: {
        orderBy: [{ employeeId: "asc" }, { date: "asc" }],
      },
    },
  });

  if (!document || document.organizationId !== organizationId) {
    throw new Error("Документ не найден");
  }

  // Должность берём из того же источника, что и экран документа:
  // jobPosition.name → positionTitle → лейбл роли (getUserDisplayTitle).
  // Раньше PDF печатал только лейбл роли и расходился с экраном
  // («Управляющий» вместо «Менеджер», «Повар» вместо «Кондитер»).
  // Плюс уволенные, на которых ссылаются записи документа: бланк — это
  // архивный документ, и после увольнения строка не должна исчезать из
  // печати (или печататься без фамилии).
  const referencedEmployeeIds = [
    ...new Set(document.entries.map((entry) => entry.employeeId).filter(Boolean)),
  ];
  const dbUsers = await db.user.findMany({
    where: {
      organizationId,
      OR: [{ isActive: true }, { id: { in: referencedEmployeeIds } }],
    },
    select: {
      id: true,
      name: true,
      role: true,
      email: true,
      positionTitle: true,
      jobPosition: { select: { name: true } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const users = dbUsers.map((user) => {
    const positionTitle = getUserDisplayTitle(user);
    return {
      id: user.id,
      // Почта вместо фамилии на бланк не идёт: у аккаунта мгновенной
      // регистрации в шапке и строках печаталось «owner-a@e2e.local».
      // Вместо неё — должность, а если нет и её — «Без имени».
      name: getUserDisplayName(user, positionTitle),
      role: user.role,
      email: user.email,
      positionTitle,
    };
  });
  const equipment = await db.equipment.findMany({
    where: {
      area: {
        organizationId,
      },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Помещения раньше подгружались из середины рендера — из-за этого он
  // не мог быть чистой функцией. Тянем их здесь и только для журнала
  // уборки: остальным формам они не нужны.
  // 2026-09-04: единый справочник — климат и график ген. уборок тоже
  // печатают имена/нормы помещений из Room.
  const rooms =
    document.template.code === CLEANING_DOCUMENT_TEMPLATE_CODE ||
    document.template.code === CLIMATE_DOCUMENT_TEMPLATE_CODE ||
    document.template.code === SANITATION_DAY_TEMPLATE_CODE
      ? await db.room.findMany({
          // C7 аудита: печать уборки в rooms-mode берёт название,
          // средства и шаги (scope) из Room — единственного источника
          // правды. Раньше detergent/scope читались из config.rooms,
          // и после перевода документа на Room справочник под бланком
          // печатался пустым, а колонка «средства» — прочерками.
          where: {
            building: {
              organizationId,
              ...(document.buildingId ? { id: document.buildingId } : {}),
            },
          },
          select: {
            id: true,
            name: true,
            detergent: true,
            currentScope: true,
            generalScope: true,
            cleanerUserIds: true,
            verifierUserIds: true,
            climateNorms: true,
          },
          orderBy: [{ buildingId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        })
      : [];

  const orgBranding = await getVisibleOrgBranding(organizationId);
  const branding: PdfFooterBrand | null = orgBranding
    ? { brandName: orgBranding.brandName, pdfSignature: orgBranding.pdfSignature }
    : null;

  // Подписи через общий планшет за период документа — по сотрудникам.
  const signatures = await loadPdfSignatureLines({
    organizationId,
    employeeIds: document.entries.map((e) => e.employeeId),
    from: document.dateFrom,
    to: new Date(document.dateTo.getTime() + 24 * 60 * 60 * 1000),
    users,
  }).catch(() => []);

  // QR в шапке каждой страницы — на основной QR этого журнала.
  // Нет секрета QR (стенд без настроек) — печатаем бланк без кода.
  let qr: JournalPdfQr | null = null;
  try {
    qr = journalDocumentPdfQr(journalPdfQrOrigin(), organizationId, document.template.code);
  } catch (error) {
    console.warn("[document-pdf] journal QR skipped", error instanceof Error ? error.message : error);
  }

  // Приказы к журналу (организация + код журнала) — печатаются после
  // страниц журнала. Ошибка чтения не ломает печать самого журнала.
  const orderScans = await loadOrderScansForPdf(organizationId, document.template.code).catch((error) => {
    console.warn("[document-pdf] order scans skipped", error instanceof Error ? error.message : error);
    return [] as OrderScanForPdf[];
  });

  return { document, users, equipment, rooms, branding, signatures, qr, orderScans };
}

async function loadPdfSignatureLines(params: {
  organizationId: string;
  employeeIds: string[];
  from: Date;
  to: Date;
  users: JournalDocumentPdfUser[];
}): Promise<PdfSignatureLine[]> {
  const { loadSignatureEvidence, SIGNATURE_METHOD_LABEL } = await import("@/lib/signature-evidence");
  const { events, deviceLabels } = await loadSignatureEvidence({
    organizationId: params.organizationId,
    userIds: params.employeeIds,
    from: params.from,
    to: params.to,
  });
  const nameById = new Map(params.users.map((u) => [u.id, u.name]));
  const groups = new Map<string, PdfSignatureLine>();
  for (const ev of events) {
    if (ev.createdAt < params.from) continue;
    const device = ev.deviceId ? (deviceLabels.get(ev.deviceId) ?? null) : null;
    const key = `${ev.userId}|${ev.method}|${device ?? ""}`;
    const line = groups.get(key);
    if (line) {
      line.count += 1;
      if (ev.photoUrl) line.photos += 1;
      if (ev.createdAt < line.firstAt) line.firstAt = ev.createdAt;
      if (ev.createdAt > line.lastAt) line.lastAt = ev.createdAt;
    } else {
      groups.set(key, {
        employeeName: nameById.get(ev.userId) ?? "—",
        method: SIGNATURE_METHOD_LABEL[ev.method] ?? ev.method,
        device,
        count: 1,
        photos: ev.photoUrl ? 1 : 0,
        firstAt: ev.createdAt,
        lastAt: ev.createdAt,
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName, "ru"));
}

/**
 * Загрузка + рендер одним вызовом — через него идут все печати журнала.
 * Сканы приказов к журналу (если есть) приклеиваются после страниц
 * журнала: уже после QR-штампа и нумерации, поэтому ни QR, ни «СТР. i ИЗ
 * N» на них нет.
 */
export async function generateJournalDocumentPdf(params: {
  documentId: string;
  organizationId: string;
}): Promise<{ buffer: Buffer; fileName: string }> {
  const input = await loadJournalDocumentPdfInput(params);
  const rendered = renderJournalDocumentPdf(input);
  if (!input.orderScans || input.orderScans.length === 0) return rendered;
  const merged = await appendOrderScansToPdf(new Uint8Array(rendered.buffer), input.orderScans);
  return { buffer: merged.buffer, fileName: rendered.fileName };
}

/**
 * Бессрочный документ к печати: `dateTo` прижимается к сегодняшнему дню,
 * записи с будущими датами отбрасываются.
 *
 * ПОЧЕМУ: у perpetual-журналов (контроль стекла, интенсивное охлаждение,
 * дезсредства, чек-лист сан. дня) `dateTo = 31.12.2099` — это маркер
 * «документ не ротируется», а не конец периода. Печать строила сетку по
 * нему и выдавала десятки страниц дней, которых ещё не было.
 */
function clampPerpetualDocumentForPrint(
  document: JournalDocumentForPdf
): JournalDocumentForPdf {
  if (!isPerpetualDateTo(document.dateTo)) return document;
  const dateTo = resolveDisplayDateTo(document.dateTo, orgTodayKey());
  if (dateTo.getTime() === document.dateTo.getTime()) return document;
  const limit = dateTo.getTime();
  return {
    ...document,
    dateTo,
    entries: document.entries.filter((entry) => entry.date.getTime() <= limit),
  };
}

export type RenderedJournalDocumentPdf = {
  buffer: Buffer;
  fileName: string;
  /** Где встал QR на каждой странице (есть, только если во входе `qr`). */
  qrPlacements?: JournalQrPlacement[];
};

/**
 * Чистый рендер: ни одного обращения к БД, только jsPDF поверх
 * переданных данных.
 *
 * QR (если есть во входе) — в шапке ХАССП справа, своей ячейкой: строк
 * таблицы он не занимает, поэтому рендер один, а таблицы доходят до
 * нижнего поля листа (раньше под угловой QR поднималось нижнее поле всех
 * таблиц, и рендер шёл в два прохода).
 */
export function renderJournalDocumentPdf(input: JournalDocumentPdfInput): RenderedJournalDocumentPdf {
  const { users, equipment, rooms, branding } = input;
  // Бессрочный документ (`dateTo = 31.12.2099`) печатается по сегодняшний
  // день: иначе сетка бланка растягивалась на десятки страниц будущих дат.
  // Старое название журнала в заголовке документа (переименование
  // 2026-09-28, `journal-title-renames.ts`) печатается новым — даже если сид
  // этот документ ещё не переименовал.
  const clamped = clampPerpetualDocumentForPrint(input.document);
  const document = {
    ...clamped,
    title: renamedJournalDocumentTitle(clamped.template.code, clamped.title ?? ""),
    template: {
      ...clamped.template,
      name: renamedJournalDocumentTitle(clamped.template.code, clamped.template.name ?? ""),
    },
  };

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const fontName = loadUnicodeFont(doc);
  doc.setFont(fontName, "normal");

  // QR в шапке: плитка под адрес — до первой отрисовки (шапка оставит под
  // неё ячейку); учёт нарисованного — для страниц без шапки (QR встаёт в
  // правый верхний угол, только если там пусто).
  const qr = input.qr?.url ? input.qr : null;
  if (qr) prepareJournalQr(doc, qr.url);
  const inkTracker = qr ? trackPdfInk(doc) : null;
  // Нижнее поле таблиц и текста бланка: поле листа + полоса под «СТР. X
  // ИЗ N» (или под подвал партнёра в две строки — она выше).
  activeFooterTextBandMm = branding ? JOURNAL_FOOTER_TEXT_BAND_BRANDED_MM : JOURNAL_FOOTER_TEXT_BAND_MM;
  if (activeFooterTextBandMm > JOURNAL_FOOTER_TEXT_BAND_MM) {
    reserveJournalTableBottom(doc, PDF_SHEET_MARGIN + activeFooterTextBandMm);
  }

  const templateCode = document.template.code;
  const dateKeys = buildDateKeys(document.dateFrom, document.dateTo);
  // В шапку всех PDF'ов сразу подставляем «name · ИНН XXX · адрес»,
  // если эти поля заполнены в /settings/organization. У инспектора СЭС
  // должны быть реквизиты прямо на печатной форме без дополнительной
  // сверки. Если что-то не задано — просто пропускаем разделитель.
  // Точки: под названием организации печатается точка с адресом.
  // Название — сокращённое для журналов (своё у документа → общее → ЕГРЮЛ
  // → полное), как в шапке на экране.
  const orgName = withBuildingLabel(
    resolveOrgJournalName(document.organization, document.config),
    document.building,
  );
  const orgInn = document.organization?.inn ?? null;
  const orgAddress = document.organization?.address ?? null;
  const organizationName = [
    orgName,
    orgInn ? `ИНН ${orgInn}` : null,
    orgAddress,
  ]
    .filter((v): v is string => Boolean(v))
    .join(" · ");
  const monthLabel = formatMonthLabel(document.dateFrom, document.dateTo);
  // Плейсхолдеры сидера (`{_autoSeeded:true}`) остаются СТРОКАМИ таблицы
  // (иначе PDF теряет ростер/дневную сетку, которую видно на экране), но
  // их data обнуляется — ни один нормализатор не посчитает их заполненными.
  const entries = document.entries.map((entry) =>
    isAutoSeededEntry(entry.data) ? { ...entry, data: {} as Record<string, unknown> } : entry
  );
  const employeeIds = entries.map((entry) => entry.employeeId);
  const entryMap: Record<string, Record<string, unknown>> = {};
  const reconciledConfig = normalizeJournalStaffBoundConfig(templateCode, document.config, users);
  const climateConfig = applyRoomDirectoryToClimateConfig(
    normalizeClimateDocumentConfig(reconciledConfig),
    rooms,
  );
  const coldConfig = normalizeColdEquipmentDocumentConfig(reconciledConfig);
  // Эффективный конфиг уборки: уборщики/проверяющие помещений из Room
  // (та же точка слияния, что у TF-адаптера) — коды у комнат и строка
  // «Проверяет» печатаются по назначениям помещений.
  const cleaningConfig = applyRoomResponsiblesToConfig(
    normalizeCleaningDocumentConfig(reconciledConfig),
    rooms.map((r) => ({
      id: r.id,
      cleanerUserIds: r.cleanerUserIds ?? [],
      verifierUserIds: r.verifierUserIds ?? [],
    })),
    new Set(users.map((u) => u.id)),
  );
  const finishedConfig = normalizeFinishedProductDocumentConfig(reconciledConfig);
  const perishableRejectionConfig = normalizePerishableRejectionConfig(reconciledConfig);
  const uvRuntimeConfig = normalizeUvRuntimeDocumentConfig(reconciledConfig);
  const equipmentCalibrationConfig = normalizeEquipmentCalibrationConfig(reconciledConfig);
  const trackedFields = getTrackedFields(document.template.fields);
  const registerFields = parseRegisterFields(document.template.fields);
  const registerConfig = normalizeRegisterDocumentConfig(reconciledConfig, registerFields);
  const traceabilityConfig = normalizeTraceabilityDocumentConfig(reconciledConfig);
  const equipmentCleaningConfig = normalizeEquipmentCleaningConfig(reconciledConfig);
  const intensiveCoolingConfig = normalizeIntensiveCoolingConfig(reconciledConfig, users);
  const medBookConfig = normalizeMedBookConfig(reconciledConfig);
  const auditPlanConfig = normalizeAuditPlanConfig(reconciledConfig);
  const auditProtocolConfig = normalizeAuditProtocolConfig(reconciledConfig);
  const auditReportConfig = normalizeAuditReportConfig(reconciledConfig);
  const metalImpurityConfig = normalizeMetalImpurityConfig(reconciledConfig);
  const disinfectantConfig = normalizeDisinfectantConfig(reconciledConfig);

  entries.forEach((entry) => {
    entryMap[makeCellKey(entry.employeeId, toDateKey(entry.date))] =
      (entry.data as Record<string, unknown>) || {};
  });

  // Ставим ДО первой отрисовки и ПОСЛЕ всех await — дальше идёт только
  // синхронный jsPDF, поэтому параллельные генерации не пересекаются.
  // Каждый вызов перезаписывает значение первым делом, так что исключение
  // в середине отрисовки не «протекает» в следующий PDF.
  activeControlPeriodicity = readControlPeriodicity(document.config, templateCode);
  activeDocumentStatus = document.status ?? "";
  activeHeaderTitle = readHeaderTitleOverride(document.config) ?? "";
  activeJournalName = document.template.name ?? "";
  activePageHeaderPainter = null;
  activePageHeaderHeight = 0;
  pagesWithJournalHeader.clear();
  titleBottomByPage.clear();
  lastHeaderTop = LEGACY_HEADER_TOP;
  resetPageLabelSlots();

  if (templateCode === "hygiene" && readHygieneFormVersion(document.config) === 2) {
    drawHygieneV2Pdf(doc, {
      organizationName,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      dateKeys,
      users,
      entries,
    });
  } else if (templateCode === "hygiene") {
    drawHygienePdf(doc, {
      organizationName,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      title: document.title || getHygieneDocumentTitle(),
      monthLabel,
      dateKeys,
      users,
      employeeIds,
      responsibleTitle: document.responsibleTitle,
      entryMap,
      printEmptyRows: readPrintEmptyRows(document.config),
    });
  } else if (templateCode === "health_check") {
    drawHealthPdf(doc, {
      organizationName,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      title: document.title || getHealthDocumentTitle(),
      monthLabel,
      dateKeys,
      users,
      employeeIds,
      entryMap,
      printEmptyRows: readPrintEmptyRows(document.config),
    });
  } else if (templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    drawClimatePdf(doc, {
      organizationName,
      title: document.title || getClimateDocumentTitle(),
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: climateConfig,
      entries: entries.map((entry) => ({
        employeeId: entry.employeeId,
        date: entry.date,
        data: (entry.data as Record<string, unknown>) || {},
      })),
      users,
    });
  } else if (templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    drawColdEquipmentPdf(doc, {
      organizationName,
      title: document.title || getColdEquipmentDocumentTitle(),
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: coldConfig,
      monthLabel,
      users,
      entries: entries.map((entry) => ({
        employeeId: entry.employeeId,
        date: entry.date,
        data: (entry.data as Record<string, unknown>) || {},
      })),
    });
  } else if (templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE) {
    // Для rooms-mode подгружаем имена помещений и инициалы юзеров.
    // В pairs-mode params не используются — pdf рендерится по старой
    // логике из config.rooms / config.controlResponsibles.
    const cleaningRoomNamesById: Record<string, string> = {};
    const cleaningUserInitialsById: Record<string, string> = {};
    const cleaningUserNamesById: Record<string, string> = {};
    const cleaningRoomDetailsById: Record<
      string,
      { name: string; detergent: string; currentScope: string[]; generalScope: string[] }
    > = {};
    const asStringList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    if (cleaningConfig?.cleaningMode === "rooms") {
      for (const r of rooms) {
        cleaningRoomNamesById[r.id] = r.name;
        cleaningRoomDetailsById[r.id] = {
          name: r.name,
          detergent: r.detergent ?? "",
          currentScope: asStringList(r.currentScope),
          generalScope: asStringList(r.generalScope),
        };
      }
      for (const u of users) {
        cleaningUserNamesById[u.id] = u.name ?? "";
        const parts = (u.name ?? "").trim().split(/\s+/);
        cleaningUserInitialsById[u.id] = parts
          .map((p) => p[0]?.toUpperCase() ?? "")
          .slice(0, 3)
          .join("");
      }
    }
    drawCleaningPdf(doc, {
      organizationName,
      title: document.title || getCleaningDocumentTitle(),
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: cleaningConfig,
      roomNamesById: cleaningRoomNamesById,
      roomDetailsById: cleaningRoomDetailsById,
      userInitialsById: cleaningUserInitialsById,
      userNamesById: cleaningUserNamesById,
      entries: entries.map((entry) => ({
        employeeId: entry.employeeId,
        date: entry.date,
        data: (entry.data as Record<string, unknown>) || {},
      })),
    });
  } else if (templateCode === MED_BOOK_TEMPLATE_CODE) {
    drawMedBookPdf(doc, {
      organizationName,
      title: MED_BOOK_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: medBookConfig,
      entries: entries.map((entry) => ({
        employeeId: entry.employeeId,
        date: entry.date,
        data: entry.data,
      })),
      users,
    });
  } else if (templateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) {
    drawFinishedProductPdf(doc, {
      organizationName,
      title: document.title || getFinishedProductDocumentTitle(),
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: finishedConfig,
    });
  } else if (templateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE) {
    drawEquipmentMaintenancePdf(doc, {
      organizationName,
      title: document.title || EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      // Имена связанных со справочником строк — как на экране, иначе
      // после переименования в /settings/equipment печать расходилась.
      config: withResolvedEquipmentNames(
        normalizeEquipmentMaintenanceConfig(reconciledConfig),
        equipment
      ),
    });
  } else if (templateCode === STAFF_TRAINING_TEMPLATE_CODE) {
    drawStaffTrainingPdf(doc, {
      organizationName,
      title: document.title || STAFF_TRAINING_FULL_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: normalizeStaffTrainingConfig(reconciledConfig),
    });
  } else if (templateCode === PERISHABLE_REJECTION_TEMPLATE_CODE) {
    drawPerishableRejectionPdf(doc, {
      organizationName,
      title: document.title || getPerishableRejectionDocumentTitle(),
      dateFrom: document.dateFrom,
      config: perishableRejectionConfig,
    });
  } else if (templateCode === PRODUCT_WRITEOFF_TEMPLATE_CODE) {
    drawProductWriteoffPdf(doc, {
      organizationName,
      title: document.title || "Акт забраковки",
      dateFrom: document.dateFrom,
      config: normalizeProductWriteoffConfig(reconciledConfig),
    });
  } else if (templateCode === GLASS_LIST_TEMPLATE_CODE) {
    const glassListConfig = normalizeGlassListConfig(reconciledConfig);
    drawGlassListPdf(doc, {
      organizationName,
      title: document.title || "Перечень изделий",
      dateFrom: document.dateFrom,
      config: glassListConfig,
      responsibleName:
        users.find((user) => user.id === (document.responsibleUserId || glassListConfig.responsibleUserId))
          ?.name || "",
    });
  } else if (templateCode === GLASS_CONTROL_TEMPLATE_CODE) {
    drawGlassControlPdf(doc, {
      organizationName,
      title: document.title || GLASS_CONTROL_PAGE_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      status: document.status,
      responsibleName:
        users.find((user) => user.id === document.responsibleUserId)?.name || "",
      config: normalizeGlassControlConfig(reconciledConfig),
      entries: entries.map((entry) => ({
        date: entry.date,
        employeeId: entry.employeeId,
        data: (entry.data as Record<string, unknown>) || {},
      })),
      users,
    });
  } else if (templateCode === SANITATION_DAY_TEMPLATE_CODE) {
    drawSanitationDayPdf(doc, {
      organizationName,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      title: document.title || SANITATION_DAY_DOCUMENT_TITLE,
      // Экран (sanitation-day-document-client) читает СЫРОЙ document.config.
      // Через reconciledConfig PDF подменял сохранённые «Кондитер / амаап»
      // дефолтами «Управляющий / Администратор» — бланк расходился с экраном.
      config: applyRoomDirectoryToSanitationConfig(
        normalizeSanitationDayConfig(document.config),
        rooms,
      ),
      users,
    });
  } else if (templateCode === TRAINING_PLAN_TEMPLATE_CODE) {
    drawTrainingPlanPdf(doc, {
      organizationName,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      title: document.title || TRAINING_PLAN_HEADING,
      config: normalizeTrainingPlanConfig(reconciledConfig),
      users,
    });
  } else if (templateCode === AUDIT_PLAN_TEMPLATE_CODE) {
    drawAuditPlanPdf(doc, {
      organizationName,
      title: document.title || AUDIT_PLAN_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: auditPlanConfig,
      users,
    });
  } else if (templateCode === AUDIT_PROTOCOL_TEMPLATE_CODE) {
    drawAuditProtocolPdf(doc, {
      organizationName,
      title: document.title || AUDIT_PROTOCOL_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: auditProtocolConfig,
    });
  } else if (templateCode === AUDIT_REPORT_TEMPLATE_CODE) {
    drawAuditReportPdf(doc, {
      organizationName,
      title: document.title || AUDIT_REPORT_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: auditReportConfig,
    });
  } else if (templateCode === METAL_IMPURITY_TEMPLATE_CODE) {
    drawMetalImpurityPdf(doc, {
      organizationName,
      title: document.title || METAL_IMPURITY_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: metalImpurityConfig,
    });
  } else if (templateCode === BREAKDOWN_HISTORY_TEMPLATE_CODE) {
    drawBreakdownHistoryPdf(doc, {
      organizationName,
      title: document.title || BREAKDOWN_HISTORY_HEADING,
      dateFrom: document.dateFrom,
      config: withResolvedEquipmentNames(
        normalizeBreakdownHistoryDocumentConfig(reconciledConfig),
        equipment
      ),
    });
  } else if (templateCode === ACCIDENT_DOCUMENT_TEMPLATE_CODE) {
    drawAccidentPdf(doc, {
      organizationName,
      title: document.title || ACCIDENT_DOCUMENT_HEADING,
      dateFrom: document.dateFrom,
      config: normalizeAccidentDocumentConfig(reconciledConfig),
    });
  } else if (templateCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE) {
    drawEquipmentCalibrationPdf(doc, {
      organizationName,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      title: document.title || EQUIPMENT_CALIBRATION_DOCUMENT_TITLE,
      config: withResolvedEquipmentNames(equipmentCalibrationConfig, equipment),
      users,
    });
  } else if (templateCode === ACCEPTANCE_DOCUMENT_TEMPLATE_CODE) {
    drawIncomingControlPdf(doc, {
      organizationName,
      title: document.title || getAcceptanceDocumentTitle(templateCode),
      dateFrom: document.dateFrom,
      config: normalizeAcceptanceDocumentConfig(reconciledConfig, users),
      users,
    });
  } else if ((ACCEPTANCE_DOCUMENT_TEMPLATE_CODES as readonly string[]).includes(templateCode)) {
    drawAcceptancePdf(doc, {
      organizationName,
      title: document.title || getAcceptanceDocumentTitle(templateCode),
      dateFrom: document.dateFrom,
      config: normalizeAcceptanceDocumentConfig(reconciledConfig, users),
      users,
    });
  } else if (templateCode === PPE_ISSUANCE_TEMPLATE_CODE) {
    drawPpeIssuancePdf(doc, {
      organizationName,
      title: document.title || PPE_ISSUANCE_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      config: normalizePpeIssuanceConfig(reconciledConfig, users),
      users,
    });
  } else if (templateCode === TRACEABILITY_DOCUMENT_TEMPLATE_CODE) {
    drawTraceabilityPdf(doc, {
      organizationName,
      title: document.title || "Журнал прослеживаемости продукции",
      dateFrom: document.dateFrom,
      config: traceabilityConfig,
    });
  } else if (templateCode === EQUIPMENT_CLEANING_TEMPLATE_CODE) {
    drawEquipmentCleaningPdf(doc, {
      organizationName,
      title: document.title || "Журнал мойки и дезинфекции оборудования",
      dateFrom: document.dateFrom,
      fieldVariant: equipmentCleaningConfig.fieldVariant,
      equipmentDirectory: equipment,
      users,
      entries: entries.map((entry) => ({
        id: entry.id,
        date: entry.date,
        data: (entry.data as Record<string, unknown>) || {},
      })),
    });
  } else if (templateCode === DISINFECTANT_TEMPLATE_CODE) {
    drawDisinfectantPdf(doc, {
      organizationName,
      title: document.title || DISINFECTANT_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: disinfectantConfig,
    });
  } else if (templateCode === INTENSIVE_COOLING_TEMPLATE_CODE) {
    drawIntensiveCoolingPdf(doc, {
      organizationName,
      title: document.title || INTENSIVE_COOLING_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      config: intensiveCoolingConfig,
      users,
    });
  } else if (isRegisterDocumentTemplate(templateCode)) {
    drawRegisterPdf(doc, {
      organizationName,
      title: document.title || getRegisterDocumentTitle(templateCode),
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      fields: registerFields,
      config: registerConfig,
      users,
      equipment,
    });
  } else if (templateCode === FRYER_OIL_TEMPLATE_CODE) {
    drawFryerOilPdf(doc, {
      organizationName,
      title: document.title || getFryerOilDocumentTitle(),
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: normalizeFryerOilDocumentConfig(reconciledConfig),
      entries: entries.map((entry) => ({
        employeeId: entry.employeeId,
        date: entry.date,
        data: (entry.data as Record<string, unknown>) || {},
      })),
    });
  } else if (templateCode === UV_LAMP_RUNTIME_TEMPLATE_CODE) {
    // Mirror the UI rule from uv-lamp-runtime-document-client: for an active
    // document, cap the visible period at today so the PDF doesn't print
    // empty rows for dates that haven't happened yet.
    const uvEffectiveTo =
      document.status === "closed"
        ? document.dateTo
        : (() => {
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            return today < document.dateTo ? today : document.dateTo;
          })();
    const uvVisibleEntries = buildVisibleUvRuntimeEntries(
      entries.map((entry) => ({
        employeeId: entry.employeeId,
        date: entry.date,
        data: (entry.data as Record<string, unknown>) || {},
      })),
      document.dateFrom,
      uvEffectiveTo
    );

    drawUvRuntimePdf(doc, {
      organizationName,
      title: document.title || getTrackedDocumentTitle(templateCode),
      dateFrom: document.dateFrom,
      dateTo: uvEffectiveTo,
      config: uvRuntimeConfig,
      entries: uvVisibleEntries,
      users,
    });
  } else if (templateCode === PEST_CONTROL_TEMPLATE_CODE) {
    drawPestControlPdf(doc, {
      organizationName,
      title: document.title || PEST_CONTROL_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      entries: entries.map((entry) => ({
        employeeId: entry.employeeId,
        date: entry.date,
        data: (entry.data as Record<string, unknown>) || {},
      })),
      users,
    });
  } else if (templateCode === CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE) {
    drawCleaningVentilationChecklistPdf(doc, {
      organizationName,
      title: document.title || CLEANING_VENTILATION_CHECKLIST_TITLE,
      dateFrom: document.dateFrom,
      config: document.config,
      entries: entries.map((entry) => ({
        date: entry.date,
        data: entry.data,
      })),
      users,
      // Общая шапка ХАССП — как у остальных журналов.
      drawHeader: (target, options) =>
        drawJournalHeader(target, {
          organizationName,
          journalLabel: "ЧЕК-ЛИСТ УБОРКИ И ПРОВЕТРИВАНИЯ ПОМЕЩЕНИЙ",
          withPeriodicity: false,
          startedDate: document.dateFrom,
          finishedDate: document.dateTo,
          marginX: options.marginX,
          top: options.top,
        }),
    });
  } else if (templateCode === SANITARY_DAY_CHECKLIST_TEMPLATE_CODE) {
    drawSanitaryDayChecklistPdf(doc, {
      organizationName,
      title: document.title || SANITARY_DAY_CHECKLIST_TITLE,
      dateFrom: document.dateFrom,
      config: document.config,
      entries: entries.map((entry) => ({
        date: entry.date,
        data: entry.data,
      })),
      users,
      // Подписи «ВЫПОЛНИЛ / ПРОВЕРИЛ» — над нижним полем листа и полосой
      // подвала.
      contentBottom: contentBottom(doc),
      // Общая шапка ХАССП — как у остальных журналов.
      drawHeader: (target, options) =>
        drawJournalHeader(target, {
          organizationName,
          journalLabel: "ЧЕК-ЛИСТ (ПАМЯТКА) ПРОВЕДЕНИЯ САНИТАРНОГО ДНЯ",
          withPeriodicity: false,
          startedDate: document.dateFrom,
          finishedDate: document.dateTo,
          marginX: options.marginX,
          top: options.top,
        }),
    });
  } else if (isTrackedDocumentTemplate(templateCode)) {
    drawTrackedPdf(doc, {
      organizationName,
      title:
        document.title ||
        getTrackedDocumentTitle(templateCode as TrackedDocumentTemplateCode),
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      fields: trackedFields,
      entries: entries.map((entry) => ({
        employeeId: entry.employeeId,
        date: entry.date,
        data: (entry.data as Record<string, unknown>) || {},
      })),
      users,
    });
  } else {
    throw new Error(`PDF шаблон не поддерживается для кода: ${templateCode}`);
  }

  // Штамп ХАССП обязан быть на КАЖДОЙ странице бланка — повторяем шапку
  // на страницах 2..N (там, где отрисовщик зарезервировал margin.top).
  repeatJournalHeaderOnPages(doc);

  // Приложение «Подписи сотрудников»: после повтора шапок (чтобы шапка на
  // него не легла) и до нумерации (чтобы N страниц было честным).
  if (input.signatures && input.signatures.length > 0) {
    appendSignaturesPage(doc, fontName, input.signatures);
  }

  // Единый проход по готовому документу: «СТР. i ИЗ N» с честным N в
  // шапке каждой страницы (или в подвале справа, если шапки на странице нет).
  stampJournalPageNumbers(doc, fontName);
  // Подвал партнёра (white-label) — после нумерации, чтобы не спорить
  // за нижний край страницы.
  stampPartnerPdfFooter(doc, branding, fontName);
  // QR — последним: в ячейки шапки, которые она зарегистрировала на каждой
  // своей странице; на странице без шапки — в свободный правый верхний угол.
  const qrPlacements = qr ? stampJournalQr(doc, { ...qr, fontName, tracker: inkTracker }) : undefined;

  activeControlPeriodicity = "";
  activeDocumentStatus = "";
  activeHeaderTitle = "";
  activeJournalName = "";
  activePageHeaderPainter = null;
  activePageHeaderHeight = 0;
  pagesWithJournalHeader.clear();
  titleBottomByPage.clear();
  lastHeaderTop = LEGACY_HEADER_TOP;
  activeFooterTextBandMm = JOURNAL_FOOTER_TEXT_BAND_MM;
  resetPageLabelSlots();

  const buffer = Buffer.from(doc.output("arraybuffer"));
  const prefix =
    templateCode === "hygiene"
      ? "hygiene-journal"
      : templateCode === "health_check"
      ? "health-journal"
      : templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE
        ? getClimateFilePrefix()
        : templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
          ? getColdEquipmentFilePrefix()
          : templateCode === CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE
            ? getCleaningVentilationFilePrefix()
            : templateCode === SANITARY_DAY_CHECKLIST_TEMPLATE_CODE
              ? getSdcFilePrefix()
            : templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
              ? getCleaningFilePrefix()
            : templateCode === MED_BOOK_TEMPLATE_CODE
              ? "med-books"
            : templateCode === PERISHABLE_REJECTION_TEMPLATE_CODE
              ? getPerishableRejectionFilePrefix()
          : templateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE
            ? getFinishedProductFilePrefix()
            : templateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE
              ? "equipment-maintenance"
            : templateCode === STAFF_TRAINING_TEMPLATE_CODE
              ? "staff-training"
            : templateCode === PRODUCT_WRITEOFF_TEMPLATE_CODE
              ? getProductWriteoffFilePrefix()
            : templateCode === PEST_CONTROL_TEMPLATE_CODE
              ? "pest-control-journal"
            : templateCode === GLASS_LIST_TEMPLATE_CODE
              ? getGlassListFilePrefix()
            : templateCode === GLASS_CONTROL_TEMPLATE_CODE
              ? getGlassControlFilePrefix()
            : templateCode === SANITATION_DAY_TEMPLATE_CODE
              ? "general-cleaning-schedule"
            : templateCode === AUDIT_PLAN_TEMPLATE_CODE
              ? "audit-plan"
            : templateCode === AUDIT_PROTOCOL_TEMPLATE_CODE
              ? "audit-protocol"
            : templateCode === AUDIT_REPORT_TEMPLATE_CODE
              ? "audit-report"
            : templateCode === METAL_IMPURITY_TEMPLATE_CODE
              ? "metal-impurity"
            : templateCode === TRAINING_PLAN_TEMPLATE_CODE
              ? "training-plan"
            : templateCode === BREAKDOWN_HISTORY_TEMPLATE_CODE
              ? "breakdown-history"
            : templateCode === ACCIDENT_DOCUMENT_TEMPLATE_CODE
              ? "accident-journal"
            : templateCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE
              ? "equipment-calibration"
            : (ACCEPTANCE_DOCUMENT_TEMPLATE_CODES as readonly string[]).includes(templateCode)
              ? "acceptance-journal"
            : templateCode === PPE_ISSUANCE_TEMPLATE_CODE
              ? "ppe-issuance-journal"
            : templateCode === TRACEABILITY_DOCUMENT_TEMPLATE_CODE
              ? "traceability-journal"
            : templateCode === EQUIPMENT_CLEANING_TEMPLATE_CODE
              ? "equipment-cleaning-journal"
            : templateCode === DISINFECTANT_TEMPLATE_CODE
              ? "disinfectant-journal"
            : templateCode === INTENSIVE_COOLING_TEMPLATE_CODE
              ? getIntensiveCoolingFilePrefix()
            : templateCode === FRYER_OIL_TEMPLATE_CODE
              ? getFryerOilFilePrefix()
            : isRegisterDocumentTemplate(templateCode)
              ? getRegisterDocumentFilePrefix(templateCode)
              : isTrackedDocumentTemplate(templateCode)
                ? getTrackedFilePrefix(templateCode)
              : (() => {
                  throw new Error(`Не удалось определить префикс PDF для кода: ${templateCode}`);
                })();

  return {
    buffer,
    fileName: `${prefix}-${toDateKey(document.dateFrom)}-${toDateKey(document.dateTo)}.pdf`,
    ...(qrPlacements ? { qrPlacements } : {}),
  };
}
