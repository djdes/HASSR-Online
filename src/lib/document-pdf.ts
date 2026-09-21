import fs from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";
import { jsPDF } from "jspdf";
import autoTable, { type CellDef, type CellHookData, type RowInput } from "jspdf-autotable";
import { getCalendarDayKind } from "@/lib/production-calendar-data";
import { db } from "@/lib/db";
import { withBuildingLabel } from "@/lib/building-scope";
import { resolveColumns, type ResolvedJournalColumn } from "@/lib/journal-columns";
import { readHeaderTitleOverride } from "@/lib/journal-header-title";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { isAutoSeededEntry } from "@/lib/journal-entry-filters";
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
  getFinishedProductDocumentTitle,
  getFinishedProductFilePrefix,
  normalizeFinishedProductDocumentConfig,
} from "@/lib/finished-product-document";
import {
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  formatPerishableDateTime,
  formatPerishableExpiry,
  getPerishableRejectionDocumentTitle,
  getPerishableRejectionFilePrefix,
  normalizePerishableRejectionConfig,
  ORGANOLEPTIC_LABELS,
  STORAGE_CONDITION_LABELS,
} from "@/lib/perishable-rejection-document";
import {
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
  formatRuDateDash as formatGlassRuDateDash,
  getGlassControlFilePrefix,
  GLASS_CONTROL_PAGE_TITLE,
  normalizeGlassControlConfig,
  normalizeGlassControlEntryData,
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
import { readControlPeriodicity } from "@/lib/control-periodicity";
import { getUserDisplayTitle } from "@/lib/user-roles";
import {
  registerPageLabelSlot,
  resetPageLabelSlots,
  stampJournalPageNumbers,
  stampPartnerPdfFooter,
  type PdfFooterBrand,
} from "@/lib/pdf-page-labels";
import { getVisibleOrgBranding } from "@/lib/partners/branding";
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
 * Шрифт для PDF. Первым идёт свой, лежащий в репозитории: раньше список
 * состоял только из системных путей, и на машине без единого из них
 * jsPDF откатывался на helvetica — а она не знает кириллицы, и весь
 * журнал печатался кракозябрами. Системные пути оставлены запасными.
 *
 * DejaVu распространяется по лицензии Bitstream Vera; её текст лежит
 * рядом в LICENSE-DejaVu.txt, как эта лицензия и требует.
 */
const BUNDLED_FONT_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "pdf-fonts",
  "DejaVuSans.ttf"
);

const FONT_CANDIDATES = [
  BUNDLED_FONT_PATH,
  "C:\\Windows\\Fonts\\arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
];

