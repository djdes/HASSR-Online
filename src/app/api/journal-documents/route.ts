import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { isCommissionJournalCode } from "@/lib/brakerage-commission";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { findOverlappingDocument } from "@/lib/journal-document-overlap";
import { db } from "@/lib/db";
import {
  buildColdEquipmentConfigFromEquipment,
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
} from "@/lib/cold-equipment-document";
import {
  CONTROL_PERIODICITY_CONFIG_KEY,
  sanitizeControlPeriodicity,
} from "@/lib/control-periodicity";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  buildClimateConfigFromRooms,
  getDefaultClimateDocumentConfig,
} from "@/lib/climate-document";
import {
  applyRoomScheduleToMatrix,
  applyRoomsToCleaningConfig,
  toRoomScheduleMap,
  applyWeekendHolidayMark,
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  copyMatrixByWeekday,
  defaultCleaningDocumentConfig,
  getDefaultCleaningResponsibleIds,
  normalizeCleaningDocumentConfig,
  stripPeriodSpecificCleaningFields,
  type CleaningMatrixMap,
} from "@/lib/cleaning-document";
import { buildDateKeys } from "@/lib/hygiene-document";
import { buildDocumentAutoTitle } from "@/lib/journal-document-title";
import { HEADER_TITLE_CONFIG_KEY, sanitizeHeaderTitle } from "@/lib/journal-header-title";
import { ORG_HEADER_NAME_CONFIG_KEY, sanitizeOrgJournalName } from "@/lib/org-journal-name";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  buildFinishedProductConfigFromUsers,
} from "@/lib/finished-product-document";
import {
  PRODUCT_WRITEOFF_TEMPLATE_CODE,
  buildProductWriteoffConfigFromData,
} from "@/lib/product-writeoff-document";
import {
  GLASS_LIST_TEMPLATE_CODE,
  buildGlassListConfigFromData,
} from "@/lib/glass-list-document";
import { getHygienePositionLabel } from "@/lib/hygiene-document";
import {
  getAcceptanceDocumentDefaultConfig,
  isAcceptanceDocumentTemplate,
} from "@/lib/acceptance-document";
import {
  PPE_ISSUANCE_TEMPLATE_CODE,
  getPpeIssuanceDefaultConfig,
} from "@/lib/ppe-issuance-document";
import {
  SANITATION_DAY_TEMPLATE_CODE,
  buildSanitationDayConfigFromRooms,
  normalizeSanitationDayConfig,
} from "@/lib/sanitation-day-document";
import {
  buildRegisterDocumentConfigFromUsers,
  isRegisterDocumentTemplate,
} from "@/lib/register-document";
import { TRAINING_PLAN_TEMPLATE_CODE, getTrainingPlanDefaultConfig } from "@/lib/training-plan-document";
import { BREAKDOWN_HISTORY_TEMPLATE_CODE, getBreakdownHistoryDefaultConfig } from "@/lib/breakdown-history-document";
import {
  ACCIDENT_DOCUMENT_TEMPLATE_CODE,
  getAccidentDocumentDefaultConfig,
} from "@/lib/accident-document";
import {
  AUDIT_PROTOCOL_TEMPLATE_CODE,
  getDefaultAuditProtocolConfig,
} from "@/lib/audit-protocol-document";
import {
  AUDIT_REPORT_TEMPLATE_CODE,
  getDefaultAuditReportConfig,
} from "@/lib/audit-report-document";
import {
  METAL_IMPURITY_TEMPLATE_CODE,
  getDefaultMetalImpurityConfig,
} from "@/lib/metal-impurity-document";
import { UV_LAMP_RUNTIME_TEMPLATE_CODE } from "@/lib/uv-lamp-runtime-document";
import {
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  buildPerishableRejectionConfigFromOrgData,
} from "@/lib/perishable-rejection-document";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import {
  buildEquipmentCalibrationConfigFromEquipment,
  EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
  normalizeEquipmentCalibrationConfig,
} from "@/lib/equipment-calibration-document";
import {
  buildEquipmentMaintenanceConfigFromEquipment,
  EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
  normalizeEquipmentMaintenanceConfig,
} from "@/lib/equipment-maintenance-document";
import {
  CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE,
  getDefaultCleaningVentilationConfig,
  normalizeCleaningVentilationConfig,
} from "@/lib/cleaning-ventilation-checklist-document";
import {
  defaultSdcConfig,
  isSanitaryDayChecklistTemplate,
} from "@/lib/sanitary-day-checklist-document";
import {
  getUserPositionLabel,
  isManagementRole,
  pickPrimaryManager,
} from "@/lib/user-roles";
import { aclActorFromSession, canWriteJournal, hasJournalAccess } from "@/lib/journal-acl";
import {
  normalizeJournalStaffBoundConfig,
  normalizeJournalDocumentStaffState,
} from "@/lib/journal-staff-binding";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { prefillResponsiblesForNewDocument } from "@/lib/journal-responsibles-cascade";
import { getPrimarySlotId, getVerifierSlotId } from "@/lib/journal-responsible-schemas";
import {
  ORG_ROSTER_WHERE,
  ORG_SIGNER_WHERE,
  RESPONSIBLE_NOT_IN_ORG_ERROR,
  rankRosterForSlot,
  resolveResponsibleChoice,
} from "@/lib/journal-roster";
import { findOrgUser } from "@/lib/journal-roster-db";
import { seedEntriesForDocument } from "@/lib/journal-document-entries-seed";
import { orgTodayKey } from "@/lib/timezone";

