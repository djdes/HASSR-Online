import type React from "react";
import { LiveRefresh } from "@/components/live/live-refresh";
import { hasSeenNotice } from "@/lib/seen-notices";
import { formatCardDateTime } from "@/lib/journal-card-date";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { JOURNAL_ACTION_CREATE_CLASS, JournalListActions } from "@/components/journals/journal-list-actions";
import { JournalPageCrumbs } from "@/components/journals/journal-breadcrumbs";
import { getJournalCrumbMenu } from "@/lib/journal-crumb-menu";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { Prisma } from "@prisma/client";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { sharedDocumentFlag } from "@/lib/journal-document-shared";
import { aclActorFromSession, hasJournalAccess } from "@/lib/journal-acl";
import { db } from "@/lib/db";
import { HygieneDocumentsClient } from "@/components/journals/hygiene-documents-client";
import { HealthDocumentsClient } from "@/components/journals/health-documents-client";
import { readControlPeriodicity } from "@/lib/control-periodicity";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  JournalEnabledIndicator,
  JournalToggleProvider,
} from "@/components/journals/journal-enabled-indicator";
import {
  getJournalAutomation,
  isAutomationSupported,
  isJournalAutomationEnabled,
} from "@/lib/journal-automation";
import {
  buildDateKeys,
  buildExampleHygieneEntryMap,
  buildHygieneExampleEmployees,
  getHygieneDemoTeamUsers,
  getHygienePositionLabel,
  getHealthSeedDocumentConfigs,
  getHygieneDefaultResponsibleTitle,
  getHygieneSeedDocumentConfigs,
} from "@/lib/hygiene-document";
import {
  getJournalDocumentDefaultTitle,
  getJournalDocumentPeriodLabel,
  isDocumentTemplate,
} from "@/lib/journal-document-helpers";
import {
  buildFinishedProductArchiveSeed,
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
} from "@/lib/finished-product-document";
import { FinishedProductDocumentsClient } from "@/components/journals/finished-product-documents-client";
import { CLIMATE_DOCUMENT_TEMPLATE_CODE } from "@/lib/climate-document";
import {
  buildColdEquipmentConfigFromEquipment,
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
} from "@/lib/cold-equipment-document";
import { ColdEquipmentDocumentsClient } from "@/components/journals/cold-equipment-documents-client";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  applyCleaningAutoFillToConfig,
  getCleaningCreatePeriodBounds,
  defaultCleaningDocumentConfig,
} from "@/lib/cleaning-document";
import { CleaningDocumentsClient } from "@/components/journals/cleaning-documents-client";
import { ComplaintDocumentsClient } from "@/components/journals/complaint-documents-client";
import {
  EQUIPMENT_CLEANING_TEMPLATE_CODE,
  getDefaultEquipmentCleaningConfig,
  getEquipmentCleaningDocumentTitle,
  getEquipmentCleaningPeriodLabel,
  normalizeEquipmentCleaningConfig,
} from "@/lib/equipment-cleaning-document";
import { TrackedDocumentsClient } from "@/components/journals/tracked-documents-client";
import {
  getTrackedDocumentCreateMode,
  isSourceStyleTrackedTemplate,
  isTrackedDocumentTemplate,
} from "@/lib/tracked-document";
import {
  COMPLAINT_REGISTER_TEMPLATE_CODE,
  COMPLAINT_REGISTER_TITLE,
  normalizeComplaintConfig,
} from "@/lib/complaint-document";
import { UvLampRuntimeDocumentsClient } from "@/components/journals/uv-lamp-runtime-documents-client";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import { MedBookDocumentsClient } from "@/components/journals/med-book-documents-client";
import { IncomingControlDocumentsClient } from "@/components/journals/incoming-control-documents-client";
import {
  MED_BOOK_TEMPLATE_CODE,
  MED_BOOK_DOCUMENT_TITLE,
  getDefaultMedBookConfig,
  emptyMedBookEntry,
} from "@/lib/med-book-document";
import {
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  buildAcceptanceDocumentConfigFromData,
  getAcceptanceDocumentTitle,
  isAcceptanceDocumentTemplate,
  normalizeAcceptanceDocumentConfig,
} from "@/lib/acceptance-document";
import {
  PPE_ISSUANCE_DOCUMENT_TITLE,
  PPE_ISSUANCE_TEMPLATE_CODE,
  PPE_ISSUANCE_SOURCE_SLUG,
  buildPpeIssuanceDemoConfig,
} from "@/lib/ppe-issuance-document";
import {
  SANITATION_DAY_SOURCE_SLUG,
  SANITATION_DAY_TEMPLATE_CODE,
  SANITATION_DAY_DOCUMENT_TITLE,
  getSanitationDayDefaultConfig,
  getSanitationDocumentDateLabel,
  getSanitationApproveLabel,
} from "@/lib/sanitation-day-document";
import { SanitationDayDocumentsClient } from "@/components/journals/sanitation-day-documents-client";
import { PpeIssuanceDocumentsClient } from "@/components/journals/ppe-issuance-documents-client";
import {
  BREAKDOWN_HISTORY_TEMPLATE_CODE,
  BREAKDOWN_HISTORY_SOURCE_SLUG,
  BREAKDOWN_HISTORY_DOCUMENT_TITLE,
  getBreakdownHistoryDefaultConfig,
} from "@/lib/breakdown-history-document";
import { BreakdownHistoryDocumentsClient } from "@/components/journals/breakdown-history-documents-client";
import {
  ACCIDENT_DOCUMENT_TEMPLATE_CODE,
  ACCIDENT_DOCUMENT_SOURCE_SLUG,
  ACCIDENT_DOCUMENT_TITLE,
  buildAccidentDocumentDemoConfig,
} from "@/lib/accident-document";
import { AccidentDocumentsClient } from "@/components/journals/accident-documents-client";
import { EquipmentCleaningDocumentsClient } from "@/components/journals/equipment-cleaning-documents-client";
import { IntensiveCoolingDocumentsClient } from "@/components/journals/intensive-cooling-documents-client";
import {
  TRAINING_PLAN_TEMPLATE_CODE,
  TRAINING_PLAN_SOURCE_SLUG,
  TRAINING_PLAN_DOCUMENT_TITLE,
  getTrainingPlanDefaultConfig,
} from "@/lib/training-plan-document";
import { TrainingPlanDocumentsClient } from "@/components/journals/training-plan-documents-client";
import {
  AUDIT_PLAN_DOCUMENT_TITLE,
  AUDIT_PLAN_SOURCE_SLUG,
  AUDIT_PLAN_TEMPLATE_CODE,
  getAuditPlanDefaultConfig,
  normalizeAuditPlanConfig,
} from "@/lib/audit-plan-document";
import { AuditPlanDocumentsClient } from "@/components/journals/audit-plan-documents-client";
import { AuditProtocolDocumentsClient } from "@/components/journals/audit-protocol-documents-client";
import { AuditReportDocumentsClient } from "@/components/journals/audit-report-documents-client";
import {
  AUDIT_PROTOCOL_DOCUMENT_TITLE,
  AUDIT_PROTOCOL_TEMPLATE_CODE,
} from "@/lib/audit-protocol-document";
import {
  AUDIT_REPORT_DOCUMENT_TITLE,
  AUDIT_REPORT_TEMPLATE_CODE,
} from "@/lib/audit-report-document";
import {
  DISINFECTANT_TEMPLATE_CODE,
  DISINFECTANT_SOURCE_SLUG,
  DISINFECTANT_DOCUMENT_TITLE,
  getDisinfectantSampleConfig,
} from "@/lib/disinfectant-document";
import { DisinfectantDocumentsClient } from "@/components/journals/disinfectant-documents-client";
import {
  UV_LAMP_RUNTIME_TEMPLATE_CODE,
  buildUvRuntimeDocumentTitle,
  defaultUvSpecification,
  formatRuDateDash,
  normalizeUvRuntimeDocumentConfig,
} from "@/lib/uv-lamp-runtime-document";
import { FryerOilDocumentsClient } from "@/components/journals/fryer-oil-documents-client";
import { FRYER_OIL_TEMPLATE_CODE } from "@/lib/fryer-oil-document";
import { PerishableRejectionDocumentsClient } from "@/components/journals/perishable-rejection-documents-client";
import {
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  PERISHABLE_REJECTION_DOCUMENT_TITLE,
  getPerishableRejectionSampleConfig,
} from "@/lib/perishable-rejection-document";
import { ProductWriteoffDocumentsClient } from "@/components/journals/product-writeoff-documents-client";
import {
  PRODUCT_WRITEOFF_DOCUMENT_TITLE,
  PRODUCT_WRITEOFF_TEMPLATE_CODE,
  buildProductWriteoffConfigFromData,
  normalizeProductWriteoffConfig,
} from "@/lib/product-writeoff-document";
import { GlassListDocumentsClient } from "@/components/journals/glass-list-documents-client";
import {
  GLASS_LIST_DOCUMENT_TITLE,
  GLASS_LIST_TEMPLATE_CODE,
  buildGlassListConfigFromData,
  normalizeGlassListConfig,
} from "@/lib/glass-list-document";
import { GlassControlDocumentsClient } from "@/components/journals/glass-control-documents-client";
import * as glassControlDocument from "@/lib/glass-control-document";
import { StaffTrainingDocumentsClient } from "@/components/journals/staff-training-documents-client";
import {
  STAFF_TRAINING_TEMPLATE_CODE,
  STAFF_TRAINING_DOCUMENT_TITLE,
  getDefaultStaffTrainingConfig,
  buildStaffTrainingSeedRows,
} from "@/lib/staff-training-document";
import { EquipmentMaintenanceDocumentsClient } from "@/components/journals/equipment-maintenance-documents-client";
import {
  EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE,
  EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
  getDefaultEquipmentMaintenanceConfig,
} from "@/lib/equipment-maintenance-document";
import { SanitaryDayChecklistDocumentsClient } from "@/components/journals/sanitary-day-checklist-documents-client";
import { CleaningVentilationChecklistDocumentsClient } from "@/components/journals/cleaning-ventilation-checklist-documents-client";
import {
  CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE,
  CLEANING_VENTILATION_CHECKLIST_TITLE,
  getDefaultCleaningVentilationConfig,
  getMonthBoundsFromDate as getCleaningVentilationMonthBounds,
  normalizeCleaningVentilationConfig,
} from "@/lib/cleaning-ventilation-checklist-document";
import {
  getSanitaryDayChecklistTitle,
  isSanitaryDayChecklistTemplate,
  defaultSdcConfig,
} from "@/lib/sanitary-day-checklist-document";
import { EquipmentCalibrationDocumentsClient } from "@/components/journals/equipment-calibration-documents-client";
import {
  buildEquipmentCalibrationConfigFromEquipment,
  EQUIPMENT_CALIBRATION_DOCUMENT_TITLE,
  EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
} from "@/lib/equipment-calibration-document";
import { TraceabilityDocumentsClient } from "@/components/journals/traceability-documents-client";
import {
  TRACEABILITY_DOCUMENT_SOURCE_SLUG,
  TRACEABILITY_DOCUMENT_TEMPLATE_CODE,
  createTraceabilityRow,
  getTraceabilitySampleConfig,
  normalizeTraceabilityDocumentConfig,
} from "@/lib/traceability-document";
import {
  getScanJournalConfig,
  isScanOnlyDocumentTemplate,
} from "@/lib/scan-journal-config";
import { getScanJournalPageCount } from "@/lib/scan-journal-pages";
import { ScanJournalDocumentsClient } from "@/components/journals/scan-journal-documents-client";
import {
  METAL_IMPURITY_DOCUMENT_TITLE,
  METAL_IMPURITY_SOURCE_SLUG,
  METAL_IMPURITY_TEMPLATE_CODE,
  getDefaultMetalImpurityConfig,
  normalizeMetalImpurityConfig,
} from "@/lib/metal-impurity-document";
import { MetalImpurityDocumentsClient } from "@/components/journals/metal-impurity-documents-client";
import {
  createIntensiveCoolingRow,
  getDefaultIntensiveCoolingConfig,
  getResponsibleTitleByRole,
  INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
  INTENSIVE_COOLING_SOURCE_SLUG,
  INTENSIVE_COOLING_TEMPLATE_CODE,
} from "@/lib/intensive-cooling-document";
import {
  PEST_CONTROL_DOCUMENT_TITLE,
  PEST_CONTROL_TEMPLATE_CODE,
} from "@/lib/pest-control-document";
import {
  getUserDisplayTitle,
  getUserRoleLabel,
  pickPrimaryManager,
  toCanonicalUserRole,
} from "@/lib/user-roles";
import { JournalAutoCreateToggle } from "@/components/journals/journal-auto-create-toggle";
import { JournalCreateDefaultsProvider } from "@/components/journals/journal-create-defaults";
import { JournalManageProvider } from "@/components/journals/document-list-ui";
import { parseOrgColumnDefaults } from "@/lib/journal-columns";
import { getPrimarySlotId } from "@/lib/journal-responsible-schemas";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";

export const dynamic = "force-dynamic";
const SOURCE_STYLE_TRACKED_DEMO_CODES = new Set([
  "daily_rejection",
  "raw_storage_control",
  "defrosting_control",
  "uv_lamp_runtime",
  "fryer_oil",
]);
type TrackedTemplateField = {
  key: string;
  type?: string;
  label?: string;
  options?: Array<{ value: string; label: string }>;
};

function getCurrentAndPreviousMonthBounds(referenceDate = new Date()) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();

  return {
    activeFrom: new Date(Date.UTC(year, month, 1)),
    activeTo: new Date(Date.UTC(year, month + 1, 0)),
    closedFrom: new Date(Date.UTC(year, month - 1, 1)),
    closedTo: new Date(Date.UTC(year, month, 0)),
  };
}

async function normalizeDemoJournalSampleCorpus(params: {
  templateId: string;
  organizationId: string;
  enabled: boolean;
}) {
  const { templateId, organizationId, enabled } = params;
  if (!enabled) return;

  const existing = await db.journalDocument.findMany({
    where: { templateId, organizationId },
    select: { status: true },
  });

  if (existing.length === 0) return;

  const activeCount = existing.filter((document) => document.status === "active").length;
  const closedCount = existing.filter((document) => document.status === "closed").length;

  if (existing.length === 2 && activeCount === 1 && closedCount === 1) {
    return;
  }

  // Demo normalization must never wipe user-created documents from the shared list route.
  // The downstream seeders can add missing samples without destructive resets.
  return;
}

async function ensureScanOnlySampleDocuments(params: {
  templateId: string;
  organizationId: string;
  createdById: string;
  title: string;
  defaultResponsibleTitle: string | null;
  responsibleUserId: string | null;
}) {
  const {
    templateId,
    organizationId,
    createdById,
    title,
    defaultResponsibleTitle,
    responsibleUserId,
  } = params;

  const existingCount = await db.journalDocument.count({
    where: { templateId, organizationId },
  });

  if (existingCount > 0) return;

  const { activeFrom, activeTo, closedFrom, closedTo } = getCurrentAndPreviousMonthBounds();

  await db.journalDocument.createMany({
    data: [
      {
        templateId,
        organizationId,
        title,
        status: "active",
        dateFrom: activeFrom,
        dateTo: activeTo,
        responsibleTitle: defaultResponsibleTitle,
        responsibleUserId,
        createdById,
      },
      {
        templateId,
        organizationId,
        title,
        status: "closed",
        dateFrom: closedFrom,
        dateTo: closedTo,
        responsibleTitle: defaultResponsibleTitle,
        responsibleUserId,
        createdById,
      },
    ],
  });
}