function loadUnicodeFont(doc: jsPDF) {
  const fontPath = FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate));

  if (!fontPath) {
    return "helvetica";
  }

  const base64 = fs.readFileSync(fontPath).toString("base64");
  doc.addFileToVFS("journal-unicode.ttf", base64);
  doc.addFont("journal-unicode.ttf", "JournalUnicode", "normal");
  doc.addFont("journal-unicode.ttf", "JournalUnicode", "bold");
  doc.addFont("journal-unicode.ttf", "JournalUnicode", "italic");
  return "JournalUnicode";
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
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  const lineHeight = 4.6;
  const startY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    doc.text(line, x + width / 2, startY + index * lineHeight, { align: "center" });
  });
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
    margin: { left: 10, right: 10 },
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
      left: 10,
      right: 10,
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
      left: 10,
      right: 10,
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
    margin: { left: 10, right: 10 },
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
      left: 10,
      right: 10,
      // Резерв под повтор штампа ХАССП на страницах 2..N.
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    pageBreak: "auto",
  });

  let noteY = (((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY) || 40) + 8;
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(9);
  for (const rule of MED_BOOK_VACCINATION_RULES) {
    if (noteY > doc.internal.pageSize.getHeight() - 12) {
      doc.addPage();
      noteY = 16;
    }
    const lines = doc.splitTextToSize(rule, pageWidth - 20) as string[];
    doc.text(lines, 10, noteY);
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
 * Левое/правое поле бланка (мм). Штамп ХАССП и таблица журнала обязаны
 * иметь ОДНУ ширину — иначе на листе видна «ступенька».
 */
const PDF_SHEET_MARGIN = 10;

/**
 * Художник шапки текущего документа: `drawJournalHeader` запоминает,
 * чем рисовать шапку, а `repeatJournalHeaderOnPages` повторяет её на
 * страницах 2..N (штамп ХАССП обязан быть на КАЖДОЙ странице).
 */
let activePageHeaderPainter: ((doc: jsPDF) => void) | null = null;

/** Высота шапки текущего документа (мм) — резерв `margin.top` у autoTable. */
let activePageHeaderHeight = 0;

/** Страницы, на которых шапка уже нарисована (без повторного оверлея). */
const pagesWithJournalHeader = new Set<number>();

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
  doc.text("Приложение. Подписи сотрудников через общий планшет", 14, 16);
  doc.setFont(fontName, "normal");
  doc.setFontSize(9);
  doc.text(
    "Каждый вход подтверждён личным ПИН сотрудника на планшете организации; запись журнала внесена под этим входом.",
    14,
    22,
  );
  const fmt = (d: Date) => d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  autoTable(doc, {
    startY: 27,
    head: [["Сотрудник", "Подтверждение", "Планшет", "Входов", "Первый", "Последний"]],
    body: lines.map((l) => [l.employeeName, l.method, l.device ?? "—", String(l.count), fmt(l.firstAt), fmt(l.lastAt)]),
    theme: "grid",
    styles: { font: fontName, fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [238, 241, 255], textColor: [11, 16, 36], font: fontName, fontStyle: "bold" },
    margin: { left: 14, right: 14 },
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
 *   ┌──────────────┬────────────────────────────┬────────────┐
 *   │              │       СИСТЕМА ХАССП        │ Начат ...  │  ← row 1
 *   │ Организация  ├────────────────────────────┼────────────┤
 *   │              │     ЖУРНАЛ ... (italic)    │ СТР. X/Y   │  ← row 2
 *   ├──────────────┴────────────────────────────┴────────────┤
 *   │ Периодичность│ <объединённое значение, без вертикалей> │  ← row 3
 *   └──────────────┴────────────────────────────────────────-┘
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
  /** Верхняя координата штампа (мм). */
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
  const y = params.top ?? 28;
  const width = pageWidth - x * 2;
  const leftWidth = 56;
  // «Начат 01-08-2026» шире, чем «СТР. 1 ИЗ 1» — правая колонка одна и та
  // же во всех журналах, чтобы шапки были единообразны.
  const rightWidth = 42;
  const middleWidth = width - leftWidth - rightWidth;
  const topHeight = 10;
  const secondHeight = 10;
  const gridBottom = y + topHeight + secondHeight;

  doc.setFontSize(10);
  const periodicityLines = withPeriodicity
    ? (doc.splitTextToSize(periodicityText, width - leftWidth - 8) as string[])
    : [];
  const periodicityHeight = withPeriodicity
    ? Math.max(12, periodicityLines.length * 4.6 + 4.4)
    : 0;
  const totalHeight = topHeight + secondHeight + periodicityHeight;

  doc.setLineWidth(0.25);
  doc.rect(x, y, width, totalHeight);
  // Вертикаль «организация | остальное» — на всю высоту: в row3 она
  // отделяет label «Периодичность контроля» от значения.
  doc.line(x + leftWidth, y, x + leftWidth, y + totalHeight);
  // Вертикаль «журнал | Начат/СТР» — только по сетке row1+row2.
  doc.line(x + leftWidth + middleWidth, y, x + leftWidth + middleWidth, gridBottom);
  doc.line(x + leftWidth, y + topHeight, x + leftWidth + middleWidth, y + topHeight);
  doc.line(x + leftWidth + middleWidth, y + topHeight, x + width, y + topHeight);
  if (withPeriodicity) {
    // Полная горизонталь над строкой периодичности (включая участок
    // под ячейкой организации) — иначе шапка «протекает» вниз.
    doc.line(x, gridBottom, x + width, gridBottom);
  }

  doc.setFont("JournalUnicode", "bold");
  drawCenteredText(doc, organizationName, x + 3, y, leftWidth - 6, topHeight + secondHeight, leftWidth - 10);

  doc.setFont("JournalUnicode", "normal");
  drawCenteredText(doc, "СИСТЕМА ХАССП", x + leftWidth, y, middleWidth, topHeight, middleWidth - 10);

  doc.setFont("JournalUnicode", "italic");
  drawCenteredText(
    doc,
    headerTitleOr(journalLabel).toUpperCase(),
    x + leftWidth,
    y + topHeight,
    middleWidth,
    secondHeight,
    middleWidth - 10
  );

  doc.setFont("JournalUnicode", "normal");
  const started = formatHeaderDate(params.startedDate);
  const finished = formatHeaderDate(resolveFinishedDate(params.finishedDate));
  doc.setFontSize(9);
  doc.text(`Начат  ${started}`, x + leftWidth + middleWidth + 3, y + 4.2);
  // Линия «Окончен ______» не должна вылезать за правую рамку штампа
  // (аудит r5, п.2): подчёркивание подрезаем под остаток ячейки.
  doc.text(
    finished
      ? `Окончен  ${finished}`
      : fitUnderscoreLabel(doc, "Окончен  ", rightWidth - 6),
    x + leftWidth + middleWidth + 3,
    y + 8.4
  );
  doc.setFontSize(10);
  registerPageLabelSlot(doc, {
    x: x + leftWidth + middleWidth,
    y: y + topHeight,
    width: rightWidth,
    height: secondHeight,
    maxWidth: rightWidth - 6,
    fontSize: 10,
    fontStyle: "normal",
  });

  if (withPeriodicity) {
    doc.setFont("JournalUnicode", "bold");
    drawCenteredText(doc, "Периодичность контроля", x + 3, gridBottom, leftWidth - 6, periodicityHeight, leftWidth - 10);

    doc.setFont("JournalUnicode", "normal");
    // Значение — единая объединённая ячейка leftWidth → width, без
    // пересекающих вертикалей.
    let cursorY = gridBottom + (periodicityHeight - periodicityLines.length * 4.6) / 2 + 3.4;
    periodicityLines.forEach((chunk) => {
      doc.text(chunk, x + leftWidth + 4, cursorY);
      cursorY += 4.6;
    });
  }

  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(10);

  const currentPage =
    (doc as jsPDF & { getCurrentPageInfo?: () => { pageNumber: number } })
      .getCurrentPageInfo?.().pageNumber ?? doc.getNumberOfPages();
  pagesWithJournalHeader.add(currentPage);

  if (params.repeatOnPages) {
    const repeatParams = { ...params, repeatOnPages: false };
    activePageHeaderPainter = (target) => {
      drawJournalHeader(target, repeatParams);
    };
    activePageHeaderHeight = y + totalHeight;
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
 */
function afterHeader(headerBottom: number, fallbackY: number) {
  return Math.max(fallbackY, headerBottom + HEADER_TITLE_GAP);
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
  return `« ${day} » ${month} ${year} г.`;
}

function drawTitle(doc: jsPDF, title: string) {
  doc.setFont("JournalUnicode", "normal");
  // Auto-shrink long h1 so titles like "Журнал контроля температурного режима
  // холодильного и морозильного оборудования" don't get truncated by the right
  // page edge. We measure the rendered width and pick a font size that fits.
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - 28; // 14mm margin each side
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
  doc.text(title, 14, 15);
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
 * (`journal-grid.ts`): выходной/праздник #f8d7d4, сокращённый #fdeeda.
 * Раньше PDF печатал колонки выходных белыми, и бланк расходился и с
 * экраном, и с печатью браузера.
 */
const PDF_DAY_OFF_FILL: [number, number, number] = [248, 215, 212];
const PDF_DAY_SHORT_FILL: [number, number, number] = [253, 238, 218];

/** Цветовая легенда дней под таблицей — как `CleaningDayColorLegend` на экране. */
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

/** Рисует строку цветовой легенды дней. Возвращает Y под ней. */
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
    journalLabel: "Гигиенический журнал",
    withPeriodicity: true,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
    marginX: 14,
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
    // Колонки выходных/праздников — розовые, как на экране и в печати.
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
      left: 14,
      right: 14,
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
    journalLabel: "Гигиенический журнал",
    withPeriodicity: true,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
    marginX: 14,
  });

  // Блок «В журнал регистрируются результаты» печатается целиком
  // на одной странице: раньше список рвался между стр. 1 и 2.
  let cursorY = afterHeader(page2HeaderBottom, 84);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(9);
  doc.text("В журнал регистрируются результаты:", 14, cursorY);
  doc.setFont("JournalUnicode", "normal");
  cursorY = renderWrappedTextBlock(
    doc,
    HYGIENE_REGISTER_NOTES.map((note) => `- ${note}`),
    14,
    cursorY + 6,
    pageWidth - 28,
    5
  );
  cursorY += 8;
  doc.setFont("JournalUnicode", "bold");
  doc.text(
    "Список работников, отмеченных в журнале на день осмотра, должен соответствовать числу работников на этот день в смену",
    14,
    cursorY
  );

  cursorY += 12;
  doc.setFont("JournalUnicode", "italic");
  doc.text("Условные обозначения:", 14, cursorY);
  cursorY += 5;
  renderWrappedTextBlock(doc, HYGIENE_REGISTER_LEGEND, 14, cursorY, pageWidth - 28, 5);
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
    marginX: 14,
    repeatOnPages: true,
  });

  const healthTitleY = afterHeader(headerBottom, 70);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text(params.title.toUpperCase(), pageWidth / 2, healthTitleY, { align: "center" });

  autoTable(doc, {
    startY: healthTitleY + 6,
    head: buildHealthHead(params.dateKeys, params.monthLabel),
    // Колонки выходных/праздников — розовые, как на экране и в печати.
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
      left: 14,
      right: 14,
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
  let cursorY = renderWrappedTextBlock(doc, HEALTH_REGISTER_NOTES, 14, finalY + 10, pageWidth - 28, 5);
  cursorY += 8;
  doc.setFont("JournalUnicode", "bold");
  doc.text(HEALTH_REGISTER_REMINDER, 14, cursorY);
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

function buildClimateBody(params: {
  config: ClimateDocumentConfig;
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: { id: string; name: string; role: string }[];
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
        content: user
          ? `${user.name}${normalized.responsibleTitle ? `\n${normalized.responsibleTitle}` : ""}`
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
  users: { id: string; name: string; role: string }[];
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
      fontSize: 6.5,
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

/**
 * Журнал контроля температурного режима холодильного оборудования.
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
  users: { id: string; name: string; role: string }[];
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
  doc.setFont("JournalUnicode", "normal");

  // (dateKey → запись дня): у журнала одна строка на дату.
  const rowByDate = new Map<string, { employeeId: string; temperatures: Record<string, number | null> }>();
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
      ...dateKeys.map((dateKey) =>
        centerCell(formatNumberShort(rowByDate.get(dateKey)?.temperatures?.[item.slotKey]))
      ),
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
        ? Object.values(row.temperatures).some((value) => value != null)
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
    startY: titleY + 6,
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
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 44 },
      ...Object.fromEntries(
        dateKeys.map((_, index) => [index + 2, { cellWidth: dayWidth }])
      ),
    },
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
    journalLabel: journalTitle,
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: params.dateTo,
    marginX: 16,
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
  const cleaningUsableWidth = doc.internal.pageSize.getWidth() - 32;
  const cleaningNameWidth = dateKeys.length > 20 ? 40 : 56;
  const cleaningDetergentWidth = dateKeys.length > 20 ? 32 : 44;
  const columnStyles: Record<number, { cellWidth: number; cellPadding?: number }> = {
    0: { cellWidth: cleaningNameWidth },
    1: { cellWidth: cleaningDetergentWidth },
  };
  const dayWidth =
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
      left: 16,
      right: 16,
      // Резерв под повтор штампа ХАССП на страницах 2..N.
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    columnStyles,
    // Заливка колонок выходных/праздников — как на экране и в печати.
    didParseCell: makeDayColumnTintHook(dateKeys, 2),
  });

  const afterMatrixY = (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 140;
  // Строка цветовой легенды дней — как `CleaningDayColorLegend` на экране.
  const dayLegendY = drawDayColorLegend(doc, 16, afterMatrixY + 6);
  doc.setFont("JournalUnicode", "italic");
  const legendY = dayLegendY + 6;
  doc.text("Условные обозначения:", 16, legendY);
  const afterLegendY = renderWrappedTextBlock(
    doc,
    // Легенда — те же строки, что на экране: «/-/» вместо легаси-«/»
    // и КИРИЛЛИЧЕСКИЕ коды Т/Г (в config.legend они хранятся латиницей).
    (config.legend.length > 0 ? config.legend : [...CLEANING_LEGEND]).map(
      (line) => displayCleaningLegendLine(line)
    ),
    16,
    legendY + 5,
    pageWidth - 32,
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
  if (summaryStartY + SUMMARY_MIN_BLOCK > doc.internal.pageSize.getHeight() - 18) {
    doc.addPage("a4", "landscape");
    summaryStartY = activePageHeaderHeight
      ? activePageHeaderHeight + HEADER_TITLE_GAP
      : 28;
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
      left: 16,
      right: 16,
      bottom: 18,
      top: activePageHeaderHeight + HEADER_TITLE_GAP,
    },
    // Сводную таблицу РАЗРЕШЕНО рвать между страницами (раньше
    // `pageBreak: "avoid"` выбрасывал её целиком на стр. 2, оставляя
    // полпустой первый лист). Сироты не будет: если до низа осталось
    // меньше, чем шапка + две строки, блок начинается с новой страницы
    // (см. summaryStartY ниже).
    rowPageBreak: "avoid",
    columnStyles: {
      0: { cellWidth: 48 },
      1: { cellWidth: 96 },
      2: { cellWidth: 96 },
    },
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
    label: (key: string, printDefault: string) => {
      const column = byKey.get(key);
      return column && column.label !== column.defaultLabel ? column.label : printDefault;
    },
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

  const columns = pdfColumns("finished_product", params.config);
  const headRow: RowInput = [
    centerCell("№"),
    centerCell(columns.label("production", "Дата, время изготовления")),
    centerCell(columns.label("rejection", "Время снятия бракеража")),
    centerCell(
      columns.label(
        "name",
        params.config.fieldNameMode === "semi"
          ? "Наименование полуфабриката"
          : "Наименование блюд (изделий)"
      )
    ),
    centerCell(columns.label("organoleptic", "Органолептическая оценка (включая оценку степени готовности)")),
  ];
  if (columns.visible("temp")) headRow.push(centerCell(columns.label("temp", "T продукта")));
  if (columns.visible("corrective")) headRow.push(centerCell(columns.label("corrective", "Корректирующие действия")));
  if (columns.visible("oxygen")) headRow.push(centerCell(columns.label("oxygen", "Остаточный кислород, %")));
  headRow.push(centerCell(columns.label("release", "Разрешение к реализации (время)")));
  if (columns.visible("release_allowed")) {
    headRow.push(centerCell(columns.label("release_allowed", "Разрешение к реализации: Да/Нет")));
  }
  if (columns.visible("courier")) headRow.push(centerCell(columns.label("courier", "Передача курьеру")));
  if (columns.visible("responsible")) {
    headRow.push(centerCell(columns.label("responsible", "Ответственный исполнитель (ФИО, должность)")));
  }
  headRow.push(
    centerCell(
      columns.label(
        "inspector",
        params.config.inspectorMode === "commission_signatures"
          ? "Подписи комиссии"
          : "ФИО лица, проводившего бракераж"
      )
    )
  );
  const head: RowInput[] = [headRow];

  const body: RowInput[] = params.config.rows.map((row, index) => {
    const line: RowInput = [
      centerCell(String(index + 1)),
      centerCell(row.productionDateTime || ""),
      centerCell(row.rejectionTime || ""),
      { content: row.productName || "", styles: { halign: "left", valign: "middle" } },
      centerCell(row.organoleptic || ""),
    ];
    if (columns.visible("temp")) line.push(centerCell(row.productTemp || ""));
    if (columns.visible("corrective")) {
      line.push({ content: row.correctiveAction || "", styles: { halign: "left", valign: "middle" } });
    }
    if (columns.visible("oxygen")) line.push(centerCell(row.oxygenLevel || ""));
    line.push(centerCell(row.releasePermissionTime || ""));
    if (columns.visible("release_allowed")) {
      line.push(centerCell(row.releaseAllowed === "no" ? "Нет" : "Да"));
    }
    if (columns.visible("courier")) line.push(centerCell(row.courierTransferTime || ""));
    if (columns.visible("responsible")) line.push(centerCell(row.responsiblePerson || ""));
    line.push(centerCell(row.inspectorName || ""));
    return line;
  });

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
    margin: { left: 10, right: 10 },
    // F-аудит: пустая строка бланка должна быть ~22pt (≈7.8мм) высотой,
    // иначе в неё физически нечего вписать от руки.
    bodyStyles: { minCellHeight: 7.8 },
  });

  const finishedFooterY = (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 66;

  // «Примечание: …» под таблицей — как на эталоне (finished_product-grid.png).
  if (params.config.footerNote) {
    doc.setFont("JournalUnicode", "bold");
    doc.setFontSize(9);
    doc.text("Примечание:", 10, finishedFooterY + 8);
    doc.setFont("JournalUnicode", "normal");
    doc.text(params.config.footerNote, 10, finishedFooterY + 13);
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
    10,
    maintenanceLegendY
  );

  autoTable(doc, {
    startY: maintenanceLegendY + 4,
    margin: { left: 10, right: 10 },
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

  const finalY = (((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY) || 40) + 8;
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  doc.text(
    `Ответственный: ${[params.config.responsibleRole, params.config.responsibleEmployee].filter(Boolean).join(", ")}`,
    10,
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
    margin: { left: 10, right: 10 },
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
      fontSize: 6.4,
      halign: "center",
      valign: "middle",
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 38 },
      2: { cellWidth: 34 },
      3: { cellWidth: 38 },
      4: { cellWidth: 24 },
      5: { cellWidth: 48 },
      6: { cellWidth: 36 },
      7: { cellWidth: 22, halign: "center" },
    },
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
  users: { id: string; name: string; role: string }[];
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
    margin: { left: 14, right: 14 },
    head,
    body: ensurePdfBodyRows(body, incomingControlColumns.length),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 6,
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
      fontSize: 5.5,
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
  users: { id: string; name: string; role: string }[];
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
  const monthColWidth = (pageWidth - 28) / baseColCount;

  autoTable(doc, {
    startY: acceptanceTitleY + 8,
    margin: { left: 14, right: 14 },
    head,
    body: ensurePdfBodyRows(body, 9),
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 6.5,
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
      fontSize: 6,
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
  users: { id: string; name: string; role: string }[];
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
    margin: { left: 14, right: 14 },
    head,
    body,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 6.5,
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
      fontSize: 6,
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
    journalLabel: params.config.documentName || params.title,
    withPeriodicity: false,
    startedDate: params.dateFrom,
    finishedDate: null,
  });

  const writeoffTitleY = afterHeader(headerBottom, 72);
  const dateLabel = formatProductWriteoffDateLong(params.config.documentDate || params.dateFrom);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(16);
  doc.text("АКТ", 105, writeoffTitleY, { align: "center" });
  doc.text(`№ ${params.config.actNumber || "1"} от ${dateLabel}`, 105, writeoffTitleY + 8, { align: "center" });

  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(11);
  let cursorY = writeoffTitleY + 20;
  doc.text("Комиссия в составе:", 24, cursorY);
  cursorY += 7;
  if (params.config.commissionMembers.length === 0) {
    doc.text("________________", 30, cursorY);
    cursorY += 7;
  } else {
    params.config.commissionMembers.forEach((member) => {
      doc.text(`${member.role} ${member.employeeName}`, 30, cursorY);
      cursorY += 6;
    });
  }

  const introLines = doc.splitTextToSize(
    `Составила настоящий АКТ о том, что ${dateLabel} на предприятии выявлены ТМЦ с несоответствиями по качеству и (или) безопасности согласно списку ниже.`,
    160
  ) as string[];
  cursorY += 4;
  introLines.forEach((line) => {
    doc.text(line, 24, cursorY);
    cursorY += 5;
  });

  const supplierLines = doc.splitTextToSize(
    `Указанные ТМЦ были выработаны ${params.config.supplierName || "________________"} и поставлены...`,
    160
  ) as string[];
  supplierLines.forEach((line) => {
    doc.text(line, 24, cursorY);
    cursorY += 5;
  });

  cursorY += 3;
  doc.text("Комиссия постановила выполнить в отношении выявленных ТМЦ следующие действия:", 24, cursorY);

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
    margin: { left: 24, right: 24 },
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 34 },
      2: { cellWidth: 30, halign: "center" },
      3: { cellWidth: 24, halign: "center" },
      4: { cellWidth: 40, halign: "center" },
      5: { cellWidth: 40, halign: "center" },
    },
  });

  const finalY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || cursorY) + 14;
  doc.text("Подписи членов комиссии:", 24, finalY);
  let signY = finalY + 8;
  (params.config.commissionMembers.length > 0 ? params.config.commissionMembers : [{ employeeName: "" }]).forEach((member) => {
    doc.text(member.employeeName || "________________", 30, signY);
    doc.line(62, signY + 1, 112, signY + 1);
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
  const rows = isBlankForm
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

  // Колонки как в таблице документа (`resolveColumns`). Заголовки — ПОЛНЫЕ
  // экранные формулировки: укороченные вроде «Документ» теряли смысл графы
  // для инспектора. `softenSlashBreaks` разбивает «Фасовка/Кол-во» на
  // переносимые слова — иначе autoTable рвал длинный токен посимвольно.
  type PerishableRow = (typeof rows)[number];
  const perishableColumns = pdfColumns("perishable_rejection", params.config);
  type PerishablePrintColumn = {
    key: string;
    head: string;
    cell: (row: PerishableRow) => string;
    style: { cellWidth: number; halign?: "center" };
  };
  const perishablePrint = ([
    {
      key: "arrival",
      head: perishableColumns.label("arrival", "Дата, время поступления пищ. продукции"),
      // Тем же хелпером, что и экран: раньше в PDF уезжал сырой ISO
      // «2026-09-15» вместо «15.09.2026».
      cell: (row) => formatPerishableDateTime(row.arrivalDate, row.arrivalTime),
      style: { cellWidth: 24 },
    },
    { key: "product", head: perishableColumns.label("product", "Наименование"), cell: (row) => row.productName, style: { cellWidth: 26 } },
    {
      key: "productionDate",
      head: perishableColumns.label("productionDate", "Дата выработки"),
      cell: (row) => row.productionDate,
      style: { cellWidth: 19, halign: "center" },
    },
    {
      key: "manufacturer",
      head: softenSlashBreaks(perishableColumns.label("manufacturer", "Изготовитель/поставщик")),
      cell: (row) => [row.manufacturer, row.supplier].filter(Boolean).join("\n"),
      style: { cellWidth: 28 },
    },
    {
      key: "packaging",
      head: softenSlashBreaks(perishableColumns.label("packaging", "Фасовка/Кол-во поступившего продукта (в кг, литрах, шт)")),
      cell: (row) => [row.packaging, row.quantity].filter(Boolean).join("\n"),
      style: { cellWidth: 24, halign: "center" },
    },
    {
      key: "document",
      head: perishableColumns.label("document", "Номер документа, подтверждающего безопасность"),
      cell: (row) => row.documentNumber,
      style: { cellWidth: 24 },
    },
    {
      key: "organoleptic",
      head: perishableColumns.label("organoleptic", "Результаты органолептической оценки"),
      cell: (row) => ORGANOLEPTIC_LABELS[row.organolepticResult] || row.organolepticResult || "",
      style: { cellWidth: 24 },
    },
    {
      key: "storage",
      head: perishableColumns.label("storage", "Условия хранения, конечный срок реализации"),
      cell: (row) =>
        [
          STORAGE_CONDITION_LABELS[row.storageCondition] || row.storageCondition || "",
          // Для скоропорта важен час срока, а не только дата.
          formatPerishableExpiry(row),
        ]
          .filter(Boolean)
          .join("\n"),
      style: { cellWidth: 27 },
    },
    {
      key: "sale",
      head: perishableColumns.label("sale", "Дата, время фактической реализации"),
      cell: (row) => formatPerishableDateTime(row.actualSaleDate, row.actualSaleTime),
      style: { cellWidth: 22, halign: "center" },
    },
    {
      key: "responsible",
      head: perishableColumns.label("responsible", "Ответственное лицо (ФИО, должность)"),
      cell: (row) => row.responsiblePerson,
      style: { cellWidth: 27 },
    },
    { key: "note", head: perishableColumns.label("note", "Примечание"), cell: (row) => row.note, style: { cellWidth: 24 } },
  ] satisfies PerishablePrintColumn[]).filter((column) => perishableColumns.visible(column.key));

  autoTable(doc, {
    startY: perishableTitleY + 8,
    theme: "grid",
    styles: {
      font: "JournalUnicode",
      fontSize: 7,
      cellPadding: 1.4,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      valign: "middle",
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      font: "JournalUnicode",
      fontStyle: "bold",
      // Мелкий кегль шапки — чтобы длинные формулировки ломались по
      // границам СЛОВ, а не по символам.
      fontSize: 6.6,
      cellPadding: 1,
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      halign: "center",
      valign: "middle",
    },
    margin: { left: 10, right: 10 },
    // Заголовки — ПОЛНЫЕ экранные формулировки
    // (perishable-rejection-document-client). Укороченные варианты
    // вроде «Документ» теряли смысл графы для инспектора.
    // Колонки «№» нет ни на экране, ни в печати браузера.
    // `softenSlashBreaks` разбивает «Фасовка/Кол-во» на переносимые
    // слова — иначе autoTable рвал длинный токен ПОСИМВОЛЬНО
    // («Фасовка/Ко|л-во посту|пившего»).
    head: [perishablePrint.map((column) => column.head)],
    body: rows.map((row) => perishablePrint.map((column) => column.cell(row))),
    // Ширины — по колонкам, которые печатаются: скрытая колонка не сдвигает
    // ширины остальных.
    columnStyles: Object.fromEntries(perishablePrint.map((column, index) => [index, column.style])),
  });
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
  doc.text(params.title || "Перечень изделий", 14, 18);

  const x = 42;
  const y = 34;
  const width = pageWidth - 84;
  const leftWidth = 38;
  const rightWidth = 22;
  const middleWidth = width - leftWidth - rightWidth;

  doc.setLineWidth(0.2);
  doc.rect(x, y, width, 22);
  doc.line(x + leftWidth, y, x + leftWidth, y + 22);
  doc.line(x + leftWidth + middleWidth, y, x + leftWidth + middleWidth, y + 22);
  doc.line(x + leftWidth, y + 11, x + leftWidth + middleWidth, y + 11);

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  drawCenteredText(doc, params.organizationName, x, y, leftWidth, 22, leftWidth - 6);

  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(11);
  drawCenteredText(doc, "СИСТЕМА ХАССП", x + leftWidth, y, middleWidth, 11, middleWidth - 6);

  doc.setFont("JournalUnicode", "italic");
  drawCenteredText(
    doc,
    headerTitleOr("ПЕРЕЧЕНЬ ИЗДЕЛИЙ ИЗ СТЕКЛА И ХРУПКОГО ПЛАСТИКА").toUpperCase(),
    x + leftWidth,
    y + 11,
    middleWidth,
    11,
    middleWidth - 10
  );
  registerPageLabelSlot(doc, {
    x: x + leftWidth + middleWidth,
    y,
    width: rightWidth,
    height: 22,
    maxWidth: rightWidth - 4,
    fontSize: 10,
    fontStyle: "normal",
  });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  doc.text("УТВЕРЖДАЮ", pageWidth - 36, 72, { align: "right" });
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(11);
  doc.text(config.responsibleTitle || "Управляющий", pageWidth - 36, 80, { align: "right" });
  doc.text(`____________________ ${params.responsibleName}`, pageWidth - 36, 88, { align: "right" });
  doc.text(`«${formatGlassListDateLong(documentDate)}» г.`, pageWidth - 36, 96, { align: "right" });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text(
    "ПЕРЕЧЕНЬ ИЗДЕЛИЙ ИЗ СТЕКЛА И ХРУПКОГО ПЛАСТИКА",
    pageWidth / 2,
    106,
    { align: "center" }
  );

  autoTable(doc, {
    startY: 114,
    margin: { left: 42, right: 42 },
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
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 34, halign: "center" },
      2: { cellWidth: 94, halign: "center" },
      3: { cellWidth: 18, halign: "center" },
    },
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

  const x = 24;
  const y = 28;
  const width = pageWidth - 48;
  const leftWidth = 56;
  const rightWidth = 32;
  const middleWidth = width - leftWidth - rightWidth;
  const topHeight = 10;
  const secondHeight = 10;
  const totalHeight = topHeight + secondHeight;

  doc.setLineWidth(0.25);
  doc.rect(x, y, width, totalHeight);
  doc.line(x + leftWidth, y, x + leftWidth, y + totalHeight);
  doc.line(x + leftWidth + middleWidth, y, x + leftWidth + middleWidth, y + totalHeight);
  doc.line(x + leftWidth, y + topHeight, x + leftWidth + middleWidth, y + topHeight);

  doc.setFontSize(10);
  doc.setFont("JournalUnicode", "bold");
  drawCenteredText(doc, params.organizationName, x + 3, y, leftWidth - 6, totalHeight, leftWidth - 10);

  doc.setFont("JournalUnicode", "normal");
  drawCenteredText(doc, "СИСТЕМА ХАССП", x + leftWidth, y, middleWidth, topHeight, middleWidth - 10);

  doc.setFont("JournalUnicode", "italic");
  drawCenteredText(doc, headerTitleOr("КАРТОЧКА ИСТОРИИ ПОЛОМОК").toUpperCase(), x + leftWidth, y + topHeight, middleWidth, secondHeight, middleWidth - 10);

  const dateFromStr = params.dateFrom instanceof Date
    ? formatBreakdownDateRu(params.dateFrom.toISOString().slice(0, 10))
    : formatBreakdownDateRu(String(params.dateFrom).slice(0, 10));

  doc.setFont("JournalUnicode", "normal");
  drawCenteredText(doc, `Начат  ${dateFromStr}\nОкончен _________`, x + leftWidth + middleWidth, y, rightWidth, topHeight, rightWidth - 4);
  registerPageLabelSlot(doc, {
    x: x + leftWidth + middleWidth,
    y: y + topHeight,
    width: rightWidth,
    height: secondHeight,
    maxWidth: rightWidth - 4,
    fontSize: 10,
    fontStyle: "normal",
  });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  doc.text("КАРТОЧКА ИСТОРИИ ПОЛОМОК", centerX, y + totalHeight + 12, { align: "center" });

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
    startY: y + totalHeight + 18,
    margin: { left: 24, right: 24 },
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

  const x = 18;
  const y = 28;
  const width = pageWidth - 36;
  const leftWidth = 48;
  const rightWidth = 40;
  const middleWidth = width - leftWidth - rightWidth;
  const topHeight = 10;
  const secondHeight = 10;
  const totalHeight = topHeight + secondHeight;

  doc.setLineWidth(0.25);
  doc.rect(x, y, width, totalHeight);
  doc.line(x + leftWidth, y, x + leftWidth, y + totalHeight);
  doc.line(x + leftWidth + middleWidth, y, x + leftWidth + middleWidth, y + totalHeight);
  doc.line(x + leftWidth, y + topHeight, x + leftWidth + middleWidth, y + topHeight);

  doc.setFontSize(10);
  doc.setFont("JournalUnicode", "bold");
  drawCenteredText(doc, params.organizationName, x + 3, y, leftWidth - 6, totalHeight, leftWidth - 10);

  doc.setFont("JournalUnicode", "normal");
  drawCenteredText(doc, "СИСТЕМА ХАССП", x + leftWidth, y, middleWidth, topHeight, middleWidth - 10);

  doc.setFont("JournalUnicode", "italic");
  drawCenteredText(doc, headerTitleOr("ЖУРНАЛ УЧЕТА АВАРИЙ").toUpperCase(), x + leftWidth, y + topHeight, middleWidth, secondHeight, middleWidth - 10);

  const dateFromStr = params.dateFrom instanceof Date
    ? formatBreakdownDateRu(params.dateFrom.toISOString().slice(0, 10))
    : formatBreakdownDateRu(String(params.dateFrom).slice(0, 10));

  doc.setFont("JournalUnicode", "normal");
  drawCenteredText(doc, `Начат  ${dateFromStr}\nОкончен __________`, x + leftWidth + middleWidth, y, rightWidth, topHeight, rightWidth - 4);
  registerPageLabelSlot(doc, {
    x: x + leftWidth + middleWidth,
    y: y + topHeight,
    width: rightWidth,
    height: secondHeight,
    maxWidth: rightWidth - 4,
    fontSize: 10,
    fontStyle: "normal",
  });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  doc.text("ЖУРНАЛ УЧЕТА АВАРИЙ", centerX, y + totalHeight + 12, { align: "center" });

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
    startY: y + totalHeight + 18,
    margin: { left: 10, right: 10 },
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
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 14 },
      2: { cellWidth: 24 },
      3: { cellWidth: 30 },
      4: { cellWidth: 44 },
      5: { cellWidth: 38 },
      6: { cellWidth: 28 },
      7: { cellWidth: 30 },
      8: { cellWidth: 42 },
    },
  });
}

function drawEquipmentCalibrationPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  config: ReturnType<typeof normalizeEquipmentCalibrationConfig>;
}) {
  const cfg = params.config;
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  const headerRight = pageWidth - 24;

  drawTitle(doc, params.title || EQUIPMENT_CALIBRATION_DOCUMENT_TITLE);
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ГРАФИК ПОВЕРКИ СРЕДСТВ ИЗМЕРЕНИЙ",
    withPeriodicity: false,
    startedDate: params.dateFrom ?? null,
    finishedDate: params.dateTo ?? null,
    marginX: 24,
  });

  const approvalY = afterHeader(headerBottom, 60);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("УТВЕРЖДАЮ", headerRight, approvalY, { align: "right" });
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  doc.text(cfg.approveRole || "", headerRight, approvalY + 6, { align: "right" });
  doc.line(headerRight - 52, approvalY + 10, headerRight, approvalY + 10);
  doc.text(cfg.approveEmployee || "", headerRight, approvalY + 14, { align: "right" });
  doc.text(formatCalibrationDateLong(cfg.documentDate), headerRight - 6, approvalY + 20, {
    align: "center",
  });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(12);
  const calibrationTitleY = Math.max(90, approvalY + 30);
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
        styles: {
          halign: "center",
          valign: "middle",
          textColor: isOverdue ? [220, 38, 38] : [0, 0, 0],
          fontStyle: isOverdue ? "bold" : "normal",
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
    margin: { left: 24, right: 24 },
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
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 48 },
      2: { cellWidth: 28 },
      3: { cellWidth: 30 },
      4: { cellWidth: 26 },
      5: { cellWidth: 22 },
      6: { cellWidth: 22 },
      7: { cellWidth: 34 },
    },
  });
}

function drawTrainingPlanPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  config: ReturnType<typeof normalizeTrainingPlanConfig>;
}) {
  const cfg = params.config;
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  const headerRight = pageWidth - 24;

  drawTitle(doc, params.title || "План обучения");
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ПЛАН ОБУЧЕНИЯ ПЕРСОНАЛА",
    withPeriodicity: false,
    startedDate: params.dateFrom ?? null,
    finishedDate: params.dateTo ?? null,
    marginX: 24,
  });

  const approvalY = afterHeader(headerBottom, 60);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("УТВЕРЖДАЮ", headerRight, approvalY, { align: "right" });
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  doc.text(cfg.approveRole || "", headerRight, approvalY + 6, { align: "right" });
  doc.line(headerRight - 52, approvalY + 10, headerRight, approvalY + 10);
  doc.text(cfg.approveEmployee || "", headerRight, approvalY + 14, { align: "right" });
  doc.text(
    formatApprovalDateLong(cfg.documentDate, cfg.year),
    headerRight - 6,
    approvalY + 20,
    { align: "center" }
  );

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  const trainingPlanTitleY = Math.max(90, approvalY + 30);
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
    margin: { left: 24, right: 24 },
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
}) {
  const cfg = params.config;
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;

  // --- Поля бланка: штамп ХАССП, блок «УТВЕРЖДАЮ» и таблица журнала
  // обязаны иметь ОДНУ ширину (иначе на листе «ступенька», аудит r5 п.2).
  const roomColWidth = 60;
  const typeColWidth = 22;
  const monthColWidth = 13.5;
  const tableWidth = roomColWidth + typeColWidth + 12 * monthColWidth;
  const tableMargin = Math.round((pageWidth - tableWidth) / 2);
  const marginLeft = tableMargin;
  const headerRight = pageWidth - tableMargin;

  // --- Title ---
  drawTitle(doc, params.title || SANITATION_DAY_DOCUMENT_TITLE);

  // --- Header table ---
  const headerBottom = drawJournalHeader(doc, {
    organizationName: params.organizationName,
    journalLabel: "ГРАФИК И УЧЕТ ГЕНЕРАЛЬНЫХ УБОРОК",
    withPeriodicity: false,
    startedDate: params.dateFrom ?? null,
    finishedDate: params.dateTo ?? null,
    marginX: tableMargin,
  });

  // --- Approval block (right-aligned to header edge) ---
  const approvalY = afterHeader(headerBottom, 60);
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("УТВЕРЖДАЮ", headerRight, approvalY, { align: "right" });
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  doc.text(cfg.approveRole || "", headerRight, approvalY + 6, { align: "right" });
  doc.line(headerRight - 52, approvalY + 10, headerRight, approvalY + 10);
  doc.text(cfg.approveEmployee || "", headerRight, approvalY + 14, { align: "right" });
  doc.text(
    formatApprovalDateLong(cfg.documentDate, cfg.year),
    headerRight - 6,
    approvalY + 20,
    { align: "center" }
  );

  // --- Centered subtitle ---
  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(11);
  const sanitationTitleY = Math.max(90, approvalY + 30);
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

  const body: RowInput[] = [];
  for (const row of cfg.rows) {
    body.push([
      { content: row.roomName || "", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "План", styles: { halign: "center", valign: "middle" } },
      ...SANITATION_MONTHS.map((month) => centerCell(row.plan[month.key] || "")),
    ]);
    body.push([
      { content: "Факт", styles: { halign: "center", valign: "middle" } },
      ...SANITATION_MONTHS.map((month) => centerCell(row.fact[month.key] || "")),
    ]);
  }

  body.push([
    {
      content: `Ответственный: ${cfg.responsibleRole}, ${cfg.responsibleEmployee}`,
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
    columnStyles: {
      0: { cellWidth: roomColWidth },
      1: { cellWidth: typeColWidth },
      ...Object.fromEntries(SANITATION_MONTHS.map((_, index) => [index + 2, { cellWidth: monthColWidth }])),
    },
  });
}

function drawTrackedPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  fields: TrackedField[];
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: { id: string; name: string; role: string }[];
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
    margin: { left: 10, right: 10 },
  });
}

function drawPestControlPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string | null;
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: { id: string; name: string; role: string }[];
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
  const userMap = Object.fromEntries(params.users.map((user) => [user.id, user.name]));

  drawTitle(doc, params.title || PEST_CONTROL_DOCUMENT_TITLE);

  const x = 24;
  const y = 28;
  const width = pageWidth - 48;
  const leftWidth = 56;
  const rightWidth = 32;
  const middleWidth = width - leftWidth - rightWidth;
  const topHeight = 10;
  const secondHeight = 10;

  doc.setLineWidth(0.25);
  doc.rect(x, y, width, topHeight + secondHeight);
  doc.line(x + leftWidth, y, x + leftWidth, y + topHeight + secondHeight);
  doc.line(x + leftWidth + middleWidth, y, x + leftWidth + middleWidth, y + topHeight + secondHeight);
  doc.line(x + leftWidth, y + topHeight, x + width, y + topHeight);

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  drawCenteredText(doc, params.organizationName, x + 3, y, leftWidth - 6, topHeight + secondHeight, leftWidth - 10);

  doc.setFont("JournalUnicode", "normal");
  drawCenteredText(doc, "СИСТЕМА ХАССП", x + leftWidth, y, middleWidth, topHeight, middleWidth - 10);

  doc.setFont("JournalUnicode", "italic");
  drawCenteredText(doc, headerTitleOr(params.title || PEST_CONTROL_DOCUMENT_TITLE).toUpperCase(), x + leftWidth, y + topHeight, middleWidth, secondHeight, middleWidth - 12);

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(9);
  // Даты шапки — ДД-ММ-ГГГГ, как на экране и в остальных бланках
  // (раньше здесь были точки). Дата окончания печатается ВМЕСТО
  // прочерка: раньше рядом стояли и «__________», и сама дата.
  doc.text(`Начат   ${formatPdfDate(startDate)}`, x + leftWidth + middleWidth + 2, y + 5);
  doc.text(
    endDate ? `Окончен ${formatPdfDate(endDate)}` : "Окончен __________",
    x + leftWidth + middleWidth + 2,
    y + 10
  );
  doc.setFont("JournalUnicode", "normal");
  registerPageLabelSlot(doc, {
    x: x + width - 42,
    y: y + 12,
    width: 40,
    height: 6,
    maxWidth: 38,
    fontSize: 10,
    fontStyle: "normal",
  });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(14);
  doc.text(
    (params.title || PEST_CONTROL_DOCUMENT_TITLE).toUpperCase(),
    pageWidth / 2,
    58,
    { align: "center" }
  );

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
      const acceptedEmployeeName =
        userMap[normalized.acceptedEmployeeId] ||
        userMap[entry.employeeId] ||
        "";

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
        [normalized.acceptedRole, acceptedEmployeeName].filter(Boolean).join(", "),
      ];
    });

  if (bodyRows.length === 0) {
    bodyRows.push(...Array.from({ length: 3 }, () => ["", "", "", "", "", "", "", ""]));
  } else {
    bodyRows.push(["", "", "", "", "", "", "", ""]);
  }

  autoTable(doc, {
    startY: 66,
    margin: { left: 24, right: 24 },
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
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 24, halign: "center" },
      2: { cellWidth: 34, halign: "center" },
      3: { cellWidth: 22, halign: "center" },
      4: { cellWidth: 31, halign: "center" },
      5: { cellWidth: 56, halign: "center" },
      6: { cellWidth: 31, halign: "center" },
      7: { cellWidth: 33, halign: "center" },
    },
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
}) {
  const marginX = 14;
  const currentFont = doc.getFont().fontName || "helvetica";

  drawTitle(doc, params.title || EQUIPMENT_CLEANING_DOCUMENT_TITLE);
  let currentY = 22;

  doc.setFontSize(11);
  doc.setFont(currentFont, "bold");

  autoTable(doc, {
    startY: currentY,
    margin: { left: marginX, right: marginX },
    theme: "grid",
    tableLineColor: [0, 0, 0],
    tableLineWidth: 0.2,
    styles: {
      font: currentFont,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      cellPadding: 2,
      halign: "center",
      valign: "middle",
      fontSize: 11,
    },
    body: [
      [
        { content: params.organizationName, rowSpan: 2, styles: { fontStyle: "bold" } },
        { content: "СИСТЕМА ХАССП" },
        {
          content: `Начат  ${toDateKey(params.dateFrom).split("-").reverse().join("-")}\nОкончен __________`,
          styles: { halign: "left" },
        },
      ],
      [
        { content: headerTitleOr("ЖУРНАЛ МОЙКИ И ДЕЗИНФЕКЦИИ ОБОРУДОВАНИЯ").toUpperCase(), styles: { fontStyle: "italic" } },
        // Пусто: «СТР. i ИЗ N» штампуется stampJournalPageNumbers по слоту,
        // который регистрируем в didDrawCell — иначе N всегда «1».
        { content: "" },
      ],
    ],
    didDrawCell: (data) => {
      if (data.section === "body" && data.row.index === 1 && data.column.index === 2) {
        registerPageLabelSlot(doc, {
          x: data.cell.x,
          y: data.cell.y,
          width: data.cell.width,
          height: data.cell.height,
          maxWidth: data.cell.width - 4,
          fontSize: 10,
          fontStyle: "normal",
        });
      }
    },
  });

  currentY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 48;
  doc.setFontSize(14);
  doc.text("ЖУРНАЛ МОЙКИ И ДЕЗИНФЕКЦИИ ОБОРУДОВАНИЯ", 105, currentY + 10, {
    align: "center",
  });

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
      `${data.controllerPosition}, ${data.controllerName}`,
    ];
  });

  autoTable(doc, {
    startY: currentY + 18,
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
  doc.text(params.organizationName, pageWidth / 2, 16, { align: "center" });
  doc.setFontSize(12);
  doc.text(params.title || DISINFECTANT_DOCUMENT_TITLE, pageWidth / 2, 24, {
    align: "center",
  });
  doc.setFont(currentFont, "normal");
  doc.setFontSize(9);
  doc.text(`Период: ${dateFromLabel} - ${dateToLabel}`, 14, 32);
  doc.text(
    `Ответственный: ${cfg.responsibleRole}${cfg.responsibleEmployee ? `, ${cfg.responsibleEmployee}` : ""}`,
    14,
    38
  );

  autoTable(doc, {
    startY: 46,
    margin: { left: 14, right: 14 },
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
    margin: { left: 14, right: 14 },
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
    margin: { left: 14, right: 14 },
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
    margin: { left: 10, right: 10 },
  });
}

function drawUvRuntimePdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeUvRuntimeDocumentConfig>;
  entries: { employeeId: string; date: Date; data: Record<string, unknown> }[];
  users: { id: string; name: string; role: string }[];
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
    margin: { left: 10, right: 10 },
  });

  const specEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

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
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;


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
  users: { id: string; name: string; role: string }[];
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
    margin: { left: 10, right: 10 },
  });
}

function drawAuditPlanPdf(doc: jsPDF, params: {
  organizationName: string;
  title: string;
  dateFrom: Date | string;
  dateTo: Date | string;
  config: ReturnType<typeof normalizeAuditPlanConfig>;
}) {
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
      params.config.approveRole,
      params.config.approveEmployee,
      getAuditPlanPrintDateLabel(params.config.documentDate),
    ].filter((line) => Boolean(line && line.trim()));
    const right = doc.internal.pageSize.getWidth() - 10;
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
    margin: { left: 10, right: 10 },
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
    12,
    afterHeader(metaBottom, 62),
    270,
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
    margin: { left: 10, right: 10 },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 120 },
      2: { cellWidth: 16 },
      3: { cellWidth: 16 },
      4: { cellWidth: 100 },
    },
  });

  const finalY = ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 66) + 10;
  doc.setFont("JournalUnicode", "normal");
  doc.setFontSize(9);
  let cursorY = finalY;
  params.config.signatures.forEach((signature) => {
    doc.text(
      `${signature.role || "Подпись"}: ${signature.name}${signature.signedAt ? `, ${formatRuDateDash(signature.signedAt)}` : ""}`,
      12,
      cursorY
    );
    cursorY += 6;
  });
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
    12,
    cursorY,
    270,
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
    margin: { left: 10, right: 10 },
  });

  cursorY = ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || cursorY) + 10;
  params.config.signatures.forEach((signature) => {
    doc.text(
      `${signature.role || "Подпись"}: ${[signature.position, signature.name].filter(Boolean).join(", ")}${signature.signedAt ? `, ${formatRuDateDash(signature.signedAt)}` : ""}`,
      12,
      cursorY
    );
    cursorY += 6;
  });
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
    margin: { left: 10, right: 10 },
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
    margin: { left: 10, right: 10 },
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
  users: { id: string; name: string; role: string }[];
}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const x = 24;
  const y = 28;
  const width = pageWidth - 48;
  const leftWidth = 56;
  const rightWidth = 36;
  const middleWidth = width - leftWidth - rightWidth;
  const topHeight = 10;
  const secondHeight = 10;
  const totalHeight = topHeight + secondHeight;

  drawTitle(doc, params.title);

  doc.setLineWidth(0.25);
  doc.rect(x, y, width, totalHeight);
  doc.line(x + leftWidth, y, x + leftWidth, y + totalHeight);
  doc.line(x + leftWidth + middleWidth, y, x + leftWidth + middleWidth, y + totalHeight);
  doc.line(x + leftWidth, y + topHeight, x + leftWidth + middleWidth, y + topHeight);

  doc.setFontSize(10);
  doc.setFont("JournalUnicode", "bold");
  drawCenteredText(doc, params.organizationName, x + 3, y, leftWidth - 6, totalHeight, leftWidth - 10);

  doc.setFont("JournalUnicode", "normal");
  drawCenteredText(doc, "СИСТЕМА ХАССП", x + leftWidth, y, middleWidth, topHeight, middleWidth - 10);

  doc.setFont("JournalUnicode", "italic");
  drawCenteredText(
    doc,
    headerTitleOr(INTENSIVE_COOLING_DOCUMENT_TITLE).toUpperCase(),
    x + leftWidth,
    y + topHeight,
    middleWidth,
    secondHeight,
    middleWidth - 10
  );

  const startedAt =
    params.dateFrom instanceof Date
      ? params.dateFrom.toISOString().slice(0, 10)
      : String(params.dateFrom).slice(0, 10);

  doc.setFont("JournalUnicode", "bold");
  doc.text(`Начат  ${formatIntensiveCoolingDate(startedAt)}`, x + leftWidth + middleWidth + 2, y + 6);
  doc.text(`Окончен __________`, x + leftWidth + middleWidth + 2, y + 13);
  doc.setFont("JournalUnicode", "normal");
  registerPageLabelSlot(doc, {
    x: x + width - 60,
    y: y + 14,
    width: 40,
    height: 6,
    maxWidth: 38,
    fontSize: 10,
    fontStyle: "normal",
  });

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(13);
  doc.text(INTENSIVE_COOLING_DOCUMENT_TITLE.toUpperCase(), pageWidth / 2, y + totalHeight + 12, {
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
          const responsibleLabel = [row.responsibleTitle, user?.name]
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
    startY: y + totalHeight + 18,
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
    margin: { left: 10, right: 10 },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 34 },
      2: { cellWidth: 34 },
      3: { cellWidth: 28 },
      4: { cellWidth: 24 },
      5: { cellWidth: 62 },
      6: { cellWidth: 28 },
      7: { cellWidth: 42 },
    },
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
    margin: { left: 10, right: 10, top: fryerContinuationTop },
    // Строка данных (дата + время двумя строками) не должна
    // рваться между страницами.
    rowPageBreak: "avoid",
  });

  const dataTableEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Appendix — quality assessment methodology
  const appendixStartY = dataTableEndY + 10;
  const pageHeight = doc.internal.pageSize.getHeight();

  // Check if we need a new page for the appendix
  const appendixY =
    appendixStartY + 8 > pageHeight - 20
      ? (() => {
          doc.addPage();
          // Не 20мм: на новой странице сверху повторяется штамп ХАССП.
          return fryerContinuationTop + 4;
        })()
      : appendixStartY;

  doc.setFont("JournalUnicode", "bold");
  doc.setFontSize(10);
  doc.text("Приложение. Методика определения качества фритюрного жира.", 10, appendixY);

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
    margin: { left: 10, right: 10, top: fryerContinuationTop },
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
    margin: { left: 10, right: 200, top: fryerContinuationTop },
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
  if (formulaY + formulaBlockHeight > pageHeight - 12) {
    doc.addPage();
    formulaY = fryerContinuationTop;
  }
  formulaLines.forEach((line, index) => {
    doc.text(line, 10, formulaY + 7 + index * 4.5);
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
  users: Array<{ id: string; name: string; role: string }>;
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
  const bodyRows = params.entries.map((entry) => {
    const data = normalizeGlassControlEntryData(entry.data);
    const userName = params.users.find((user) => user.id === entry.employeeId)?.name || params.responsibleName;
    return [
      formatGlassRuDateDash(entry.date),
      data.damagesDetected ? "V" : "",
      data.damagesDetected ? "" : "V",
      data.itemName,
      data.quantity,
      data.damageInfo,
      userName,
    ];
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
    margin: { left: 14, right: 14, top: activePageHeaderHeight + HEADER_TITLE_GAP },
    columnStyles: {
      0: { cellWidth: 24, halign: "center" },
      1: { cellWidth: 12, halign: "center" },
      2: { cellWidth: 12, halign: "center" },
      3: { cellWidth: 42 },
      4: { cellWidth: 16, halign: "center" },
      5: { cellWidth: 58 },
      6: { cellWidth: 28, halign: "center" },
    },
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
};

export type PdfSignatureLine = {
  employeeName: string;
  method: string;
  device: string | null;
  count: number;
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
  const users = dbUsers.map((user) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    email: user.email,
    positionTitle: getUserDisplayTitle(user),
  }));
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

  return { document, users, equipment, rooms, branding, signatures };
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
      if (ev.createdAt < line.firstAt) line.firstAt = ev.createdAt;
      if (ev.createdAt > line.lastAt) line.lastAt = ev.createdAt;
    } else {
      groups.set(key, {
        employeeName: nameById.get(ev.userId) ?? "—",
        method: SIGNATURE_METHOD_LABEL[ev.method] ?? ev.method,
        device,
        count: 1,
        firstAt: ev.createdAt,
        lastAt: ev.createdAt,
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName, "ru"));
}

/** Совместимость: загрузка + рендер одним вызовом, как было раньше. */
export async function generateJournalDocumentPdf(params: {
  documentId: string;
  organizationId: string;
}): Promise<{ buffer: Buffer; fileName: string }> {
  return renderJournalDocumentPdf(await loadJournalDocumentPdfInput(params));
}

/**
 * Чистый рендер: ни одного обращения к БД, только jsPDF поверх
 * переданных данных.
 */
export function renderJournalDocumentPdf(
  input: JournalDocumentPdfInput
): { buffer: Buffer; fileName: string } {
  const { document, users, equipment, rooms, branding } = input;

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const fontName = loadUnicodeFont(doc);
  doc.setFont(fontName, "normal");

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
  resetPageLabelSlots();

  if (templateCode === "hygiene") {
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
    });
  } else if (templateCode === TRAINING_PLAN_TEMPLATE_CODE) {
    drawTrainingPlanPdf(doc, {
      organizationName,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      title: document.title || TRAINING_PLAN_HEADING,
      config: normalizeTrainingPlanConfig(reconciledConfig),
    });
  } else if (templateCode === AUDIT_PLAN_TEMPLATE_CODE) {
    drawAuditPlanPdf(doc, {
      organizationName,
      title: document.title || AUDIT_PLAN_DOCUMENT_TITLE,
      dateFrom: document.dateFrom,
      dateTo: document.dateTo,
      config: auditPlanConfig,
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
  // шапке каждой страницы (или в подвале, если шапки на странице нет).
  stampJournalPageNumbers(doc);
  // Подвал партнёра (white-label) — после нумерации, чтобы не спорить
  // за нижний край страницы.
  stampPartnerPdfFooter(doc, branding);

  activeControlPeriodicity = "";
  activeDocumentStatus = "";
  activeHeaderTitle = "";
  activeJournalName = "";
  activePageHeaderPainter = null;
  activePageHeaderHeight = 0;
  pagesWithJournalHeader.clear();
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
  };
}