/**
 * Журналы, где утверждающий шапки («УТВЕРЖДАЮ») — отдельный слот
 * ответственных, а не основной. У остальных журналов утверждающий
 * совпадает с основным слотом и уже берётся из диалога.
 */
const APPROVER_SLOT_BY_JOURNAL: Record<string, string> = {
  [SANITATION_DAY_TEMPLATE_CODE]: "manager",
};

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const templateCode = searchParams.get("templateCode");
  const status = searchParams.get("status") || "active";

  if (!templateCode) {
    return NextResponse.json({ error: "templateCode обязателен" }, { status: 400 });
  }

  const resolvedTemplateCode = resolveJournalCodeAlias(templateCode);
  const template = await db.journalTemplate.findUnique({ where: { code: resolvedTemplateCode } });
  if (!template) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });

  // ACL: employees without an explicit grant for this template get 403.
  // Root/managers/unmigrated users bypass inside hasJournalAccess.
  const allowed = await hasJournalAccess(
    aclActorFromSession(session),
    resolvedTemplateCode
  );
  if (!allowed) {
    return NextResponse.json({ error: "Нет доступа к журналу" }, { status: 403 });
  }

  const documents = await db.journalDocument.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      templateId: template.id,
      status,
      // Точки: документы активной точки и общие (без точки).
      ...buildingWhere(await getActiveBuildingId(session)),
    },
    orderBy: { dateFrom: "desc" },
    include: {
      // Считаем только реальные entries без _autoSeeded плейсхолдеров,
      // чтобы менеджер на /journals/[code] видел честный «N записей»
      // (5 реально заполненных, а не 35 включая seeded-болванки).
      _count: { select: { entries: { where: NOT_AUTO_SEEDED } } },
    },
  });

  return NextResponse.json({ documents, template });
}

/**
 * Подставляет «Дату ввода установки в эксплуатацию» (= дата начала
 * документа) в спецификацию УФ-установки, если она пустая. Ничего не
 * перетирает: заполненное значение и любые прочие ключи конфига
 * возвращаются как есть.
 */
