import { randomUUID } from "crypto";
import type { SlotUserMap } from "@/lib/journal-responsibles-cascade";

/**
 * Per-journal патчеры document.config — каскад выбранных в settings
 * слотов в реальные поля конфига документа.
 *
 * Каждый журнал хранит своих ответственных по-разному:
 *   • training_plan / audit_plan / equipment_calibration ... — один
 *     топ-левел approveEmployeeId / responsibleEmployeeId
 *   • cleaning — массивы cleaningResponsibles[] / controlResponsibles[]
 *   • equipment_cleaning — washerUserId / controllerUserId
 *   • product_writeoff / finished_product — комиссия из 3 человек
 *
 * Patcher принимает текущий config (как-есть из БД) + slot users
 * (как сохранили в settings) + helper для имени → возвращает обновлённый
 * config. Используется в cascadeResponsibleToActiveDocuments после
 * каждого сохранения, чтобы поля внутри документа сразу подхватили
 * новых ответственных.
 *
 * Если для journalCode patcher'а нет — config не трогаем, ограничиваемся
 * JournalDocument.responsibleUserId (top-level колонка) который и так
 * пишется. Это OK для журналов без user-bound config полей (hygiene,
 * health_check, med_books, glass_control, fryer_oil и т.п.).
 */

export type DocPatcherCtx = {
  /** Возвращает «Иванов И.И.» по userId или пустую строку. */
  getName: (userId: string | null | undefined) => string;
  /** Возвращает «Шеф-повар» по userId или пустую строку. */
  getPositionTitle: (userId: string | null | undefined) => string;
};

type ConfigObj = Record<string, unknown>;
type Patcher = (
  cfg: ConfigObj,
  slots: SlotUserMap,
  ctx: DocPatcherCtx
) => ConfigObj;

function asObj(v: unknown): ConfigObj {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as ConfigObj)
    : {};
}

function asArr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Помощник: подменить approveEmployeeId/Employee при наличии primary slot. */
function patchApprove(
  cfg: ConfigObj,
  userId: string | null,
  ctx: DocPatcherCtx,
  fieldId = "approveEmployeeId",
  fieldName = "approveEmployee"
): ConfigObj {
  if (!userId) return cfg;
  return {
    ...cfg,
    [fieldId]: userId,
    [fieldName]: ctx.getName(userId),
  };
}

/** Помощник: подменить responsibleEmployeeId. */
function patchResponsibleEmp(
  cfg: ConfigObj,
  userId: string | null,
  field = "responsibleEmployeeId"
): ConfigObj {
  if (!userId) return cfg;
  return { ...cfg, [field]: userId };
}

/** Помощник: подменить responsibleUserId / defaultResponsibleUserId. */
function patchResponsibleUser(
  cfg: ConfigObj,
  userId: string | null,
  field = "responsibleUserId"
): ConfigObj {
  if (!userId) return cfg;
  return { ...cfg, [field]: userId };
}

function patchAcceptanceResponsible(
  cfg: ConfigObj,
  userId: string | null,
  ctx: DocPatcherCtx
): ConfigObj {
  if (!userId) return cfg;
  const title = ctx.getPositionTitle(userId);
  return {
    ...cfg,
    defaultResponsibleUserId: userId,
    ...(title ? { defaultResponsibleTitle: title } : {}),
  };
}

