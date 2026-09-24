import { withNewHygieneFormVersion } from "@/lib/hygiene-v2";
import { findHygieneAdmissionViolation } from "@/lib/hygiene-admission-guard";
import { Prisma, type JournalDocument, type JournalTemplate } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import { resolveJournalPeriod } from "@/lib/journal-period";
import {
  normalizeJournalStaffBoundConfig,
  reconcileEntryStaffFields,
  type StaffBindingUser,
} from "@/lib/journal-staff-binding";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  createEmptyClimateEntryData,
  normalizeClimateDocumentConfig,
  normalizeClimateEntryData,
  applyRoomDirectoryToClimateConfig,
  type ClimateDirectoryRoom,
} from "@/lib/climate-document";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  createEmptyColdEquipmentEntryData,
  normalizeColdEquipmentDocumentConfig,
  normalizeColdEquipmentEntryData,
} from "@/lib/cold-equipment-document";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  normalizeCleaningDocumentConfig,
  normalizeCleaningEntryData,
  setCleaningMatrixValue,
} from "@/lib/cleaning-document";
import {
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  RAW_MATERIAL_ACCEPTANCE_TEMPLATE_CODE,
  normalizeAcceptanceDocumentConfig,
} from "@/lib/acceptance-document";
import {
  normalizeRegisterDocumentConfig,
  parseRegisterFields,
} from "@/lib/register-document";
import { REGISTER_JOURNAL_CODES } from "@/lib/register-journals";
import {
  PPE_ISSUANCE_TEMPLATE_CODE,
  normalizePpeIssuanceConfig,
} from "@/lib/ppe-issuance-document";
import {
  TRACEABILITY_DOCUMENT_TEMPLATE_CODE,
  normalizeTraceabilityDocumentConfig,
} from "@/lib/traceability-document";
import {
  AUDIT_PLAN_TEMPLATE_CODE,
  normalizeAuditPlanConfig,
} from "@/lib/audit-plan-document";
import {
  AUDIT_PROTOCOL_TEMPLATE_CODE,
  normalizeAuditProtocolConfig,
} from "@/lib/audit-protocol-document";
import {
  AUDIT_REPORT_TEMPLATE_CODE,
  normalizeAuditReportConfig,
} from "@/lib/audit-report-document";
import {
  TRAINING_PLAN_TEMPLATE_CODE,
  normalizeTrainingPlanConfig,
} from "@/lib/training-plan-document";
import {
  STAFF_TRAINING_TEMPLATE_CODE,
  normalizeStaffTrainingConfig,
} from "@/lib/staff-training-document";
import {
  EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
  normalizeEquipmentCalibrationConfig,
} from "@/lib/equipment-calibration-document";
import {
  EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
  normalizeEquipmentMaintenanceConfig,
} from "@/lib/equipment-maintenance-document";
import {
  PRODUCT_WRITEOFF_TEMPLATE_CODE,
  normalizeProductWriteoffConfig,
} from "@/lib/product-writeoff-document";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  normalizeFinishedProductDocumentConfig,
} from "@/lib/finished-product-document";
import {
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  normalizePerishableRejectionConfig,
} from "@/lib/perishable-rejection-document";
import {
  GLASS_LIST_TEMPLATE_CODE,
  normalizeGlassListConfig,
} from "@/lib/glass-list-document";
import {
  DISINFECTANT_TEMPLATE_CODE,
  normalizeDisinfectantConfig,
} from "@/lib/disinfectant-document";
import {
  METAL_IMPURITY_TEMPLATE_CODE,
  normalizeMetalImpurityConfig,
} from "@/lib/metal-impurity-document";
import {
  BREAKDOWN_HISTORY_TEMPLATE_CODE,
  normalizeBreakdownHistoryDocumentConfig,
} from "@/lib/breakdown-history-document";
import {
  ACCIDENT_DOCUMENT_TEMPLATE_CODE,
  normalizeAccidentDocumentConfig,
} from "@/lib/accident-document";
import {
  INTENSIVE_COOLING_TEMPLATE_CODE,
  normalizeIntensiveCoolingConfig,
} from "@/lib/intensive-cooling-document";
import {
  SANITATION_DAY_TEMPLATE_CODE,
  normalizeSanitationDayConfig,
} from "@/lib/sanitation-day-document";
import {
  SANITARY_DAY_CHECKLIST_TEMPLATE_CODE,
  normalizeSdcConfig,
} from "@/lib/sanitary-day-checklist-document";
import {
  PEST_CONTROL_TEMPLATE_CODE,
  normalizePestControlEntryData,
} from "@/lib/pest-control-document";
import {
  EQUIPMENT_CLEANING_TEMPLATE_CODE,
  normalizeEquipmentCleaningRowData,
} from "@/lib/equipment-cleaning-document";
import {
  CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE,
  normalizeCleaningVentilationEntryData,
} from "@/lib/cleaning-ventilation-checklist-document";

