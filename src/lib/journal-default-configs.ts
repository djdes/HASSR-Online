/**
 * Per-journal default-config provider — генерирует stock config с
 * дефолтными строками (rows/zones/equipment) при создании нового
 * документа. Без этого многие документы создавались с пустым {},
 * и bulk-assign-today / печать падали с «нет строк для назначения».
 *
 * Используется prefillResponsiblesForNewDocument: сначала берёт base
 * config от соответствующей default-функции, потом поверх накладывает
 * patcher с конкретными slot users.
 *
 * Если для journalCode дефолта нет — возвращаем пустой config, который
 * патчер всё равно дополнит. Это OK для журналов без обязательных rows
 * (накладные/одиночные записи).
 */

import { getAcceptanceDocumentDefaultConfig } from "./acceptance-document";
import { getAccidentDocumentDefaultConfig } from "./accident-document";
import { getAuditPlanDefaultConfig } from "./audit-plan-document";
import { getDefaultAuditProtocolConfig } from "./audit-protocol-document";
import { getDefaultAuditReportConfig } from "./audit-report-document";
import { getBreakdownHistoryDefaultConfig } from "./breakdown-history-document";
import { defaultCleaningDocumentConfig } from "./cleaning-document";
import { getDefaultCleaningVentilationConfig } from "./cleaning-ventilation-checklist-document";
import {
  buildClimateConfigFromAreas,
  buildClimateConfigFromRooms,
  getDefaultClimateDocumentConfig,
} from "./climate-document";
import {
  buildColdEquipmentConfigFromEquipment,
  getColdEquipmentSampleConfig,
  getDefaultColdEquipmentDocumentConfig,
} from "./cold-equipment-document";
import {
  getDisinfectantDefaultConfig,
  getDisinfectantSampleConfig,
} from "./disinfectant-document";
import {
  buildEquipmentCalibrationConfigFromEquipment,
  getDefaultEquipmentCalibrationConfig,
} from "./equipment-calibration-document";
import { getDefaultEquipmentCleaningConfig } from "./equipment-cleaning-document";
import {
  buildEquipmentMaintenanceConfigFromEquipment,
  getDefaultEquipmentMaintenanceConfig,
} from "./equipment-maintenance-document";
import {
  buildFinishedProductConfigFromUsers,
  buildFinishedProductSampleConfig,
  getDefaultFinishedProductDocumentConfig,
} from "./finished-product-document";
import { getDefaultGlassControlConfig } from "./glass-control-document";
import {
  buildGlassListConfigFromData,
  getDefaultGlassListConfig,
} from "./glass-list-document";
import { getDefaultIntensiveCoolingConfig } from "./intensive-cooling-document";
import { getDefaultMedBookConfig } from "./med-book-document";
import { getDefaultMetalImpurityConfig } from "./metal-impurity-document";
import {
  buildPerishableRejectionConfigFromOrgData,
  getPerishableRejectionSampleConfig,
} from "./perishable-rejection-document";
import { getPpeIssuanceDefaultConfig } from "./ppe-issuance-document";
import { getDefaultProductWriteoffConfig } from "./product-writeoff-document";
import {
  buildRegisterDocumentConfigFromUsers,
  getDefaultRegisterDocumentConfig,
} from "./register-document";
import {
  buildSanitationDayConfigFromAreas,
  buildSanitationDayConfigFromRooms,
  getSanitationDayDefaultConfig,
} from "./sanitation-day-document";
import { defaultSdcConfig } from "./sanitary-day-checklist-document";
import {
  getDefaultTraceabilityDocumentConfig,
  getTraceabilitySampleConfig,
} from "./traceability-document";
import { getTrainingPlanDefaultConfig } from "./training-plan-document";
import { defaultUvSpecification } from "./uv-lamp-runtime-document";

/**
 * Org-данные, которые провайдер может опционально использовать для
 * генерации enriched дефолта (например, climate подтянет rooms из
 * areas, cold-equipment — equipment по типу холодильник).
 *
 * Все поля optional: если caller не передаёт — провайдер делает stub
 * (один default-row). Если передаёт — провайдер заполняет по реальным
 * данным.
 */
