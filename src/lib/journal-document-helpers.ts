import {
  getHealthDocumentTitle,
  getHygieneDocumentTitle,
  getHygienePeriodLabel,
} from "@/lib/hygiene-document";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  getColdEquipmentDocumentTitle,
  getColdEquipmentPeriodLabel,
} from "@/lib/cold-equipment-document";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  getClimateDocumentTitle,
  getClimatePeriodLabel,
} from "@/lib/climate-document";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  getCleaningDocumentTitle,
  getCleaningPeriodLabel,
} from "@/lib/cleaning-document";
import {
  EQUIPMENT_CLEANING_TEMPLATE_CODE,
  getEquipmentCleaningDocumentTitle,
  getEquipmentCleaningPeriodLabel,
} from "@/lib/equipment-cleaning-document";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  getFinishedProductDefaultDocumentTitle,
  getFinishedProductPeriodLabel,
} from "@/lib/finished-product-document";
import {
  getTrackedDocumentTitle,
  isTrackedDocumentTemplate,
} from "@/lib/tracked-document";
import { COMPLAINT_REGISTER_TEMPLATE_CODE } from "@/lib/complaint-document";
import { getRegisterDocumentTitle } from "@/lib/register-document";
import { isGenericRegisterJournal, REGISTER_JOURNAL_CODES } from "@/lib/register-journals";
import { AUDIT_PROTOCOL_TEMPLATE_CODE } from "@/lib/audit-protocol-document";
import { AUDIT_REPORT_TEMPLATE_CODE } from "@/lib/audit-report-document";
import {
  SANITATION_DAY_TEMPLATE_CODE,
  SANITATION_DAY_DOCUMENT_TITLE,
} from "@/lib/sanitation-day-document";
import {
  MED_BOOK_TEMPLATE_CODE,
  MED_BOOK_DOCUMENT_TITLE,
} from "@/lib/med-book-document";
import {
  GLASS_LIST_DOCUMENT_TITLE,
  GLASS_LIST_TEMPLATE_CODE,
} from "@/lib/glass-list-document";
import {
  GLASS_CONTROL_DOCUMENT_TITLE,
  GLASS_CONTROL_TEMPLATE_CODE,
} from "@/lib/glass-control-document";
import {
  AUDIT_PLAN_DOCUMENT_TITLE,
  AUDIT_PLAN_TEMPLATE_CODE,
} from "@/lib/audit-plan-document";
import {
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  PERISHABLE_REJECTION_DOCUMENT_TITLE,
} from "@/lib/perishable-rejection-document";
import {
  STAFF_TRAINING_TEMPLATE_CODE,
  STAFF_TRAINING_FULL_TITLE,
} from "@/lib/staff-training-document";
import {
  TRAINING_PLAN_TEMPLATE_CODE,
  TRAINING_PLAN_DOCUMENT_TITLE,
} from "@/lib/training-plan-document";
import {
  BREAKDOWN_HISTORY_TEMPLATE_CODE,
  BREAKDOWN_HISTORY_DOCUMENT_TITLE,
} from "@/lib/breakdown-history-document";
import {
  ACCIDENT_DOCUMENT_TEMPLATE_CODE,
  ACCIDENT_DOCUMENT_TITLE,
} from "@/lib/accident-document";
import {
  EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
  EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE,
} from "@/lib/equipment-maintenance-document";
import {
  DISINFECTANT_TEMPLATE_CODE,
  DISINFECTANT_DOCUMENT_TITLE,
} from "@/lib/disinfectant-document";
import {
  getAcceptanceDocumentTitle,
  isAcceptanceDocumentTemplate,
} from "@/lib/acceptance-document";
import {
  getSanitaryDayChecklistTitle,
  isSanitaryDayChecklistTemplate,
} from "@/lib/sanitary-day-checklist-document";
import {
  PPE_ISSUANCE_DOCUMENT_TITLE,
  PPE_ISSUANCE_TEMPLATE_CODE,
} from "@/lib/ppe-issuance-document";
import {
  TRACEABILITY_DOCUMENT_TEMPLATE_CODE,
  getTraceabilityDocumentTitle,
} from "@/lib/traceability-document";
import {
  INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
  INTENSIVE_COOLING_TEMPLATE_CODE,
} from "@/lib/intensive-cooling-document";
import {
  METAL_IMPURITY_DOCUMENT_TITLE,
  METAL_IMPURITY_TEMPLATE_CODE,
} from "@/lib/metal-impurity-document";
import {
  getScanJournalConfig,
  isScanOnlyDocumentTemplate as isScanOnlyDocumentTemplateFromConfig,
} from "@/lib/scan-journal-config";