const PATCHERS: Record<string, Patcher> = {
  // ═══════════════════════════════════════════════════════════════
  // Pattern A: single primary user → top-level config field
  // ═══════════════════════════════════════════════════════════════
  training_plan: (cfg, slots, ctx) =>
    patchApprove(cfg, slots.main ?? null, ctx),

  audit_plan: (cfg, slots, ctx) =>
    patchApprove(cfg, slots.main ?? null, ctx),

  audit_protocol: (cfg, slots, ctx) =>
    patchApprove(cfg, slots.main ?? null, ctx),

  audit_report: (cfg, slots, ctx) =>
    patchApprove(cfg, slots.main ?? null, ctx),

  equipment_calibration: (cfg, slots, ctx) =>
    patchApprove(cfg, slots.main ?? null, ctx),

  equipment_maintenance: (cfg, slots, ctx) => {
    const u = slots.main ?? null;
    let next = patchApprove(cfg, u, ctx);
    next = patchResponsibleEmp(next, u);
    return next;
  },

  general_cleaning: (cfg, slots, ctx) => {
    // Pattern B (2 slots): supervisor (старший бригады) + manager (контроль)
    const supervisor = slots.supervisor ?? slots.main ?? null;
    const manager = slots.manager ?? supervisor;
    let next = patchApprove(cfg, manager, ctx);
    next = patchResponsibleEmp(next, supervisor);
    return next;
  },

  sanitary_day_control: (cfg, slots, ctx) => {
    const u = slots.main ?? null;
    let next = patchApprove(cfg, u, ctx);
    next = patchResponsibleEmp(next, u);
    return next;
  },

  glass_items_list: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null),

  glass_control: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null),

  climate_control: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null),

  cold_equipment_control: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null),

  disinfectant_usage: (cfg, slots) =>
    patchResponsibleEmp(cfg, slots.main ?? null),

  metal_impurity: (cfg, slots) =>
    patchResponsibleEmp(cfg, slots.main ?? null),

  traceability_test: (cfg, slots) =>
    patchResponsibleEmp(cfg, slots.main ?? null, "defaultResponsibleEmployeeId"),

  complaint_register: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  intensive_cooling: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  // Приёмка: вместе с человеком — его должность, иначе в карточке списка и
  // в новых строках стояла бы должность другого сотрудника.
  incoming_control: (cfg, slots, ctx) =>
    patchAcceptanceResponsible(cfg, slots.main ?? null, ctx),

  incoming_raw_materials_control: (cfg, slots, ctx) =>
    patchAcceptanceResponsible(cfg, slots.main ?? null, ctx),

  perishable_rejection: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  accident_journal: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  pest_control: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  med_books: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  // staff_training — основной ответственный (тренер) идёт в default;
  // строки документа пер-сотрудник, в каждой свой employeeId.
  staff_training: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  ppe_issuance: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultIssuerUserId"),

  // hygiene/health_check — отдельный «инспектор» в шапке (responsibleUserId
  // на JournalDocument уже стоит). В config обычно ничего не пишется,
  // но на всякий случай ставим default для row-уровня логики.
  hygiene: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  health_check: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  // uv-lamp / fryer-oil — у них может быть простая верхнеуровневая
  // ссылка на оператора. Оставляем универсальный «defaultResponsibleUserId».
  uv_lamp_runtime: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  fryer_oil: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  cleaning_ventilation_checklist: (cfg, slots) =>
    patchResponsibleUser(cfg, slots.main ?? null, "defaultResponsibleUserId"),

  // ═══════════════════════════════════════════════════════════════
  // Pattern B: 2 named users (supervisor + controller)
  // ═══════════════════════════════════════════════════════════════
  cleaning: (cfg, slots, ctx) => {
    const supervisor = slots.supervisor ?? slots.main ?? null;
    const controller = slots.controller ?? null;

    const cleaningResponsibles = asArr<ConfigObj>(
      (cfg as ConfigObj).cleaningResponsibles
    ).map((r) => ({ ...r }));
    const controlResponsibles = asArr<ConfigObj>(
      (cfg as ConfigObj).controlResponsibles
    ).map((r) => ({ ...r }));

    if (supervisor) {
      const supervisorName = ctx.getName(supervisor);
      const supervisorTitle = ctx.getPositionTitle(supervisor) || "Уборщик";
      if (cleaningResponsibles.length === 0) {
        cleaningResponsibles.push({
          id: `cleaning-resp-${randomUUID()}`,
          kind: "cleaning",
          title: supervisorTitle,
          userId: supervisor,
          userName: supervisorName,
          name: supervisorName,
          code: "C1",
        });
      } else {
        cleaningResponsibles[0] = {
          ...cleaningResponsibles[0],
          userId: supervisor,
          // ВАЖНО: userName — это поле, которое реально отображается в
          // <Cleaning…RowCard/> и printable таблице. Раньше patcher
          // писал только `name` → userName оставался от прошлого юзера
          // (или из defaultCleaningResponsibleIds — поэтому пользователь
          // видел случайного "Кузнецов" вместо реальной уборщицы Петровой).
          userName: supervisorName,
          name: supervisorName,
          // Title тоже обновляем — иначе при смене юзера осталась бы
          // старая должность ("Повар" даже когда юзер — "Уборщица").
          title: supervisorTitle,
        };
      }
    }
    if (controller) {
      const controllerName = ctx.getName(controller);
      const controllerTitle = ctx.getPositionTitle(controller) || "Контролёр";
      if (controlResponsibles.length === 0) {
        controlResponsibles.push({
          id: `control-resp-${randomUUID()}`,
          kind: "control",
          title: controllerTitle,
          userId: controller,
          userName: controllerName,
          name: controllerName,
          code: "C1",
        });
      } else {
        controlResponsibles[0] = {
          ...controlResponsibles[0],
          userId: controller,
          userName: controllerName,
          name: controllerName,
          title: controllerTitle,
        };
      }
    }
    return { ...cfg, cleaningResponsibles, controlResponsibles };
  },

  equipment_cleaning: (cfg, slots) => {
    const supervisor = slots.supervisor ?? slots.main ?? null;
    const controller = slots.controller ?? supervisor;
    const next: ConfigObj = { ...cfg };
    if (supervisor) next.washerUserId = supervisor;
    if (controller) next.controllerUserId = controller;
    return next;
  },

  // ═══════════════════════════════════════════════════════════════
  // Pattern C: 3-person commission
  // ═══════════════════════════════════════════════════════════════
  finished_product: (cfg, slots) => {
    // У бракеража готовой продукции в config пока нет фиксированного
    // committee-поля — ставим defaultResponsibleUserId как primary
    // (председатель), а остальных кладём как extras для будущего UI.
    // Состав комиссии живёт в config.commissionMembers (окно «Сторонняя
    // бракеражная комиссия»), слоты «Член комиссии» убраны.
    const chef = slots.chef ?? slots.main ?? null;
    const next: ConfigObj = { ...cfg };
    if (chef) {
      next.defaultResponsibleUserId = chef;
    }
    return next;
  },

  product_writeoff: (cfg, slots) => {
    const chef = slots.chef ?? slots.main ?? null;
    const next: ConfigObj = { ...cfg };
    if (chef) next.defaultResponsibleUserId = chef;
    next.commission = {
      chefUserId: slots.chef ?? null,
      storekeeperUserId: slots.storekeeper ?? null,
      managerUserId: slots.manager ?? null,
    };
    return next;
  },
};

/**
 * Главный entry — патчит config документа выбранного журнала. Если
 * patcher для кода не задан — возвращает null (не трогаем config).
 *
 * Возвращает уже-готовый JSON для записи в JournalDocument.config.
 */
export function patchDocumentConfig(
  journalCode: string,
  currentConfig: unknown,
  slots: SlotUserMap,
  ctx: DocPatcherCtx
): ConfigObj | null {
  const patcher = PATCHERS[journalCode];
  if (!patcher) return null;
  return patcher(asObj(currentConfig), slots, ctx);
}

export function hasDocumentConfigPatcher(journalCode: string): boolean {
  return journalCode in PATCHERS;
}