export type ExternalEntryInput = {
  employeeId?: string | null;
  date?: string | null;
  data?: unknown;
};

export type DispatchResult =
  | {
      ok: true;
      documentId: string;
      entriesWritten: number;
      createdDocument: boolean;
      templateCode: string;
    }
  | {
      ok: false;
      httpStatus: number;
      error: string;
    };

type EmployeeRecord = {
  id: string;
  name: string;
  role: string | null;
  positionTitle: string | null;
  jobPosition?: { name: string } | null;
};

type Normalized = { employeeId: string; date: Date; data: unknown };
type WriterContext = {
  organizationId: string;
  template: JournalTemplate;
  document: JournalDocument;
  allUsers: EmployeeRecord[];
  employeesById: Map<string, EmployeeRecord>;
};

type ConfigNormalizer = (
  value: unknown,
  template: JournalTemplate,
  users: StrictRoleUser[],
  organizationName: string
) => unknown;

type StrictRoleUser = EmployeeRecord & { role: string };

function startOfUtcDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthRange(d: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from, to };
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStrictRoleUsers(users: EmployeeRecord[]): StrictRoleUser[] {
  return users.map((user) => ({ ...user, role: user.role ?? "" }));
}

function uniqueByLowerName<T extends { name: string }>(items: T[]) {
  return new Map(items.map((item) => [item.name.trim().toLowerCase(), item] as const));
}

async function pickDefaultEmployeeId(organizationId: string): Promise<string | null> {
  const user = await db.user.findFirst({
    where: { organizationId, isActive: true },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true },
  });
  return user?.id ?? null;
}