const SCAN_ONLY_JOURNALS = [
  {
    code: "audit_plan_scan",
    folderName: "План-программа внутренних аудитов",
    title: "План-программа внутренних аудитов",
  },
  {
    code: "audit_protocol_scan",
    folderName: "Протокол внутреннего аудита",
    title: "Журнал аудита - Протокол",
  },
  {
    code: "audit_report_scan",
    folderName: "Отчет о внутреннем аудите",
    title: "Журнал аудита - Отчет",
  },
  {
    code: "critical_limit_check",
    folderName: "Журнал учета критических показателей",
    title: "Журнал учета критических показателей",
  },
] as const;

export type ScanOnlyJournalCode = (typeof SCAN_ONLY_JOURNALS)[number]["code"];

export function getScanOnlyJournalCodeMeta(code: string) {
  const configCode = getScanJournalConfig(code);
  if (configCode) {
    return {
      code: configCode.code,
      folderName: configCode.folderName,
      title: configCode.title,
    };
  }

  return SCAN_ONLY_JOURNALS.find((item) => item.code === code);
}

export function getScanOnlyJournalFolderName(code: string) {
  return getScanOnlyJournalCodeMeta(code)?.folderName ?? null;
}

export function isScanOnlyJournalTemplate(code: string) {
  return (
    isScanOnlyDocumentTemplateFromConfig(code) ||
    getScanOnlyJournalCodeMeta(code) != null
  );
}

export function isDocumentTemplate(templateCode: string) {
  return (
    templateCode === "hygiene" ||
    templateCode === "health_check" ||
    templateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE ||
    templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE ||
    templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE ||
    templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE ||
    templateCode === EQUIPMENT_CLEANING_TEMPLATE_CODE ||
    templateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE ||
    templateCode === STAFF_TRAINING_TEMPLATE_CODE ||
    templateCode === PERISHABLE_REJECTION_TEMPLATE_CODE ||
    templateCode === MED_BOOK_TEMPLATE_CODE ||
    templateCode === GLASS_LIST_TEMPLATE_CODE ||
    templateCode === GLASS_CONTROL_TEMPLATE_CODE ||
    templateCode === AUDIT_PLAN_TEMPLATE_CODE ||
    templateCode === TRAINING_PLAN_TEMPLATE_CODE ||
    templateCode === BREAKDOWN_HISTORY_TEMPLATE_CODE ||
    templateCode === ACCIDENT_DOCUMENT_TEMPLATE_CODE ||
    templateCode === PPE_ISSUANCE_TEMPLATE_CODE ||
    templateCode === TRACEABILITY_DOCUMENT_TEMPLATE_CODE ||
    templateCode === METAL_IMPURITY_TEMPLATE_CODE ||
    templateCode === INTENSIVE_COOLING_TEMPLATE_CODE ||
    templateCode === DISINFECTANT_TEMPLATE_CODE ||
    isScanOnlyJournalTemplate(templateCode) ||
    isTrackedDocumentTemplate(templateCode)
  );
}

/**
 * Журналы, у которых есть свой документный экран, но которые НЕ проходят
 * через generic-ветку `isDocumentTemplate` — они разбираются ниже по
 * `/journals/[code]/page.tsx` собственными блоками.
 *
 * Существует ровно ради `/journals/<code>/new`: без этого списка форма
 * `DynamicForm` открывалась для журналов, чьи данные живут в
 * `JournalDocument.config`. Для `audit_protocol` и `audit_report`
 * `template.fields` пуст, и пользователь видел форму на ноль полей;
 * для `complaint_register` — три поля `textarea`, которые до этой правки
 * вообще не рендерились.
 *
 * Добавлять сюда, а НЕ в `isDocumentTemplate`: там эти коды перехватила бы
 * generic-ветка и их собственные экраны стали бы недостижимы.
 */
const DOCUMENT_UI_ONLY_TEMPLATE_CODES = new Set([
  COMPLAINT_REGISTER_TEMPLATE_CODE,
  // Табличные реестры: заполняются строками внутри документа.
  ...REGISTER_JOURNAL_CODES,
  AUDIT_PROTOCOL_TEMPLATE_CODE,
  AUDIT_REPORT_TEMPLATE_CODE,
]);

/**
 * «У журнала заполнение идёт в документе, а не через `/new`».
 * Шире, чем `isDocumentTemplate`: включает журналы с собственным экраном.
 */
export function hasDocumentFillUi(templateCode: string) {
  return (
    isDocumentTemplate(templateCode) ||
    DOCUMENT_UI_ONLY_TEMPLATE_CODES.has(templateCode)
  );
}

export function isStaffDocumentTemplate(templateCode: string) {
  return templateCode === "hygiene" || templateCode === "health_check";
}