function withUvCommissioningDate(
  config: Record<string, unknown> | undefined,
  dateFrom: string
): Record<string, unknown> | undefined {
  const dateKey = String(dateFrom).slice(0, 10);
  if (!dateKey) return config;
  const base = (config ?? {}) as Record<string, unknown>;
  const rawSpec = base.spec;
  const spec =
    rawSpec && typeof rawSpec === "object" && !Array.isArray(rawSpec)
      ? (rawSpec as Record<string, unknown>)
      : {};
  const current = typeof spec.commissioningDate === "string" ? spec.commissioningDate.trim() : "";
  if (current) return config;
  return { ...base, spec: { ...spec, commissioningDate: dateKey } };
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  if (!isManagementRole(session.user.role)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = await request.json();
  const { templateCode, title, dateFrom, dateTo, responsibleUserId, responsibleTitle, config } = body;
  // `force: true` присылает клиент после того, как человек в диалоге
  // подтвердил, что второй документ на тот же период нужен осознанно.
  const force = body?.force === true;

  if (!templateCode || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "templateCode, dateFrom, dateTo обязательны" },
      { status: 400 }
    );
  }

  const resolvedTemplateCode = resolveJournalCodeAlias(templateCode);
  const template = await db.journalTemplate.findUnique({ where: { code: resolvedTemplateCode } });
  if (!template) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });

  const coldEquipmentConfig =
    resolvedTemplateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
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
          })
        )
      : undefined;

  const cleaningUsers =
    resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? await db.user.findMany({
          where: {
            organizationId: getActiveOrgId(session),
            ...ORG_ROSTER_WHERE,
          },
          select: {
            id: true,
            name: true,
            role: true,
            positionTitle: true,
          },
          orderBy: [{ role: "asc" }, { id: "asc" }],
        })
      : [];

  // Ростер журнала: только живые сотрудники этой организации. ROOT,
  // архивные и пользователи других организаций (партнёр, мульти-орг)
  // ответственными документа быть не могут.
  const allUsers = await db.user.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      // Бракераж готовой продукции: сторонняя комиссия нужна в сверке
      // состава комиссии (у скоропорта комиссии нет).
      ...(isCommissionJournalCode(resolvedTemplateCode) ? ORG_SIGNER_WHERE : ORG_ROSTER_WHERE),
    },
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      jobPosition: { select: { name: true, categoryKey: true } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const orgUserIds = new Set(allUsers.map((user) => user.id));

  // Явный выбор в диалоге создания проверяем сразу: чужой, архивный или
  // ROOT id — это ошибка клиента, а не повод молча поставить другого.
  const responsibleChoice = resolveResponsibleChoice({
    bodyUserId: responsibleUserId,
    orgUserIds,
  });
  const verifierChoice = resolveResponsibleChoice({
    bodyUserId: body?.verifierUserId,
    orgUserIds,
  });
  if ("error" in responsibleChoice || "error" in verifierChoice) {
    return NextResponse.json(RESPONSIBLE_NOT_IN_ORG_ERROR, { status: 400 });
  }
  const bodyResponsibleUserId = responsibleChoice.userId;
  const bodyVerifierUserId = verifierChoice.userId;

  const allProducts =
    resolvedTemplateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE ||
    resolvedTemplateCode === PRODUCT_WRITEOFF_TEMPLATE_CODE ||
    resolvedTemplateCode === GLASS_LIST_TEMPLATE_CODE ||
    resolvedTemplateCode === METAL_IMPURITY_TEMPLATE_CODE ||
    resolvedTemplateCode === PERISHABLE_REJECTION_TEMPLATE_CODE
      ? await db.product.findMany({
          where: {
            organizationId: getActiveOrgId(session),
            isActive: true,
          },
          select: {
            name: true,
          },
          orderBy: { name: "asc" },
        })
      : [];

  // Поставщики из принятых партий: справочник металлопримесей и бракеража
  // скоропортящейся продукции.
  const metalSuppliers =
    resolvedTemplateCode === METAL_IMPURITY_TEMPLATE_CODE ||
    resolvedTemplateCode === PERISHABLE_REJECTION_TEMPLATE_CODE
      ? await db.batch.findMany({
          where: {
            organizationId: getActiveOrgId(session),
            supplier: { not: null },
          },
          select: {
            supplier: true,
          },
          orderBy: { supplier: "asc" },
          distinct: ["supplier"],
        })
      : [];

  const recentBatches =
    resolvedTemplateCode === PRODUCT_WRITEOFF_TEMPLATE_CODE
      ? await db.batch.findMany({
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
          orderBy: { receivedAt: "desc" },
          take: 10,
        })
      : [];

  const allAreas =
    resolvedTemplateCode === GLASS_LIST_TEMPLATE_CODE
      ? await db.area.findMany({
          where: {
            organizationId: getActiveOrgId(session),
          },
          select: {
            id: true,
            name: true,
          },
          orderBy: { name: "asc" },
        })
      : [];

  const allEquipment =
    resolvedTemplateCode === GLASS_LIST_TEMPLATE_CODE
      ? await db.equipment.findMany({
          where: {
            area: {
              organizationId: getActiveOrgId(session),
            },
          },
          select: {
            name: true,
          },
          orderBy: { name: "asc" },
        })
      : [];

  const cleaningAreas =
    resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? await db.area.findMany({
          where: {
            organizationId: getActiveOrgId(session),
          },
          select: {
            id: true,
            name: true,
          },
          orderBy: { name: "asc" },
        })
      : [];

  // Точки: новый документ принадлежит активной точке, помещения — её же.
  const activeBuildingId = await getActiveBuildingId(session);

  // 2026-09-04: единый справочник помещений. Климат и график ген. уборок
  // сидируются из Room (/settings/buildings), а не из legacy Area.
  const directoryRooms =
    resolvedTemplateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE ||
    resolvedTemplateCode === SANITATION_DAY_TEMPLATE_CODE
      ? await db.room.findMany({
          where: {
            building: {
              organizationId: getActiveOrgId(session),
              ...(activeBuildingId ? { id: activeBuildingId } : {}),
            },
          },
          // 2026-09-22: вместе с графиком генуборки помещения — план
          // нового документа сразу заполняется датами по графику.
          select: {
            id: true,
            name: true,
            climateNorms: true,
            generalScheduleType: true,
            generalDays: true,
            generalMonthDays: true,
          },
          orderBy: [{ buildingId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        })
      : [];
  // «Сегодня» по поясу организации: план по графику сеется с этого дня,
  // прошедшие дни года остаются пустыми.
  const sanitationFromKey =
    resolvedTemplateCode === SANITATION_DAY_TEMPLATE_CODE
      ? orgTodayKey(
          (
            await db.organization.findUnique({
              where: { id: getActiveOrgId(session) },
              select: { timezone: true },
            })
          )?.timezone ?? undefined
        )
      : null;

  // C1/C2 аудита: помещения уборки — это таблица Room
  // (/settings/buildings), а не blueprint'ы в config.rooms. Матрицу и
  // план строим по ним; расписание Т/Г тоже приходит отсюда.
  const cleaningRooms =
    resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? await db.room.findMany({
          where: {
            building: {
              organizationId: getActiveOrgId(session),
              ...(activeBuildingId ? { id: activeBuildingId } : {}),
            },
          },
          select: {
            id: true,
            currentDays: true,
            generalDays: true,
            currentScheduleType: true,
            generalScheduleType: true,
            currentMonthDays: true,
            generalMonthDays: true,
          },
          orderBy: [{ buildingId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        })
      : [];
  const cleaningRoomIds = cleaningRooms.map((room) => room.id);
  const cleaningRoomSchedule =
    cleaningRooms.length > 0 ? toRoomScheduleMap(cleaningRooms) : undefined;

  const cleaningDefaults =
    resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? getDefaultCleaningResponsibleIds(cleaningUsers)
      : null;

  // Org-level шаблон по умолчанию для cleaning. Когда менеджер
  // нажимает «Сохранить как шаблон» — config записывается в
  // Organization.defaultCleaningDocumentConfig. Здесь вытаскиваем,
  // чтобы новые JournalDocument создавались с теми же rooms/scopes/days.
  const cleaningOrgDefault =
    resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? await db.organization
          .findUnique({
            where: { id: getActiveOrgId(session) },
            select: { defaultCleaningDocumentConfig: true },
          })
          .then((row) => {
            const raw = row?.defaultCleaningDocumentConfig;
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
            return raw as Record<string, unknown>;
          })
      : null;

  // Самый последний предыдущий JournalDocument для cleaning в этой орге.
  // Используется чтобы новый журнал создавался «как прошлый» — теми же
  // rooms, ответственными, weekday-масками. matrix/marks (период-специфика)
  // отрезаем — в новом периоде свои даты, отметки уборщицы не переносятся.
  const cleaningPrevDocRaw =
    resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? await db.journalDocument.findFirst({
          where: {
            organizationId: getActiveOrgId(session),
            template: { code: CLEANING_DOCUMENT_TEMPLATE_CODE },
          },
          orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
          select: { id: true, dateFrom: true, config: true },
        })
      : null;
  const cleaningPrevDocConfig = stripPeriodSpecificCleaningFields(
    cleaningPrevDocRaw?.config,
  );

  const equipmentCalibrationSource =
    resolvedTemplateCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE
      ? await db.equipment.findMany({
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
        })
      : [];

  // ППР: строки графика — реальное оборудование организации. Раньше
  // дефолт подставлял четыре выдуманные единицы с готовыми отметками.
  const equipmentMaintenanceSource =
    resolvedTemplateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE
      ? await db.equipment.findMany({
          where: {
            area: {
              organizationId: getActiveOrgId(session),
            },
          },
          select: { id: true, name: true, type: true },
          orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
        })
      : [];

  const rawConfig =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : undefined;

  const equipmentMaintenanceConfig =
    resolvedTemplateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE
      ? (() => {
          const year =
            Number(String(dateFrom).slice(0, 4)) || new Date().getUTCFullYear();
          const providedRows =
            rawConfig && Array.isArray(rawConfig.rows) && rawConfig.rows.length > 0
              ? normalizeEquipmentMaintenanceConfig(rawConfig).rows
              : null;
          const built = buildEquipmentMaintenanceConfigFromEquipment(
            equipmentMaintenanceSource,
            year
          );
          return {
            ...built,
            ...(rawConfig
              ? normalizeEquipmentMaintenanceConfig({ ...built, ...rawConfig })
              : {}),
            year,
            rows: providedRows || built.rows,
          };
        })()
      : undefined;


  const calibrationYear = Number(String(dateFrom).slice(0, 4)) || new Date().getUTCFullYear();
  const calibrationOwner = pickPrimaryManager(allUsers);
  const calibrationProvidedRows =
    rawConfig && Array.isArray(rawConfig.rows) && rawConfig.rows.length > 0
      ? normalizeEquipmentCalibrationConfig(rawConfig).rows
      : null;
  const equipmentCalibrationConfig =
    resolvedTemplateCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE
      ? (() => {
          const built = buildEquipmentCalibrationConfigFromEquipment(
            equipmentCalibrationSource,
            {
              ...rawConfig,
              year: calibrationYear,
            }
          );

          return {
            ...built,
            year: calibrationYear,
            approveEmployee: built.approveEmployee || calibrationOwner?.name || "",
            rows: calibrationProvidedRows || built.rows,
          };
        })()
      : undefined;

  const initialConfig =
    resolvedTemplateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
      ? coldEquipmentConfig
      : resolvedTemplateCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE
      ? equipmentCalibrationConfig
      : resolvedTemplateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE
      ? equipmentMaintenanceConfig
      : resolvedTemplateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE
      ? buildClimateConfigFromRooms(directoryRooms)
      : resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? // «Как прошлый журнал»: если есть предыдущий документ —
        // используем его rooms/schedule/планы как структурную основу,
        // НО даём body перебить responsibles/title/settings (это явный
        // выбор менеджера в диалоге создания).
        //
        // Раньше cleaning-documents-client всегда отправлял body.config
        // построенный из defaultCleaningDocumentConfig (с пустыми
        // blueprint-rooms), и server.rawConfig полностью перекрывал
        // prev-doc fallback. Из-за этого новый документ создавался с
        // дефолтными комнатами (currentDays=127, generalDays=0) и
        // applyRoomScheduleToMatrix размечал все ячейки T.
        //
        // Теперь даже когда rawConfig пришёл — prev doc'а rooms +
        // structural fields имеют приоритет; перезаписываем только
        // явные body-fields (responsibles + title + settings + autoFill).
        normalizeCleaningDocumentConfig(
          (() => {
            if (!cleaningPrevDocConfig) {
              return (
                rawConfig
                ?? cleaningOrgDefault
                ?? defaultCleaningDocumentConfig(cleaningUsers, cleaningAreas)
              );
            }
            if (!rawConfig) return cleaningPrevDocConfig;
            const body = rawConfig;
            // BASE = prev. Matrix/marks ОСТАЁМ — будем remap'ить по
            // day-of-week в новый период через copyMatrixByWeekday
            // (см. ниже applyRoomScheduleToMatrix call). Это сохраняет
            // pattern уборки прошлого периода («каждая среда = G,
            // выходные = /»), а не теряет его.
            const merged: Record<string, unknown> = { ...cleaningPrevDocConfig };
            // Body-fields, которые перебивают prev (явный выбор менеджера):
            if (Array.isArray(body.cleaningResponsibles)) {
              merged.cleaningResponsibles = body.cleaningResponsibles;
            }
            if (Array.isArray(body.controlResponsibles)) {
              merged.controlResponsibles = body.controlResponsibles;
            }
            if (typeof body.title === "string" && body.title) {
              merged.title = body.title;
            }
            if (typeof body.documentTitle === "string" && body.documentTitle) {
              merged.documentTitle = body.documentTitle;
            }
            if (body.autoFill && typeof body.autoFill === "object") {
              merged.autoFill = body.autoFill;
            }
            if (body.settings && typeof body.settings === "object") {
              merged.settings = body.settings;
            }
            return merged;
          })(),
          {
            users: cleaningUsers,
            areas: cleaningAreas,
          },
        )
      : resolvedTemplateCode === CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE
      ? normalizeCleaningVentilationConfig(
          rawConfig ?? getDefaultCleaningVentilationConfig(allUsers),
          allUsers
        )
      : resolvedTemplateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE
      ? buildFinishedProductConfigFromUsers(
          allUsers,
          allProducts.map((product) => product.name)
        )
      : resolvedTemplateCode === PRODUCT_WRITEOFF_TEMPLATE_CODE
      ? buildProductWriteoffConfigFromData({
          users: allUsers,
          products: allProducts,
          batches: recentBatches,
          referenceDate: new Date(dateFrom),
        })
      : resolvedTemplateCode === GLASS_LIST_TEMPLATE_CODE
      ? buildGlassListConfigFromData({
          users: allUsers,
          areas: allAreas,
          equipment: allEquipment,
          products: allProducts,
          referenceDate: new Date(dateFrom),
        })
      : isAcceptanceDocumentTemplate(resolvedTemplateCode)
      ? getAcceptanceDocumentDefaultConfig(allUsers)
      : resolvedTemplateCode === PPE_ISSUANCE_TEMPLATE_CODE
      ? getPpeIssuanceDefaultConfig(allUsers)
      : resolvedTemplateCode === SANITATION_DAY_TEMPLATE_CODE
      ? // «График и учет генеральных уборок» — годовой бланк. Строки
        // берём из помещений организации (раньше подставлялись
        // демо-строки дефолта), а должность/ФИО ответственного из
        // диалога создания кладём в блок «УТВЕРЖДАЮ» (`approve*`).
        // rows из body уважаем только если они непустые: диалог
        // присылает лишь approve*/responsible*, и наивный merge обнулил
        // бы список помещений.
        (() => {
          const base = buildSanitationDayConfigFromRooms(directoryRooms, new Date(dateFrom), {
            fromKey: sanitationFromKey,
          });
          const provided = (rawConfig || {}) as Record<string, unknown>;
          const providedRows =
            Array.isArray(provided.rows) && provided.rows.length > 0;
          return {
            ...base,
            ...provided,
            rows: providedRows ? provided.rows : base.rows,
          };
        })()
      : resolvedTemplateCode === TRAINING_PLAN_TEMPLATE_CODE
      ? getTrainingPlanDefaultConfig()
      : resolvedTemplateCode === BREAKDOWN_HISTORY_TEMPLATE_CODE
      ? getBreakdownHistoryDefaultConfig()
      : resolvedTemplateCode === ACCIDENT_DOCUMENT_TEMPLATE_CODE
      ? getAccidentDocumentDefaultConfig()
      : resolvedTemplateCode === AUDIT_PROTOCOL_TEMPLATE_CODE
      ? getDefaultAuditProtocolConfig()
      : resolvedTemplateCode === AUDIT_REPORT_TEMPLATE_CODE
      ? getDefaultAuditReportConfig()
      : resolvedTemplateCode === METAL_IMPURITY_TEMPLATE_CODE
      ? getDefaultMetalImpurityConfig({
          users: allUsers,
          materials: allProducts.map((item) => item.name).filter(Boolean),
          suppliers: metalSuppliers
            .map((item) => item.supplier || "")
            .filter(Boolean),
          date: typeof dateFrom === "string" ? dateFrom : new Date(dateFrom).toISOString().slice(0, 10),
          responsibleName:
            rawConfig && typeof rawConfig.responsibleEmployee === "string"
              ? rawConfig.responsibleEmployee
              : undefined,
          responsiblePosition:
            rawConfig && typeof rawConfig.responsiblePosition === "string"
              ? rawConfig.responsiblePosition
              : undefined,
        })
      : resolvedTemplateCode === PERISHABLE_REJECTION_TEMPLATE_CODE
      ? buildPerishableRejectionConfigFromOrgData({
          products: allProducts.map((product) => product.name),
          suppliers: metalSuppliers.map((item) => item.supplier || ""),
        })
      : isSanitaryDayChecklistTemplate(resolvedTemplateCode)
      ? rawConfig ?? defaultSdcConfig()
      : isRegisterDocumentTemplate(resolvedTemplateCode)
      ? buildRegisterDocumentConfigFromUsers(allUsers)
      : undefined;

  const cleaningControlRole =
    resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? cleaningUsers.find(
          (user) =>
            user.id ===
            (responsibleUserId ||
              (initialConfig as { controlResponsibles?: Array<{ userId?: string }> } | undefined)
                ?.controlResponsibles?.[0]?.userId ||
              cleaningDefaults?.responsibleControlUserId)
        )?.role || null
      : null;

  const fallbackResponsibleUserId =
    (resolvedTemplateCode === GLASS_LIST_TEMPLATE_CODE
      ? ((initialConfig as { responsibleUserId?: string } | undefined)?.responsibleUserId || null)
      : null) ||
    (resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? ((initialConfig as { controlResponsibles?: Array<{ userId?: string }> } | undefined)
          ?.controlResponsibles?.[0]?.userId ||
        cleaningDefaults?.responsibleControlUserId ||
        null)
      : null);
  const fallbackResponsibleTitle =
    responsibleTitle ||
    (resolvedTemplateCode === GLASS_LIST_TEMPLATE_CODE
      ? ((initialConfig as { responsibleTitle?: string } | undefined)?.responsibleTitle || null)
      : null) ||
    (resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? ((initialConfig as { controlResponsibles?: Array<{ title?: string }> } | undefined)
          ?.controlResponsibles?.[0]?.title ||
        getHygienePositionLabel(cleaningControlRole || "owner"))
      : null);
  const configForDocument =
    resolvedTemplateCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE
      ? equipmentCalibrationConfig
      : resolvedTemplateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE
      ? equipmentMaintenanceConfig
      : resolvedTemplateCode === CLEANING_DOCUMENT_TEMPLATE_CODE
      ? // Cleaning: используем уже-merged initialConfig (содержит prev doc
        // как базу + body responsibles/title), НЕ rawConfig напрямую.
        // Раньше тут было `rawConfig ?? initialConfig` и rawConfig из
        // body всегда побеждал → merge logic выше игнорировался полностью.
        //
        // Шаги:
        //   1. Нормализуем merged config.
        //   2. Если был prev doc — копируем его matrix в новый period
        //      по day-of-week pattern'у (среда → среда, выходные → выходные).
        //      Это сохраняет фактический ритм уборки прошлого месяца.
        //   3. Если prev'а не было — fill-empty по weekday-маскам комнат.
        (() => {
          const normalized = normalizeCleaningDocumentConfig(
            applyRoomsToCleaningConfig(initialConfig, cleaningRoomIds),
            {
              users: cleaningUsers,
              areas: cleaningAreas,
            },
          );
          const newDateKeys = buildDateKeys(dateFrom, dateTo);
          if (cleaningPrevDocConfig) {
            const prevMatrix =
              (cleaningPrevDocConfig as { matrix?: CleaningMatrixMap }).matrix;
            let remapped = copyMatrixByWeekday(prevMatrix, newDateKeys);
            // Поверх копии — оверрайдим выходные и праздники РФ-календаря
            // на «/». Прошлый период мог иметь T на Sat (если уборщица
            // там работала или менеджер случайно отметил), но в новом
            // периоде дни недели сместились + могут быть праздники, и
            // поведение по умолчанию должно быть «не убиралась». Pattern
            // T-на-будни / G-по-средам сохраняется через copy, а
            // weekends/holidays зануляем «/» как в кнопке «План заново».
            remapped = applyWeekendHolidayMark(remapped, newDateKeys, normalized);
            return {
              ...normalized,
              matrix: remapped,
              marks: remapped,
            };
          }
          return applyRoomScheduleToMatrix(
            normalized,
            newDateKeys,
            "fill-empty",
            cleaningRoomSchedule,
          );
        })()
      : resolvedTemplateCode === CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE
      ? normalizeCleaningVentilationConfig(rawConfig ?? initialConfig, allUsers)
      : resolvedTemplateCode === PRODUCT_WRITEOFF_TEMPLATE_CODE
      ? normalizeJournalStaffBoundConfig(
          resolvedTemplateCode,
          {
            ...(((initialConfig as Record<string, unknown>) || {}) as Record<string, unknown>),
            ...((rawConfig || {}) as Record<string, unknown>),
          },
          allUsers
        )
      : resolvedTemplateCode === GLASS_LIST_TEMPLATE_CODE ||
        resolvedTemplateCode === PERISHABLE_REJECTION_TEMPLATE_CODE
      ? // Диалог присылает только настройки состава (`showNote`), списки
        // берём из справочников организации.
        {
          ...(((initialConfig as Record<string, unknown>) || {}) as Record<string, unknown>),
          ...((rawConfig || {}) as Record<string, unknown>),
        }
      : resolvedTemplateCode === SANITATION_DAY_TEMPLATE_CODE
      ? // initialConfig уже слил поля диалога (approve*/responsible*) с
        // помещениями справочника. Сырой `config` из тела без `rows`
        // обнулил бы график — новый документ оставался без помещений.
        normalizeJournalStaffBoundConfig(resolvedTemplateCode, initialConfig, allUsers)
      : normalizeJournalStaffBoundConfig(
          resolvedTemplateCode,
          config ?? initialConfig ?? undefined,
          allUsers
        );
  const normalizedDocumentState = normalizeJournalDocumentStaffState(
    resolvedTemplateCode,
    {
      config: configForDocument,
      responsibleUserId: bodyResponsibleUserId || fallbackResponsibleUserId,
      responsibleTitle: fallbackResponsibleTitle,
    },
    allUsers,
    { allowFallbackUser: false }
  );

  // Prefill from /settings/journal-responsibles (Organization
  // .journalResponsibleUsersJson): слоты заполняют то, что человек в
  // диалоге НЕ выбрал (проверяющий, члены комиссии, конфиг-поля журнала).
  //
  // Приоритет: явный выбор в диалоге → слоты настроек → то, что вывели из
  // конфига (cleaning/glass) → никто. Раньше слоты перебивали выбор, а
  // диалог всегда присылал авто-предвыбранного «первого» — и сервер не
  // отличал «выбрал» от «так получилось». Выбранного человека передаём
  // как override слота, чтобы и шапка, и поля конфига получили его.
  //
  // Выбрали только должность, а человека нет (в должности несколько
  // сотрудников, список закрыли) — ответственный берётся из этой
  // должности: сохранённый в настройках, если он в ней, иначе по общему
  // правилу ростера. Раньше это делал клиент — «первый попавшийся по роли».
  const primarySlotId = getPrimarySlotId(resolvedTemplateCode);
  const requestedTitle =
    typeof responsibleTitle === "string" ? responsibleTitle.trim() : "";
  let titleResponsibleUserId: string | null = null;
  if (!bodyResponsibleUserId && requestedTitle) {
    const titleCandidates = allUsers.filter(
      (user) => getUserPositionLabel(user) === requestedTitle
    );
    if (titleCandidates.length > 0) {
      const savedSlots = await db.organization.findUnique({
        where: { id: getActiveOrgId(session) },
        select: { journalResponsibleUsersJson: true },
      });
      const savedPrimary = (
        (savedSlots?.journalResponsibleUsersJson ?? {}) as Record<
          string,
          Record<string, string | null> | undefined
        >
      )[resolvedTemplateCode]?.[primarySlotId];
      titleResponsibleUserId =
        titleCandidates.find((user) => user.id === savedPrimary)?.id ??
        rankRosterForSlot(titleCandidates, { kind: "filler" })?.id ??
        null;
    }
  }
  const explicitResponsibleUserId = bodyResponsibleUserId || titleResponsibleUserId;

  const slotOverrides: Record<string, string> = {};
  if (explicitResponsibleUserId) {
    slotOverrides[primarySlotId] = explicitResponsibleUserId;
  }
  if (bodyVerifierUserId) {
    slotOverrides[getVerifierSlotId(resolvedTemplateCode)] = bodyVerifierUserId;
  }
  // Утверждающий («УТВЕРЖДАЮ» в шапке) у части журналов — отдельный слот,
  // а не основной. Диалог присылает его в `config.approveEmployeeId`;
  // без override слот подбирался бы сам, и в шапке оказалась бы
  // должность из диалога рядом с ФИО другого человека.
  const approverSlotId = APPROVER_SLOT_BY_JOURNAL[resolvedTemplateCode];
  const bodyApproveEmployeeId =
    rawConfig && typeof rawConfig.approveEmployeeId === "string"
      ? rawConfig.approveEmployeeId
      : "";
  if (approverSlotId && bodyApproveEmployeeId && orgUserIds.has(bodyApproveEmployeeId)) {
    slotOverrides[approverSlotId] = bodyApproveEmployeeId;
  }
  const prefilled = await prefillResponsiblesForNewDocument({
    organizationId: getActiveOrgId(session),
    journalCode: resolvedTemplateCode,
    baseConfig:
      (normalizedDocumentState.config as Record<string, unknown> | undefined) ??
      undefined,
    slotOverrides,
    // Переключатели колонок в диалоге создания стартуют с общего набора
    // организации, поэтому присланные флаги — выбор человека.
    respectColumnFlags: true,
  });

  const finalResponsibleUserId =
    explicitResponsibleUserId ||
    prefilled.responsibleUserId ||
    (normalizedDocumentState.responsibleUserId &&
    orgUserIds.has(normalizedDocumentState.responsibleUserId)
      ? normalizedDocumentState.responsibleUserId
      : null);
  // Должность в шапке — должность того, кто реально стал ответственным.
  // Присланный титул уважаем, только если у человека должность не указана.
  let finalResponsibleTitle = normalizedDocumentState.responsibleTitle ?? null;
  const finalResponsibleUser = finalResponsibleUserId
    ? await findOrgUser(getActiveOrgId(session), finalResponsibleUserId)
    : null;
  if (finalResponsibleUser) {
    const positionName =
      finalResponsibleUser.jobPositionName || finalResponsibleUser.positionTitle || null;
    finalResponsibleTitle =
      positionName ||
      (typeof responsibleTitle === "string" && responsibleTitle.trim()) ||
      getHygienePositionLabel(finalResponsibleUser.role || "cook");
  } else if (!finalResponsibleUserId && typeof responsibleTitle === "string") {
    finalResponsibleTitle = responsibleTitle.trim() || finalResponsibleTitle;
  }
  // ВСЕГДА используем prefilled.config — patcher уже сделал merge:
  // body fields сохранил, slot-user'ов из настроек проставил поверх.
  // Раньше при наличии rawConfig мы оставляли normalizedDocumentState.config
  // (PRE-патчер), и слот-пользователи терялись.
  const baseFinalConfig =
    prefilled.config ??
    (normalizedDocumentState.config as Record<string, unknown> | undefined);

  // «Периодичность контроля» приходит отдельным top-level полем, а не внутри
  // `config`: per-journal нормализаторы собирают свежий объект и выкинули бы
  // незнакомый ключ. Пустая строка — валидное значение (владелец убрал строку
  // из бумажной шапки), поэтому проверяем именно `!== undefined`.
  const finalConfig =
    body.controlPeriodicity !== undefined
      ? {
          ...(baseFinalConfig ?? {}),
          [CONTROL_PERIODICITY_CONFIG_KEY]: sanitizeControlPeriodicity(
            body.controlPeriodicity
          ),
        }
      : baseFinalConfig;

  /**
   * P8: «Дата ввода установки в эксплуатацию» у бактерицидной установки
   * по умолчанию равна дате начала документа.
   *
   * Раньше дефолт жил ТОЛЬКО в диалоге редактирования спецификации
   * (`uv-lamp-runtime-document-client.tsx`, `defaultCommissioningDate`) —
   * то есть в конфиг он попадал лишь после того, как кто-то откроет и
   * сохранит настройки. Документы, созданные из списка/cron'ом, ехали с
   * пустой датой, и в бумажной спецификации стоял прочерк. Ставим её
   * ЗДЕСЬ, в единственной серверной точке создания, и только если поле
   * действительно пустое — явный выбор пользователя не перетираем.
   */
  // Название организации и документа «только в этом документе» — так же
  // отдельными полями тела, как периодичность. Пустое значение не пишем:
  // шапка возьмёт общее название организации и стандартное — бланка.
  const headerOrgName = sanitizeOrgJournalName(body.headerOrgName);
  const headerTitle = sanitizeHeaderTitle(body.headerTitle);
  const finalConfigWithHeader =
    headerOrgName || headerTitle
      ? {
          ...(finalConfig ?? {}),
          ...(headerOrgName ? { [ORG_HEADER_NAME_CONFIG_KEY]: headerOrgName } : {}),
          ...(headerTitle ? { [HEADER_TITLE_CONFIG_KEY]: headerTitle } : {}),
        }
      : finalConfig;

  const finalConfigWithUvDefaults =
    resolvedTemplateCode === UV_LAMP_RUNTIME_TEMPLATE_CODE
      ? withUvCommissioningDate(finalConfigWithHeader, dateFrom)
      : finalConfigWithHeader;

  /**
   * Не заводим второй бланк на тот же период молча.
   *
   * Раньше здесь создавалось безусловно, и на проде вышло два документа
   * на 1–15 сентября: один сделало ночное автосоздание, второй —
   * руководитель кнопкой. Названия разные, потому что собирались в
   * разных местах кода, а период один. Для матричных журналов документ
   * И ЕСТЬ период: половина отметок смены уходит в один бланк, половина
   * в другой, и на проверке ни один не выглядит заполненным.
   *
   * Запрещать наглухо нельзя — второй документ иногда нужен осознанно.
   * Поэтому отвечаем 409 и отдаём найденный: пусть человек решит,
   * открыть существующий или всё-таки создать ещё один.
   */
  if (!force) {
    const sameTemplate = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        templateId: template.id,
        status: "active",
        ...buildingWhere(activeBuildingId),
      },
      select: { id: true, title: true, dateFrom: true, dateTo: true, status: true },
      orderBy: [{ dateFrom: "desc" }],
      take: 50,
    });
    const clash = findOverlappingDocument(sameTemplate, {
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    });
    if (clash) {
      // Человеческий текст кладём именно в `error`: его показывают все
      // двадцать четыре места, откуда создаются документы. Машинный код
      // отдельным полем — для тех, кто захочет разобрать ответ.
      return NextResponse.json(
        {
          error:
            `За этот период уже есть документ «${clash.title}». ` +
            "Откройте его или выберите другой период.",
          code: "duplicate-period",
          existing: {
            id: clash.id,
            title: clash.title,
            dateFrom: clash.dateFrom.toISOString(),
            dateTo: clash.dateTo.toISOString(),
          },
        },
        { status: 409 },
      );
    }
  }

  const doc = await db.journalDocument.create({
    data: {
      templateId: template.id,
      organizationId: getActiveOrgId(session),
      buildingId: activeBuildingId,
      // Пустое название → «Имя журнала — период» (как в диалогах создания),
      // а не голое имя шаблона: список документов иначе состоял из клонов.
      title:
        (typeof title === "string" && title.trim()) ||
        buildDocumentAutoTitle({
          templateCode: resolvedTemplateCode,
          journalName: template.name,
          dateFrom: String(dateFrom),
          dateTo: String(dateTo),
          year: (config as { year?: string | number } | undefined)?.year,
        }),
      config: finalConfigWithUvDefaults as Prisma.InputJsonValue | undefined,
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
      responsibleUserId: finalResponsibleUserId,
      responsibleTitle: finalResponsibleTitle,
      verifierUserId: bodyVerifierUserId || prefilled.verifierUserId,
      createdById: session.user.id,
    },
  });

  // Сид строк — как в cron-пути (ensureActiveDocument). Без него
  // созданный вручную гигиенический документ открывался пустым
  // («Записей нет»), тогда как на эталоне сразу видны строки
  // сотрудников. Логика PER_DAY / PER_EMPLOYEE_PER_DAY внутри
  // seedEntriesForDocument; для остальных журналов — no-op.
  await seedEntriesForDocument({
    documentId: doc.id,
    journalCode: resolvedTemplateCode,
    organizationId: getActiveOrgId(session),
    dateFrom: doc.dateFrom,
    dateTo: doc.dateTo,
    responsibleUserId: finalResponsibleUserId ?? null,
  }).catch((err) => {
    console.warn(
      `[journal-documents] seedEntries failed for ${resolvedTemplateCode}`,
      err
    );
  });

  return NextResponse.json({ document: doc }, { status: 201 });
}