export type DefaultConfigOrgData = {
  areas?: Array<{ id: string; name: string }>;
  /// 2026-09-04: единый справочник помещений (Room). Климат и график
  /// ген. уборок сидируются из него; areas — legacy fallback.
  /// 2026-09-22: график генуборки помещения — план графика сразу
  /// заполняется датами с сегодняшнего дня до конца года.
  rooms?: Array<{
    id: string;
    name: string;
    climateNorms?: unknown;
    generalScheduleType?: string | null;
    generalDays?: number | null;
    generalMonthDays?: unknown;
  }>;
  equipment?: Array<{
    id: string;
    name: string;
    type?: string | null;
    tempMin?: number | null;
    tempMax?: number | null;
  }>;
  users?: Array<{
    id: string;
    name: string;
    role: string;
    /** Должность, вписанная руками в карточке сотрудника. */
    positionTitle?: string | null;
    /** Должность из справочника — она приоритетнее вписанной руками. */
    jobPositionName?: string | null;
  }>;
  products?: Array<{ id: string; name: string }>;
  /** Поставщики из принятых партий организации (без повторов). */
  suppliers?: string[];
  organizationName?: string;
  /**
   * Демо-организация (или витрина лендинга). Только ей достаются
   * образцы-фикстуры: «Пельмени», стоковые холодильники, приходы
   * дезсредств. Реальная организация получает пустые таблицы или данные
   * своих справочников.
   */
  isDemo?: boolean;
};

/**
 * Должность сотрудника для печатной формы. Порядок тот же, что в PDF
 * (`document-pdf.ts`): справочник → вписанное руками → пусто. Роль
 * («cook», «waiter») сюда не подставляем: в бланке для проверки она
 * выглядит как техническая метка, а не как должность.
 */
export function pickUserTitle(user: {
  positionTitle?: string | null;
  jobPositionName?: string | null;
}): string {
  return user.jobPositionName?.trim() || user.positionTitle?.trim() || "";
}

type Provider = (orgData?: DefaultConfigOrgData) => Record<string, unknown>;

/**
 * Конфиг журнала-реестра. Строки НЕ создаём: в реестрах (инструктажи,
 * жалобы, дератизация, прослеживаемость) строка — это случившееся
 * событие, и заранее насыпанные пустые строки означали бы записи,
 * которых не было. Подставляем только ответственного по умолчанию.
 */
function registerConfig(
  orgData?: DefaultConfigOrgData
): Record<string, unknown> {
  if (orgData?.users?.length) {
    return buildRegisterDocumentConfigFromUsers(
      orgData.users
    ) as unknown as Record<string, unknown>;
  }
  return getDefaultRegisterDocumentConfig() as unknown as Record<
    string,
    unknown
  >;
}