export function getJournalDocumentDefaultTitle(templateCode: string) {
  const scanJournalConfig = getScanJournalConfig(templateCode);
  if (scanJournalConfig) {
    return scanJournalConfig.title;
  }

  if (templateCode === "health_check") return getHealthDocumentTitle();
  if (templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    return getColdEquipmentDocumentTitle();
  }
  if (templateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) {
    return getFinishedProductDefaultDocumentTitle();
  }
  if (templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    return getClimateDocumentTitle();
  }
  if (templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE) {
    return getCleaningDocumentTitle();
  }
  if (templateCode === EQUIPMENT_CLEANING_TEMPLATE_CODE) {
    return getEquipmentCleaningDocumentTitle();
  }
  if (templateCode === SANITATION_DAY_TEMPLATE_CODE) {
    return SANITATION_DAY_DOCUMENT_TITLE;
  }
  if (templateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE) {
    return EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE;
  }
  if (templateCode === STAFF_TRAINING_TEMPLATE_CODE) {
    return STAFF_TRAINING_FULL_TITLE;
  }
  if (templateCode === PERISHABLE_REJECTION_TEMPLATE_CODE) {
    return PERISHABLE_REJECTION_DOCUMENT_TITLE;
  }
  if (templateCode === MED_BOOK_TEMPLATE_CODE) {
    return MED_BOOK_DOCUMENT_TITLE;
  }
  if (templateCode === GLASS_LIST_TEMPLATE_CODE) {
    return GLASS_LIST_DOCUMENT_TITLE;
  }
  if (templateCode === GLASS_CONTROL_TEMPLATE_CODE) {
    return GLASS_CONTROL_DOCUMENT_TITLE;
  }
  if (templateCode === AUDIT_PLAN_TEMPLATE_CODE) {
    return AUDIT_PLAN_DOCUMENT_TITLE;
  }
  if (templateCode === TRAINING_PLAN_TEMPLATE_CODE) {
    return TRAINING_PLAN_DOCUMENT_TITLE;
  }
  if (templateCode === BREAKDOWN_HISTORY_TEMPLATE_CODE) {
    return BREAKDOWN_HISTORY_DOCUMENT_TITLE;
  }
  if (templateCode === ACCIDENT_DOCUMENT_TEMPLATE_CODE) {
    return ACCIDENT_DOCUMENT_TITLE;
  }
  if (templateCode === DISINFECTANT_TEMPLATE_CODE) {
    return DISINFECTANT_DOCUMENT_TITLE;
  }
  if (templateCode === PPE_ISSUANCE_TEMPLATE_CODE) {
    return PPE_ISSUANCE_DOCUMENT_TITLE;
  }
  if (templateCode === METAL_IMPURITY_TEMPLATE_CODE) {
    return METAL_IMPURITY_DOCUMENT_TITLE;
  }
  if (templateCode === INTENSIVE_COOLING_TEMPLATE_CODE) {
    return INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME;
  }
  if (isAcceptanceDocumentTemplate(templateCode)) {
    return getAcceptanceDocumentTitle(templateCode);
  }
  if (isSanitaryDayChecklistTemplate(templateCode)) {
    return getSanitaryDayChecklistTitle(templateCode);
  }
  if (isGenericRegisterJournal(templateCode)) {
    return getRegisterDocumentTitle(templateCode);
  }
  if (templateCode === "critical_limit_check") {
    return "Журнал учета критических показателей";
  }
  if (templateCode === TRACEABILITY_DOCUMENT_TEMPLATE_CODE) {
    return getTraceabilityDocumentTitle();
  }
  if (isTrackedDocumentTemplate(templateCode)) {
    return getTrackedDocumentTitle(templateCode);
  }
  return getHygieneDocumentTitle();
}

export function getJournalDocumentHeading(templateCode: string, closed = false) {
  const base = getJournalDocumentDefaultTitle(templateCode);
  return closed ? `${base} (закрытые)` : base;
}

export function getJournalDocumentPeriodLabel(
  templateCode: string,
  dateFrom: Date | string,
  dateTo: Date | string
) {
  if (templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    return getColdEquipmentPeriodLabel(dateFrom, dateTo);
  }

  if (templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    return getClimatePeriodLabel(dateFrom, dateTo);
  }

  if (templateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) {
    return getFinishedProductPeriodLabel(dateFrom, dateTo);
  }

  if (templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE) {
    return getCleaningPeriodLabel(dateFrom, dateTo);
  }

  if (templateCode === EQUIPMENT_CLEANING_TEMPLATE_CODE) {
    return getEquipmentCleaningPeriodLabel(dateFrom);
  }

  return getHygienePeriodLabel(dateFrom, dateTo);
}