async function findOrCreateDocument(params: {
  organizationId: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  date: Date;
  createdById: string | null;
}): Promise<{ doc: Awaited<ReturnType<typeof db.journalDocument.findFirst>>; created: boolean }> {
  const { organizationId, templateId, templateCode, templateName, date, createdById } = params;
  const day = startOfUtcDay(date);

  const existing = await db.journalDocument.findFirst({
    where: {
      organizationId,
      templateId,
      status: "active",
      dateFrom: { lte: day },
      dateTo: { gte: day },
    },
    orderBy: { dateFrom: "desc" },
  });
  if (existing) return { doc: existing, created: false };

  // Используем resolveJournalPeriod вместо плоского monthRange:
  // hygiene/health/cold-equipment получат half-month, годовые
  // (медкнижки, обучение, аварии) — год.
  const period = resolveJournalPeriod(templateCode, day);
  const created = await db.journalDocument.create({
    data: {
      organizationId,
      templateId,
      title: templateName,
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      status: "active",
      autoFill: false,
      createdById: createdById || undefined,
      config: templateCode === "hygiene" ? (withNewHygieneFormVersion(templateCode, {}) as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
  return { doc: created, created: true };
}

function normalizeClimatePayload(
  value: unknown,
  documentConfig: unknown,
  directoryRooms: ClimateDirectoryRoom[] = [],
) {
  if (!isRecord(value)) {
    return normalizeClimateEntryData(value);
  }

  if ("measurements" in value) {
    return normalizeClimateEntryData(value);
  }

  // 2026-09-04: имена помещений — из справочника Room (Room wins), чтобы
  // датчик, присланный по имени помещения, попадал в нужную строку.
  const config = applyRoomDirectoryToClimateConfig(
    normalizeClimateDocumentConfig(documentConfig),
    directoryRooms,
  );
  const roomByDirectoryId = new Map(
    config.rooms.filter((r) => r.roomId).map((r) => [r.roomId as string, r]),
  );
  const result = createEmptyClimateEntryData(
    config,
    typeof value.responsibleTitle === "string" ? value.responsibleTitle : null
  );
  const roomByName = uniqueByLowerName(config.rooms);
  const firstRoom = config.rooms[0];

  const applyMeasurement = (
    roomId: string | undefined,
    time: string | undefined,
    temperature: unknown,
    humidity: unknown
  ) => {
    if (!roomId || !time) return;
    if (!result.measurements[roomId]) result.measurements[roomId] = {};
    result.measurements[roomId][time] = {
      temperature: normalizeNumber(temperature),
      humidity: normalizeNumber(humidity),
    };
  };

  const readings = Array.isArray(value.readings) ? value.readings : [];
  for (const reading of readings) {
    if (!isRecord(reading)) continue;
    const requestedRoomId = normalizeText(reading.roomId);
    const roomId =
      // roomId — id строки документа ИЛИ id помещения справочника.
      (requestedRoomId &&
        (config.rooms.some((r) => r.id === requestedRoomId)
          ? requestedRoomId
          : roomByDirectoryId.get(requestedRoomId)?.id)) ||
      roomByName.get(normalizeText(reading.roomName).toLowerCase())?.id ||
      firstRoom?.id;
    const time =
      normalizeText(reading.time) ||
      config.controlTimes[0];
    applyMeasurement(roomId, time, reading.temperature ?? reading.temp, reading.humidity);
  }

  const topLevelTimes = config.controlTimes;
  const aliasSources = [
    ["morning", topLevelTimes[0]],
    ["evening", topLevelTimes[1] || topLevelTimes[0]],
    ["day", topLevelTimes[0]],
  ] as const;
  for (const [key, time] of aliasSources) {
    const source = value[key];
    if (!isRecord(source) || !firstRoom) continue;
    applyMeasurement(firstRoom.id, time, source.temperature ?? source.temp, source.humidity);
  }

  if (firstRoom && ("temp" in value || "humidity" in value)) {
    applyMeasurement(firstRoom.id, topLevelTimes[0], value.temp ?? value.temperature, value.humidity);
  }

  return result;
}

function normalizeColdEquipmentPayload(value: unknown, documentConfig: unknown) {
  if (!isRecord(value)) {
    return normalizeColdEquipmentEntryData(value);
  }

  if ("temperatures" in value) {
    return normalizeColdEquipmentEntryData(value);
  }

  const config = normalizeColdEquipmentDocumentConfig(documentConfig);
  const result = createEmptyColdEquipmentEntryData(
    config,
    typeof value.responsibleTitle === "string" ? value.responsibleTitle : null
  );
  const equipmentByName = uniqueByLowerName(config.equipment);
  const equipmentBySourceId = new Map(
    config.equipment
      .filter((item) => item.sourceEquipmentId)
      .map((item) => [item.sourceEquipmentId as string, item] as const)
  );
  const firstEquipment = config.equipment[0];

  const readings = Array.isArray(value.readings) ? value.readings : [];
  for (const [index, reading] of readings.entries()) {
    if (!isRecord(reading)) continue;
    const equipment =
      (normalizeText(reading.equipmentId) && config.equipment.find((item) => item.id === normalizeText(reading.equipmentId))) ||
      equipmentBySourceId.get(normalizeText(reading.sourceEquipmentId)) ||
      equipmentByName.get(normalizeText(reading.equipmentName).toLowerCase()) ||
      config.equipment[index] ||
      firstEquipment;
    if (!equipment) continue;
    result.temperatures[equipment.id] = normalizeNumber(reading.temp ?? reading.temperature);
  }

  if (firstEquipment && ("temp" in value || "temperature" in value)) {
    result.temperatures[firstEquipment.id] = normalizeNumber(value.temp ?? value.temperature);
  }

  return result;
}

function normalizeCleaningPayload(value: unknown) {
  if (!isRecord(value)) {
    return normalizeCleaningEntryData(value);
  }

  if ("activities" in value) {
    return normalizeCleaningEntryData(value);
  }

  const activityType =
    value.activityType === "disinfection" ||
    value.activityType === "ventilation" ||
    value.activityType === "wetCleaning"
      ? value.activityType
      : "wetCleaning";

  const times = Array.isArray(value.times)
    ? value.times.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : normalizeText(value.time)
      ? [normalizeText(value.time)]
      : [];

  return normalizeCleaningEntryData({
    activities: [
      {
        type: activityType,
        times: times.length > 0 ? times : [value.done === true ? "done" : ""].filter(Boolean),
        responsibleName: normalizeText(value.responsibleName || value.note),
      },
    ],
  });
}

function normalizeEquipmentCleaningPayload(value: unknown) {
  if (!isRecord(value)) return normalizeEquipmentCleaningRowData(value);
  return normalizeEquipmentCleaningRowData(value);
}

function normalizeChecklistTime(value: unknown) {
  const raw = normalizeText(value);
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return raw;
  const hour = String(Math.min(23, Math.max(0, Number(match[1])))).padStart(2, "0");
  const minute = Math.floor(Math.min(59, Math.max(0, Number(match[2]))) / 5) * 5;
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function normalizeCleaningVentilationPayload(value: unknown) {
  const normalized = normalizeCleaningVentilationEntryData(value);
  const procedures = Object.fromEntries(
    Object.entries(normalized.procedures).map(([key, times]) => [
      key,
      times.map((time) => normalizeChecklistTime(time)).filter(Boolean),
    ])
  );
  return {
    ...normalized,
    procedures,
  };
}

function normalizeEntryDocumentConfig(templateCode: string, value: unknown, users: EmployeeRecord[]) {
  switch (templateCode) {
    case CLIMATE_DOCUMENT_TEMPLATE_CODE:
      return normalizeClimateDocumentConfig(value);
    case COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE:
      return normalizeColdEquipmentDocumentConfig(value);
    case CLEANING_DOCUMENT_TEMPLATE_CODE:
      return normalizeCleaningDocumentConfig(value, { users: toStrictRoleUsers(users) });
    default:
      return value;
  }
}

function shouldPersistEntryConfig(templateCode: string) {
  return (
    templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE ||
    templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE ||
    templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
  );
}

function mergeCleaningEntryIntoConfig(
  configValue: unknown,
  entryValue: unknown,
  entryDate: Date,
  users: EmployeeRecord[]
) {
  const config = normalizeCleaningDocumentConfig(configValue, { users: toStrictRoleUsers(users) });
  const entry = normalizeCleaningEntryData(entryValue);
  const dateKey = toDateKey(entryDate);
  const roomMark = entry.activities[0]?.type === "wetCleaning" ? "T" : "T";

  let next = config;
  for (const room of next.rooms) {
    next = setCleaningMatrixValue({
      config: next,
      rowId: room.id,
      dateKey,
      value: roomMark,
    });
  }

  next.cleaningResponsibles.forEach((responsible, index) => {
    next = setCleaningMatrixValue({
      config: next,
      rowId: responsible.id,
      dateKey,
      value: responsible.code || `C${index + 1}`,
    });
  });

  next.controlResponsibles.forEach((responsible, index) => {
    next = setCleaningMatrixValue({
      config: next,
      rowId: responsible.id,
      dateKey,
      value: responsible.code || `C${index + 1}`,
    });
  });

  return next;
}

function normalizeEntryPayload(
  templateCode: string,
  value: unknown,
  documentConfig: unknown,
  directoryRooms: ClimateDirectoryRoom[] = [],
) {
  switch (templateCode) {
    case CLIMATE_DOCUMENT_TEMPLATE_CODE:
      return normalizeClimatePayload(value, documentConfig, directoryRooms);
    case COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE:
      return normalizeColdEquipmentPayload(value, documentConfig);
    case CLEANING_DOCUMENT_TEMPLATE_CODE:
      return normalizeCleaningPayload(value);
    case PEST_CONTROL_TEMPLATE_CODE:
      return normalizePestControlEntryData(value);
    case EQUIPMENT_CLEANING_TEMPLATE_CODE:
      return normalizeEquipmentCleaningPayload(value);
    case CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE:
      return normalizeCleaningVentilationPayload(value);
    default:
      return value;
  }
}

function mergeConfigPatch(currentConfig: unknown, patch: unknown) {
  if (!isRecord(currentConfig) || !isRecord(patch)) {
    return patch;
  }

  const next: Record<string, unknown> = { ...currentConfig };
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith("append") && key.length > 6) {
      const targetKey = key.charAt(6).toLowerCase() + key.slice(7);
      if (Array.isArray(value)) {
        next[targetKey] = [...(Array.isArray(next[targetKey]) ? (next[targetKey] as unknown[]) : []), ...value];
        continue;
      }
      next[targetKey] = [...(Array.isArray(next[targetKey]) ? (next[targetKey] as unknown[]) : []), value];
      continue;
    }

    next[key] = value;
  }

  return next;
}

const CONFIG_WRITER_NORMALIZERS = new Map<string, ConfigNormalizer>([
  [
    ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
    (value, _template, users) => normalizeAcceptanceDocumentConfig(value, users),
  ],
  [
    RAW_MATERIAL_ACCEPTANCE_TEMPLATE_CODE,
    (value, _template, users) => normalizeAcceptanceDocumentConfig(value, users),
  ],
  [
    "complaint_register",
    (value, template) =>
      normalizeRegisterDocumentConfig(value, parseRegisterFields(template.fields)),
  ],
  // Табличные реестры (register-journals.ts): тот же нормализатор строк.
  ...REGISTER_JOURNAL_CODES.map(
    (code) =>
      [
        code,
        ((value, template) =>
          normalizeRegisterDocumentConfig(value, parseRegisterFields(template.fields))) as ConfigNormalizer,
      ] as [string, ConfigNormalizer]
  ),
  [
    PPE_ISSUANCE_TEMPLATE_CODE,
    (value, _template, users) => normalizePpeIssuanceConfig(value, users),
  ],
  [
    TRACEABILITY_DOCUMENT_TEMPLATE_CODE,
    (value) => normalizeTraceabilityDocumentConfig(value),
  ],
  [
    AUDIT_PLAN_TEMPLATE_CODE,
    (value, _template, users, organizationName) =>
      normalizeJournalStaffBoundConfig(
        AUDIT_PLAN_TEMPLATE_CODE,
        normalizeAuditPlanConfig(value, { users, organizationName }),
        users
      ),
  ],
  [AUDIT_PROTOCOL_TEMPLATE_CODE, (value) => normalizeAuditProtocolConfig(value)],
  [AUDIT_REPORT_TEMPLATE_CODE, (value) => normalizeAuditReportConfig(value)],
  [
    TRAINING_PLAN_TEMPLATE_CODE,
    (value, _template, users) =>
      normalizeJournalStaffBoundConfig(
        TRAINING_PLAN_TEMPLATE_CODE,
        normalizeTrainingPlanConfig(value),
        users
      ),
  ],
  [
    STAFF_TRAINING_TEMPLATE_CODE,
    (value, _template, users) =>
      normalizeJournalStaffBoundConfig(
        STAFF_TRAINING_TEMPLATE_CODE,
        normalizeStaffTrainingConfig(value),
        users
      ),
  ],
  [
    EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
    (value, _template, users) =>
      normalizeJournalStaffBoundConfig(
        EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
        normalizeEquipmentCalibrationConfig(value),
        users
      ),
  ],
  [
    EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
    (value, _template, users) =>
      normalizeJournalStaffBoundConfig(
        EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
        normalizeEquipmentMaintenanceConfig(value),
        users
      ),
  ],
  [
    PRODUCT_WRITEOFF_TEMPLATE_CODE,
    (value, _template, users) =>
      normalizeJournalStaffBoundConfig(
        PRODUCT_WRITEOFF_TEMPLATE_CODE,
        normalizeProductWriteoffConfig(value),
        users
      ),
  ],
  [FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE, (value) => normalizeFinishedProductDocumentConfig(value)],
  [PERISHABLE_REJECTION_TEMPLATE_CODE, (value) => normalizePerishableRejectionConfig(value)],
  [GLASS_LIST_TEMPLATE_CODE, (value) => normalizeGlassListConfig(value)],
  [
    DISINFECTANT_TEMPLATE_CODE,
    (value, _template, users) =>
      normalizeJournalStaffBoundConfig(
        DISINFECTANT_TEMPLATE_CODE,
        normalizeDisinfectantConfig(value),
        users
      ),
  ],
  [
    METAL_IMPURITY_TEMPLATE_CODE,
    (value, _template, users) =>
      normalizeJournalStaffBoundConfig(
        METAL_IMPURITY_TEMPLATE_CODE,
        normalizeMetalImpurityConfig(value),
        users
      ),
  ],
  [BREAKDOWN_HISTORY_TEMPLATE_CODE, (value) => normalizeBreakdownHistoryDocumentConfig(value)],
  [ACCIDENT_DOCUMENT_TEMPLATE_CODE, (value) => normalizeAccidentDocumentConfig(value)],
  [INTENSIVE_COOLING_TEMPLATE_CODE, (value) => normalizeIntensiveCoolingConfig(value)],
  [
    SANITATION_DAY_TEMPLATE_CODE,
    (value, _template, users) =>
      normalizeJournalStaffBoundConfig(
        SANITATION_DAY_TEMPLATE_CODE,
        normalizeSanitationDayConfig(value),
        users
      ),
  ],
  [SANITARY_DAY_CHECKLIST_TEMPLATE_CODE, (value) => normalizeSdcConfig(value)],
]);

async function writeConfigEntries(params: {
  tx: Prisma.TransactionClient;
  document: JournalDocument;
  template: JournalTemplate;
  entries: Normalized[];
  allUsers: EmployeeRecord[];
  organizationName: string;
}) {
  const { tx, document, template, entries, allUsers, organizationName } = params;
  const normalizer = CONFIG_WRITER_NORMALIZERS.get(template.code);
  if (!normalizer) {
    return { written: 0 };
  }

  let nextConfig: unknown = document.config;
  for (const entry of entries) {
    nextConfig = mergeConfigPatch(nextConfig, entry.data);
  }
  const normalizedConfig = normalizer(
    nextConfig,
    template,
    toStrictRoleUsers(allUsers),
    organizationName
  );
  await tx.journalDocument.update({
    where: { id: document.id },
    data: { config: toPrismaJsonValue(normalizedConfig) },
  });
  return { written: entries.length };
}

function usesConfigWriter(templateCode: string) {
  return CONFIG_WRITER_NORMALIZERS.has(templateCode);
}

export async function dispatchExternalEntries(params: {
  organizationId: string;
  journalCode: string;
  entries: ExternalEntryInput[];
}): Promise<DispatchResult> {
  const { organizationId, journalCode } = params;

  if (!journalCode || typeof journalCode !== "string") {
    return { ok: false, httpStatus: 400, error: "journalCode required" };
  }

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true },
  });
  if (!organization) {
    return { ok: false, httpStatus: 404, error: "organizationId not found" };
  }

  const resolvedCode = resolveJournalCodeAlias(journalCode);
  const template = await db.journalTemplate.findUnique({ where: { code: resolvedCode } });
  if (!template) {
    return { ok: false, httpStatus: 404, error: `template not found: ${resolvedCode}` };
  }

  const entries = Array.isArray(params.entries) ? params.entries : [];
  if (entries.length === 0) {
    return { ok: false, httpStatus: 400, error: "entries array is empty" };
  }

  const fallbackEmployeeId = await pickDefaultEmployeeId(organizationId);
  const anchorDate = (() => {
    for (const e of entries) {
      if (e?.date) {
        const d = new Date(e.date);
        if (Number.isFinite(d.getTime())) return d;
      }
    }
    return new Date();
  })();

  const normalized: Normalized[] = [];
  for (const raw of entries) {
    const employeeId = raw?.employeeId || fallbackEmployeeId;
    if (!employeeId) {
      return {
        ok: false,
        httpStatus: 400,
        error: "employeeId required and no default user found for organization",
      };
    }
    const dateStr = raw?.date ?? anchorDate.toISOString();
    const d = new Date(dateStr);
    if (!Number.isFinite(d.getTime())) {
      return { ok: false, httpStatus: 400, error: `invalid date: ${String(dateStr)}` };
    }
    normalized.push({
      employeeId: String(employeeId),
      date: startOfUtcDay(d),
      data: raw?.data ?? {},
    });
  }

  const allUsers = await db.user.findMany({
    where: { organizationId, isActive: true },
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      jobPosition: { select: { name: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  const employeesById = new Map(allUsers.map((u) => [u.id, u]));
  for (const entry of normalized) {
    if (!employeesById.has(entry.employeeId)) {
      return { ok: false, httpStatus: 404, error: `employee not found in org: ${entry.employeeId}` };
    }
  }

  const { doc: foundDoc, created } = await findOrCreateDocument({
    organizationId,
    templateId: template.id,
    templateCode: template.code,
    templateName: template.name,
    date: anchorDate,
    createdById: fallbackEmployeeId,
  });
  const doc = foundDoc;
  if (!doc) {
    return { ok: false, httpStatus: 500, error: "failed to resolve document" };
  }
  const initialDoc: JournalDocument = doc;

  const docDateFrom = startOfUtcDay(new Date(initialDoc.dateFrom));
  const docDateTo = startOfUtcDay(new Date(initialDoc.dateTo));
  for (const entry of normalized) {
    if (entry.date < docDateFrom || entry.date > docDateTo) {
      return {
        ok: false,
        httpStatus: 400,
        error: `entry date ${entry.date.toISOString().slice(0, 10)} outside document range`,
      };
    }
  }

  // Гигиена: «Допущен» через внешний API — только после ответа
  // сотрудника о здоровье за этот день (пожелание РПН).
  const admissionError = await findHygieneAdmissionViolation(db, {
    templateCode: template.code,
    documentId: initialDoc.id,
    config: initialDoc.config,
    items: normalized,
  });
  if (admissionError) {
    return { ok: false, httpStatus: 409, error: admissionError };
  }

  const context: WriterContext = {
    organizationId,
    template,
    document: initialDoc,
    allUsers,
    employeesById,
  };

  // 2026-09-04: справочник помещений для сопоставления замеров климата.
  const directoryRooms =
    template.code === CLIMATE_DOCUMENT_TEMPLATE_CODE
      ? await db.room.findMany({
          where: { building: { organizationId } },
          select: { id: true, name: true, climateNorms: true },
        })
      : [];

  let written = 0;
  await db.$transaction(async (tx) => {
    let currentDoc = initialDoc;
    let documentConfig: unknown = currentDoc.config;
    if (shouldPersistEntryConfig(template.code)) {
      documentConfig = normalizeEntryDocumentConfig(template.code, currentDoc.config, allUsers);
      currentDoc = await tx.journalDocument.update({
        where: { id: currentDoc.id },
        data: { config: toPrismaJsonValue(documentConfig) },
      });
    }

    if (usesConfigWriter(template.code)) {
      const configEntries = normalized.map((entry) => ({
        ...entry,
        data: normalizeEntryPayload(template.code, entry.data, documentConfig, directoryRooms),
      }));
      const configResult = await writeConfigEntries({
        tx,
        document: currentDoc,
        template,
        entries: configEntries,
        allUsers,
        organizationName: organization.name,
      });
      written += configResult.written;
      return;
    }

    for (const entry of normalized) {
      const employee = context.employeesById.get(entry.employeeId)!;
      const normalizedData = normalizeEntryPayload(template.code, entry.data, documentConfig, directoryRooms);
      const reconciled = reconcileEntryStaffFields(normalizedData, employee as StaffBindingUser);
      await tx.journalDocumentEntry.upsert({
        where: {
          documentId_employeeId_date: {
            documentId: currentDoc.id,
            employeeId: entry.employeeId,
            date: entry.date,
          },
        },
        update: { data: toPrismaJsonValue(reconciled) },
        create: {
          documentId: currentDoc.id,
          employeeId: entry.employeeId,
          date: entry.date,
          data: toPrismaJsonValue(reconciled),
        },
      });

      if (template.code === CLEANING_DOCUMENT_TEMPLATE_CODE) {
        documentConfig = mergeCleaningEntryIntoConfig(documentConfig, normalizedData, entry.date, allUsers);
      }

      written += 1;
    }

    if (template.code === CLEANING_DOCUMENT_TEMPLATE_CODE) {
      currentDoc = await tx.journalDocument.update({
        where: { id: currentDoc.id },
        data: {
          config: toPrismaJsonValue(documentConfig),
          autoFill:
            isRecord(documentConfig) &&
            isRecord(documentConfig.autoFill) &&
            typeof documentConfig.autoFill.enabled === "boolean"
              ? documentConfig.autoFill.enabled
              : currentDoc.autoFill,
        },
      });
    }
  });

  return {
    ok: true,
    documentId: initialDoc.id,
    entriesWritten: written,
    createdDocument: created,
    templateCode: resolvedCode,
  };
}