const PROVIDERS: Record<string, Provider> = {
  // ═══ ТЕМПЕРАТУРА ═══
  climate_control: (orgData) => {
    if (orgData?.rooms && orgData.rooms.length > 0) {
      return buildClimateConfigFromRooms(orgData.rooms) as unknown as Record<
        string,
        unknown
      >;
    }
    if (orgData?.areas && orgData.areas.length > 0) {
      return buildClimateConfigFromAreas(orgData.areas) as unknown as Record<
        string,
        unknown
      >;
    }
    return getDefaultClimateDocumentConfig() as unknown as Record<
      string,
      unknown
    >;
  },
  cold_equipment_control: (orgData) => {
    if (orgData?.equipment && orgData.equipment.length > 0) {
      return buildColdEquipmentConfigFromEquipment(orgData.equipment, {
        sampleFallback: orgData.isDemo === true,
      }) as unknown as Record<string, unknown>;
    }
    return (
      orgData?.isDemo
        ? getColdEquipmentSampleConfig()
        : getDefaultColdEquipmentDocumentConfig()
    ) as unknown as Record<string, unknown>;
  },
  intensive_cooling: (orgData) =>
    getDefaultIntensiveCoolingConfig(
      orgData?.users ?? []
    ) as unknown as Record<string, unknown>,
  fryer_oil: (orgData) => registerConfig(orgData),

  // ═══ УБОРКА ═══
  cleaning: (orgData) =>
    defaultCleaningDocumentConfig(
      orgData?.users,
      orgData?.areas
    ) as unknown as Record<string, unknown>,
  general_cleaning: (orgData) => {
    if (orgData?.rooms && orgData.rooms.length > 0) {
      return buildSanitationDayConfigFromRooms(
        orgData.rooms
      ) as unknown as Record<string, unknown>;
    }
    if (orgData?.areas && orgData.areas.length > 0) {
      return buildSanitationDayConfigFromAreas(
        orgData.areas
      ) as unknown as Record<string, unknown>;
    }
    return getSanitationDayDefaultConfig() as unknown as Record<string, unknown>;
  },
  cleaning_ventilation_checklist: (orgData) => {
    if (orgData?.users && orgData.users.length > 0) {
      return getDefaultCleaningVentilationConfig(
        // Должность из справочника → подпись ответственных чек-листа.
        orgData.users.map((user) => ({
          ...user,
          jobPosition: user.jobPositionName?.trim()
            ? { name: user.jobPositionName.trim(), categoryKey: "" }
            : null,
        }))
      ) as unknown as Record<string, unknown>;
    }
    return getDefaultCleaningVentilationConfig() as unknown as Record<
      string,
      unknown
    >;
  },
  // Бактерицидная установка — не реестр: у документа номер установки,
  // цех и спецификация лампы. Раньше сюда отдавался конфиг реестра с
  // «первым сотрудником» ответственным, и форма расходилась с
  // `normalizeUvRuntimeDocumentConfig`.
  uv_lamp_runtime: () => ({
    lampNumber: "1",
    areaName: "",
    spec: defaultUvSpecification(),
  }),
  disinfectant_usage: (orgData) =>
    (orgData?.isDemo
      ? getDisinfectantSampleConfig()
      : getDisinfectantDefaultConfig()) as unknown as Record<string, unknown>,
  sanitary_day_control: () =>
    defaultSdcConfig() as unknown as Record<string, unknown>,
  equipment_cleaning: () =>
    getDefaultEquipmentCleaningConfig() as unknown as Record<string, unknown>,

  // ═══ ПРИЁМКА ═══
  // Ответственного приёмки проставляет слот «Ответственные за журналы»;
  // здесь его не угадываем (раньше — управляющий или первый по алфавиту).
  incoming_control: (orgData) =>
    getAcceptanceDocumentDefaultConfig(
      orgData?.isDemo ? orgData.users ?? [] : []
    ) as unknown as Record<string, unknown>,
  incoming_raw_materials_control: (orgData) =>
    getAcceptanceDocumentDefaultConfig(
      orgData?.isDemo ? orgData.users ?? [] : []
    ) as unknown as Record<string, unknown>,
  perishable_rejection: (orgData) =>
    (orgData?.isDemo
      ? getPerishableRejectionSampleConfig()
      : buildPerishableRejectionConfigFromOrgData({
          products: (orgData?.products ?? []).map((product) => product.name),
          suppliers: orgData?.suppliers,
        })) as unknown as Record<string, unknown>,
  metal_impurity: () =>
    getDefaultMetalImpurityConfig() as unknown as Record<string, unknown>,

  // ═══ ПРОИЗВОДСТВО / БРАКЕРАЖ ═══
  finished_product: (orgData) => {
    if (orgData?.users?.length) {
      const productNames = (orgData.products ?? []).map((p) => p.name);
      return (
        orgData.isDemo
          ? buildFinishedProductSampleConfig(orgData.users, productNames)
          : buildFinishedProductConfigFromUsers(orgData.users, productNames)
      ) as unknown as Record<string, unknown>;
    }
    return getDefaultFinishedProductDocumentConfig() as unknown as Record<
      string,
      unknown
    >;
  },
  product_writeoff: () =>
    getDefaultProductWriteoffConfig() as unknown as Record<string, unknown>,

  // ═══ ОБОРУДОВАНИЕ ═══
  equipment_calibration: (orgData) => {
    const year = new Date().getUTCFullYear();
    if (orgData?.equipment && orgData.equipment.length > 0) {
      const calibrationSource = orgData.equipment.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type ?? "",
        tempMin: e.tempMin ?? null,
        tempMax: e.tempMax ?? null,
      }));
      return buildEquipmentCalibrationConfigFromEquipment(calibrationSource, {
        year,
      }) as unknown as Record<string, unknown>;
    }
    return getDefaultEquipmentCalibrationConfig(year) as unknown as Record<
      string,
      unknown
    >;
  },
  equipment_maintenance: (orgData) => {
    const year = new Date().getUTCFullYear();
    if (orgData?.equipment && orgData.equipment.length > 0) {
      return buildEquipmentMaintenanceConfigFromEquipment(
        orgData.equipment.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type ?? null,
        })),
        year
      ) as unknown as Record<string, unknown>;
    }
    return getDefaultEquipmentMaintenanceConfig(year) as unknown as Record<
      string,
      unknown
    >;
  },
  breakdown_history: () =>
    getBreakdownHistoryDefaultConfig() as unknown as Record<string, unknown>,
  glass_items_list: (orgData) => {
    const hasData =
      (orgData?.equipment && orgData.equipment.length > 0) ||
      (orgData?.products && orgData.products.length > 0) ||
      (orgData?.areas && orgData.areas.length > 0);
    if (hasData) {
      return buildGlassListConfigFromData({
        users: orgData?.users ?? [],
        areas: orgData?.areas ?? [],
        equipment: orgData?.equipment ?? [],
        products: orgData?.products ?? [],
      }) as unknown as Record<string, unknown>;
    }
    return getDefaultGlassListConfig() as unknown as Record<string, unknown>;
  },
  glass_control: () =>
    getDefaultGlassControlConfig() as unknown as Record<string, unknown>,

  // ═══ ОБУЧЕНИЕ / ПЕРСОНАЛ ═══
  training_plan: () =>
    getTrainingPlanDefaultConfig() as unknown as Record<string, unknown>,
  staff_training: (orgData) => registerConfig(orgData),
  ppe_issuance: (orgData) =>
    getPpeIssuanceDefaultConfig(orgData?.users ?? []) as unknown as Record<
      string,
      unknown
    >,
  med_books: () =>
    getDefaultMedBookConfig() as unknown as Record<string, unknown>,

  // ═══ ИНЦИДЕНТЫ ═══
  accident_journal: () =>
    getAccidentDocumentDefaultConfig() as unknown as Record<string, unknown>,
  complaint_register: (orgData) => registerConfig(orgData),
  pest_control: (orgData) => registerConfig(orgData),

  // ═══ ТАБЛИЧНЫЕ РЕЕСТРЫ (register-journals.ts) ═══
  daily_samples: (orgData) => registerConfig(orgData),
  vitaminization: (orgData) => registerConfig(orgData),
  ration_control: (orgData) => registerConfig(orgData),
  transport_temperature: (orgData) => registerConfig(orgData),
  tableware_breakage: (orgData) => registerConfig(orgData),
  pool_water_control: (orgData) => registerConfig(orgData),

  // ═══ АУДИТЫ ═══
  audit_plan: (orgData) =>
    getAuditPlanDefaultConfig({
      organizationName: orgData?.organizationName,
      users: orgData?.users,
    }) as unknown as Record<string, unknown>,
  audit_protocol: () =>
    getDefaultAuditProtocolConfig() as unknown as Record<string, unknown>,
  audit_report: () =>
    getDefaultAuditReportConfig() as unknown as Record<string, unknown>,
  // Раньше — конфиг реестра, а нормализатор журнала добавлял к нему
  // «Муку» и «Пельмени». Теперь — родная форма журнала.
  traceability_test: (orgData) =>
    (orgData?.isDemo
      ? getTraceabilitySampleConfig()
      : getDefaultTraceabilityDocumentConfig()) as unknown as Record<string, unknown>,
};

export function getDefaultConfigForJournal(
  journalCode: string,
  orgData?: DefaultConfigOrgData
): Record<string, unknown> {
  const provider = PROVIDERS[journalCode];
  if (!provider) return {};
  try {
    return provider(orgData);
  } catch (err) {
    // Лёгкая защита от падений в дефолт-генераторах: возвращаем пустой
    // вместо ошибки — лучше создать документ без rows, чем не создать
    // вовсе.
    console.warn(
      `[journal-default-configs] provider failed for ${journalCode}`,
      err
    );
    return {};
  }
}