async function ensureStaffJournalSampleDocuments({
  templateCode,
  organizationId,
  templateId,
  users,
  createdById,
}: {
  templateCode: string;
  organizationId: string;
  templateId: string;
  users: { id: string; name: string; role: string; email?: string | null }[];
  createdById: string;
}) {
  const configs =
    templateCode === "health_check"
      ? getHealthSeedDocumentConfigs()
      : getHygieneSeedDocumentConfigs();

  const existingDocuments = await db.journalDocument.findMany({
    where: {
      organizationId,
      templateId,
    },
    select: {
      status: true,
      dateFrom: true,
      dateTo: true,
    },
  });

  const existingKeys = new Set(
    existingDocuments.map((document) => {
      const from = document.dateFrom.toISOString().slice(0, 10);
      const to = document.dateTo.toISOString().slice(0, 10);
      return `${document.status}:${from}:${to}`;
    })
  );

  const responsibleUser = pickPrimaryManager(users);

  for (const config of configs) {
    const key = `${config.status}:${config.dateFrom}:${config.dateTo}`;
    if (existingKeys.has(key)) continue;

    const document = await db.journalDocument.create({
      data: {
        templateId,
        organizationId,
        title: config.title,
        status: config.status,
        dateFrom: new Date(config.dateFrom),
        dateTo: new Date(config.dateTo),
        responsibleUserId: responsibleUser?.id || null,
        responsibleTitle: getHygieneDefaultResponsibleTitle(users),
        createdById,
      },
    });

    const sourceUsers =
      templateCode === "hygiene" && config.variant === "demo_team"
        ? getHygieneDemoTeamUsers(users)
        : users;

    const employeeIds = buildHygieneExampleEmployees(
      sourceUsers,
      templateCode === "health_check" ? 5 : 7
    )
      .filter((employee) => !employee.id.startsWith("blank-"))
      .map((employee) => employee.id);

    if (employeeIds.length === 0) continue;

    const dateKeys = buildDateKeys(config.dateFrom, config.dateTo);

    if (templateCode === "hygiene") {
      const entryMap = buildExampleHygieneEntryMap(employeeIds, dateKeys);
      const entries = Object.entries(entryMap).map(([compoundKey, data]) => {
        const separatorIndex = compoundKey.lastIndexOf(":");
        const employeeId = compoundKey.slice(0, separatorIndex);
        const dateKey = compoundKey.slice(separatorIndex + 1);

        return {
          documentId: document.id,
          employeeId,
          date: new Date(dateKey),
          data,
        };
      });

      if (entries.length > 0) {
        await db.journalDocumentEntry.createMany({ data: entries });
      }
      continue;
    }

    await db.journalDocumentEntry.createMany({
      data: employeeIds.flatMap((employeeId) =>
        dateKeys.map((dateKey) => ({
          documentId: document.id,
          employeeId,
          date: new Date(dateKey),
          data: {},
        }))
      ),
      skipDuplicates: true,
    });
  }
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toSourceDateLabel(value: Date) {
  // Было «01-09-2026» — третье написание одной и той же даты на соседних
  // экранах. Общий помощник подписей карточек даёт «01.09.2026».
  return formatCardDateTime(toDateKey(value));
}

function buildTrackedDemoValue(field: TrackedTemplateField, rowIndex: number) {
  switch (field.type) {
    case "boolean":
      return true;
    case "number":
      return rowIndex + 1;
    case "date":
      return toDateKey(new Date());
    case "select":
      return field.options?.[0]?.value ?? "";
    default:
      return `${field.label || field.key} ${rowIndex + 1}`.trim();
  }
}

function getTrackedMeta(templateCode: string, dateFrom: Date, dateTo: Date) {
  if (isAcceptanceDocumentTemplate(templateCode)) {
    return {
      metaLabel: "Дата начала",
      metaValue: toSourceDateLabel(dateFrom),
    };
  }

  if (templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    return {
      metaLabel: "Дата начала",
      metaValue: toSourceDateLabel(dateFrom),
    };
  }

  if (!isSourceStyleTrackedTemplate(templateCode)) {
    return {
      metaLabel: "Период",
      metaValue: getJournalDocumentPeriodLabel(templateCode, dateFrom, dateTo),
    };
  }

  const mode = getTrackedDocumentCreateMode(templateCode);
  if (mode === "staff") {
    return {
      metaLabel: "Период",
      metaValue: getJournalDocumentPeriodLabel(templateCode, dateFrom, dateTo),
    };
  }

  if (mode === "uv") {
    return {
      metaLabel: "Дата начала",
      metaValue: toSourceDateLabel(dateFrom),
    };
  }

  return {
    metaLabel: "Дата документа",
    metaValue: toSourceDateLabel(dateFrom),
  };
}

async function ensureSourceStyleTrackedSampleDocuments({
  templateCode,
  templateId,
  organizationId,
  users,
  createdById,
  templateFields,
}: {
  templateCode: string;
  templateId: string;
  organizationId: string;
  users: { id: string; name: string; role: string; email?: string | null }[];
  createdById: string;
  templateFields: TrackedTemplateField[];
}) {
  if (!SOURCE_STYLE_TRACKED_DEMO_CODES.has(templateCode)) return;

  const activeUser = pickPrimaryManager(users) || users[0];

  if (!activeUser) return;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const activeFrom = new Date(Date.UTC(year, month, 1));
  const activeTo = new Date(Date.UTC(year, month + 1, 0));
  const closedFrom = new Date(Date.UTC(year, month - 1, 1));
  const closedTo = new Date(Date.UTC(year, month, 0));

  const existing = await db.journalDocument.findMany({
    where: {
      organizationId,
      templateId,
      status: {
        in: ["active", "closed"],
      },
    },
    select: {
      status: true,
    },
  });

  const hasStatus = new Set(existing.map((item) => item.status));
  const baseData = Object.fromEntries(
    templateFields.map((field, index) => [field.key, buildTrackedDemoValue(field, index)])
  );
  const defaultTitle = getJournalDocumentDefaultTitle(templateCode);

  const configs = [
    { status: "active" as const, dateFrom: activeFrom, dateTo: activeTo },
    { status: "closed" as const, dateFrom: closedFrom, dateTo: closedTo },
  ];

  const isUv = templateCode === UV_LAMP_RUNTIME_TEMPLATE_CODE;
  const isFryerOil = templateCode === FRYER_OIL_TEMPLATE_CODE;
  const uvConfig = isUv
    ? {
        lampNumber: "1",
        // U1: линия «наименование цеха / участка применения» пустая,
        // пока управляющая не заполнит её в настройках документа.
        areaName: "",
        spec: {
          ...defaultUvSpecification(),
          // U4: дата ввода в эксплуатацию = дата начала документа.
          commissioningDate: activeFrom.toISOString().slice(0, 10),
        },
      }
    : undefined;

  for (const config of configs) {
    if (hasStatus.has(config.status)) continue;

    const docTitle = isUv && uvConfig
      ? buildUvRuntimeDocumentTitle(uvConfig)
      : defaultTitle;

    const created = await db.journalDocument.create({
      data: {
        templateId,
        organizationId,
        title: docTitle,
        status: config.status,
        dateFrom: config.dateFrom,
        dateTo: config.dateTo,
        responsibleUserId: activeUser.id,
        responsibleTitle: getHygieneDefaultResponsibleTitle(users),
        createdById,
        ...(uvConfig ? { config: uvConfig } : isFryerOil ? { config: { lists: { fatTypes: ["Подсолнечное масло", "Пальмовое масло", "Рапсовое масло", "Фритюрный жир"], equipmentTypes: ["Фритюрница настольная", "Фритюрница напольная", "Жарочный шкаф"], productTypes: ["Картофель фри", "Пельмени", "Вареники", "Рыба в кляре", "Куриные наггетсы"] } } } : {}),
      },
      select: {
        id: true,
      },
    });

    if (isUv) {
      // Create UV sample entries - daily entries for the period
      const entryData: { documentId: string; employeeId: string; date: Date; data: object }[] = [];
      const d = new Date(config.dateFrom);
      const end = new Date(config.dateTo);
      while (d <= end) {
        entryData.push({
          documentId: created.id,
          employeeId: activeUser.id,
          date: new Date(d),
          data: {
            startTime: `10:0${Math.floor(Math.random() * 6)}`,
            endTime: `18:0${Math.floor(Math.random() * 6)}`,
          },
        });
        d.setUTCDate(d.getUTCDate() + 1);
      }
      await db.journalDocumentEntry.createMany({
        data: entryData,
        skipDuplicates: true,
      });
    } else if (isFryerOil) {
      const sampleEntries = [
        {
          documentId: created.id,
          employeeId: activeUser.id,
          date: config.dateFrom,
          data: {
            startDate: config.dateFrom.toISOString().slice(0, 10),
            startHour: 9, startMinute: 0,
            fatType: "Подсолнечное масло",
            qualityStart: 5,
            equipmentType: "Фритюрница настольная",
            productType: "Картофель фри",
            endHour: 11, endMinute: 30,
            qualityEnd: 4,
            carryoverKg: 2.5,
            disposedKg: 0,
            controllerName: activeUser.name,
          },
        },
      ];
      await db.journalDocumentEntry.createMany({ data: sampleEntries, skipDuplicates: true });
    } else {
      await db.journalDocumentEntry.createMany({
        data: [
          {
            documentId: created.id,
            employeeId: activeUser.id,
            date: config.dateFrom,
            data: baseData,
          },
        ],
        skipDuplicates: true,
      });
    }
  }
}

async function ensureSanitationDaySampleDocuments(params: {
  templateId: string;
  organizationId: string;
  createdById: string;
  users: { id: string; name: string; role: string; email?: string | null }[];
}) {
  const { templateId, organizationId, createdById, users } = params;
  const currentYearDate = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const previousYearDate = new Date(
    Date.UTC(new Date().getUTCFullYear() - 1, 0, 1)
  );
  const responsibleUser = pickPrimaryManager(users) || users[0] || null;

  const existing = await db.journalDocument.findMany({
    where: {
      templateId,
      organizationId,
    },
    select: {
      status: true,
    },
  });

  const statuses = new Set(existing.map((item) => item.status));
  const docsToCreate: Array<{ status: "active" | "closed"; date: Date }> = [];

  if (!statuses.has("active")) {
    docsToCreate.push({ status: "active", date: currentYearDate });
  }
  if (!statuses.has("closed")) {
    docsToCreate.push({ status: "closed", date: previousYearDate });
  }

  for (const doc of docsToCreate) {
    const config = getSanitationDayDefaultConfig(doc.date);
    if (responsibleUser) {
      config.approveEmployeeId = responsibleUser.id;
      config.approveEmployee = responsibleUser.name;
      config.responsibleEmployeeId = responsibleUser.id;
      config.responsibleEmployee = responsibleUser.name;
    }

    await db.journalDocument.create({
      data: {
        templateId,
        organizationId,
        title: SANITATION_DAY_DOCUMENT_TITLE,
        status: doc.status,
        dateFrom: doc.date,
        dateTo: doc.date,
        createdById,
        responsibleUserId: responsibleUser?.id || null,
        responsibleTitle: config.responsibleRole,
        config,
      },
    });
  }
}

async function ensurePpeIssuanceSampleDocuments(params: {
  templateId: string;
  organizationId: string;
  createdById: string;
  users: { id: string; name: string; role: string; email?: string | null }[];
}) {
  const { templateId, organizationId, createdById, users } = params;
  const existingCount = await db.journalDocument.count({
    where: {
      templateId,
      organizationId,
    },
  });

  if (existingCount > 0) return;

  const now = new Date();
  const activeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const closedFrom1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const configs = [
    {
      status: "active" as const,
      dateFrom: activeFrom,
      config: buildPpeIssuanceDemoConfig(users, activeFrom),
    },
    {
      status: "closed" as const,
      dateFrom: closedFrom1,
      config: buildPpeIssuanceDemoConfig(users, closedFrom1),
    },
  ];

  for (const item of configs) {
    await db.journalDocument.create({
      data: {
        templateId,
        organizationId,
        title: PPE_ISSUANCE_DOCUMENT_TITLE,
        status: item.status,
        dateFrom: item.dateFrom,
        dateTo: item.dateFrom,
        createdById,
        config: item.config,
      },
    });
  }
}

async function ensureTraceabilitySampleDocuments(params: {
  templateId: string;
  organizationId: string;
  createdById: string;
  users: { id: string; name: string; role: string; email?: string | null }[];
}) {
  const { templateId, organizationId, createdById, users } = params;

  const existingStatuses = new Set(
    (
      await db.journalDocument.findMany({
        where: {
          templateId,
          organizationId,
        },
        select: { status: true },
      })
    ).map((document) => document.status)
  );

  if (existingStatuses.has("active") && existingStatuses.has("closed")) return;

  const products = await db.product.findMany({
    where: {
      organizationId,
      isActive: true,
    },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 12,
  });

  const orgItemNames = products
    .map((item) => item.name.trim())
    .filter((name) => name.length > 0);
  const rawMaterialList = orgItemNames.length > 0 ? orgItemNames.slice(0, 8) : ["Мука"];
  const productList = orgItemNames.length > 0 ? orgItemNames.slice(0, 8) : ["Пельмени"];

  const responsibleUser = pickPrimaryManager(users);
  const defaultResponsibleRole =
    responsibleUser?.role === "technologist"
      ? "Технолог"
      : responsibleUser
        ? "Управляющий"
        : "Управляющий";

  const sampleRows = [
    createTraceabilityRow({
      date: "2022-04-04",
      incoming: {
        rawMaterialName: rawMaterialList[0] || "Мука",
        batchNumber: "150",
        packagingDate: "2022-04-01",
        quantityPieces: null,
        quantityKg: 20.5,
      },
      outgoing: {
        productName: productList[0] || "Пельмени",
        quantityPacksPieces: null,
        quantityPacksKg: 0.5,
        shockTemp: 3.5,
      },
      responsibleRole: defaultResponsibleRole,
      responsibleEmployeeId: responsibleUser?.id || null,
      responsibleEmployee: responsibleUser?.name || "",
    }),
    createTraceabilityRow({
      date: "2024-02-12",
      incoming: {
        rawMaterialName: rawMaterialList[0] || "Мука",
        batchNumber: "1112",
        packagingDate: "2024-02-10",
        quantityPieces: null,
        quantityKg: 5,
      },
      outgoing: {
        productName: productList[0] || "Пельмени",
        quantityPacksPieces: 20,
        quantityPacksKg: null,
        shockTemp: null,
      },
      responsibleRole: defaultResponsibleRole,
      responsibleEmployeeId: responsibleUser?.id || null,
      responsibleEmployee: responsibleUser?.name || "",
    }),
    createTraceabilityRow({
      date: "2024-02-13",
      incoming: {
        rawMaterialName: rawMaterialList[0] || "Мука",
        batchNumber: "1114",
        packagingDate: "2024-02-10",
        quantityPieces: null,
        quantityKg: 20,
      },
      outgoing: {
        productName: productList[0] || "Пельмени",
        quantityPacksPieces: 30,
        quantityPacksKg: null,
        shockTemp: 2,
      },
      responsibleRole: defaultResponsibleRole,
      responsibleEmployeeId: responsibleUser?.id || null,
      responsibleEmployee: responsibleUser?.name || "",
    }),
  ];

  const config = normalizeTraceabilityDocumentConfig({
    ...getTraceabilitySampleConfig(),
    documentTitle: "Журнал прослеживаемости",
    dateFrom: "2025-01-01",
    showShockTempField: true,
    showShipmentBlock: false,
    rawMaterialList,
    productList,
    rows: sampleRows,
    defaultResponsibleRole,
    defaultResponsibleEmployeeId: responsibleUser?.id || null,
    defaultResponsibleEmployee: responsibleUser?.name || "",
  });

  if (!existingStatuses.has("active")) {
    await db.journalDocument.create({
      data: {
        templateId,
        organizationId,
        title: config.documentTitle,
        status: "active",
        dateFrom: new Date(`${config.dateFrom}T00:00:00.000Z`),
        dateTo: new Date(`${config.dateFrom}T00:00:00.000Z`),
        createdById,
        responsibleUserId: responsibleUser?.id || null,
        responsibleTitle: defaultResponsibleRole,
        config,
      },
    });
  }

  if (!existingStatuses.has("closed")) {
    await db.journalDocument.create({
      data: {
        templateId,
        organizationId,
        title: config.documentTitle,
        status: "closed",
        dateFrom: new Date("2024-12-01T00:00:00.000Z"),
        dateTo: new Date("2024-12-01T00:00:00.000Z"),
        createdById,
        responsibleUserId: responsibleUser?.id || null,
        responsibleTitle: defaultResponsibleRole,
        config: {
          ...config,
          dateFrom: "2024-12-01",
        } as Prisma.InputJsonValue,
      },
    });
  }
}

async function ensureGlassControlSampleDocuments(params: {
  templateId: string;
  organizationId: string;
  createdById: string;
  users: { id: string; name: string; role: string; email?: string | null }[];
}) {
  const { templateId, organizationId, createdById, users } = params;

  const existingDocuments = await db.journalDocument.count({
    where: { templateId, organizationId },
  });

  if (existingDocuments > 0) return;

  const responsibleUser = pickPrimaryManager(users);

  if (!responsibleUser) return;

  const equipment = await db.equipment.findMany({
    where: {
      area: {
        organizationId,
      },
    },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 4,
  });

  const products = await db.product.findMany({
    where: {
      organizationId,
      isActive: true,
    },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 4,
  });

  const itemNames = [...equipment, ...products]
    .map((item) => item.name.trim())
    .filter((item) => item.length > 0);

  const now = new Date();
  const activeFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const activeTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const closedFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const closedTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));

  const baseConfig = {
    ...glassControlDocument.getDefaultGlassControlConfig(),
    documentName: glassControlDocument.GLASS_CONTROL_DOCUMENT_TITLE,
    controlFrequency: glassControlDocument.GLASS_CONTROL_DEFAULT_FREQUENCY,
  } as Prisma.InputJsonValue;

  const activeDocument = await db.journalDocument.create({
    data: {
      templateId,
      organizationId,
      title: glassControlDocument.GLASS_CONTROL_DOCUMENT_TITLE,
      status: "active",
      dateFrom: activeFrom,
      dateTo: activeFrom,
      responsibleUserId: responsibleUser.id,
      responsibleTitle: "Управляющий",
      autoFill: true,
      createdById,
      config: baseConfig,
    },
  });

  const closedDocument = await db.journalDocument.create({
    data: {
      templateId,
      organizationId,
      title: glassControlDocument.GLASS_CONTROL_DOCUMENT_TITLE,
      status: "closed",
      dateFrom: closedFrom,
      dateTo: closedTo,
      responsibleUserId: responsibleUser.id,
      responsibleTitle: "Управляющий",
      createdById,
      config: baseConfig,
    },
  });

  const activeRows = glassControlDocument.buildDailyRange(
    activeFrom.toISOString().slice(0, 10),
    activeTo.toISOString().slice(0, 10)
  );
  const closedRows = glassControlDocument.buildDailyRange(
    closedFrom.toISOString().slice(0, 10),
    closedTo.toISOString().slice(0, 10)
  );

  await db.journalDocumentEntry.createMany({
    data: activeRows.map((dateKey: string, index: number) => ({
      documentId: activeDocument.id,
      employeeId: responsibleUser.id,
      date: new Date(`${dateKey}T00:00:00.000Z`),
      data: (index === Math.max(0, activeRows.length - 2)
        ? {
            damagesDetected: true,
            itemName: itemNames[0] || "Стеклянная емкость",
            quantity: "1",
            damageInfo: "Скол. Изделие заменено.",
          }
        : {
            damagesDetected: false,
            itemName: "",
            quantity: "",
            damageInfo: "",
          }) as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });

  await db.journalDocumentEntry.createMany({
    data: closedRows.map((dateKey: string) => ({
      documentId: closedDocument.id,
      employeeId: responsibleUser.id,
      date: new Date(`${dateKey}T00:00:00.000Z`),
      data: {
        damagesDetected: false,
        itemName: "",
        quantity: "",
        damageInfo: "",
      } as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
}

async function ensureIntensiveCoolingSampleDocuments(params: {
  templateId: string;
  organizationId: string;
  createdById: string;
  users: { id: string; name: string; role: string; email?: string | null }[];
}) {
  const { templateId, organizationId, createdById, users } = params;
  const existingStatuses = new Set(
    (
      await db.journalDocument.findMany({
        where: { templateId, organizationId },
        select: { status: true },
      })
    ).map((item) => item.status)
  );

  if (existingStatuses.has("active") && existingStatuses.has("closed")) return;

  const products = await db.product.findMany({
    where: {
      organizationId,
      isActive: true,
    },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 12,
  });

  const dishSuggestions = products
    .map((item) => item.name.trim())
    .filter((name) => name.length > 0);
  const fallbackDishes =
    dishSuggestions.length > 0
      ? dishSuggestions
      : ["Пельмени", "Котлеты жареные", "Гуляш", "Плов"];

  const responsibleUser = pickPrimaryManager(users);
  const responsibleTitle = getResponsibleTitleByRole(responsibleUser?.role);
  const activeDate = "2021-10-01";

  if (!existingStatuses.has("active")) {
    const activeConfig = getDefaultIntensiveCoolingConfig(users, fallbackDishes);
    activeConfig.defaultResponsibleTitle = responsibleTitle;
    activeConfig.defaultResponsibleUserId = responsibleUser?.id || null;
    activeConfig.rows = [
      createIntensiveCoolingRow({
        productionDate: "2021-10-29",
        productionHour: "10",
        productionMinute: "00",
        dishName: fallbackDishes[0] || "Пельмени",
        startTemperature: "86",
        endTemperature: "5",
        correctiveAction: "-",
        comment: "-",
        responsibleTitle: "",
        responsibleUserId: "",
      }),
      createIntensiveCoolingRow({
        productionDate: "2021-10-30",
        productionHour: "20",
        productionMinute: "09",
        dishName: fallbackDishes[1] || "Котлеты жареные",
        startTemperature: "95",
        endTemperature: "8",
        correctiveAction:
          "Проведена настройка шокера. Уменьшено количество загрузки шокера",
        comment: "Утилизировано",
        responsibleTitle,
        responsibleUserId: responsibleUser?.id || "",
      }),
    ];

    await db.journalDocument.create({
      data: {
        templateId,
        organizationId,
        title: INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
        status: "active",
        dateFrom: new Date(activeDate),
        dateTo: new Date(activeDate),
        createdById,
        config: activeConfig as Prisma.InputJsonValue,
      },
    });
  }

  if (!existingStatuses.has("closed")) {
    const closedConfig = getDefaultIntensiveCoolingConfig(users, fallbackDishes);
    closedConfig.defaultResponsibleTitle = responsibleTitle;
    closedConfig.defaultResponsibleUserId = responsibleUser?.id || null;
    closedConfig.finishedAt = new Date("2021-10-31").toISOString();

    await db.journalDocument.create({
      data: {
        templateId,
        organizationId,
        title: INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
        status: "closed",
        dateFrom: new Date(activeDate),
        dateTo: new Date(activeDate),
        createdById,
        config: closedConfig as Prisma.InputJsonValue,
      },
    });
  }
}

async function ensurePestControlSampleDocuments({
  organizationId,
  templateId,
  users,
  createdById,
}: {
  organizationId: string;
  templateId: string;
  users: { id: string; name: string; role: string; email?: string | null }[];
  createdById: string;
}) {
  const existingCount = await db.journalDocument.count({
    where: { organizationId, templateId },
  });

  if (existingCount > 0) return;

  const acceptedUser = pickPrimaryManager(users);

  const acceptedRole = acceptedUser
    ? getHygienePositionLabel(acceptedUser.role)
    : "Управляющий";

  const activeDocument = await db.journalDocument.create({
    data: {
      templateId,
      organizationId,
      title: PEST_CONTROL_DOCUMENT_TITLE,
      status: "active",
      dateFrom: new Date("2025-03-05T00:00:00.000Z"),
      dateTo: new Date("2025-03-05T00:00:00.000Z"),
      responsibleTitle: acceptedRole,
      responsibleUserId: acceptedUser?.id || null,
      createdById,
    },
  });

  if (acceptedUser) {
    await db.journalDocumentEntry.createMany({
      data: [
        {
          documentId: activeDocument.id,
          employeeId: acceptedUser.id,
          date: new Date("2025-03-17T18:00:11.000Z"),
          data: {
            performedDate: "2025-03-17",
            performedHour: "18",
            performedMinute: "00",
            timeSpecified: true,
            event: "Дезинсекция",
            areaOrVolume: "200",
            treatmentProduct: "Раствор",
            note: "Не мыть полы 24 -48 часов. Добавочно расставить ловушки.",
            performedBy: "ИП",
            acceptedRole,
            acceptedEmployeeId: acceptedUser.id,
          } satisfies Prisma.InputJsonValue,
        },
        {
          documentId: activeDocument.id,
          employeeId: acceptedUser.id,
          date: new Date("2025-03-25T11:00:22.000Z"),
          data: {
            performedDate: "2025-03-25",
            performedHour: "11",
            performedMinute: "00",
            timeSpecified: true,
            event: "Дезинсекция",
            areaOrVolume: "84,9",
            treatmentProduct: "пропан",
            note: "",
            performedBy: "ИП Хижняк",
            acceptedRole,
            acceptedEmployeeId: acceptedUser.id,
          } satisfies Prisma.InputJsonValue,
        },
      ],
    });
  }

  await db.journalDocument.create({
    data: {
      templateId,
      organizationId,
      title: PEST_CONTROL_DOCUMENT_TITLE,
      status: "closed",
      dateFrom: new Date("2025-02-05T00:00:00.000Z"),
      dateTo: new Date("2025-02-28T00:00:00.000Z"),
      responsibleTitle: acceptedRole,
      responsibleUserId: acceptedUser?.id || null,
      createdById,
    },
  });
}

export default async function JournalDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { code } = await params;
  const resolvedCode = resolveJournalCodeAlias(code);
  const { tab } = await searchParams;
  const session = await requireAuth();

  const template = await db.journalTemplate.findUnique({
    where: { code: resolvedCode },
  });

  if (!template) {
    notFound();
  }

  // Per-user journal ACL. Root, managers, and unmigrated users bypass;
  // employees need an explicit UserJournalAccess row. See src/lib/journal-acl.ts.
  const allowed = await hasJournalAccess(
    aclActorFromSession(session),
    resolvedCode
  );
  if (!allowed) {
    notFound();
  }

  // Organization-level toggle (see /settings/journals). If the manager
  // turned this journal off, we shouldn't silently 404 — point the user
  // at the setting instead so they can re-enable it.
  const orgSettings = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: {
      name: true,
      isDemo: true,
      disabledJournalCodes: true,
      journalAutomationJson: true,
      autoJournalCodes: true,
      journalResponsibleUsersJson: true,
      journalColumnsJson: true,
    },
  });
  // Набор журналов для выпадающего списка в крошке «журнал»:
  // за смену обходят несколько журналов подряд, и переход между
  // ними не должен стоить возврата в список.
  const journalMenu = await getJournalCrumbMenu(session, resolvedCode);
  // Локальная копия названия: внутри `withBanner` TS уже не помнит, что
  // `template` прошёл проверку на null выше.
  const journalTitle = template.name;
  const disabledCodes = Array.isArray(orgSettings?.disabledJournalCodes)
    ? (orgSettings?.disabledJournalCodes as string[])
    : [];
  if (disabledCodes.includes(resolvedCode)) {
    return (
      <div className="mx-auto max-w-[640px] space-y-6 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-16 text-center">
        <div className="text-[20px] font-semibold text-[#0b1024]">
          Этот журнал отключён
        </div>
        <p className="text-[14px] leading-[1.6] text-[#6f7282]">
          «{template.name}» отключён для вашей организации: он не показывается
          на дашборде и сотрудникам. Включите его здесь же — записи и
          документы за прошлые периоды никуда не делись.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <JournalEnabledIndicator
            code={resolvedCode}
            name={template.name}
            disabled
            disabledCodes={disabledCodes}
            canToggle={hasFullWorkspaceAccess(session.user)}
          />
          <a
            href="/settings/journals"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Весь набор журналов
          </a>
        </div>
      </div>
    );
  }

  const activeTab = tab === "closed" ? "closed" : "active";
  // Точки: списки документов — активная точка + общие документы без точки.
  const activeBuildingId = await getActiveBuildingId(session);

  // Ростер журнала: живые сотрудники этой организации без ROOT — из них
  // выбирают ответственного при создании документа.
  const orgUsers = await db.user.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      ...ORG_ROSTER_WHERE,
    },
    select: { id: true, name: true, role: true, email: true, positionTitle: true, jobPosition: { select: { name: true, categoryKey: true } } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  /**
   * Страница СПИСКА документов журнала повторяет эталон
   * (lk.haccp-online.ru): сразу H1 → вкладки → карточки. Ни хлебных крошек,
   * ни красно-зелёных алерт-баннеров «Нужно заполнить за сегодня» здесь нет —
   * крошки живут только ВНУТРИ документа, а сводка «что заполнить сегодня»
   * остаётся на `/dashboard` (там `TodayPendingBanner` не трогали).
   *
   * `withBanner` сохранён как единственная обёртка всех ~40 return-веток
   * файла: менять их по одной было бы источником расхождений. Крошки
   * поэтому живут здесь — иначе на сорока ветках они бы разъехались.
   */
  // Состояние автоматики читаем из уже загруженной строки организации —
  // переключателю больше не нужен собственный запрос (он давал вспышку
  // «выключено» на включённом журнале).
  const journalAutomation = getJournalAutomation(orgSettings, resolvedCode);
  const canManageAutomation = hasFullWorkspaceAccess(session.user);

  // Ответственный по умолчанию в диалоге создания — основной слот из
  // «Ответственные за журналы», если этот человек всё ещё в ростере.
  const savedPrimaryResponsibleId =
    (
      (orgSettings?.journalResponsibleUsersJson ?? {}) as Record<
        string,
        Record<string, string | null> | undefined
      >
    )[resolvedCode]?.[getPrimarySlotId(resolvedCode)] ?? null;
  const journalCreateDefaults = {
    defaultResponsibleUserId:
      savedPrimaryResponsibleId &&
      orgUsers.some((user) => user.id === savedPrimaryResponsibleId)
        ? savedPrimaryResponsibleId
        : null,
    columnDefaults: parseOrgColumnDefaults(orgSettings?.journalColumnsJson),
  };

  function withBanner(children: React.ReactNode) {
    return (
      <div className="space-y-5">
        <JournalPageCrumbs
          organizationName={orgSettings?.name || ORG_NAME_FALLBACK}
          journalName={journalTitle}
          journalCode={resolvedCode}
          journalMenu={journalMenu}
        />
        {/* Автоматика — настройка ЖУРНАЛА, а не отдельного документа:
            решение «пусть ведётся сам» принимают один раз для журнала
            целиком. На странице документа тумблер и повторялся у каждого
            документа, и лез поверх бланка.

            Показываем только там, где это осмысленно: у field-based
            журналов автосоздание плодило документы-сироты, а сотрудник
            без прав на настройки ловил 403 при переключении. */}
        {canManageAutomation && isDocumentTemplate(resolvedCode) ? (
          <JournalAutoCreateToggle
            templateCode={resolvedCode}
            initialAutoCreate={journalAutomation.autoCreate}
            initialAutoFill={journalAutomation.autoFill}
            autofillSupported={isAutomationSupported(resolvedCode)}
          />
        ) : null}
        {/* Индикатор «включён / отключён» рисует общая шапка документных
            журналов; данные о наборе и правах она получает отсюда. */}
        <JournalToggleProvider
          value={{
            code: resolvedCode,
            name: journalTitle,
            disabledCodes,
            canToggle: hasFullWorkspaceAccess(session.user),
          }}
        >
          <JournalCreateDefaultsProvider value={journalCreateDefaults}>
            {/* Создание / настройки / удаление документов API отдаёт только
                руководителю — у рядового сотрудника эти кнопки просто
                исчезают, а не отбиваются 403. */}
            <JournalManageProvider canManage={hasFullWorkspaceAccess(session.user)}>
              {children}
            </JournalManageProvider>
          </JournalCreateDefaultsProvider>
        </JournalToggleProvider>
      </div>
    );
  }
  // Образцы документов сеются ТОЛЬКО в демо-организацию (флаг в самой
  // организации). Раньше признаком было «в организации есть служебный
  // аккаунт витрины», а часть веток (скан-журналы, дезсредства, санитарный
  // день, мойка оборудования) не проверяла вообще ничего — и реальные
  // организации получали чужие приходы, холодильники и закрытые документы
  // за прошлый месяц, просто открыв страницу журнала.
  const shouldNormalizeDemoSamples = orgSettings?.isDemo === true;
  // Название организации для образцов и чтения старых конфигов.
  const organizationDisplayName = orgSettings?.name || ORG_NAME_FALLBACK;

  if (shouldNormalizeDemoSamples) {
    await normalizeDemoJournalSampleCorpus({
      templateId: template.id,
      organizationId: getActiveOrgId(session),
      enabled: shouldNormalizeDemoSamples,
    });
  }

  if (resolvedCode === "hygiene" || resolvedCode === "health_check") {
    // Only seed the sample grid for the demo org. Real customer orgs start
    // completely empty — the owner creates documents manually.
    if (shouldNormalizeDemoSamples) {
      await ensureStaffJournalSampleDocuments({
        templateCode: resolvedCode,
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        users: orgUsers,
        createdById: session.user.id,
      });
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { dateFrom: "asc" },
    });

    const mappedDocuments = documents.map((document) => {
      const config = (document.config && typeof document.config === "object" && !Array.isArray(document.config))
        ? (document.config as Record<string, unknown>)
        : {};
      return {
        id: document.id,
        shared: sharedDocumentFlag(document, documents),
        title: document.title || getJournalDocumentDefaultTitle(resolvedCode),
        status: document.status as "active" | "closed",
        responsibleTitle: document.responsibleTitle,
        responsibleUserId: document.responsibleUserId,
        periodLabel: getJournalDocumentPeriodLabel(resolvedCode, document.dateFrom, document.dateTo),
        printEmptyRows: typeof config.printEmptyRows === "number" ? config.printEmptyRows : 0,
        controlPeriodicity: readControlPeriodicity(document.config, resolvedCode),
        // Период документа — чтобы его можно было поменять в настройках
        // из списка (сервер это умеет давно, UI не давал).
        dateFrom: document.dateFrom.toISOString().slice(0, 10),
        dateTo: document.dateTo.toISOString().slice(0, 10),
      };
    });

    // Тумблер «журнал ведётся сам» показываем только там, где
    // автоматика реально умеет работать (строка на сотрудника × день).
    const automation = isAutomationSupported(resolvedCode)
      ? {
          code: resolvedCode,
          enabled: isJournalAutomationEnabled(orgSettings, resolvedCode),
          canManage: hasFullWorkspaceAccess(session.user),
          // Разовое уведомление про автоматику — отметка в аккаунте:
          // в localStorage оно всплывало заново в каждом браузере.
          noticeSeen: await hasSeenNotice(session.user.id, "hygiene-automation"),
        }
      : undefined;

    if (resolvedCode === "health_check") {
      return withBanner(
        <HealthDocumentsClient
          activeTab={activeTab}
          templateCode={resolvedCode}
          templateName={template.name}
          users={orgUsers}
          documents={mappedDocuments}
          automation={automation}
          canManageDocuments={hasFullWorkspaceAccess(session.user)}
        />
      );
    }

    return withBanner(
      <HygieneDocumentsClient
        activeTab={activeTab}
        templateCode={resolvedCode}
        templateName={template.name}
        users={orgUsers}
        documents={mappedDocuments}
        automation={automation}
        canManageDocuments={hasFullWorkspaceAccess(session.user)}
      />
    );
  }

  if (isScanOnlyDocumentTemplate(resolvedCode)) {
    const pageCount = await getScanJournalPageCount(resolvedCode);
    if (pageCount === 0) {
      notFound();
    }

    const scanConfig = getScanJournalConfig(resolvedCode);
    if (shouldNormalizeDemoSamples) {
      await ensureScanOnlySampleDocuments({
        templateId: template.id,
        organizationId: getActiveOrgId(session),
        createdById: session.user.id,
        title: scanConfig?.title || template.name,
        defaultResponsibleTitle: scanConfig?.defaultResponsibleTitle || null,
        responsibleUserId: pickPrimaryManager(orgUsers)?.id || null,
      });
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { createdAt: "desc" },
    });

    return withBanner(
      <ScanJournalDocumentsClient
        activeTab={activeTab}
        templateCode={resolvedCode}
        templateName={scanConfig?.title || template.name}
        defaultResponsibleTitle={scanConfig?.defaultResponsibleTitle || null}
        defaultResponsibleUserId={pickPrimaryManager(orgUsers)?.id || null}
        documents={documents.map((document) => ({
          id: document.id,
          shared: sharedDocumentFlag(document, documents),
          title: document.title || (scanConfig?.title || template.name),
          status: document.status as "active" | "closed",
          dateLabel: scanConfig?.dateLabel || "Период",
          dateValue:
            document.dateFrom.toISOString().slice(0, 10) ===
            document.dateTo.toISOString().slice(0, 10)
              ? document.dateFrom.toISOString().slice(0, 10)
              : `${document.dateFrom.toISOString().slice(0, 10)} — ${document.dateTo.toISOString().slice(0, 10)}`,
          responsibleLabel:
            document.responsibleTitle ||
            (scanConfig?.showResponsible ? scanConfig.defaultResponsibleTitle || null : null),
          responsibleValue: document.responsibleUserId
            ? orgUsers.find((user) => user.id === document.responsibleUserId)?.name || null
            : null,
        }))}
      />
    );
  }

  if (resolvedCode === MED_BOOK_TEMPLATE_CODE) {
    // Auto-seed one active sample document if none exist (demo org only)
    const existingCount = shouldNormalizeDemoSamples
      ? await db.journalDocument.count({
          where: {
            organizationId: getActiveOrgId(session),
            templateId: template.id,
          },
        })
      : 1;

    if (shouldNormalizeDemoSamples && existingCount === 0) {
      const now = new Date();
      const doc = await db.journalDocument.create({
        data: {
          templateId: template.id,
          organizationId: getActiveOrgId(session),
          title: MED_BOOK_DOCUMENT_TITLE,
          status: "active",
          dateFrom: now,
          dateTo: now,
          createdById: session.user.id,
          config: getDefaultMedBookConfig(),
        },
      });

      // Add sample entries for each org user
      if (orgUsers.length > 0) {
        const sampleExamDate = "2025-04-19";
        const sampleExamExpiry = "2026-04-19";
        const expiredExamDate = "2025-03-25";
        const expiredExamExpiry = "2026-03-25";

        await db.journalDocumentEntry.createMany({
          data: orgUsers.slice(0, 5).map((user) => ({
            documentId: doc.id,
            employeeId: user.id,
            date: now,
            data: {
              // Должность из справочника: карта legacy-ролей давала всем
              // текущим ролям «Сотрудник».
              ...emptyMedBookEntry(getUserDisplayTitle(user)),
              birthDate: "2010-03-19",
              gender: "female" as const,
              hireDate: "2025-03-19",
              examinations: {
                "Гинеколог": { date: sampleExamDate, expiryDate: sampleExamExpiry },
                "Стоматолог": { date: null, expiryDate: null },
                "Психиатр": { date: expiredExamDate, expiryDate: expiredExamExpiry },
                "Оториноларинголог": { date: null, expiryDate: null },
                "Терапевт": { date: "2025-06-14", expiryDate: "2026-06-14" },
                "Невролог": { date: "2025-06-14", expiryDate: "2026-06-14" },
                "Нарколог": { date: "2025-06-14", expiryDate: "2026-06-14" },
                "Флюорография": { date: expiredExamDate, expiryDate: expiredExamExpiry },
              },
              vaccinations: {
                "Дифтерия": { type: "refusal" as const },
                "Дизентерия Зонне": { type: "done" as const, dose: "V1", date: "2024-01-01", expiryDate: "2025-01-01" },
                "Краснуха": { type: "refusal" as const },
                "Гепатит B": { type: "refusal" as const },
                "Гепатит A": { type: "refusal" as const },
                "Грипп": { type: "refusal" as const },
                "Коронавирус": { type: "done" as const, dose: "V1", date: "2025-04-01", expiryDate: null },
              },
              note: null,
            },
          })),
          skipDuplicates: true,
        });
      }
    }

    /**
     * Документная модель (M1 аудита, живой эталон med_books-1-list.png):
     * список документов с вкладками «Активные/Закрытые» и кнопкой
     * «Создать документ». Бездокументная переделка фазы N7 (ленивое
     * создание «вечного» документа прямо на странице журнала) откатана:
     * такой документ никуда не делся, он просто снова показывается
     * обычной карточкой в списке. Разрушающих миграций нет.
     */
    if (shouldNormalizeDemoSamples) {
      const medBookStatuses = new Set(
        (
          await db.journalDocument.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
            },
            select: { status: true },
          })
        ).map((document) => document.status)
      );

      if (!medBookStatuses.has("closed")) {
        const { closedFrom } = getCurrentAndPreviousMonthBounds();
        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: MED_BOOK_DOCUMENT_TITLE,
            status: "closed",
            dateFrom: closedFrom,
            dateTo: closedFrom,
            createdById: session.user.id,
            config: getDefaultMedBookConfig(),
          },
        });
      }
    }

    const medBookDocuments = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { createdAt: "asc" },
    });

    return withBanner(
      <MedBookDocumentsClient
        activeTab={activeTab}
        templateCode={resolvedCode}
        templateName={template.name}
        users={orgUsers}
        documents={medBookDocuments.map((doc) => ({
          id: doc.id,
          shared: sharedDocumentFlag(doc, medBookDocuments),
          title: doc.title || MED_BOOK_DOCUMENT_TITLE,
          status: doc.status as "active" | "closed",
          dateFrom: doc.dateFrom.toISOString().slice(0, 10),
        }))}
      />
    );
  }

  /**
   * Специализированные клиенты журналов рендерятся ВСЕГДА, а не только у
   * демо-организаций. Раньше внешнее условие было
   * `shouldNormalizeDemoSamples && resolvedCode === ...`, из-за чего у реальных
   * организаций страница проваливалась в общий рендер. Под флагом остался
   * только досев демо-образцов (активный/закрытый образец для витрины).
   */
  if (resolvedCode === PERISHABLE_REJECTION_TEMPLATE_CODE) {
    if (shouldNormalizeDemoSamples) {
      const existingCount = await db.journalDocument.count({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
        },
      });

      if (existingCount === 0) {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth();
        const dateFrom = new Date(Date.UTC(year, month, 1));
        const dateTo = new Date(Date.UTC(year, month + 1, 0));

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: PERISHABLE_REJECTION_DOCUMENT_TITLE,
            status: "active",
            dateFrom,
            dateTo,
            createdById: session.user.id,
            config: getPerishableRejectionSampleConfig(),
          },
        });
      }

      const perishableStatuses = new Set(
        (
          await db.journalDocument.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
            },
            select: { status: true },
          })
        ).map((document) => document.status)
      );

      if (!perishableStatuses.has("closed")) {
        const { closedFrom, closedTo } = getCurrentAndPreviousMonthBounds();
        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: PERISHABLE_REJECTION_DOCUMENT_TITLE,
            status: "closed",
            dateFrom: closedFrom,
            dateTo: closedTo,
            createdById: session.user.id,
            config: getPerishableRejectionSampleConfig(),
          },
        });
      }
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { dateFrom: "asc" },
    });

    return withBanner(
      <PerishableRejectionDocumentsClient
        activeTab={activeTab}
        templateCode={resolvedCode}
        templateName={template.name}
        users={orgUsers}
        documents={documents.map((doc) => ({
          id: doc.id,
          shared: sharedDocumentFlag(doc, documents),
          title: doc.title || PERISHABLE_REJECTION_DOCUMENT_TITLE,
          status: doc.status as "active" | "closed",
          startedAtLabel: doc.dateFrom.toLocaleDateString("ru-RU").replaceAll(".", "-"),
          dateFrom: doc.dateFrom.toISOString().slice(0, 10),
          config: doc.config,
        }))}
      />
    );
  }

  if (resolvedCode === GLASS_LIST_TEMPLATE_CODE) {
    if (shouldNormalizeDemoSamples) {
      const existingCount = await db.journalDocument.count({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
        },
      });

      if (existingCount === 0) {
        const [areas, equipment, products] = await Promise.all([
          db.area.findMany({
            where: { organizationId: getActiveOrgId(session) },
            select: { name: true },
            orderBy: { name: "asc" },
          }),
          db.equipment.findMany({
            where: {
              area: {
                organizationId: getActiveOrgId(session),
              },
            },
            select: { name: true },
            orderBy: { name: "asc" },
            take: 10,
          }),
          db.product.findMany({
            where: { organizationId: getActiveOrgId(session), isActive: true },
            select: { name: true },
            orderBy: { name: "asc" },
            take: 10,
          }),
        ]);

        const glassListConfig = buildGlassListConfigFromData({
          users: orgUsers,
          areas,
          equipment,
          products,
          referenceDate: new Date(Date.UTC(2025, 1, 1)),
        });

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: glassListConfig.documentName || GLASS_LIST_DOCUMENT_TITLE,
            status: "active",
            dateFrom: new Date(glassListConfig.documentDate),
            dateTo: new Date(glassListConfig.documentDate),
            responsibleTitle: glassListConfig.responsibleTitle || null,
            responsibleUserId: glassListConfig.responsibleUserId || null,
            createdById: session.user.id,
            config: glassListConfig as Prisma.InputJsonValue,
          },
        });
      }

      const glassListStatuses = new Set(
        (
          await db.journalDocument.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
            },
            select: { status: true },
          })
        ).map((document) => document.status)
      );

      if (!glassListStatuses.has("closed")) {
        const [areas, equipment, products] = await Promise.all([
          db.area.findMany({
            where: { organizationId: getActiveOrgId(session) },
            select: { name: true },
            orderBy: { name: "asc" },
          }),
          db.equipment.findMany({
            where: {
              area: {
                organizationId: getActiveOrgId(session),
              },
            },
            select: { name: true },
            orderBy: { name: "asc" },
            take: 10,
          }),
          db.product.findMany({
            where: { organizationId: getActiveOrgId(session), isActive: true },
            select: { name: true },
            orderBy: { name: "asc" },
            take: 10,
          }),
        ]);

        const closedGlassListConfig = buildGlassListConfigFromData({
          users: orgUsers,
          areas,
          equipment,
          products,
          referenceDate: new Date(Date.UTC(2025, 0, 1)),
        });

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: closedGlassListConfig.documentName || GLASS_LIST_DOCUMENT_TITLE,
            status: "closed",
            dateFrom: new Date(closedGlassListConfig.documentDate),
            dateTo: new Date(closedGlassListConfig.documentDate),
            responsibleTitle: closedGlassListConfig.responsibleTitle || null,
            responsibleUserId: closedGlassListConfig.responsibleUserId || null,
            createdById: session.user.id,
            config: closedGlassListConfig as Prisma.InputJsonValue,
          },
        });
      }
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { dateFrom: "desc" },
    });

    return withBanner(
      <GlassListDocumentsClient
        activeTab={activeTab}
        routeCode={code}
        templateCode={resolvedCode}
        templateName={template.name}
        users={orgUsers}
        documents={documents.map((doc) => {
          const config = normalizeGlassListConfig(doc.config);
          return {
            id: doc.id,
            shared: sharedDocumentFlag(doc, documents),
            title: doc.title || GLASS_LIST_DOCUMENT_TITLE,
            status: doc.status as "active" | "closed",
            dateFrom: doc.dateFrom.toISOString().slice(0, 10),
            responsibleTitle: doc.responsibleTitle || config.responsibleTitle || null,
            responsibleUserId: doc.responsibleUserId || config.responsibleUserId || null,
            config,
          };
        })}
      />
    );
  }

  if (resolvedCode === glassControlDocument.GLASS_CONTROL_TEMPLATE_CODE) {
    if (shouldNormalizeDemoSamples) {
      await ensureGlassControlSampleDocuments({
        templateId: template.id,
        organizationId: getActiveOrgId(session),
        createdById: session.user.id,
        users: orgUsers,
      });
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { dateFrom: "asc" },
    });

    return withBanner(
      <GlassControlDocumentsClient
        activeTab={activeTab}
        routeCode={code === glassControlDocument.GLASS_CONTROL_SOURCE_SLUG ? code : resolvedCode}
        templateCode={resolvedCode}
        templateName={template.name}
        users={orgUsers}
        documents={documents.map((doc) => ({
          id: doc.id,
          shared: sharedDocumentFlag(doc, documents),
          title: doc.title || glassControlDocument.GLASS_CONTROL_DOCUMENT_TITLE,
          status: doc.status as "active" | "closed",
          responsibleTitle: doc.responsibleTitle,
          responsibleUserId: doc.responsibleUserId,
          dateFrom: doc.dateFrom.toISOString().slice(0, 10),
          config: doc.config,
        }))}
      />
    );
  }

  if (resolvedCode === STAFF_TRAINING_TEMPLATE_CODE) {
    if (shouldNormalizeDemoSamples) {
      const existingCount = await db.journalDocument.count({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
        },
      });

      if (existingCount === 0) {
        const now = new Date();
        const year = now.getUTCFullYear();
        const dateFrom = new Date(Date.UTC(year, 0, 1));
        const dateTo = new Date(Date.UTC(year, 11, 31));

        const seedRows = buildStaffTrainingSeedRows(
          orgUsers,
          `${year}-01-01`
        );

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: STAFF_TRAINING_DOCUMENT_TITLE,
            status: "active",
            dateFrom,
            dateTo,
            createdById: session.user.id,
            config: {
              ...getDefaultStaffTrainingConfig(),
              rows: seedRows,
            },
          },
        });
      }

      const staffTrainingStatuses = new Set(
        (
          await db.journalDocument.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
            },
            select: { status: true },
          })
        ).map((document) => document.status)
      );

      if (!staffTrainingStatuses.has("closed")) {
        const previousYear = new Date().getUTCFullYear() - 1;
        const closedRows = buildStaffTrainingSeedRows(orgUsers, `${previousYear}-01-01`);
        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: STAFF_TRAINING_DOCUMENT_TITLE,
            status: "closed",
            dateFrom: new Date(Date.UTC(previousYear, 0, 1)),
            dateTo: new Date(Date.UTC(previousYear, 11, 31)),
            createdById: session.user.id,
            config: {
              ...getDefaultStaffTrainingConfig(),
              rows: closedRows,
            },
          },
        });
      }
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { dateFrom: "asc" },
    });

    return withBanner(
      <StaffTrainingDocumentsClient
        activeTab={activeTab}
        templateCode={resolvedCode}
        templateName={template.name}
        users={orgUsers}
        documents={documents.map((doc) => ({
          id: doc.id,
          shared: sharedDocumentFlag(doc, documents),
          title: doc.title || STAFF_TRAINING_DOCUMENT_TITLE,
          status: doc.status as "active" | "closed",
          startedAtLabel: doc.dateFrom.toLocaleDateString("ru-RU").replaceAll(".", "-"),
          dateFrom: doc.dateFrom.toISOString().slice(0, 10),
          config: doc.config,
        }))}
      />
    );
  }

  if (resolvedCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE) {
    if (shouldNormalizeDemoSamples) {
      const existingCount = await db.journalDocument.count({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
        },
      });

      if (existingCount === 0) {
        const year = new Date().getUTCFullYear();
        const cfg = getDefaultEquipmentMaintenanceConfig(year);
        const manager = pickPrimaryManager(orgUsers);
        const headChef =
          orgUsers.find((u) => toCanonicalUserRole(u.role) === "head_chef") || manager;
        if (manager) {
          cfg.approveEmployeeId = manager.id;
          cfg.approveEmployee = manager.name;
        }
        if (headChef) {
          cfg.responsibleEmployeeId = headChef.id;
          cfg.responsibleEmployee = headChef.name;
        }

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE,
            status: "active",
            dateFrom: new Date(Date.UTC(year, 0, 1)),
            dateTo: new Date(Date.UTC(year, 11, 31)),
            createdById: session.user.id,
            config: cfg,
          },
        });
      }

      const equipmentMaintenanceStatuses = new Set(
        (
          await db.journalDocument.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
            },
            select: { status: true },
          })
        ).map((document) => document.status)
      );

      if (!equipmentMaintenanceStatuses.has("closed")) {
        const previousYear = new Date().getUTCFullYear() - 1;
        const cfg = getDefaultEquipmentMaintenanceConfig(previousYear);
        const manager = pickPrimaryManager(orgUsers);
        const headChef =
          orgUsers.find((u) => toCanonicalUserRole(u.role) === "head_chef") || manager;
        if (manager) {
          cfg.approveEmployeeId = manager.id;
          cfg.approveEmployee = manager.name;
        }
        if (headChef) {
          cfg.responsibleEmployeeId = headChef.id;
          cfg.responsibleEmployee = headChef.name;
        }

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE,
            status: "closed",
            dateFrom: new Date(Date.UTC(previousYear, 0, 1)),
            dateTo: new Date(Date.UTC(previousYear, 11, 31)),
            createdById: session.user.id,
            config: cfg,
          },
        });
      }

      const equipmentCalibrationStatuses = new Set(
        (
          await db.journalDocument.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
            },
            select: { status: true },
          })
        ).map((document) => document.status)
      );

      if (!equipmentCalibrationStatuses.has("closed")) {
        const previousYear = new Date().getUTCFullYear() - 1;
        const equipmentSource = await db.equipment.findMany({
          where: {
            area: {
              organizationId: getActiveOrgId(session),
            },
          },
          select: {
            id: true,
            name: true,
            type: true,
            serialNumber: true,
            tempMin: true,
            tempMax: true,
            area: {
              select: {
                name: true,
              },
            },
          },
          orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
        });
        const cfg = buildEquipmentCalibrationConfigFromEquipment(equipmentSource, { year: previousYear });
        const manager = pickPrimaryManager(orgUsers);
        if (manager) {
          cfg.approveEmployeeId = manager.id;
          cfg.approveEmployee = manager.name;
        }

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: EQUIPMENT_CALIBRATION_DOCUMENT_TITLE,
            status: "closed",
            dateFrom: new Date(Date.UTC(previousYear, 0, 1)),
            dateTo: new Date(Date.UTC(previousYear, 11, 31)),
            createdById: session.user.id,
            config: cfg,
          },
        });
      }
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { dateFrom: "desc" },
    });

    return withBanner(
      <EquipmentMaintenanceDocumentsClient
        activeTab={activeTab}
        templateCode={resolvedCode}
        templateName={template.name}
        users={orgUsers}
        documents={documents.map((doc) => ({
          id: doc.id,
          shared: sharedDocumentFlag(doc, documents),
          title: doc.title || EQUIPMENT_MAINTENANCE_DOCUMENT_TITLE,
          status: doc.status as "active" | "closed",
          dateFrom: doc.dateFrom.toISOString().slice(0, 10),
          config: doc.config,
        }))}
      />
    );
  }

  if (resolvedCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE) {
    if (shouldNormalizeDemoSamples) {
      const existingCount = await db.journalDocument.count({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
        },
      });

      if (existingCount === 0) {
        const year = new Date().getUTCFullYear();
        const equipmentSource = await db.equipment.findMany({
          where: {
            area: {
              organizationId: getActiveOrgId(session),
            },
          },
          select: {
            id: true,
            name: true,
            type: true,
            serialNumber: true,
            tempMin: true,
            tempMax: true,
            area: {
              select: {
                name: true,
              },
            },
          },
          orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
        });
        const cfg = buildEquipmentCalibrationConfigFromEquipment(equipmentSource, { year });
        const manager = pickPrimaryManager(orgUsers);
        if (manager) {
          cfg.approveEmployeeId = manager.id;
          cfg.approveEmployee = manager.name;
        }

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: EQUIPMENT_CALIBRATION_DOCUMENT_TITLE,
            status: "active",
            dateFrom: new Date(Date.UTC(year, 0, 1)),
            dateTo: new Date(Date.UTC(year, 11, 31)),
            createdById: session.user.id,
            config: cfg,
          },
        });
      }
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { dateFrom: "desc" },
    });

    return withBanner(
      <EquipmentCalibrationDocumentsClient
        activeTab={activeTab}
        templateCode={resolvedCode}
        templateName={template.name}
        users={orgUsers}
        documents={documents.map((doc) => ({
          id: doc.id,
          shared: sharedDocumentFlag(doc, documents),
          title: doc.title || EQUIPMENT_CALIBRATION_DOCUMENT_TITLE,
          status: doc.status as "active" | "closed",
          dateFrom: doc.dateFrom.toISOString().slice(0, 10),
          config: doc.config,
        }))}
      />
    );
  }

  if (isDocumentTemplate(resolvedCode)) {
    const parsedTemplateFields = Array.isArray(template.fields)
      ? (template.fields as TrackedTemplateField[])
      : [];

    // All auto-seeded sample documents below are only for the demo org —
    // real customer orgs start empty and build their own corpus.
    if (shouldNormalizeDemoSamples) {
      await ensureSourceStyleTrackedSampleDocuments({
        templateCode: resolvedCode,
        templateId: template.id,
        organizationId: getActiveOrgId(session),
        users: orgUsers,
        createdById: session.user.id,
        templateFields: parsedTemplateFields,
      });
    }

    if (
      shouldNormalizeDemoSamples &&
      (resolvedCode === CLIMATE_DOCUMENT_TEMPLATE_CODE ||
        resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE)
    ) {
      const existingBasicDocumentCount = await db.journalDocument.count({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
        },
      });

      if (existingBasicDocumentCount === 0) {
        const { activeFrom, activeTo, closedFrom, closedTo } = getCurrentAndPreviousMonthBounds();
        const coldEquipmentConfig =
          resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
            ? buildColdEquipmentConfigFromEquipment(
                await db.equipment.findMany({
                  where: {
                    area: {
                      organizationId: getActiveOrgId(session),
                    },
                  },
                  select: {
                    id: true,
                    name: true,
                    type: true,
                    tempMin: true,
                    tempMax: true,
                  },
                  orderBy: { name: "asc" },
                }),
                { sampleFallback: true }
              )
            : undefined;
        const primaryUser = pickPrimaryManager(orgUsers) || orgUsers[0];
        const defaultResponsibleTitle = primaryUser
          ? getUserRoleLabel(primaryUser.role)
          : null;
        await db.journalDocument.createMany({
          data: [
            {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: getJournalDocumentDefaultTitle(resolvedCode),
              status: "active",
              dateFrom: activeFrom,
              dateTo: activeTo,
              createdById: session.user.id,
              responsibleUserId:
                resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
                  ? primaryUser?.id || null
                  : null,
              responsibleTitle:
                resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
                  ? defaultResponsibleTitle
                  : null,
              config:
                resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
                  ? (coldEquipmentConfig as Prisma.InputJsonValue)
                  : undefined,
            },
            {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: getJournalDocumentDefaultTitle(resolvedCode),
              status: "closed",
              dateFrom: closedFrom,
              dateTo: closedTo,
              createdById: session.user.id,
              responsibleUserId:
                resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
                  ? primaryUser?.id || null
                  : null,
              responsibleTitle:
                resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
                  ? defaultResponsibleTitle
                  : null,
              config:
                resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
                  ? (coldEquipmentConfig as Prisma.InputJsonValue)
                  : undefined,
            },
          ],
        });
      }
    }

    if (resolvedCode === CLEANING_DOCUMENT_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        const existingCleaningCount = await db.journalDocument.count({
          where: {
            organizationId: getActiveOrgId(session),
            templateId: template.id,
          },
        });

        if (existingCleaningCount === 0) {
          const period = getCleaningCreatePeriodBounds();
          const cleaningAreas = await db.area.findMany({
            where: {
              organizationId: getActiveOrgId(session),
            },
            select: {
              id: true,
              name: true,
            },
            orderBy: {
              name: "asc",
            },
          });
          const cleaningConfig = applyCleaningAutoFillToConfig({
            config: defaultCleaningDocumentConfig(orgUsers, cleaningAreas),
            dateFrom: period.dateFrom,
            dateTo: period.dateTo,
          });
          const responsibleUser = pickPrimaryManager(orgUsers) || orgUsers[0];

          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: getJournalDocumentDefaultTitle(resolvedCode),
              status: "active",
              dateFrom: new Date(`${period.dateFrom}T00:00:00.000Z`),
              dateTo: new Date(`${period.dateTo}T00:00:00.000Z`),
              createdById: session.user.id,
              responsibleUserId: responsibleUser?.id || null,
              responsibleTitle: responsibleUser ? "Управляющий" : null,
              config: cleaningConfig,
            },
          });

        }

        const cleaningStatuses = new Set(
          (
            await db.journalDocument.findMany({
              where: {
                organizationId: getActiveOrgId(session),
                templateId: template.id,
              },
              select: { status: true },
            })
          ).map((document) => document.status)
        );

        if (!cleaningStatuses.has("closed")) {
          const closedReferenceDate = new Date();
          closedReferenceDate.setUTCMonth(closedReferenceDate.getUTCMonth() - 1);
          const period = getCleaningCreatePeriodBounds(closedReferenceDate);
          const cleaningAreas = await db.area.findMany({
            where: {
              organizationId: getActiveOrgId(session),
            },
            select: {
              id: true,
              name: true,
            },
            orderBy: {
              name: "asc",
            },
          });
          const cleaningConfig = applyCleaningAutoFillToConfig({
            config: defaultCleaningDocumentConfig(orgUsers, cleaningAreas),
            dateFrom: period.dateFrom,
            dateTo: period.dateTo,
          });
          const responsibleUser = pickPrimaryManager(orgUsers) || orgUsers[0];

          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: getJournalDocumentDefaultTitle(resolvedCode),
              status: "closed",
              dateFrom: new Date(`${period.dateFrom}T00:00:00.000Z`),
              dateTo: new Date(`${period.dateTo}T00:00:00.000Z`),
              createdById: session.user.id,
              responsibleUserId: responsibleUser?.id || null,
              responsibleTitle: responsibleUser ? "Управляющий" : null,
              config: cleaningConfig,
            },
          });
        }
      }
    }

    if (resolvedCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        const existingDocument = await db.journalDocument.findFirst({
          where: {
            organizationId: getActiveOrgId(session),
            templateId: template.id,
          },
          orderBy: { dateFrom: "asc" },
        });

        if (!existingDocument) {
          const seed = buildFinishedProductArchiveSeed(new Date());

          await db.journalDocument.createMany({
            data: [
              {
                templateId: template.id,
                organizationId: getActiveOrgId(session),
                title: seed.active.title,
                status: "active",
                dateFrom: seed.active.dateFrom,
                dateTo: seed.active.dateTo,
                createdById: session.user.id,
              },
              ...seed.closed.map((item) => ({
                templateId: template.id,
                organizationId: getActiveOrgId(session),
                title: item.title,
                status: "closed" as const,
                dateFrom: item.dateFrom,
                dateTo: item.dateTo,
                createdById: session.user.id,
              })),
            ],
          });
        }
      }
    }

    if (resolvedCode === TRACEABILITY_DOCUMENT_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        await ensureTraceabilitySampleDocuments({
          templateId: template.id,
          organizationId: getActiveOrgId(session),
          createdById: session.user.id,
          users: orgUsers,
        });
      }
    }

    if (resolvedCode === INTENSIVE_COOLING_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        await ensureIntensiveCoolingSampleDocuments({
          templateId: template.id,
          organizationId: getActiveOrgId(session),
          createdById: session.user.id,
          users: orgUsers,
        });
      }
    }

    if (resolvedCode === PRODUCT_WRITEOFF_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        const [products, batches, existingDocuments] = await Promise.all([
          db.product.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              isActive: true,
            },
            select: { name: true },
            orderBy: { name: "asc" },
          }),
          db.batch.findMany({
            where: {
              organizationId: getActiveOrgId(session),
            },
            select: {
              code: true,
              productName: true,
              supplier: true,
              quantity: true,
              unit: true,
              receivedAt: true,
            },
            orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
            take: 10,
          }),
          db.journalDocument.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
            },
            select: {
              status: true,
            },
          }),
        ]);

        const existingStatuses = new Set(existingDocuments.map((item) => item.status));
        const sampleDate = new Date("2025-08-05T00:00:00.000Z");

        if (!existingStatuses.has("active")) {
          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: PRODUCT_WRITEOFF_DOCUMENT_TITLE,
              status: "active",
              dateFrom: sampleDate,
              dateTo: sampleDate,
              createdById: session.user.id,
              config: buildProductWriteoffConfigFromData({
                users: orgUsers,
                products,
                batches,
                referenceDate: sampleDate,
              }) as Prisma.InputJsonValue,
            },
          });
        }

        if (!existingStatuses.has("closed")) {
          const closedConfig = buildProductWriteoffConfigFromData({
            users: orgUsers,
            products,
            batches,
            referenceDate: sampleDate,
          });
          closedConfig.actNumber = "2";
          closedConfig.comment = "Архивный тестовый документ";

          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: PRODUCT_WRITEOFF_DOCUMENT_TITLE,
              status: "closed",
              dateFrom: sampleDate,
              dateTo: sampleDate,
              createdById: session.user.id,
              config: closedConfig as Prisma.InputJsonValue,
            },
          });
        }
      }
    }

    if (resolvedCode === PEST_CONTROL_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        await ensurePestControlSampleDocuments({
          templateId: template.id,
          organizationId: getActiveOrgId(session),
          createdById: session.user.id,
          users: orgUsers,
        });
      }
    }

    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { dateFrom: "asc" },
    });

    if (resolvedCode === INTENSIVE_COOLING_TEMPLATE_CODE) {
      const products = await db.product.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          isActive: true,
        },
        select: { name: true },
        orderBy: { name: "asc" },
        take: 20,
      });

      return withBanner(
        <IntensiveCoolingDocumentsClient
          activeTab={activeTab}
          routeCode={code === INTENSIVE_COOLING_SOURCE_SLUG ? code : resolvedCode}
          users={orgUsers}
          dishSuggestions={products.map((item) => item.name)}
          documents={documents.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, documents),
            title: document.title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            config: document.config,
          }))}
        />
      );
    }

    if (resolvedCode === PRODUCT_WRITEOFF_TEMPLATE_CODE) {
      return withBanner(
        <ProductWriteoffDocumentsClient
          activeTab={activeTab}
          templateCode={resolvedCode}
          templateName={template.name}
          users={orgUsers}
          documents={documents.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, documents),
            title: document.title || PRODUCT_WRITEOFF_DOCUMENT_TITLE,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            config: normalizeProductWriteoffConfig(document.config),
          }))}
        />
      );
    }

    if (resolvedCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) {
      return withBanner(
        <FinishedProductDocumentsClient
          activeTab={activeTab}
          templateCode={resolvedCode}
          templateName={template.name}
          users={orgUsers}
          documents={documents.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, documents),
            title: document.title || getJournalDocumentDefaultTitle(resolvedCode),
            status: document.status as "active" | "closed",
            responsibleTitle: document.responsibleTitle,
            periodLabel: getJournalDocumentPeriodLabel(resolvedCode, document.dateFrom, document.dateTo),
            // «ДД-ММ-ГГГГ» — единый формат дат карточек списка.
            startedAtLabel: toSourceDateLabel(document.dateFrom),
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            dateTo: document.dateTo.toISOString().slice(0, 10),
            config: document.config,
          }))}
        />
      );
    }

    if (resolvedCode === SANITATION_DAY_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        await ensureSanitationDaySampleDocuments({
          templateId: template.id,
          organizationId: getActiveOrgId(session),
          createdById: session.user.id,
          users: orgUsers,
        });
      }

      const sanitationDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { createdAt: "asc" },
      });

      return withBanner(
        <SanitationDayDocumentsClient
          routeCode={code === SANITATION_DAY_SOURCE_SLUG ? code : resolvedCode}
          templateCode={resolvedCode}
          activeTab={activeTab}
          users={orgUsers}
          documents={sanitationDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, sanitationDocuments),
            title: document.title || SANITATION_DAY_DOCUMENT_TITLE,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            dateTo: document.dateTo.toISOString().slice(0, 10),
            config: document.config,
            periodLabel: getSanitationDocumentDateLabel(
              document.dateFrom.toISOString().slice(0, 10)
            ),
            responsibleTitle: getSanitationApproveLabel("", ""),
            metaLabel: "",
            metaValue: "",
          }))}
        />
      );
    }

    if (resolvedCode === DISINFECTANT_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        const existingDis = await db.journalDocument.findMany({
          where: { templateId: template.id, organizationId: getActiveOrgId(session) },
          select: { status: true },
        });
        const disStatuses = new Set(existingDis.map((d) => d.status));
        const disinfectantResponsibleUser = pickPrimaryManager(orgUsers) || orgUsers[0] || null;
        const disinfectantConfig = (() => {
          const cfg = getDisinfectantSampleConfig();
          if (!disinfectantResponsibleUser) return cfg;
          return {
            ...cfg,
            responsibleEmployeeId: disinfectantResponsibleUser.id,
            responsibleEmployee: disinfectantResponsibleUser.name,
            receipts: cfg.receipts.map((row) => ({
              ...row,
              responsibleEmployeeId: disinfectantResponsibleUser.id,
              responsibleEmployee: disinfectantResponsibleUser.name,
            })),
            consumptions: cfg.consumptions.map((row) => ({
              ...row,
              responsibleEmployeeId: disinfectantResponsibleUser.id,
              responsibleEmployee: disinfectantResponsibleUser.name,
            })),
          };
        })();
        if (!disStatuses.has("active")) {
          const now = new Date();
          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: DISINFECTANT_DOCUMENT_TITLE,
              status: "active",
              dateFrom: now,
              dateTo: now,
              createdById: session.user.id,
              responsibleUserId: disinfectantResponsibleUser?.id || null,
              responsibleTitle: disinfectantConfig.responsibleRole,
              config: disinfectantConfig as Prisma.InputJsonValue,
            },
          });
        }
        if (!disStatuses.has("closed")) {
          const { closedFrom } = getCurrentAndPreviousMonthBounds();
          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: DISINFECTANT_DOCUMENT_TITLE,
              status: "closed",
              dateFrom: closedFrom,
              dateTo: closedFrom,
              createdById: session.user.id,
              responsibleUserId: disinfectantResponsibleUser?.id || null,
              responsibleTitle: disinfectantConfig.responsibleRole,
              config: disinfectantConfig as Prisma.InputJsonValue,
            },
          });
        }
      }

      const disDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { createdAt: "asc" },
      });

      return withBanner(
        <DisinfectantDocumentsClient
          routeCode={code === DISINFECTANT_SOURCE_SLUG ? code : resolvedCode}
          templateCode={resolvedCode}
          activeTab={activeTab}
          users={orgUsers}
          documents={disDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, disDocuments),
            title: document.title || DISINFECTANT_DOCUMENT_TITLE,
            status: document.status as "active" | "closed",
            config: document.config,
          }))}
        />
      );
    }

    if (resolvedCode === TRAINING_PLAN_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        const existingTP = await db.journalDocument.findMany({
          where: { templateId: template.id, organizationId: getActiveOrgId(session) },
          select: { status: true },
        });

        if (existingTP.length === 0) {
          const now = new Date();
          const approveUser = pickPrimaryManager(orgUsers) || orgUsers[0] || null;
          const activeConfig = getTrainingPlanDefaultConfig(now);
          if (approveUser) {
            activeConfig.approveEmployeeId = approveUser.id;
            activeConfig.approveEmployee = approveUser.name;
          }
          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: `${TRAINING_PLAN_DOCUMENT_TITLE} ${now.getUTCFullYear()}`,
              status: "active",
              dateFrom: new Date(Date.UTC(now.getUTCFullYear(), 0, 11)),
              dateTo: new Date(Date.UTC(now.getUTCFullYear(), 0, 11)),
              createdById: session.user.id,
              responsibleUserId: approveUser?.id || null,
              responsibleTitle: activeConfig.approveRole,
              config: activeConfig,
            },
          });

          const previousYear = new Date(Date.UTC(new Date().getUTCFullYear() - 1, 0, 11));
          const closedConfig = getTrainingPlanDefaultConfig(previousYear);
          if (approveUser) {
            closedConfig.approveEmployeeId = approveUser.id;
            closedConfig.approveEmployee = approveUser.name;
          }
          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: `${TRAINING_PLAN_DOCUMENT_TITLE} ${previousYear.getUTCFullYear()}`,
              status: "closed",
              dateFrom: previousYear,
              dateTo: previousYear,
              createdById: session.user.id,
              responsibleUserId: approveUser?.id || null,
              responsibleTitle: closedConfig.approveRole,
              config: closedConfig,
            },
          });
        }
      }

      const tpDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { createdAt: "asc" },
      });

      return withBanner(
        <TrainingPlanDocumentsClient
          routeCode={code === TRAINING_PLAN_SOURCE_SLUG ? code : resolvedCode}
          templateCode={resolvedCode}
          activeTab={activeTab}
          users={orgUsers}
          documents={tpDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, tpDocuments),
            title: document.title || TRAINING_PLAN_DOCUMENT_TITLE,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            dateTo: document.dateTo.toISOString().slice(0, 10),
            config: document.config,
          }))}
        />
      );
    }

    if (resolvedCode === AUDIT_PLAN_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        const existingAuditPlans = await db.journalDocument.findMany({
          where: { templateId: template.id, organizationId: getActiveOrgId(session) },
          select: { status: true },
        });
        const auditPlanStatuses = new Set(existingAuditPlans.map((document) => document.status));

        if (!auditPlanStatuses.has("active")) {
          const defaultConfig = getAuditPlanDefaultConfig({
            organizationName: organizationDisplayName,
            users: orgUsers,
          });

          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: AUDIT_PLAN_DOCUMENT_TITLE,
              status: "active",
              dateFrom: new Date(defaultConfig.documentDate),
              dateTo: new Date(defaultConfig.documentDate),
              createdById: session.user.id,
              config: defaultConfig,
            },
          });
        }
        if (!auditPlanStatuses.has("closed")) {
          const defaultConfig = getAuditPlanDefaultConfig({
            organizationName: organizationDisplayName,
            users: orgUsers,
          });
          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: AUDIT_PLAN_DOCUMENT_TITLE,
              status: "closed",
              dateFrom: new Date("2025-01-15T00:00:00.000Z"),
              dateTo: new Date("2025-01-15T00:00:00.000Z"),
              createdById: session.user.id,
              config: defaultConfig,
            },
          });
        }
      }

      const auditPlanDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { createdAt: "asc" },
      });

      return withBanner(
        <AuditPlanDocumentsClient
          routeCode={code === AUDIT_PLAN_SOURCE_SLUG ? code : resolvedCode}
          templateCode={resolvedCode}
          activeTab={activeTab}
          users={orgUsers}
          documents={auditPlanDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, auditPlanDocuments),
            title: document.title || AUDIT_PLAN_DOCUMENT_TITLE,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            dateTo: document.dateTo.toISOString().slice(0, 10),
            config: normalizeAuditPlanConfig(document.config, {
              organizationName: organizationDisplayName,
              users: orgUsers,
            }),
          }))}
        />
      );
    }

    if (resolvedCode === EQUIPMENT_CLEANING_TEMPLATE_CODE) {
      const existingEquipmentCleaningCount = shouldNormalizeDemoSamples
        ? await db.journalDocument.count({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
            },
          })
        : 0;

      if (shouldNormalizeDemoSamples && existingEquipmentCleaningCount === 0) {
        const { activeFrom, closedFrom } = getCurrentAndPreviousMonthBounds();
        await db.journalDocument.createMany({
          data: [
            {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: getEquipmentCleaningDocumentTitle(),
              status: "active",
              dateFrom: activeFrom,
              dateTo: activeFrom,
              createdById: session.user.id,
              config: getDefaultEquipmentCleaningConfig(),
            },
            {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: getEquipmentCleaningDocumentTitle(),
              status: "closed",
              dateFrom: closedFrom,
              dateTo: closedFrom,
              createdById: session.user.id,
              config: getDefaultEquipmentCleaningConfig(),
            },
          ],
        });
      }

      const equipmentCleaningDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { createdAt: "asc" },
      });

      return withBanner(
        <EquipmentCleaningDocumentsClient
          activeTab={activeTab}
          templateCode={resolvedCode}
          templateName={template.name}
          users={orgUsers}
          documents={equipmentCleaningDocuments.map((document) => {
            const config = normalizeEquipmentCleaningConfig(document.config);
            return {
              id: document.id,
              shared: sharedDocumentFlag(document, equipmentCleaningDocuments),
              title: document.title || getEquipmentCleaningDocumentTitle(),
              status: document.status as "active" | "closed",
              startedAtLabel: getEquipmentCleaningPeriodLabel(document.dateFrom),
              dateFrom: document.dateFrom.toISOString().slice(0, 10),
              fieldVariant: config.fieldVariant,
            };
          })}
        />
      );
    }

    if (resolvedCode === METAL_IMPURITY_TEMPLATE_CODE) {
      const [allMetalDocuments, metalUsers, metalProducts, metalSuppliers] = await Promise.all([
        db.journalDocument.findMany({
          where: {
            organizationId: getActiveOrgId(session),
            templateId: template.id,
          },
          orderBy: { createdAt: "asc" },
        }),
        db.user.findMany({
          where: {
            organizationId: getActiveOrgId(session),
            isActive: true,
          },
          select: { id: true, name: true, role: true, positionTitle: true, jobPosition: { select: { name: true, categoryKey: true } } },
          orderBy: [{ role: "asc" }, { name: "asc" }],
        }),
        db.product.findMany({
          where: {
            organizationId: getActiveOrgId(session),
            isActive: true,
          },
          select: { name: true },
          orderBy: { name: "asc" },
          take: 25,
        }),
        db.batch.findMany({
          where: {
            organizationId: getActiveOrgId(session),
            supplier: { not: null },
          },
          select: { supplier: true },
          orderBy: { supplier: "asc" },
          distinct: ["supplier"],
          take: 25,
        }),
      ]);

      const metalStatuses = new Set(allMetalDocuments.map((document) => document.status));
      const materialNames = metalProducts.map((item) => item.name).filter(Boolean);
      const supplierNames = metalSuppliers
        .map((item) => item.supplier || "")
        .filter(Boolean);
      const responsibleUser = pickPrimaryManager(metalUsers) || metalUsers[0] || null;

      if (shouldNormalizeDemoSamples && !metalStatuses.has("active")) {
        const config = getDefaultMetalImpurityConfig({
          users: metalUsers,
          materials: materialNames,
          suppliers: supplierNames,
          date: "2025-02-01",
          responsibleName: responsibleUser?.name,
          responsiblePosition: responsibleUser
            ? getUserRoleLabel(responsibleUser.role)
            : undefined,
        });

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: METAL_IMPURITY_DOCUMENT_TITLE,
            status: "active",
            dateFrom: new Date(config.startDate),
            dateTo: new Date(config.startDate),
            responsibleUserId: responsibleUser?.id || null,
            responsibleTitle: config.responsiblePosition,
            createdById: session.user.id,
            config,
          },
        });
      }

      if (shouldNormalizeDemoSamples && !metalStatuses.has("closed")) {
        const config = getDefaultMetalImpurityConfig({
          users: metalUsers,
          materials: materialNames,
          suppliers: supplierNames,
          date: "2025-01-01",
          responsibleName: responsibleUser?.name,
          responsiblePosition: responsibleUser
            ? getUserRoleLabel(responsibleUser.role)
            : undefined,
        });
        config.endDate = "2025-01-31";

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: METAL_IMPURITY_DOCUMENT_TITLE,
            status: "closed",
            dateFrom: new Date(config.startDate),
            dateTo: new Date(config.endDate),
            responsibleUserId: responsibleUser?.id || null,
            responsibleTitle: config.responsiblePosition,
            createdById: session.user.id,
            config,
          },
        });
      }

      const metalDocuments = metalStatuses.has("active") && metalStatuses.has("closed")
        ? allMetalDocuments.filter((document) => document.status === activeTab)
        : await db.journalDocument.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
              status: activeTab,
              ...buildingWhere(activeBuildingId),
            },
            orderBy: { createdAt: "asc" },
          });

      return withBanner(
        <MetalImpurityDocumentsClient
          routeCode={code === METAL_IMPURITY_SOURCE_SLUG ? code : resolvedCode}
          activeTab={activeTab}
          users={metalUsers}
          availableMaterials={materialNames}
          availableSuppliers={supplierNames}
          documents={metalDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, metalDocuments),
            title: document.title || METAL_IMPURITY_DOCUMENT_TITLE,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            config: normalizeMetalImpurityConfig(document.config ?? getDefaultMetalImpurityConfig()),
          }))}
        />
      );
    }

    if (isAcceptanceDocumentTemplate(resolvedCode)) {
      const [allAcceptanceDocuments, acceptanceUsers, acceptanceProducts, acceptanceSuppliers] =
        await Promise.all([
          db.journalDocument.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              templateId: template.id,
            },
            orderBy: { createdAt: "asc" },
          }),
          // Ростер как у страницы документа: без архивных и ROOT — иначе
          // диалог настроек предлагал уволенного сотрудника.
          db.user.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              ...ORG_ROSTER_WHERE,
            },
            select: { id: true, name: true, role: true, positionTitle: true, jobPosition: { select: { name: true, categoryKey: true } } },
            orderBy: [{ role: "asc" }, { name: "asc" }],
          }),
          db.product.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              isActive: true,
            },
            select: { name: true },
            orderBy: { name: "asc" },
            take: 50,
          }),
          db.batch.findMany({
            where: {
              organizationId: getActiveOrgId(session),
              supplier: { not: null },
            },
            select: { supplier: true },
            orderBy: { supplier: "asc" },
            distinct: ["supplier"],
            take: 50,
          }),
        ]);

      const acceptanceStatuses = new Set(allAcceptanceDocuments.map((document) => document.status));
      const productNames = acceptanceProducts.map((item) => item.name).filter(Boolean);
      const supplierNames = acceptanceSuppliers
        .map((item) => item.supplier || "")
        .filter(Boolean);
      const manufacturerNames = supplierNames;
      const responsibleUser = pickPrimaryManager(acceptanceUsers) || acceptanceUsers[0] || null;

      // Sample docs only for the demo org — real customer orgs start empty.
      if (shouldNormalizeDemoSamples && !acceptanceStatuses.has("active")) {
        const config = buildAcceptanceDocumentConfigFromData({
          users: acceptanceUsers,
          products: productNames,
          manufacturers: manufacturerNames,
          suppliers: supplierNames,
          date: "2025-03-01",
          responsibleTitle: responsibleUser ? getUserRoleLabel(responsibleUser.role) : null,
          responsibleUserId: responsibleUser?.id || null,
          includeSampleRows: true,
        });

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: getAcceptanceDocumentTitle(resolvedCode),
            status: "active",
            dateFrom: new Date("2025-03-01"),
            dateTo: new Date("2025-03-01"),
            responsibleUserId: responsibleUser?.id || null,
            responsibleTitle: config.defaultResponsibleTitle,
            createdById: session.user.id,
            config,
          },
        });
      }

      if (shouldNormalizeDemoSamples && !acceptanceStatuses.has("closed")) {
        const config = buildAcceptanceDocumentConfigFromData({
          users: acceptanceUsers,
          products: productNames,
          manufacturers: manufacturerNames,
          suppliers: supplierNames,
          date: "2025-02-01",
          responsibleTitle: responsibleUser ? getUserRoleLabel(responsibleUser.role) : null,
          responsibleUserId: responsibleUser?.id || null,
          includeSampleRows: true,
        });

        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: getAcceptanceDocumentTitle(resolvedCode),
            status: "closed",
            dateFrom: new Date("2025-02-01"),
            dateTo: new Date("2025-02-28"),
            responsibleUserId: responsibleUser?.id || null,
            responsibleTitle: config.defaultResponsibleTitle,
            createdById: session.user.id,
            config,
          },
        });
      }

      const acceptanceDocuments =
        acceptanceStatuses.has("active") && acceptanceStatuses.has("closed")
          ? allAcceptanceDocuments.filter((document) => document.status === activeTab)
          : await db.journalDocument.findMany({
              where: {
                organizationId: getActiveOrgId(session),
                templateId: template.id,
                status: activeTab,
                ...buildingWhere(activeBuildingId),
              },
              orderBy: { createdAt: "asc" },
            });

      return withBanner(
        <IncomingControlDocumentsClient
          templateCode={resolvedCode}
          routeCode={code === ACCEPTANCE_DOCUMENT_TEMPLATE_CODE ? code : resolvedCode}
          activeTab={activeTab}
          users={acceptanceUsers}
          availableProducts={productNames}
          availableManufacturers={manufacturerNames}
          availableSuppliers={supplierNames}
          documents={acceptanceDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, acceptanceDocuments),
            title: document.title || getAcceptanceDocumentTitle(resolvedCode),
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            config: normalizeAcceptanceDocumentConfig(document.config ?? {}, acceptanceUsers),
          }))}
        />
      );
    }

    if (resolvedCode === BREAKDOWN_HISTORY_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        const existingBH = await db.journalDocument.findMany({
          where: { templateId: template.id, organizationId: getActiveOrgId(session) },
          select: { status: true },
        });
        const bhStatuses = new Set(existingBH.map((d) => d.status));
        if (!bhStatuses.has("active")) {
          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: BREAKDOWN_HISTORY_DOCUMENT_TITLE,
              status: "active",
              dateFrom: new Date("2021-10-28"),
              dateTo: new Date("2021-10-28"),
              createdById: session.user.id,
              config: getBreakdownHistoryDefaultConfig(),
            },
          });
        }
        if (!bhStatuses.has("closed")) {
          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: BREAKDOWN_HISTORY_DOCUMENT_TITLE,
              status: "closed",
              dateFrom: new Date("2021-09-28"),
              dateTo: new Date("2021-09-28"),
              createdById: session.user.id,
              config: getBreakdownHistoryDefaultConfig(),
            },
          });
        }
      }

      const bhDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { createdAt: "asc" },
      });

      return withBanner(
        <BreakdownHistoryDocumentsClient
          routeCode={code === BREAKDOWN_HISTORY_SOURCE_SLUG ? code : resolvedCode}
          templateCode={resolvedCode}
          activeTab={activeTab}
          documents={bhDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, bhDocuments),
            title: document.title || BREAKDOWN_HISTORY_DOCUMENT_TITLE,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            config: document.config,
          }))}
        />
      );
    }

    if (resolvedCode === ACCIDENT_DOCUMENT_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        const existingAccidentDocuments = await db.journalDocument.findMany({
          where: { templateId: template.id, organizationId: getActiveOrgId(session) },
          select: { status: true },
        });
        const accidentStatuses = new Set(existingAccidentDocuments.map((d) => d.status));

        if (!accidentStatuses.has("active")) {
          const areaNames = (
            await db.area.findMany({
              where: { organizationId: getActiveOrgId(session) },
              select: { name: true },
              orderBy: { name: "asc" },
            })
          ).map((item) => item.name);

          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: ACCIDENT_DOCUMENT_TITLE,
              status: "active",
              dateFrom: new Date("2021-10-01"),
              dateTo: new Date("2021-10-01"),
              createdById: session.user.id,
              config: buildAccidentDocumentDemoConfig({
                areaNames,
                userNames: orgUsers.map((user) => user.name),
              }),
            },
          });
        }
        if (!accidentStatuses.has("closed")) {
          const areaNames = (
            await db.area.findMany({
              where: { organizationId: getActiveOrgId(session) },
              select: { name: true },
              orderBy: { name: "asc" },
            })
          ).map((item) => item.name);

          await db.journalDocument.create({
            data: {
              templateId: template.id,
              organizationId: getActiveOrgId(session),
              title: ACCIDENT_DOCUMENT_TITLE,
              status: "closed",
              dateFrom: new Date("2021-09-01"),
              dateTo: new Date("2021-09-01"),
              createdById: session.user.id,
              config: buildAccidentDocumentDemoConfig({
                areaNames,
                userNames: orgUsers.map((user) => user.name),
              }),
            },
          });
        }
      }

      const accidentDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { createdAt: "asc" },
      });

      return withBanner(
        <AccidentDocumentsClient
          routeCode={code === ACCIDENT_DOCUMENT_SOURCE_SLUG ? code : resolvedCode}
          templateCode={resolvedCode}
          activeTab={activeTab}
          documents={accidentDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, accidentDocuments),
            title: document.title || ACCIDENT_DOCUMENT_TITLE,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
          }))}
        />
      );
    }

    if (resolvedCode === PPE_ISSUANCE_TEMPLATE_CODE) {
      if (shouldNormalizeDemoSamples) {
        await ensurePpeIssuanceSampleDocuments({
          templateId: template.id,
          organizationId: getActiveOrgId(session),
          createdById: session.user.id,
          users: orgUsers,
        });
      }

      const ppeDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { dateFrom: "asc" },
      });

      return withBanner(
        <PpeIssuanceDocumentsClient
          routeCode={code === PPE_ISSUANCE_SOURCE_SLUG ? code : resolvedCode}
          templateCode={resolvedCode}
          activeTab={activeTab}
          users={orgUsers}
          documents={ppeDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, ppeDocuments),
            title: document.title || PPE_ISSUANCE_DOCUMENT_TITLE,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            config: document.config,
          }))}
        />
      );
    }

    /**
     * Чек-лист проветривания рендерится СВОИМ клиентом всегда, а не только
     * у демо-организаций. Раньше условие было
     * `shouldNormalizeDemoSamples && resolvedCode === ...`, из-за чего у
     * реальных организаций страница списка проваливалась в общий рендер и
     * показывала диалог создания с нативным <input type="date"> в US-формате.
     * Демо-досев (активный + закрытый образцы) остался под флагом.
     */
    if (resolvedCode === CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE) {
      const existingChecklistDocuments = shouldNormalizeDemoSamples
        ? await db.journalDocument.findMany({
            where: { templateId: template.id, organizationId: getActiveOrgId(session) },
            orderBy: { dateFrom: "desc" },
          })
        : [];

      const statuses = new Set(existingChecklistDocuments.map((document) => document.status));
      if (shouldNormalizeDemoSamples && !statuses.has("active")) {
        const { dateFrom: activeDateFrom, dateTo: activeDateTo } =
          getCleaningVentilationMonthBounds(new Date().toISOString().slice(0, 10));
        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: CLEANING_VENTILATION_CHECKLIST_TITLE,
            status: "active",
            dateFrom: new Date(activeDateFrom),
            dateTo: new Date(activeDateTo),
            createdById: session.user.id,
            config: getDefaultCleaningVentilationConfig(orgUsers),
          },
        });
      }

      if (shouldNormalizeDemoSamples && !statuses.has("closed")) {
        const previousMonth = new Date();
        previousMonth.setMonth(previousMonth.getMonth() - 1);
        const { dateFrom: closedDateFrom, dateTo: closedDateTo } =
          getCleaningVentilationMonthBounds(previousMonth.toISOString().slice(0, 10));
        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: CLEANING_VENTILATION_CHECKLIST_TITLE,
            status: "closed",
            dateFrom: new Date(closedDateFrom),
            dateTo: new Date(closedDateTo),
            createdById: session.user.id,
            config: getDefaultCleaningVentilationConfig(orgUsers),
          },
        });
      }

      const checklistDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { dateFrom: "desc" },
      });

      return withBanner(
        <CleaningVentilationChecklistDocumentsClient
          routeCode={code}
          templateCode={resolvedCode}
          activeTab={activeTab}
          users={orgUsers}
          documents={checklistDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, checklistDocuments),
            title: document.title || CLEANING_VENTILATION_CHECKLIST_TITLE,
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            config:
              document.config && typeof document.config === "object" && !Array.isArray(document.config)
                ? normalizeCleaningVentilationConfig(document.config, orgUsers)
                : null,
          }))}
        />
      );
    }

    if (isSanitaryDayChecklistTemplate(resolvedCode)) {
      const existingSdc = await db.journalDocument.findMany({
        where: { templateId: template.id, organizationId: getActiveOrgId(session) },
        select: { status: true },
      });

      if (shouldNormalizeDemoSamples && existingSdc.length === 0) {
        const today = new Date();
        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: getSanitaryDayChecklistTitle(resolvedCode),
            status: "active",
            dateFrom: today,
            dateTo: today,
            createdById: session.user.id,
            config: defaultSdcConfig(),
          },
        });
      }

      const sdcStatuses = new Set(existingSdc.map((document) => document.status));
      if (shouldNormalizeDemoSamples && !sdcStatuses.has("closed")) {
        const { closedFrom } = getCurrentAndPreviousMonthBounds();
        await db.journalDocument.create({
          data: {
            templateId: template.id,
            organizationId: getActiveOrgId(session),
            title: getSanitaryDayChecklistTitle(resolvedCode),
            status: "closed",
            dateFrom: closedFrom,
            dateTo: closedFrom,
            createdById: session.user.id,
            config: defaultSdcConfig(),
          },
        });
      }

      const sdcDocuments = await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          templateId: template.id,
          status: activeTab,
          ...buildingWhere(activeBuildingId),
        },
        orderBy: { dateFrom: "desc" },
      });

      return withBanner(
        <SanitaryDayChecklistDocumentsClient
          routeCode={code}
          templateCode={resolvedCode}
          activeTab={activeTab}
          users={orgUsers}
          documents={sdcDocuments.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, sdcDocuments),
            title: document.title || getSanitaryDayChecklistTitle(resolvedCode),
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            config:
              document.config && typeof document.config === "object" && !Array.isArray(document.config)
                ? (document.config as Record<string, unknown>)
                : null,
          }))}
        />
      );
    }

    if (resolvedCode === TRACEABILITY_DOCUMENT_TEMPLATE_CODE) {
      return withBanner(
        <TraceabilityDocumentsClient
          activeTab={activeTab}
          routeCode={code === TRACEABILITY_DOCUMENT_SOURCE_SLUG ? code : resolvedCode}
          templateCode={resolvedCode}
          templateName={template.name}
          documents={documents.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, documents),
            title: document.title || getJournalDocumentDefaultTitle(resolvedCode),
            status: document.status as "active" | "closed",
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            config:
              document.config && typeof document.config === "object" && !Array.isArray(document.config)
                ? (document.config as Record<string, unknown>)
                : null,
          }))}
        />
      );
    }

    if (
      resolvedCode === CLIMATE_DOCUMENT_TEMPLATE_CODE ||
      resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE ||
      resolvedCode === CLEANING_DOCUMENT_TEMPLATE_CODE ||
      isTrackedDocumentTemplate(resolvedCode)
    ) {
      if (resolvedCode === CLEANING_DOCUMENT_TEMPLATE_CODE) {
        return withBanner(
          <CleaningDocumentsClient
            activeTab={activeTab}
            routeCode={code}
            templateCode={resolvedCode}
            users={orgUsers}
            documents={documents.map((document) => ({
              id: document.id,
              shared: sharedDocumentFlag(document, documents),
              title: document.title || getJournalDocumentDefaultTitle(resolvedCode),
              status: document.status as "active" | "closed",
              dateFrom: document.dateFrom.toISOString().slice(0, 10),
              dateTo: document.dateTo.toISOString().slice(0, 10),
              config: document.config,
            }))}
          />
        );
      }

      if (resolvedCode === FRYER_OIL_TEMPLATE_CODE) {
        return withBanner(
          <FryerOilDocumentsClient
            activeTab={activeTab}
            routeCode={code}
            templateCode={resolvedCode}
            templateName={template.name}
            users={orgUsers}
            documents={documents.map((document) => ({
              id: document.id,
              shared: sharedDocumentFlag(document, documents),
              title: document.title || "Журнал учета использования фритюрных жиров",
              status: document.status as "active" | "closed",
              responsibleTitle: document.responsibleTitle,
              dateFrom: document.dateFrom.toISOString().slice(0, 10),
            }))}
          />
        );
      }

      if (resolvedCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
        return withBanner(
          <ColdEquipmentDocumentsClient
            activeTab={activeTab}
            routeCode={code}
            templateCode={resolvedCode}
            templateName={template.name}
            users={orgUsers}
            documents={documents.map((document) => ({
              id: document.id,
              shared: sharedDocumentFlag(document, documents),
              title: document.title || getJournalDocumentDefaultTitle(resolvedCode),
              status: document.status as "active" | "closed",
              responsibleTitle: document.responsibleTitle,
              responsibleUserId: document.responsibleUserId,
              responsibleUserName: document.responsibleUserId
                ? orgUsers.find((user) => user.id === document.responsibleUserId)?.name || null
                : null,
              periodLabel: getJournalDocumentPeriodLabel(
                resolvedCode,
                document.dateFrom,
                document.dateTo
              ),
              dateFrom: document.dateFrom.toISOString().slice(0, 10),
              dateTo: document.dateTo.toISOString().slice(0, 10),
            }))}
          />
        );
      }

      if (resolvedCode === UV_LAMP_RUNTIME_TEMPLATE_CODE) {
        return withBanner(
          <UvLampRuntimeDocumentsClient
            activeTab={activeTab}
            routeCode={code}
            templateCode={resolvedCode}
            templateName={template.name}
            users={orgUsers}
            documents={documents.map((document) => {
              const config = normalizeUvRuntimeDocumentConfig(document.config);
              return {
                id: document.id,
                shared: sharedDocumentFlag(document, documents),
                title: buildUvRuntimeDocumentTitle(config),
                status: document.status as "active" | "closed",
                responsibleTitle: document.responsibleTitle,
                responsibleUserId: document.responsibleUserId,
                dateFrom: document.dateFrom.toISOString().slice(0, 10),
                config:
                  document.config && typeof document.config === "object" && !Array.isArray(document.config)
                    ? (document.config as Record<string, unknown>)
                    : null,
                periodLabel: formatRuDateDash(document.dateFrom),
              };
            })}
          />
        );
      }

      const trackedHeading =
        isAcceptanceDocumentTemplate(resolvedCode)
          ? "Журнал приемки и входного контроля продукции"
          : template.name;

      return withBanner(
        <TrackedDocumentsClient
          activeTab={activeTab}
          templateCode={resolvedCode}
          templateName={template.name}
          heading={trackedHeading}
          users={orgUsers}
          documents={documents.map((document) => ({
            id: document.id,
            shared: sharedDocumentFlag(document, documents),
            title: document.title || getJournalDocumentDefaultTitle(resolvedCode),
            status: document.status as "active" | "closed",
            responsibleTitle: document.responsibleTitle,
            responsibleUserId: document.responsibleUserId,
            responsibleUserName: document.responsibleUserId
              ? orgUsers.find((user) => user.id === document.responsibleUserId)?.name || null
              : null,
            periodLabel: getJournalDocumentPeriodLabel(resolvedCode, document.dateFrom, document.dateTo),
            ...getTrackedMeta(resolvedCode, document.dateFrom, document.dateTo),
            dateFrom: document.dateFrom.toISOString().slice(0, 10),
            dateTo: document.dateTo.toISOString().slice(0, 10),
            config:
              document.config && typeof document.config === "object" && !Array.isArray(document.config)
                ? (document.config as Record<string, unknown>)
                : null,
          }))}
        />
      );
    }

    return withBanner(
      <HygieneDocumentsClient
        activeTab={activeTab}
        templateCode={resolvedCode}
        templateName={template.name}
        users={orgUsers}
        documents={documents.map((document) => ({
          id: document.id,
          shared: sharedDocumentFlag(document, documents),
          title: document.title || getJournalDocumentDefaultTitle(resolvedCode),
          status: document.status as "active" | "closed",
          responsibleTitle: document.responsibleTitle,
          responsibleUserId: document.responsibleUserId,
          periodLabel: getJournalDocumentPeriodLabel(resolvedCode, document.dateFrom, document.dateTo),
          dateFrom: document.dateFrom.toISOString().slice(0, 10),
          dateTo: document.dateTo.toISOString().slice(0, 10),
        }))}
        canManageDocuments={hasFullWorkspaceAccess(session.user)}
      />
    );
  }

  if (resolvedCode === COMPLAINT_REGISTER_TEMPLATE_CODE) {
    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { createdAt: "asc" },
    });

    return withBanner(
      <ComplaintDocumentsClient
        activeTab={activeTab}
        routeCode={code}
        documents={documents.map((document) => ({
          id: document.id,
          shared: sharedDocumentFlag(document, documents),
          title: document.title || COMPLAINT_REGISTER_TITLE,
          status: document.status as "active" | "closed",
          dateFrom: document.dateFrom.toISOString().slice(0, 10),
          config: normalizeComplaintConfig(document.config as never),
        }))}
      />
    );
  }

  if (resolvedCode === AUDIT_PROTOCOL_TEMPLATE_CODE) {
    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { createdAt: "asc" },
    });

    return withBanner(
      <AuditProtocolDocumentsClient
        activeTab={activeTab}
        routeCode={code}
        documents={documents.map((document) => ({
          id: document.id,
          shared: sharedDocumentFlag(document, documents),
          title: document.title || AUDIT_PROTOCOL_DOCUMENT_TITLE,
          status: document.status as "active" | "closed",
          dateFrom: document.dateFrom.toISOString().slice(0, 10),
          config: document.config,
        }))}
      />
    );
  }

  if (resolvedCode === AUDIT_REPORT_TEMPLATE_CODE) {
    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: activeTab,
        ...buildingWhere(activeBuildingId),
      },
      orderBy: { createdAt: "asc" },
    });

    return withBanner(
      <AuditReportDocumentsClient
        activeTab={activeTab}
        routeCode={code}
        documents={documents.map((document) => ({
          id: document.id,
          shared: sharedDocumentFlag(document, documents),
          title: document.title || AUDIT_REPORT_DOCUMENT_TITLE,
          status: document.status as "active" | "closed",
          dateFrom: document.dateFrom.toISOString().slice(0, 10),
          config: document.config,
        }))}
      />
    );
  }

  const entries = await db.journalEntry.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      templateId: template.id,
    },
    orderBy: { createdAt: "desc" },
    include: {
      filledBy: {
        select: {
          name: true,
        },
      },
    },
  });

  return withBanner(
    <div className="space-y-8">
      {/* Записи и документы этого журнала обновляются по живому событию —
          только своего кода, чужие журналы страницу не дёргают. */}
      <LiveRefresh codes={[code]} />
      {/* Тёмный hero снят: на рабочей странице журнала он занимал первый
          экран, а название журнала и так стоит в крошках PageNav. */}
      <PageHeader
        eyebrow="Журнал"
        title={template.name}
        description={template.description ?? undefined}
        actions={
          <>
            <JournalEnabledIndicator
              code={resolvedCode}
              name={template.name}
              disabled={false}
              disabledCodes={disabledCodes}
              canToggle={hasFullWorkspaceAccess(session.user)}
            />
            <PageHeaderStat>
              {entries.length} {entries.length === 1 ? "запись" : "записей"}
            </PageHeaderStat>
            {/* «QR-точка контроля» над рядом «Новая запись | Инструкция» —
                тот же блок, что у документных журналов. */}
            <JournalListActions
              templateCode={resolvedCode}
              journalName={template.name}
              canManage={hasFullWorkspaceAccess(session.user)}
              create={
                <Link href={`/journals/${resolvedCode}/new`} className={JOURNAL_ACTION_CREATE_CLASS}>
                  <Plus className="size-4" />
                  Новая запись
                </Link>
              }
            />
          </>
        }
      />

      {entries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-14 text-center sm:px-6">
          <div className="text-[15px] font-medium text-[#0b1024]">
            Записей пока нет
          </div>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
            Первая запись появится здесь сразу после сохранения на
            странице «Новая запись».
          </p>
          <Link
            href={`/journals/${resolvedCode}/new`}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            <Plus className="size-4" />
            Создать запись
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {entries.map((entry) => {
            const statusLabel =
              entry.status === "submitted"
                ? "Отправлено"
                : entry.status === "draft"
                ? "Черновик"
                : entry.status === "finalized"
                ? "Закрыто"
                : entry.status;
            return (
              <li key={entry.id}>
                <Link
                  href={`/journals/${resolvedCode}/${entry.id}`}
                  className="group flex h-full flex-col gap-3 rounded-2xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/40 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold leading-tight text-[#0b1024]">
                        {entry.createdAt.toLocaleString("ru-RU", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="mt-1.5 text-[13px] text-[#6f7282]">
                        Заполнил: {entry.filledBy?.name || "—"}
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-[#3848c7]">
                      {statusLabel}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
