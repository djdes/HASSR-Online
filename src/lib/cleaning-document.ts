import { buildDateKeys, coerceUtcDate, formatMonthLabel, isWeekend, toDateKey } from "@/lib/hygiene-document";
import { getCalendarDayKind } from "@/lib/production-calendar-data";
import {
  getUserRoleLabel,
  pickPrimaryManager,
  pickPrimaryStaff,
} from "@/lib/user-roles";

export const CLEANING_DOCUMENT_TEMPLATE_CODE = "cleaning";
export const CLEANING_PAGE_TITLE = "Журнал уборки";
export const CLEANING_DOCUMENT_TITLE = CLEANING_PAGE_TITLE;

export type CleaningActivityType = "disinfection" | "ventilation" | "wetCleaning";

export type CleaningScheduleItem = {
  times: string[];
  responsibleUserId: string | null;
};

export type CleaningProcedure = {
  surfaces: string;
  ventilationRooms: string;
  wetCleaningRooms: string;
  detergent: string;
};

export type CleaningResponsiblePerson = {
  userId: string;
  title: string;
};

export type CleaningActivityEntry = {
  type: CleaningActivityType;
  times: string[];
  responsibleName: string;
};

export type CleaningEntryData = {
  activities: CleaningActivityEntry[];
  /**
   * Поля для room-completion entries, которые пишет
   * `tasksflow-adapters/cleaning.ts` когда уборщица закрывает race-задачу.
   * Используются клиентом в `cellValue` чтобы отобразить код уборщика
   * (С1/С2/...) в ячейке matrix вместо planned-значения T/G.
   *
   * Старые legacy-entries (записи активностей) этих полей не имеют —
   * `kind` undefined → клиент их игнорирует и читает planned matrix.
   */
  kind?: "cleaning_room";
  /** Legacy single-room fields: always mirror the LAST completed room. */
  roomId?: string;
  dateKey?: string;
  cleanerUserId?: string;
  completedAt?: string;
  /**
   * 2026-09: one cleaner may finish several rooms on the same day, but
   * the entry is unique per (documentId, employeeId, date). All rooms of
   * the day live here; `roomId`/`completedAt` above stay in sync with the
   * most recent one for old readers. Read via `listCleaningRoomCompletions`.
   */
  rooms?: Record<string, CleaningRoomCompletion>;
};

export type CleaningRoomCompletion = {
  completedAt: string;
  controllerUserId?: string;
  controllerCompletedAt?: string;
};

export type CleaningRoomCompletionView = CleaningRoomCompletion & {
  roomId: string;
  cleanerUserId: string;
  dateKey: string;
};

/**
 * Flattens a `cleaning_room` entry into one item per completed room.
 * Handles both the new `rooms` map and legacy single-room entries.
 * Non-completion entries (activities) yield an empty list.
 */
export function listCleaningRoomCompletions(
  value: unknown,
): CleaningRoomCompletionView[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (record.kind !== "cleaning_room") return [];
  const cleanerUserId =
    typeof record.cleanerUserId === "string" ? record.cleanerUserId : "";
  const dateKey = typeof record.dateKey === "string" ? record.dateKey : "";
  const out: CleaningRoomCompletionView[] = [];
  const rooms = record.rooms;
  if (rooms && typeof rooms === "object" && !Array.isArray(rooms)) {
    for (const [roomId, raw] of Object.entries(rooms as Record<string, unknown>)) {
      if (!roomId || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const r = raw as Record<string, unknown>;
      out.push({
        roomId,
        cleanerUserId,
        dateKey,
        completedAt: typeof r.completedAt === "string" ? r.completedAt : "",
        controllerUserId:
          typeof r.controllerUserId === "string" ? r.controllerUserId : undefined,
        controllerCompletedAt:
          typeof r.controllerCompletedAt === "string"
            ? r.controllerCompletedAt
            : undefined,
      });
    }
  }
  if (out.length === 0 && typeof record.roomId === "string" && record.roomId) {
    out.push({
      roomId: record.roomId,
      cleanerUserId,
      dateKey,
      completedAt: typeof record.completedAt === "string" ? record.completedAt : "",
      controllerUserId:
        typeof record.controllerUserId === "string" ? record.controllerUserId : undefined,
      controllerCompletedAt:
        typeof record.controllerCompletedAt === "string"
          ? record.controllerCompletedAt
          : undefined,
    });
  }
  return out;
}

/**
 * Adds/overwrites one room in a `cleaning_room` entry `data`, keeping the
 * legacy single-room fields pointed at the room just written.
 */
export function mergeCleaningRoomCompletion(
  prev: unknown,
  args: { roomId: string; cleanerUserId: string; dateKey: string; completedAt: string },
): Record<string, unknown> {
  const base =
    prev && typeof prev === "object" && !Array.isArray(prev)
      ? (prev as Record<string, unknown>)
      : {};
  const rooms: Record<string, CleaningRoomCompletion> = {};
  for (const c of listCleaningRoomCompletions({ ...base, kind: "cleaning_room" })) {
    rooms[c.roomId] = {
      completedAt: c.completedAt,
      ...(c.controllerUserId ? { controllerUserId: c.controllerUserId } : {}),
      ...(c.controllerCompletedAt
        ? { controllerCompletedAt: c.controllerCompletedAt }
        : {}),
    };
  }
  rooms[args.roomId] = { completedAt: args.completedAt };
  return {
    ...base,
    kind: "cleaning_room",
    roomId: args.roomId,
    dateKey: args.dateKey,
    cleanerUserId: args.cleanerUserId,
    completedAt: args.completedAt,
    rooms,
  };
}

export type CleaningResponsibleKind = "cleaning" | "control";

export type CleaningResponsible = {
  id: string;
  kind: CleaningResponsibleKind;
  title: string;
  userId: string;
  userName: string;
  code: string;
};

export type CleaningRoomItem = {
  id: string;
  areaId: string | null;
  name: string;
  detergent: string;
  currentScope: string[];
  generalScope: string[];
  /// Bitmask дней недели когда проводится ТЕКУЩАЯ уборка.
  /// bit 0 = Пн, ... bit 6 = Вс. См. src/lib/weekday-mask.ts.
  /// По умолчанию 127 (ежедневно).
  currentDays?: number;
  /// Bitmask дней недели когда проводится ГЕНЕРАЛЬНАЯ уборка.
  /// По умолчанию 0 (не запланировано — задаётся вручную в матрице).
  generalDays?: number;
};

export type CleaningMatrixValue = string;
export type CleaningMatrixMap = Record<string, Record<string, CleaningMatrixValue>>;

/**
 * Структура одного шага pipeline'а (currentScope/generalScope item).
 *
 * Обратная совместимость: legacy-формат — `string` (только label, без
 * флага фото). Новый формат — `{ label, requirePhoto? }`. parseScopeStep
 * нормализует оба варианта в единый объект.
 *
 * Effective-requirePhoto в TF-pipeline:
 *   step.requirePhoto === true  → photoMode='required' независимо от room
 *   step.requirePhoto === false → photoMode='optional' независимо от room
 *   step.requirePhoto === undefined → fallback на room.requirePhoto
 *
 * Это даёт менеджеру 3-stage UX:
 *   1) master-toggle на помещение (default для всех шагов)
 *   2) явный override per-step (camera-button рядом с шагом)
 *   3) untouched шаги наследуют master
 */
export type ScopeStep = {
  label: string;
  requirePhoto?: boolean;
};

export function parseScopeStep(raw: unknown): ScopeStep | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? { label: trimmed } : null;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (label.length === 0) return null;
    const out: ScopeStep = { label };
    if (typeof r.requirePhoto === "boolean") out.requirePhoto = r.requirePhoto;
    return out;
  }
  return null;
}

export function parseScopeSteps(raw: unknown): ScopeStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseScopeStep).filter((s): s is ScopeStep => s !== null);
}

/**
 * Возвращает effective requirePhoto для шага: explicit step.requirePhoto
 * (если задан) либо fallback на room.requirePhoto.
 */
export function effectiveStepRequirePhoto(
  step: ScopeStep,
  roomRequirePhoto: boolean,
): boolean {
  if (typeof step.requirePhoto === "boolean") return step.requirePhoto;
  return roomRequirePhoto;
}

export type CleaningResponsiblePair = {
  id: string;
  cleaningTitle: string;
  cleaningUserId: string | null;
  cleaningUserName: string;
  controlTitle: string;
  controlUserId: string | null;
  controlUserName: string;
};

export type CleaningReferenceRow = {
  id: string;
  roomId: string;
  name: string;
  detergent: string;
  currentScope: string[];
  generalScope: string[];
};

export type CleaningDocumentSettings = {
  autoFillEnabled: boolean;
  skipWeekends: boolean;
  fillUntilToday: boolean;
};

export type CleaningAutoFillSettings = {
  enabled: boolean;
  skipWeekends: boolean;
  fillUntilToday: boolean;
  defaultRoomMark: CleaningMatrixValue;
};

export type CleaningDocumentConfig = {
  title: string;
  documentTitle: string;
  settings: CleaningDocumentSettings;
  autoFill: CleaningAutoFillSettings;
  responsiblePairs: CleaningResponsiblePair[];
  rooms: CleaningRoomItem[];
  legend: string[];
  referenceTable: CleaningReferenceRow[];
  matrix: CleaningMatrixMap;
  ventilationEnabled: boolean;
  skipWeekends: boolean;
  schedule: {
    disinfection: CleaningScheduleItem;
    ventilation: CleaningScheduleItem;
    wetCleaning: CleaningScheduleItem;
  };
  procedure: CleaningProcedure;
  responsiblePersons: CleaningResponsiblePerson[];
  periodicity: {
    disinfectionPerDay: number;
    ventilationPerDay: number;
    wetCleaningPerDay: number;
  };
  cleaningResponsibles: CleaningResponsible[];
  controlResponsibles: CleaningResponsible[];
  marks: CleaningMatrixMap;
  /// Режим раздачи задач:
  ///   "pairs"  — старый: 1 задача на пару (cleaner+control), на день.
  ///   "rooms"  — новый: 1 race-задача на каждое помещение в день,
  ///              которую может закрыть любой из selectedCleanerUserIds.
  ///              Контролёр получает один agg-таск в конце дня.
  /// По умолчанию "pairs" — старые документы продолжают работать.
  cleaningMode?: "pairs" | "rooms";
  /// IDs зарегистрированных Room (см. /settings/buildings) которые
  /// участвуют в этом журнале. Используются только при cleaningMode="rooms".
  selectedRoomIds?: string[];
  /// IDs User-ов, которые могут забирать задачи на уборку (race).
  /// Только для cleaningMode="rooms".
  selectedCleanerUserIds?: string[];
  /// Закреплённый номер кода уборщика: userId → N (показывается как «СN»).
  /// Подпись в журнале ХАССП не должна менять владельца при смене состава,
  /// поэтому номер выдаётся один раз и больше не переиспользуется: уволенный
  /// уборщик уносит свой номер с собой, новый получает следующий свободный.
  cleanerCodeByUserId?: Record<string, number>;
  /// Снимок имени на момент закрепления кода. Нужен для легенды: уволенный
  /// уборщик в ростер уже не приходит, а его подписи в журнале остаются.
  cleanerNameByUserId?: Record<string, string>;
  /// То же для контролёров (строка «Контролёр»).
  controlCodeByUserId?: Record<string, number>;
  controlNameByUserId?: Record<string, string>;
  /// Режим распределения уборщиков по комнатам (только rooms-mode):
  ///   • false (default) — round-robin: на каждую комнату ровно ОДИН
  ///     уборщик (cleaners[i % cleaners.length]). Маркова делает 0,2,4,
  ///     Захаров делает 1,3,5. Каждый знает свой набор.
  ///   • true — race: на каждую комнату создаётся task для КАЖДОГО
  ///     выбранного уборщика. Кто первый закроет — у остальных задача
  ///     уходит в «выполнено другим». Подходит для гибких смен где
  ///     уборщица сама выбирает что делать.
  ///
  /// Технически: при true адаптер генерирует rooms × cleaners rows,
  /// все с rowKey 'room::<roomId>::cleaner::<uid>'. selectRowsForBulkAssign
  /// сохраняет все (Pass 1 dedupe by rowKey не userId), TF создаёт
  /// task на каждого. claimedByWorkerId отметит «занято» у остальных.
  roomsRaceMode?: boolean;
  /// Per-room контролёры — разные supervisor'ы для разных комнат.
  /// Map roomId → userId. Если для комнаты нет записи — fallback на
  /// document-wide controlUserId. Используется в rooms-mode когда
  /// например, кухню проверяет шеф, а гостевую зону — заведующая.
  ///
  /// Технически при bulk-assign cleaning адаптер прокидывает
  /// verifierUserId per-row через AdapterRow.verifierUserId, и
  /// bulk-assign создаёт supervisor-task на этого юзера вместо
  /// document-wide.
  ///
  /// 2026-09-04: список (несколько проверяющих у помещения). Первый —
  /// проверяющий задачи в TF, все — получают вечернюю сводку по своим
  /// помещениям. Источник — Room.verifierUserIds, подмешивается в
  /// эффективный конфиг через applyRoomResponsiblesToConfig
  /// (src/lib/cleaning-room-responsibles.ts). Legacy string → [string].
  verifierByRoomId?: Record<string, string[]>;
  /// 2026-09: закрепление зон «по желанию». roomId → уборщики зоны
  /// (подмножество selectedCleanerUserIds). Один id — зона закреплена,
  /// несколько — гонка внутри зоны. Комната без записи → пул как раньше
  /// (race / round-robin). См. resolveRoomCleaners.
  cleanerByRoomId?: Record<string, string[]>;
  /// User-id ответственного за контроль. В rooms-режиме он получает
  /// одну сводную задачу в конце дня. Используется как fallback если
  /// для конкретной комнаты нет записи в verifierByRoomId.
  controlUserId?: string | null;
  /// Режим pipeline'а (подзадач в TasksFlow):
  ///   "perRoom" (default) — у каждого помещения свой список шагов
  ///                          (currentScope/generalScope в CleaningRoomItem).
  ///                          Используется когда уборка разная по цехам.
  ///   "global"            — один общий список для ВСЕХ помещений
  ///                          (`globalSubtasks` ниже). Используется когда
  ///                          протокол одинаковый для каждой комнаты.
  ///   "legacy"            — без подзадач, сотрудник просто отмечает
  ///                          «выполнено» в TasksFlow без чек-листа.
  cleaningSubtaskMode?: "perRoom" | "global" | "legacy";
  /// Общий список подзадач (для cleaningSubtaskMode === "global").
  /// Если режим другой — поле игнорируется. По умолчанию пустое.
  globalSubtasks?: {
    current: string[];
    general: string[];
  };
};

type UserLike = {
  id: string;
  name: string;
  role: string;
};

type AreaLike = {
  id: string;
  name: string;
};

type NormalizationContext = {
  users?: UserLike[];
  areas?: AreaLike[];
};

type LegacyResponsibleDefaults = {
  responsibleCleaningUserId?: string | null;
  responsibleControlUserId?: string | null;
};

// DEFAULT_ROOM_BLUEPRINTS — стартовые помещения для нового журнала уборки.
// currentScope/generalScope ПУСТЫЕ — менеджер заполняет вручную через
// диалог редактирования помещения (или подгружает из шаблона по умолчанию).
// Раньше тут были hard-coded шаги «Пол / Стеллажи / Полки», но это путало
// пользователей с другим типом производства (пекарня, бар, мясокомбинат)
// и не отражало их реальные процедуры — теперь стартуем с чистого листа.
// Если орга сохранила свой шаблон через «Сохранить как шаблон» — он
// подменит этот fallback (см. journal-documents/route.ts).
const DEFAULT_ROOM_BLUEPRINTS = [
  {
    name: "гостевая зона",
    detergent: "",
    currentScope: [] as string[],
    generalScope: [] as string[],
  },
  {
    name: "помещение мойки",
    detergent: "",
    currentScope: [] as string[],
    generalScope: [] as string[],
  },
  {
    name: "горячий цех/кухня",
    detergent: "",
    currentScope: [] as string[],
    generalScope: [] as string[],
  },
  {
    name: "Бар",
    detergent: "",
    currentScope: [] as string[],
    generalScope: [] as string[],
  },
] as const;

export const CLEANING_SCOPE_OPTIONS = Array.from(
  new Set(DEFAULT_ROOM_BLUEPRINTS.flatMap((item) => [...item.currentScope, ...item.generalScope]))
);

/**
 * Обозначение «уборка не проводилась». В matrix хранится односимвольный
 * "/" (менять сторадж нельзя — на него завязаны TF-override sync, autoFill
 * и planRoomMonth), а показываем и в ячейке, и в легенде «/-/» как на
 * эталоне (cleaning-07-grid-with-room.png).
 */
export const CLEANING_NOT_PERFORMED_DISPLAY = "/-/";

export const CLEANING_LEGEND = [
  `${CLEANING_NOT_PERFORMED_DISPLAY} — Уборка не проводилась`,
  "Т — Текущая",
  "Г — Генеральная; при генеральной уборке выполняется уборка поверхностей, указанных в текущей уборке, а также промываются стены за оборудованием, вентиляционные зонты при наличии и т.д.",
] as const;

export const CLEANING_MARK_OPTIONS = [
  { value: "" as CleaningMatrixValue, code: "", label: "Пусто" },
  { value: "T" as CleaningMatrixValue, code: "Т", label: "Текущая" },
  { value: "G" as CleaningMatrixValue, code: "Г", label: "Генеральная" },
  { value: "/" as CleaningMatrixValue, code: "/", label: "Не проводилась" },
] as const;

/**
 * Перевод стораджевого Latin-кода ('T'/'G') в кириллический символ для UI.
 * Сторадж остаётся Latin для совместимости со всем существующим кодом
 * (TasksFlow override-sync, planRoomMonth, autoFill defaults и т.д.).
 * Дисплей в Cyrillic чтобы Г/К в одной таблице с С1/С2 (Cyrillic) выглядели
 * однородно — менеджер видел только русские буквы.
 *
 * Sentinel "—" (em dash) — явно очищенная менеджером ячейка. Хранится
 * в matrix чтобы перебить completion-fallback (без него после G→/→delete
 * клетка возвращалась к "Т" от completion, и менеджер не мог достичь
 * визуальной пустоты). В UI отображается как пустая строка.
 */
export const CLEANING_EMPTY_SENTINEL = "—";

export function displayMatrixValue(value: string): string {
  if (value === "T") return "Т";
  if (value === "G") return "Г";
  if (value === CLEANING_EMPTY_SENTINEL) return "";
  if (value === "/") return CLEANING_NOT_PERFORMED_DISPLAY;
  return value;
}

/**
 * Легенда документа хранится строками в config.legend, поэтому у старых
 * документов там лежит «/ — Уборка не проводилась». Мигрировать данные
 * не нужно — правим только ОТОБРАЖЕНИЕ.
 */
export function displayLegendLine(line: string): string {
  return line.startsWith("/ ")
    ? `${CLEANING_NOT_PERFORMED_DISPLAY}${line.slice(1)}`
    : line;
}

export const ACTIVITY_LABELS: Record<CleaningActivityType, string> = {
  disinfection: "Дезинфекция",
  ventilation: "Проветривание",
  wetCleaning: "Влажная уборка",
};

function createId(prefix: string) {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

function normalizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDateKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function normalizeMatrixValue(value: unknown): CleaningMatrixValue {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cloneMatrix(value: CleaningMatrixMap): CleaningMatrixMap {
  const next: CleaningMatrixMap = {};
  for (const [rowId, row] of Object.entries(value)) {
    next[rowId] = { ...row };
  }
  return next;
}

function normalizeRoomLike(value: unknown, fallback: CleaningRoomItem): CleaningRoomItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const record = value as Record<string, unknown>;
  // Weekday-mask: 0..127 integer; fallback на defaults (текущая=ежедневно, генеральная=не запланировано).
  const normalizeDayMask = (raw: unknown, fb: number) => {
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 127) return raw;
    return fb;
  };
  return {
    id: normalizeText(record.id, fallback.id),
    areaId: normalizeText(record.areaId) || fallback.areaId,
    name: normalizeText(record.name ?? record.roomName, fallback.name),
    detergent: normalizeText(record.detergent, fallback.detergent),
    currentScope: normalizeStringArray(record.currentScope).length
      ? normalizeStringArray(record.currentScope)
      : [...fallback.currentScope],
    generalScope: normalizeStringArray(record.generalScope).length
      ? normalizeStringArray(record.generalScope)
      : [...fallback.generalScope],
    currentDays: normalizeDayMask(record.currentDays, fallback.currentDays ?? 127),
    generalDays: normalizeDayMask(record.generalDays, fallback.generalDays ?? 0),
  };
}

function buildDefaultRooms(areas?: AreaLike[]): CleaningRoomItem[] {
  if (!areas || areas.length === 0) {
    return DEFAULT_ROOM_BLUEPRINTS.map((blueprint, index) => ({
      id: createId(`cleaning-room-${index + 1}`),
      areaId: null,
      name: blueprint.name,
      detergent: blueprint.detergent,
      currentScope: [...blueprint.currentScope],
      generalScope: [...blueprint.generalScope],
      currentDays: 127, // ежедневно
      generalDays: 0,   // не запланировано (задаётся вручную в матрице)
    }));
  }

  return areas.map((area, index) => {
    const blueprint = DEFAULT_ROOM_BLUEPRINTS[index % DEFAULT_ROOM_BLUEPRINTS.length];
    return {
      id: createId(`cleaning-room-${index + 1}`),
      areaId: area.id,
      name: area.name,
      detergent: blueprint.detergent,
      currentScope: [...blueprint.currentScope],
      generalScope: [...blueprint.generalScope],
      currentDays: 127,
      generalDays: 0,
    };
  });
}

function getPrimaryCleaningUser(users?: UserLike[]) {
  if (!users || users.length === 0) return null;
  return pickPrimaryStaff(users);
}

function getPrimaryControlUser(users?: UserLike[], excludeUserId?: string | null) {
  if (!users || users.length === 0) return null;
  const availableUsers = users.filter((user) => user.id !== excludeUserId);
  return pickPrimaryManager(availableUsers) || availableUsers[0] || users[0];
}

function getRoleTitle(role: string, fallback: string) {
  return normalizeText(getUserRoleLabel(role), fallback) || fallback;
}

function buildDefaultCleaningResponsible(
  user: UserLike | null,
  index: number,
  fallbackTitle: string
): CleaningResponsible {
  return {
    id: createId("cleaning-cleaning"),
    kind: "cleaning",
    title: user ? getRoleTitle(user.role, fallbackTitle) : fallbackTitle,
    userId: user?.id || "",
    userName: user?.name || "",
    code: `C${index + 1}`,
  };
}

function buildDefaultControlResponsible(
  user: UserLike | null,
  index: number,
  fallbackTitle: string
): CleaningResponsible {
  return {
    id: createId("cleaning-control"),
    kind: "control",
    title: user ? getRoleTitle(user.role, fallbackTitle) : fallbackTitle,
    userId: user?.id || "",
    userName: user?.name || "",
    code: `C${index + 1}`,
  };
}

function reindexResponsibles(items: CleaningResponsible[]) {
  return items.map((item, index) => ({
    ...item,
    code: `C${index + 1}`,
  }));
}

function normalizeResponsibleArray(
  kind: CleaningResponsibleKind,
  value: unknown,
  users?: UserLike[],
  fallbackTitle?: string
): CleaningResponsible[] {
  if (!Array.isArray(value)) return [];

  const fallback = fallbackTitle || (kind === "control" ? "Ответственный за контроль" : "Ответственный за уборку");
  const items = value
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item)
    )
    .map((item, index) => {
      const userId = normalizeText(item.userId);
      const user = users?.find((candidate) => candidate.id === userId) || null;
      return {
        id: normalizeText(item.id, createId(`cleaning-${kind}`)),
        kind,
        title: normalizeText(item.title, fallback),
        userId,
        userName: normalizeText(item.userName, user?.name || ""),
        code: normalizeText(item.code, `C${index + 1}`),
      };
    })
    .filter((item) => item.userId || item.userName || item.title);

  return reindexResponsibles(items);
}

function buildDefaultSchedule(cleaningResponsibles: CleaningResponsible[], controlResponsibles: CleaningResponsible[]) {
  const cleaningUserId = cleaningResponsibles[0]?.userId || null;
  const controlUserId = controlResponsibles[0]?.userId || cleaningUserId;

  return {
    disinfection: {
      times: ["14:00", "12:00", "23:00"],
      responsibleUserId: cleaningUserId,
    },
    ventilation: {
      times: ["12:00", "10:00", "23:00"],
      responsibleUserId: controlUserId,
    },
    wetCleaning: {
      times: ["12:00", "18:00"],
      responsibleUserId: cleaningUserId,
    },
  };
}

function buildCompatibilityProcedure(rooms: CleaningRoomItem[]): CleaningProcedure {
  return {
    surfaces: rooms.flatMap((room) => room.currentScope).slice(0, 6).join(", "),
    ventilationRooms: rooms.map((room) => room.name).join(", "),
    wetCleaningRooms: rooms.map((room) => room.name).join(", "),
    detergent: rooms
      .map((room) => room.detergent)
      .filter(Boolean)
      .join("; "),
  };
}

function buildCompatibilityResponsiblePersons(config: {
  cleaningResponsibles: CleaningResponsible[];
  controlResponsibles: CleaningResponsible[];
}) {
  return [...config.cleaningResponsibles, ...config.controlResponsibles]
    .filter((item) => item.userId || item.userName)
    .map((item) => ({
      userId: item.userId,
      title: item.title,
    }));
}

function buildReferenceTable(rooms: CleaningRoomItem[]): CleaningReferenceRow[] {
  return rooms.map((room) => ({
    id: createId("cleaning-reference"),
    roomId: room.id,
    name: room.name,
    detergent: room.detergent,
    currentScope: [...room.currentScope],
    generalScope: [...room.generalScope],
  }));
}

function buildResponsiblePairs(
  cleaningResponsibles: CleaningResponsible[],
  controlResponsibles: CleaningResponsible[]
): CleaningResponsiblePair[] {
  const max = Math.max(cleaningResponsibles.length, controlResponsibles.length, 1);
  const pairs: CleaningResponsiblePair[] = [];

  for (let index = 0; index < max; index += 1) {
    const cleaning = cleaningResponsibles[index] || cleaningResponsibles[0] || null;
    const control = controlResponsibles[index] || controlResponsibles[0] || null;

    pairs.push({
      id: createId("cleaning-pair"),
      cleaningTitle: cleaning?.title || "Ответственный за уборку",
      cleaningUserId: cleaning?.userId || null,
      cleaningUserName: cleaning?.userName || "",
      controlTitle: control?.title || "Ответственный за контроль",
      controlUserId: control?.userId || null,
      controlUserName: control?.userName || "",
    });
  }

  return pairs;
}

function normalizeLegend(value: unknown): string[] {
  if (!Array.isArray(value)) return [...CLEANING_LEGEND];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeMatrix(value: unknown): CleaningMatrixMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: CleaningMatrixMap = {};
  for (const [rowId, rowValue] of Object.entries(value as Record<string, unknown>)) {
    if (!rowValue || typeof rowValue !== "object" || Array.isArray(rowValue)) continue;

    const normalizedRow: Record<string, CleaningMatrixValue> = {};
    for (const [dateKey, cellValue] of Object.entries(rowValue as Record<string, unknown>)) {
      const safeDateKey = normalizeDateKey(dateKey);
      if (!safeDateKey) continue;
      normalizedRow[safeDateKey] = normalizeMatrixValue(cellValue);
    }

    result[rowId] = normalizedRow;
  }

  return result;
}

function normalizeRooms(
  value: unknown,
  areas?: AreaLike[],
  /**
   * C1: Room-first документ ОСОЗНАННО держит `rooms: []` — строки берутся
   * из таблицы `Room`. Без этого флага пустой массив трактовался как
   * «данных нет» и подменялся blueprint'ами, из-за чего в матрице
   * появлялись дубли «гостевая зона / помещение мойки / …» поверх
   * настоящих помещений.
   */
  allowEmpty = false,
) {
  const defaults = buildDefaultRooms(areas);
  if (!Array.isArray(value)) return defaults;
  if (value.length === 0) return allowEmpty ? [] : defaults;

  const rooms = value
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item)
    )
    .map((item, index) => normalizeRoomLike(item, defaults[index % defaults.length] || defaults[0]))
    .filter((room) => room.name);

  return rooms.length > 0 ? rooms : defaults;
}

function buildBaseConfig(users?: UserLike[], areas?: AreaLike[]): CleaningDocumentConfig {
  const rooms = buildDefaultRooms(areas);
  const primaryCleaning = getPrimaryCleaningUser(users);
  const primaryControl = getPrimaryControlUser(users, primaryCleaning?.id || null);

  const cleaningResponsibles = reindexResponsibles([
    buildDefaultCleaningResponsible(primaryCleaning, 0, "Ответственный за уборку"),
  ]);
  const controlResponsibles = reindexResponsibles([
    buildDefaultControlResponsible(primaryControl, 0, "Ответственный за контроль"),
  ]);
  const referenceTable = buildReferenceTable(rooms);
  const responsiblePairs = buildResponsiblePairs(cleaningResponsibles, controlResponsibles);

  return {
    title: CLEANING_PAGE_TITLE,
    documentTitle: CLEANING_PAGE_TITLE,
    settings: {
      // Автозаполнение по умолчанию выключено: новый документ
      // создаётся «чистым», менеджер сам включает автозаполнение
      // когда убедился что responsibles и расписание настроены.
      autoFillEnabled: false,
      skipWeekends: false,
      fillUntilToday: true,
    },
    autoFill: {
      enabled: false,
      skipWeekends: false,
      fillUntilToday: true,
      defaultRoomMark: "T",
    },
    // Cleaning unification 2026-05-08, Stage 8: новые документы по
    // умолчанию в rooms-mode (1 задача на помещение). Старые pairs-mode
    // документы продолжают работать через explicit cleaningMode='pairs'
    // в config (нормализация сохраняет их как есть). См. spec
    // docs/superpowers/specs/2026-05-08-cleaning-unification.md
    cleaningMode: "rooms",
    responsiblePairs,
    rooms,
    legend: [...CLEANING_LEGEND],
    referenceTable,
    matrix: {},
    ventilationEnabled: true,
    skipWeekends: false,
    schedule: buildDefaultSchedule(cleaningResponsibles, controlResponsibles),
    procedure: buildCompatibilityProcedure(rooms),
    responsiblePersons: buildCompatibilityResponsiblePersons({
      cleaningResponsibles,
      controlResponsibles,
    }),
    periodicity: {
      disinfectionPerDay: 3,
      ventilationPerDay: 3,
      wetCleaningPerDay: 2,
    },
    cleaningResponsibles,
    controlResponsibles,
    marks: {},
  };
}

function syncCompatibilityFields(config: CleaningDocumentConfig): CleaningDocumentConfig {
  const title = normalizeText(config.title || config.documentTitle, CLEANING_PAGE_TITLE) || CLEANING_PAGE_TITLE;
  // C1: в Room-first конфиге (режим "rooms" + выбранные помещения)
  // пустой `rooms` — норма: строки собираются из таблицы Room. Подмена
  // на blueprint'ы возвращала бы дубли строк в матрице и справочнике.
  const isRoomFirst =
    config.cleaningMode === "rooms" &&
    Array.isArray(config.selectedRoomIds) &&
    config.selectedRoomIds.length > 0;
  const rooms =
    config.rooms.length > 0 ? config.rooms : isRoomFirst ? [] : buildDefaultRooms();
  const cleaningResponsibles =
    config.cleaningResponsibles.length > 0
      ? reindexResponsibles(config.cleaningResponsibles)
      : reindexResponsibles([buildDefaultCleaningResponsible(null, 0, "Ответственный за уборку")]);
  const controlResponsibles =
    config.controlResponsibles.length > 0
      ? reindexResponsibles(config.controlResponsibles)
      : reindexResponsibles([buildDefaultControlResponsible(null, 0, "Ответственный за контроль")]);
  const matrix = cloneMatrix(config.matrix || config.marks || {});
  const settings = {
    autoFillEnabled:
      config.settings?.autoFillEnabled ??
      config.autoFill?.enabled ??
      config.ventilationEnabled ??
      true,
    skipWeekends:
      config.settings?.skipWeekends ??
      config.autoFill?.skipWeekends ??
      config.skipWeekends ??
      false,
    fillUntilToday:
      config.settings?.fillUntilToday ?? config.autoFill?.fillUntilToday ?? true,
  };
  const autoFill = {
    enabled: config.autoFill?.enabled ?? settings.autoFillEnabled,
    skipWeekends: config.autoFill?.skipWeekends ?? settings.skipWeekends,
    fillUntilToday: config.autoFill?.fillUntilToday ?? settings.fillUntilToday,
    defaultRoomMark: normalizeMatrixValue(config.autoFill?.defaultRoomMark || "T") || "T",
  };
  const referenceTable = config.referenceTable.length > 0 ? config.referenceTable : buildReferenceTable(rooms);
  const responsiblePairs =
    config.responsiblePairs.length > 0
      ? config.responsiblePairs.map((pair, index) => ({
          id: normalizeText(pair.id, createId("cleaning-pair")),
          cleaningTitle: normalizeText(pair.cleaningTitle, cleaningResponsibles[index]?.title || "Ответственный за уборку"),
          cleaningUserId: pair.cleaningUserId || cleaningResponsibles[index]?.userId || null,
          cleaningUserName: normalizeText(pair.cleaningUserName, cleaningResponsibles[index]?.userName || ""),
          controlTitle: normalizeText(pair.controlTitle, controlResponsibles[index]?.title || "Ответственный за контроль"),
          controlUserId: pair.controlUserId || controlResponsibles[index]?.userId || null,
          controlUserName: normalizeText(pair.controlUserName, controlResponsibles[index]?.userName || ""),
        }))
      : buildResponsiblePairs(cleaningResponsibles, controlResponsibles);
  const schedule = config.schedule || buildDefaultSchedule(cleaningResponsibles, controlResponsibles);
  const procedure = config.procedure || buildCompatibilityProcedure(rooms);
  const responsiblePersons =
    config.responsiblePersons.length > 0
      ? config.responsiblePersons
      : buildCompatibilityResponsiblePersons({ cleaningResponsibles, controlResponsibles });
  const periodicity =
    config.periodicity || {
      disinfectionPerDay: 3,
      ventilationPerDay: 3,
      wetCleaningPerDay: 2,
    };
  const legend = config.legend.length > 0 ? [...config.legend] : [...CLEANING_LEGEND];

  return {
    ...config,
    title,
    documentTitle: title,
    settings,
    autoFill,
    responsiblePairs,
    rooms,
    legend,
    referenceTable,
    matrix,
    ventilationEnabled: config.ventilationEnabled ?? true,
    skipWeekends: settings.skipWeekends,
    schedule,
    procedure,
    responsiblePersons,
    periodicity,
    cleaningResponsibles,
    controlResponsibles,
    marks: matrix,
  };
}

function normalizeResponsiblePairs(
  value: unknown,
  cleaningResponsibles: CleaningResponsible[],
  controlResponsibles: CleaningResponsible[],
  users?: UserLike[]
): CleaningResponsiblePair[] {
  if (!Array.isArray(value) || value.length === 0) {
    return buildResponsiblePairs(cleaningResponsibles, controlResponsibles);
  }

  const result = value
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item)
    )
    .map((item, index) => {
      const cleaningUserId = normalizeText(item.cleaningUserId);
      const controlUserId = normalizeText(item.controlUserId);
      const cleaningUser = users?.find((user) => user.id === cleaningUserId) || null;
      const controlUser = users?.find((user) => user.id === controlUserId) || null;

      return {
        id: normalizeText(item.id, createId("cleaning-pair")),
        cleaningTitle: normalizeText(
          item.cleaningTitle,
          cleaningResponsibles[index]?.title || "Ответственный за уборку"
        ),
        cleaningUserId: cleaningUserId || cleaningResponsibles[index]?.userId || null,
        cleaningUserName: normalizeText(
          item.cleaningUserName,
          cleaningUser?.name || cleaningResponsibles[index]?.userName || ""
        ),
        controlTitle: normalizeText(
          item.controlTitle,
          controlResponsibles[index]?.title || "Ответственный за контроль"
        ),
        controlUserId: controlUserId || controlResponsibles[index]?.userId || null,
        controlUserName: normalizeText(
          item.controlUserName,
          controlUser?.name || controlResponsibles[index]?.userName || ""
        ),
      };
    });

  return result.length > 0 ? result : buildResponsiblePairs(cleaningResponsibles, controlResponsibles);
}

function normalizeSchedule(
  value: unknown,
  defaults: ReturnType<typeof buildDefaultSchedule>
): CleaningDocumentConfig["schedule"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const record = value as Record<string, unknown>;
  const normalizeItem = (item: unknown, fallback: CleaningScheduleItem): CleaningScheduleItem => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fallback;
    const itemRecord = item as Record<string, unknown>;
    return {
      times: normalizeStringArray(itemRecord.times).length
        ? normalizeStringArray(itemRecord.times)
        : [...fallback.times],
      responsibleUserId:
        typeof itemRecord.responsibleUserId === "string" && itemRecord.responsibleUserId.trim() !== ""
          ? itemRecord.responsibleUserId
          : fallback.responsibleUserId,
    };
  };

  return {
    disinfection: normalizeItem(record.disinfection, defaults.disinfection),
    ventilation: normalizeItem(record.ventilation, defaults.ventilation),
    wetCleaning: normalizeItem(record.wetCleaning, defaults.wetCleaning),
  };
}

function normalizeProcedure(value: unknown, rooms: CleaningRoomItem[]): CleaningProcedure {
  const fallback = buildCompatibilityProcedure(rooms);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;

  const record = value as Record<string, unknown>;
  return {
    surfaces: normalizeText(record.surfaces, fallback.surfaces),
    ventilationRooms: normalizeText(record.ventilationRooms, fallback.ventilationRooms),
    wetCleaningRooms: normalizeText(record.wetCleaningRooms, fallback.wetCleaningRooms),
    detergent: normalizeText(record.detergent, fallback.detergent),
  };
}

function normalizePeriodicity(value: unknown) {
  const fallback = {
    disinfectionPerDay: 3,
    ventilationPerDay: 3,
    wetCleaningPerDay: 2,
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  return {
    disinfectionPerDay:
      typeof record.disinfectionPerDay === "number"
        ? record.disinfectionPerDay
        : fallback.disinfectionPerDay,
    ventilationPerDay:
      typeof record.ventilationPerDay === "number"
        ? record.ventilationPerDay
        : fallback.ventilationPerDay,
    wetCleaningPerDay:
      typeof record.wetCleaningPerDay === "number"
        ? record.wetCleaningPerDay
        : fallback.wetCleaningPerDay,
  };
}

function cloneConfig(config: CleaningDocumentConfig): CleaningDocumentConfig {
  return {
    ...config,
    settings: { ...config.settings },
    autoFill: { ...config.autoFill },
    responsiblePairs: config.responsiblePairs.map((pair) => ({ ...pair })),
    rooms: config.rooms.map((room) => ({
      ...room,
      currentScope: [...room.currentScope],
      generalScope: [...room.generalScope],
    })),
    legend: [...config.legend],
    referenceTable: config.referenceTable.map((row) => ({
      ...row,
      currentScope: [...row.currentScope],
      generalScope: [...row.generalScope],
    })),
    matrix: cloneMatrix(config.matrix),
    schedule: {
      disinfection: {
        times: [...config.schedule.disinfection.times],
        responsibleUserId: config.schedule.disinfection.responsibleUserId,
      },
      ventilation: {
        times: [...config.schedule.ventilation.times],
        responsibleUserId: config.schedule.ventilation.responsibleUserId,
      },
      wetCleaning: {
        times: [...config.schedule.wetCleaning.times],
        responsibleUserId: config.schedule.wetCleaning.responsibleUserId,
      },
    },
    procedure: { ...config.procedure },
    responsiblePersons: config.responsiblePersons.map((item) => ({ ...item })),
    periodicity: { ...config.periodicity },
    cleaningResponsibles: config.cleaningResponsibles.map((item) => ({ ...item })),
    controlResponsibles: config.controlResponsibles.map((item) => ({ ...item })),
    marks: cloneMatrix(config.marks),
  };
}

function setMatrixCell(
  matrix: CleaningMatrixMap,
  rowId: string,
  dateKey: string,
  value: CleaningMatrixValue
): CleaningMatrixMap {
  const next = cloneMatrix(matrix);
  const row = { ...(next[rowId] || {}) };

  if (value) {
    row[dateKey] = value;
  } else {
    delete row[dateKey];
  }

  if (Object.keys(row).length > 0) {
    next[rowId] = row;
  } else {
    delete next[rowId];
  }

  return next;
}

function clearRowsFromMatrix(matrix: CleaningMatrixMap, rowIds: string[]): CleaningMatrixMap {
  const rowIdSet = new Set(rowIds);
  const next: CleaningMatrixMap = {};
  for (const [rowId, row] of Object.entries(matrix)) {
    if (!rowIdSet.has(rowId)) {
      next[rowId] = { ...row };
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Defaults and normalization
// ---------------------------------------------------------------------------

export function defaultCleaningDocumentConfig(
  users?: UserLike[],
  areas?: AreaLike[]
): CleaningDocumentConfig {
  return syncCompatibilityFields(buildBaseConfig(users, areas));
}

export function normalizeCleaningDocumentConfig(
  value: unknown,
  context: NormalizationContext = {}
): CleaningDocumentConfig {
  const defaults = defaultCleaningDocumentConfig(context.users, context.areas);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const record = value as Record<string, unknown>;
  const hasModernModel =
    Array.isArray(record.rooms) ||
    Array.isArray(record.responsiblePairs) ||
    Array.isArray(record.referenceTable) ||
    record.matrix !== undefined ||
    record.marks !== undefined;

  // Room-first конфиг: режим "rooms" + непустой selectedRoomIds. В нём
  // `rooms: []` — валидное состояние (см. applyRoomsToCleaningConfig).
  const isRoomFirstConfig =
    record.cleaningMode === "rooms" &&
    Array.isArray(record.selectedRoomIds) &&
    record.selectedRoomIds.length > 0;
  // Явный пустой `rooms: []` — это «пользователь удалил все строки», а не
  // «данных нет»: раньше на его месте воскресали четыре blueprint'а с
  // новыми id.
  const roomsExplicitlyEmpty =
    Array.isArray(record.rooms) && record.rooms.length === 0;
  const rooms = normalizeRooms(
    record.rooms ?? record.referenceTable,
    context.areas,
    isRoomFirstConfig || roomsExplicitlyEmpty,
  );
  const cleaningResponsibles = normalizeResponsibleArray(
    "cleaning",
    record.cleaningResponsibles,
    context.users,
    "Ответственный за уборку"
  );
  const controlResponsibles = normalizeResponsibleArray(
    "control",
    record.controlResponsibles,
    context.users,
    "Ответственный за контроль"
  );
  const scheduleDefaults = buildDefaultSchedule(
    cleaningResponsibles.length > 0 ? cleaningResponsibles : defaults.cleaningResponsibles,
    controlResponsibles.length > 0 ? controlResponsibles : defaults.controlResponsibles
  );
  const matrix = normalizeMatrix(record.matrix ?? record.marks);
  const title = normalizeText(record.title ?? record.documentTitle, defaults.title);
  const settingsRecord =
    record.settings && typeof record.settings === "object" && !Array.isArray(record.settings)
      ? (record.settings as Record<string, unknown>)
      : null;
  const autoFillRecord =
    record.autoFill && typeof record.autoFill === "object" && !Array.isArray(record.autoFill)
      ? (record.autoFill as Record<string, unknown>)
      : null;
  const settingsAutoFillEnabled =
    typeof settingsRecord?.autoFillEnabled === "boolean"
      ? settingsRecord.autoFillEnabled
      : typeof record.autoFillEnabled === "boolean"
        ? record.autoFillEnabled
        : defaults.settings.autoFillEnabled;
  const settingsSkipWeekends =
    typeof settingsRecord?.skipWeekends === "boolean"
      ? settingsRecord.skipWeekends
      : typeof record.skipWeekends === "boolean"
        ? record.skipWeekends
        : defaults.settings.skipWeekends;
  const settingsFillUntilToday =
    typeof settingsRecord?.fillUntilToday === "boolean"
      ? settingsRecord.fillUntilToday
      : defaults.settings.fillUntilToday;
  const autoFillEnabled =
    typeof autoFillRecord?.enabled === "boolean" ? autoFillRecord.enabled : defaults.autoFill.enabled;
  const autoFillSkipWeekends =
    typeof autoFillRecord?.skipWeekends === "boolean"
      ? autoFillRecord.skipWeekends
      : defaults.autoFill.skipWeekends;
  const autoFillFillUntilToday =
    typeof autoFillRecord?.fillUntilToday === "boolean"
      ? autoFillRecord.fillUntilToday
      : defaults.autoFill.fillUntilToday;
  const autoFillDefaultRoomMark =
    typeof autoFillRecord?.defaultRoomMark === "string"
      ? normalizeMatrixValue(autoFillRecord.defaultRoomMark) || "T"
      : defaults.autoFill.defaultRoomMark || "T";

  const next: CleaningDocumentConfig = {
    ...defaults,
    title,
    documentTitle: title,
    settings: {
      autoFillEnabled: settingsAutoFillEnabled,
      skipWeekends: settingsSkipWeekends,
      fillUntilToday: settingsFillUntilToday,
    },
    autoFill: {
      enabled: autoFillEnabled,
      skipWeekends: autoFillSkipWeekends,
      fillUntilToday: autoFillFillUntilToday,
      defaultRoomMark: autoFillDefaultRoomMark,
    },
    responsiblePairs: normalizeResponsiblePairs(
      record.responsiblePairs,
      cleaningResponsibles,
      controlResponsibles,
      context.users
    ),
    rooms,
    legend: normalizeLegend(record.legend),
    referenceTable: buildReferenceTable(rooms),
    matrix,
    ventilationEnabled:
      typeof record.ventilationEnabled === "boolean"
        ? record.ventilationEnabled
        : defaults.ventilationEnabled,
    skipWeekends:
      typeof record.skipWeekends === "boolean"
        ? record.skipWeekends
        : defaults.skipWeekends,
    schedule: normalizeSchedule(record.schedule, scheduleDefaults),
    procedure: normalizeProcedure(record.procedure, rooms),
    responsiblePersons:
      Array.isArray(record.responsiblePersons) && record.responsiblePersons.length > 0
        ? record.responsiblePersons
            .filter(
              (item): item is Record<string, unknown> =>
                !!item && typeof item === "object" && !Array.isArray(item)
            )
            .map((item) => ({
              userId: normalizeText(item.userId),
              title: normalizeText(item.title),
            }))
            .filter((item) => item.userId || item.title)
        : buildCompatibilityResponsiblePersons({
            cleaningResponsibles:
              cleaningResponsibles.length > 0 ? cleaningResponsibles : defaults.cleaningResponsibles,
            controlResponsibles:
              controlResponsibles.length > 0 ? controlResponsibles : defaults.controlResponsibles,
          }),
    periodicity: normalizePeriodicity(record.periodicity),
    cleaningResponsibles:
      cleaningResponsibles.length > 0 ? cleaningResponsibles : defaults.cleaningResponsibles,
    controlResponsibles:
      controlResponsibles.length > 0 ? controlResponsibles : defaults.controlResponsibles,
    marks: matrix,
  };

  if (!hasModernModel && next.responsiblePairs.length === 0) {
    next.responsiblePairs = buildResponsiblePairs(next.cleaningResponsibles, next.controlResponsibles);
  }

  // Rooms-mode (Этап 2). Опциональные поля — без значения старые
  // документы продолжают работать через responsiblePairs.
  // Cleaning unification 2026-05-08, Stage 8: умное определение режима.
  //   • Если в записи явно указан cleaningMode — уважаем (включая "pairs")
  //   • Иначе если в записи уже есть pairs или legacy-rooms — это старый
  //     документ pairs-mode, оставляем "pairs" чтобы не сломать
  //   • Иначе (полностью пустой config) — новый rooms-mode по дефолту
  const modeRaw = record.cleaningMode;
  if (modeRaw === "pairs" || modeRaw === "rooms") {
    next.cleaningMode = modeRaw;
  } else {
    const hasLegacyData =
      (Array.isArray(record.responsiblePairs) &&
        record.responsiblePairs.length > 0) ||
      (Array.isArray(record.rooms) && record.rooms.length > 0);
    next.cleaningMode = hasLegacyData ? "pairs" : "rooms";
  }
  next.selectedRoomIds = Array.isArray(record.selectedRoomIds)
    ? record.selectedRoomIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  next.selectedCleanerUserIds = Array.isArray(record.selectedCleanerUserIds)
    ? record.selectedCleanerUserIds.filter(
        (x): x is string => typeof x === "string" && x.length > 0
      )
    : [];
  next.roomsRaceMode = record.roomsRaceMode === true;
  // Per-room verifiers: string (legacy) или string[] → string[] без
  // дублей и пустых значений.
  if (record.verifierByRoomId && typeof record.verifierByRoomId === "object" && !Array.isArray(record.verifierByRoomId)) {
    const cleaned: Record<string, string[]> = {};
    for (const [roomId, raw] of Object.entries(record.verifierByRoomId as Record<string, unknown>)) {
      if (typeof roomId !== "string" || roomId.length === 0) continue;
      const list = Array.isArray(raw) ? raw : [raw];
      const ids = Array.from(
        new Set(list.filter((x): x is string => typeof x === "string" && x.length > 0)),
      );
      if (ids.length > 0) cleaned[roomId] = ids;
    }
    next.verifierByRoomId = cleaned;
  } else {
    next.verifierByRoomId = {};
  }
  next.controlUserId =
    typeof record.controlUserId === "string" && record.controlUserId.length > 0
      ? record.controlUserId
      : null;
  // Per-room cleaners: only known rooms, only pool members, no dupes.
  next.cleanerByRoomId = normalizeCleanerByRoomId(
    record.cleanerByRoomId,
    next.selectedRoomIds,
    next.selectedCleanerUserIds,
  );

  // Закрепляем «сотрудник → номер кода». Первая нормализация фиксирует
  // ТЕКУЩИЙ порядок — ровно то, что документ показывал до сих пор, —
  // и дальше номер за сотрудником больше не меняется.
  const nameById = new Map<string, string>();
  // Имя из конфига — запасной источник: ростер сюда приходит не всегда.
  for (const r of [...next.cleaningResponsibles, ...next.controlResponsibles]) {
    if (r.userId && r.userName) nameById.set(r.userId, r.userName);
  }
  for (const u of context.users ?? []) nameById.set(u.id, u.name);
  const pinnedCleaners = pinSignatureCodes(
    currentCleanerUserIds(next),
    asCodeMap(record.cleanerCodeByUserId),
    asNameMap(record.cleanerNameByUserId),
    nameById,
  );
  next.cleanerCodeByUserId = pinnedCleaners.codeByUserId;
  next.cleanerNameByUserId = pinnedCleaners.nameByUserId;
  const pinnedControllers = pinSignatureCodes(
    Array.from(
      new Set(
        next.controlResponsibles.map((r) => r.userId).filter((id): id is string => !!id),
      ),
    ),
    asCodeMap(record.controlCodeByUserId),
    asNameMap(record.controlNameByUserId),
    nameById,
  );
  next.controlCodeByUserId = pinnedControllers.codeByUserId;
  next.controlNameByUserId = pinnedControllers.nameByUserId;

  // Pipeline (subtask) mode — perRoom by default для backwards-compat.
  // legacy = без подзадач, global = один общий список, perRoom = по помещению.
  const subtaskModeRaw = record.cleaningSubtaskMode;
  next.cleaningSubtaskMode =
    subtaskModeRaw === "legacy" || subtaskModeRaw === "global" || subtaskModeRaw === "perRoom"
      ? subtaskModeRaw
      : "perRoom";
  // Global subtasks — используются только в "global" mode, но всегда
  // нормализуем чтобы переключение режимов не теряло данные.
  const globalRaw = record.globalSubtasks;
  if (globalRaw && typeof globalRaw === "object" && !Array.isArray(globalRaw)) {
    const g = globalRaw as Record<string, unknown>;
    next.globalSubtasks = {
      current: normalizeStringArray(g.current),
      general: normalizeStringArray(g.general),
    };
  } else {
    next.globalSubtasks = { current: [], general: [] };
  }

  return syncCompatibilityFields(next);
}

export function normalizeCleanerByRoomId(
  raw: unknown,
  selectedRoomIds: string[],
  pool: string[],
): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const roomSet = new Set(selectedRoomIds);
  const poolSet = new Set(pool);
  const out: Record<string, string[]> = {};
  for (const [roomId, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!roomId || !roomSet.has(roomId) || !Array.isArray(ids)) continue;
    const cleaned = Array.from(
      new Set(ids.filter((x): x is string => typeof x === "string" && poolSet.has(x))),
    );
    if (cleaned.length > 0) out[roomId] = cleaned;
  }
  return out;
}

/**
 * Кто убирает комнату — единственный источник для адаптера,
 * override-sync, клиента и PDF.
 *   1. Закрепление cleanerByRoomId[roomId] (если есть).
 *   2. Иначе пул: race → все; round-robin → cleaners[idx % n], где idx —
 *      позиция в selectedRoomIds (стабильна, не зависит от «/» в matrix).
 */
export function resolveRoomCleaners(
  config: Pick<
    CleaningDocumentConfig,
    "selectedRoomIds" | "selectedCleanerUserIds" | "roomsRaceMode" | "cleanerByRoomId"
  >,
  roomId: string,
): string[] {
  const pool = config.selectedCleanerUserIds ?? [];
  const pinned = config.cleanerByRoomId?.[roomId];
  if (Array.isArray(pinned) && pinned.length > 0) {
    const poolSet = new Set(pool);
    const valid = pinned.filter((id) => poolSet.has(id));
    if (valid.length > 0) return valid;
  }
  if (pool.length === 0) return [];
  if (config.roomsRaceMode === true) return [...pool];
  const idx = (config.selectedRoomIds ?? []).indexOf(roomId);
  if (idx < 0) return [pool[0]];
  return [pool[idx % pool.length]];
}

/**
 * Кто проверяет комнату — список: проверяющие помещения (Room.verifierUserIds
 * через эффективный конфиг) → контролёр документа → первый из
 * controlResponsibles. Первый в списке — проверяющий задачи в TF,
 * остальные получают вечернюю сводку по своим помещениям.
 */
export function resolveRoomControllers(
  config: Pick<
    CleaningDocumentConfig,
    "verifierByRoomId" | "controlUserId" | "controlResponsibles"
  >,
  roomId: string,
): string[] {
  const zone = config.verifierByRoomId?.[roomId];
  if (Array.isArray(zone) && zone.length > 0) return [...zone];
  const fallback =
    config.controlUserId ?? config.controlResponsibles?.[0]?.userId ?? null;
  return fallback ? [fallback] : [];
}

/** Кто контролирует комнату (основной): первый из resolveRoomControllers. */
export function resolveRoomController(
  config: Pick<
    CleaningDocumentConfig,
    "verifierByRoomId" | "controlUserId" | "controlResponsibles"
  >,
  roomId: string,
): string | null {
  return resolveRoomControllers(config, roomId)[0] ?? null;
}

/**
 * Подписи нижних строк журнала уборки (экран, карточки списка, PDF).
 * Совпадают с названиями слотов в /settings/journal-responsibles.
 * Хранимые `title` ответственных (должность) — отдельное поле, не они.
 */
export const CLEANING_ROW_LABELS = {
  cleaning: "Старший по уборке",
  control: "Контролёр",
} as const;

/**
 * Префикс стабильной ссылки на сотрудника в ячейке подписи: `uid:<userId>`.
 * Код «СN» — только отображение, оно вычисляется при отрисовке по
 * закреплённой карте (`cleanerCodeByUserId`). Так подпись остаётся
 * подписью конкретного человека, даже когда состав уборщиков поменялся.
 */
export const CLEANING_USER_REF_PREFIX = "uid:";

/** Ссылка на сотрудника для ячейки подписи; пустая строка — нет сотрудника. */
export function cleaningSignatureRef(userId: string | undefined | null): string {
  return userId ? `${CLEANING_USER_REF_PREFIX}${userId}` : "";
}

export type CleaningCodeEntry = {
  id: string;
  userId: string;
  code: string;
  userName: string;
  title: string;
  /**
   * Сотрудника уже нет в составе документа, но его подписи в журнале
   * остались. Он держится в легенде (иначе подпись некому приписать),
   * но новые подписи на него не ставятся.
   */
  retired?: boolean;
};

function asCodeMap(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (userId && typeof value === "number" && Number.isInteger(value) && value > 0) {
      out[userId] = value;
    }
  }
  return out;
}

function asNameMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (userId && typeof value === "string" && value.length > 0) out[userId] = value;
  }
  return out;
}

function pickName(
  userId: string,
  userNameById?: Map<string, string> | Record<string, string>,
): string | undefined {
  const raw =
    userNameById instanceof Map ? userNameById.get(userId) : userNameById?.[userId];
  return raw && raw.length > 0 ? raw : undefined;
}

/** Текущий список уборщиков документа: пул rooms-mode либо ответственные. */
function currentCleanerUserIds(
  config: Pick<
    CleaningDocumentConfig,
    "cleaningMode" | "selectedCleanerUserIds" | "cleaningResponsibles"
  >,
): string[] {
  const pool = config.selectedCleanerUserIds ?? [];
  const source =
    config.cleaningMode === "rooms" && pool.length > 0
      ? pool
      : (config.cleaningResponsibles ?? []).map((r) => r.userId);
  return Array.from(new Set(source.filter((id): id is string => !!id)));
}

/**
 * Закрепление «сотрудник → номер кода». Уже выданные номера не двигаются
 * и не переиспользуются, новые сотрудники получают следующий свободный.
 * `prevNames` — снимок имён: уволенный в ростер не приходит, но его
 * подписи в журнале остаются и должны читаться.
 */
export function pinSignatureCodes(
  userIds: string[],
  prevCodes: Record<string, number> | undefined,
  prevNames: Record<string, string> | undefined,
  userNameById?: Map<string, string> | Record<string, string>,
): { codeByUserId: Record<string, number>; nameByUserId: Record<string, string> } {
  const codeByUserId: Record<string, number> = {};
  for (const [userId, value] of Object.entries(prevCodes ?? {})) {
    if (userId && typeof value === "number" && Number.isInteger(value) && value > 0) {
      codeByUserId[userId] = value;
    }
  }
  const nameByUserId: Record<string, string> = {};
  for (const [userId, value] of Object.entries(prevNames ?? {})) {
    if (userId && typeof value === "string" && value.length > 0) {
      nameByUserId[userId] = value;
    }
  }
  let maxCode = 0;
  for (const value of Object.values(codeByUserId)) {
    if (value > maxCode) maxCode = value;
  }
  for (const userId of userIds) {
    if (codeByUserId[userId] === undefined) codeByUserId[userId] = ++maxCode;
  }
  for (const userId of Object.keys(codeByUserId)) {
    const fresh = pickName(userId, userNameById);
    if (fresh) nameByUserId[userId] = fresh;
  }
  return { codeByUserId, nameByUserId };
}

/**
 * userId'ы, на которых ссылается строка подписей в matrix. Нужны легенде:
 * выбывший уборщик остаётся в ней, пока на него есть хоть одна подпись.
 */
function collectSignatureUserIds(
  row: Record<string, CleaningMatrixValue> | undefined,
  numberToUserId: Map<number, string>,
): string[] {
  if (!row) return [];
  const out = new Set<string>();
  for (const raw of Object.values(row)) {
    if (typeof raw !== "string") continue;
    for (const part of stripAutoSignatureMarker(raw).split(",")) {
      const token = part.trim();
      if (!token) continue;
      if (token.startsWith(CLEANING_USER_REF_PREFIX)) {
        const userId = token.slice(CLEANING_USER_REF_PREFIX.length);
        if (userId) out.add(userId);
        continue;
      }
      const legacy = /^С(\d+)$/.exec(token);
      const userId = legacy ? numberToUserId.get(Number(legacy[1])) : undefined;
      if (userId) out.add(userId);
    }
  }
  return Array.from(out);
}

function buildCodeEntries(params: {
  userIds: string[];
  codeByUserId: Record<string, number>;
  nameByUserId: Record<string, string>;
  signatureRow?: Record<string, CleaningMatrixValue>;
  idPrefix: string;
  title: string;
  resolved: Map<string, { id: string; userName: string; title: string }>;
  userNameById?: Map<string, string> | Record<string, string>;
}): CleaningCodeEntry[] {
  const numberToUserId = new Map<number, string>();
  for (const [userId, value] of Object.entries(params.codeByUserId)) {
    if (!numberToUserId.has(value)) numberToUserId.set(value, userId);
  }
  // Выбывшие: в текущем списке их нет, но их подписи в журнале остались.
  const extra = collectSignatureUserIds(params.signatureRow, numberToUserId).filter(
    (userId) => !params.userIds.includes(userId) && params.codeByUserId[userId] !== undefined,
  );
  const retiredSet = new Set(extra);
  return [...params.userIds, ...extra]
    .map((userId, idx) => {
      const meta = params.resolved.get(userId);
      const number = params.codeByUserId[userId] ?? idx + 1;
      return {
        id: meta?.id ?? `${params.idPrefix}${userId}`,
        userId,
        code: `С${number}`,
        userName:
          meta?.userName ||
          pickName(userId, params.userNameById) ||
          params.nameByUserId[userId] ||
          "—",
        title: meta?.title ?? params.title,
        ...(retiredSet.has(userId) ? { retired: true as const } : {}),
        number,
      };
    })
    .sort((a, b) => a.number - b.number)
    .map(({ number: _number, ...entry }) => entry);
}

/**
 * Легенда «Ответственный за уборку» — коды С1…СN. Rooms-mode с непустым
 * пулом → пул; иначе cleaningResponsibles. Номер берётся из закреплённой
 * карты `cleanerCodeByUserId` (позиция в списке — только fallback для
 * документов, которые ещё ни разу не нормализовались).
 * Один источник для экрана и PDF (раньше они читали разные списки).
 */
export function listCleaningCodeEntries(
  config: Pick<
    CleaningDocumentConfig,
    "cleaningMode" | "selectedCleanerUserIds" | "cleaningResponsibles"
  > &
    Partial<
      Pick<CleaningDocumentConfig, "matrix" | "cleanerCodeByUserId" | "cleanerNameByUserId">
    >,
  userNameById?: Map<string, string> | Record<string, string>,
): CleaningCodeEntry[] {
  const userIds = currentCleanerUserIds(config);
  const pool = config.selectedCleanerUserIds ?? [];
  const isPoolMode = config.cleaningMode === "rooms" && pool.length > 0;
  const resolved = new Map<string, { id: string; userName: string; title: string }>();
  if (!isPoolMode) {
    for (const r of config.cleaningResponsibles ?? []) {
      if (r.userId && !resolved.has(r.userId)) {
        resolved.set(r.userId, {
          id: r.id,
          userName: r.userName || pickName(r.userId, userNameById) || "",
          title: r.title,
        });
      }
    }
  }
  const pinned = pinSignatureCodes(
    userIds,
    config.cleanerCodeByUserId,
    config.cleanerNameByUserId,
    userNameById,
  );
  return buildCodeEntries({
    userIds,
    codeByUserId: pinned.codeByUserId,
    nameByUserId: pinned.nameByUserId,
    signatureRow: config.matrix?.[CLEANING_SIGNATURE_ROW_ID],
    idPrefix: "selected-cleaner-",
    title: "Уборщик",
    resolved,
    userNameById,
  });
}

/**
 * Легенда «Контролёр». Отдельная нумерация от С1 — списки логически
 * независимые. Номера тоже закреплены (`controlCodeByUserId`).
 */
export function listControlCodeEntries(
  config: Pick<CleaningDocumentConfig, "controlResponsibles"> &
    Partial<
      Pick<CleaningDocumentConfig, "matrix" | "controlCodeByUserId" | "controlNameByUserId">
    >,
  userNameById?: Map<string, string> | Record<string, string>,
): CleaningCodeEntry[] {
  const list = config.controlResponsibles ?? [];
  const userIds = Array.from(
    new Set(list.map((r) => r.userId).filter((id): id is string => !!id)),
  );
  const resolved = new Map<string, { id: string; userName: string; title: string }>();
  for (const r of list) {
    if (r.userId && !resolved.has(r.userId)) {
      resolved.set(r.userId, {
        id: r.id,
        userName: r.userName || pickName(r.userId, userNameById) || "",
        title: r.title,
      });
    }
  }
  const pinned = pinSignatureCodes(
    userIds,
    config.controlCodeByUserId,
    config.controlNameByUserId,
    userNameById,
  );
  const entries = buildCodeEntries({
    userIds,
    codeByUserId: pinned.codeByUserId,
    nameByUserId: pinned.nameByUserId,
    signatureRow: config.matrix?.[CONTROL_SIGNATURE_ROW_ID],
    idPrefix: "control-responsible-",
    title: "Контролёр",
    resolved,
    userNameById,
  });
  // Строки без userId (пустой слот «не назначен») в карту кодов не
  // попадают, но в легенде их видно — иначе слот исчезает из бланка.
  const orphans = list.filter((r) => !r.userId);
  if (orphans.length === 0) return entries;
  let next = entries.length;
  return [
    ...entries,
    ...orphans.map((r) => ({
      id: r.id,
      userId: r.userId,
      code: `С${++next}`,
      userName: r.userName || "—",
      title: r.title,
    })),
  ];
}

/**
 * Единый резолвер подписей: и запись, и чтение ячеек строк
 * `__cleaning_signature__` / `__control_signature__` идут только через него.
 * Понимает три формата значения:
 *   • `uid:<userId>` — то, что пишется сейчас (стабильно при смене состава);
 *   • `СN` — легаси, резолвится через закреплённую карту номеров;
 *   • `—` / `""` — явная очистка менеджером (подавляет computed-подпись).
 */
export type CleaningSignatureResolver = {
  entries: CleaningCodeEntry[];
  /** Код «СN» сотрудника, если он есть в легенде документа. */
  codeOf(userId: string): string | null;
  /** Сотрудник по токену `uid:<id>` или `СN`. */
  userIdOf(token: string): string | null;
  /**
   * Ручная/авто-подпись → коды для показа. `""` — явная очистка,
   * `null` — подписи нет (вызывающий падает на computed).
   */
  readManual(raw: unknown): string | null;
  /** Значение для записи в matrix. */
  encode(userIds: string[]): string;
};

export function buildCleaningSignatureResolver(
  entries: CleaningCodeEntry[],
): CleaningSignatureResolver {
  const codeByUserId = new Map<string, string>();
  const userIdByCode = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.userId) continue;
    if (!codeByUserId.has(entry.userId)) codeByUserId.set(entry.userId, entry.code);
    if (!userIdByCode.has(entry.code)) userIdByCode.set(entry.code, entry.userId);
  }
  const codeOf = (userId: string) => codeByUserId.get(userId) ?? null;
  const userIdOf = (token: string) => {
    const trimmed = token.trim();
    if (trimmed.startsWith(CLEANING_USER_REF_PREFIX)) {
      const userId = trimmed.slice(CLEANING_USER_REF_PREFIX.length);
      return userId.length > 0 ? userId : null;
    }
    return userIdByCode.get(trimmed) ?? null;
  };
  return {
    entries,
    codeOf,
    userIdOf,
    readManual(raw: unknown): string | null {
      if (typeof raw !== "string") return null;
      const manual = stripAutoSignatureMarker(raw);
      if (manual === "" || manual === CLEANING_EMPTY_SENTINEL) return "";
      const codes: string[] = [];
      for (const part of manual.split(",")) {
        const token = part.trim();
        if (!token || token === CLEANING_EMPTY_SENTINEL) continue;
        const userId = userIdOf(token);
        if (userId) {
          const code = codeOf(userId);
          if (code && !codes.includes(code)) codes.push(code);
          continue;
        }
        // Не ссылка на сотрудника (устаревший «СN» или инициалы от руки):
        // устаревший код отбрасываем, произвольный текст показываем как есть.
        if (/^С\d+$/.test(token) || token.startsWith(CLEANING_USER_REF_PREFIX)) continue;
        if (!codes.includes(token)) codes.push(token);
      }
      return codes.length > 0 ? codes.join(",") : null;
    },
    encode(userIds: string[]): string {
      return Array.from(new Set(userIds.filter(Boolean)))
        .map((userId) => `${CLEANING_USER_REF_PREFIX}${userId}`)
        .join(",");
    },
  };
}

/** Контролёр документа по умолчанию (без учёта зон). */
export function resolveDocumentController(
  config: Pick<CleaningDocumentConfig, "controlUserId" | "controlResponsibles">,
): string | null {
  return config.controlUserId ?? config.controlResponsibles?.[0]?.userId ?? null;
}

/** Is at least one room pinned to explicit cleaners? */
export function countPinnedRooms(config: Pick<CleaningDocumentConfig, "cleanerByRoomId">): number {
  return Object.keys(config.cleanerByRoomId ?? {}).length;
}

/**
 * Серверная валидация cleaning-документа. Используется в PATCH endpoint
 * для отсечения невалидных конфигураций ДО save'а — чтобы юзер получил
 * явную ошибку вместо silent-fail в bulk-assign.
 *
 * Бросает Error с понятным сообщением для UI. Возвращает void.
 */
export function validateCleaningDocumentConfig(
  config: CleaningDocumentConfig,
): void {
  if (config.cleaningMode !== "rooms") return;

  // Строки бланка могут приходить из справочника Room (selectedRoomIds)
  // ЛИБО из самого конфига (config.rooms). Требовать первое всегда нельзя:
  // у организации без «Помещений» валидатор отбивал каждое сохранение.
  const hasRoomRows =
    (config.selectedRoomIds?.length ?? 0) > 0 || (config.rooms?.length ?? 0) > 0;
  if (!hasRoomRows) {
    throw new Error(
      "Режим «По комнатам» требует выбрать хотя бы одну комнату " +
        "(selectedRoomIds). Открой настройки документа и отметь " +
        "комнаты для уборки.",
    );
  }

  // Уборщик тоже может быть задан «по-старому» — списком ответственных
  // за уборку; пул selectedCleanerUserIds появляется только в rooms-mode
  // со справочником.
  const hasCleaners =
    (config.selectedCleanerUserIds?.length ?? 0) > 0 ||
    (config.cleaningResponsibles?.length ?? 0) > 0 ||
    Object.keys(config.cleanerByRoomId ?? {}).length > 0;
  if (!hasCleaners) {
    throw new Error(
      "Режим «По комнатам» требует хотя бы одного уборщика: выберите " +
        "уборщиков в пуле документа или назначьте их помещениям в " +
        "«Настройки → Помещения».",
    );
  }
}

export function normalizeCleaningEntryData(value: unknown): CleaningEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { activities: [] };
  }

  const record = value as Record<string, unknown>;
  const activities = Array.isArray(record.activities)
    ? record.activities
        .filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === "object" && !Array.isArray(item)
        )
        .map((item): CleaningActivityEntry => ({
          type:
            item.type === "disinfection" || item.type === "ventilation" || item.type === "wetCleaning"
              ? item.type
              : "wetCleaning",
          times: normalizeStringArray(item.times),
          responsibleName: normalizeText(item.responsibleName),
        }))
    : [];

  const result: CleaningEntryData = { activities };

  // Сохраняем поля room-completion, чтобы клиент мог отрисовать
  // С1/С2 в ячейке matrix. См. CleaningEntryData выше.
  if (record.kind === "cleaning_room") {
    result.kind = "cleaning_room";
    if (typeof record.roomId === "string") result.roomId = record.roomId;
    if (typeof record.dateKey === "string") result.dateKey = record.dateKey;
    if (typeof record.cleanerUserId === "string")
      result.cleanerUserId = record.cleanerUserId;
    if (typeof record.completedAt === "string")
      result.completedAt = record.completedAt;
    const completions = listCleaningRoomCompletions(record);
    if (completions.length > 0) {
      result.rooms = {};
      for (const c of completions) {
        result.rooms[c.roomId] = {
          completedAt: c.completedAt,
          ...(c.controllerUserId ? { controllerUserId: c.controllerUserId } : {}),
          ...(c.controllerCompletedAt
            ? { controllerCompletedAt: c.controllerCompletedAt }
            : {}),
        };
      }
    }
  }

  return result;
}

export function getDefaultCleaningResponsibleIds(users: Array<{ id: string; role: string }>) {
  const responsibleCleaningUserId = pickPrimaryStaff(users)?.id || null;

  const responsibleControlUserId =
    pickPrimaryManager(users.filter((user) => user.id !== responsibleCleaningUserId))?.id ||
    users.find((user) => user.id !== responsibleCleaningUserId)?.id ||
    responsibleCleaningUserId;

  return {
    responsibleCleaningUserId,
    responsibleControlUserId,
  };
}

export function buildCleaningConfigFromAreas(
  areas: AreaLike[],
  userDefaults?: LegacyResponsibleDefaults
): CleaningDocumentConfig {
  const config = defaultCleaningDocumentConfig(undefined, areas);

  if (userDefaults?.responsibleCleaningUserId) {
    config.cleaningResponsibles = config.cleaningResponsibles.map((item, index) =>
      index === 0
        ? { ...item, userId: userDefaults.responsibleCleaningUserId || "", userName: item.userName }
        : item
    );
  }

  if (userDefaults?.responsibleControlUserId) {
    config.controlResponsibles = config.controlResponsibles.map((item, index) =>
      index === 0
        ? { ...item, userId: userDefaults.responsibleControlUserId || "", userName: item.userName }
        : item
    );
  }

  return syncCompatibilityFields(config);
}

export function buildCleaningDocumentConfig(params: {
  users?: UserLike[];
  areas?: AreaLike[];
  base?: unknown;
  title?: string;
}) {
  const normalized = normalizeCleaningDocumentConfig(params.base, {
    users: params.users,
    areas: params.areas,
  });

  return params.title
    ? syncCompatibilityFields({
        ...normalized,
        title: params.title,
        documentTitle: params.title,
      })
    : normalized;
}

export function getCleaningDocumentTitle() {
  return CLEANING_PAGE_TITLE;
}

/**
 * The cleaning journal is run as a half-month document (1st–15th, then
 * 16th–end). Pick the half that contains `referenceDate` so creating
 * a doc on the 20th gives «16–30» (or «16–31» / «16–28»/«16–29»),
 * not «1–15» from the previous half.
 */
export function getCleaningCreatePeriodBounds(referenceDate = new Date()) {
  const date = coerceUtcDate(referenceDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthStr = String(month + 1).padStart(2, "0");

  if (day <= 15) {
    return {
      dateFrom: `${year}-${monthStr}-01`,
      dateTo: `${year}-${monthStr}-${String(Math.min(lastDay, 15)).padStart(2, "0")}`,
    };
  }

  return {
    dateFrom: `${year}-${monthStr}-16`,
    dateTo: `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`,
  };
}

const RU_MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

export function getCleaningPeriodLabel(dateFrom: Date | string, dateTo: Date | string) {
  const from = typeof dateFrom === "string" ? new Date(`${dateFrom}T00:00:00`) : dateFrom;
  const to = typeof dateTo === "string" ? new Date(`${dateTo}T00:00:00`) : dateTo;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return formatMonthLabel(dateFrom, dateTo);
  }

  if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
    return `${RU_MONTHS[from.getMonth()]} с ${from.getDate()} по ${to.getDate()}`;
  }

  return formatMonthLabel(dateFrom, dateTo);
}

/**
 * Подпись группы колонок-дней в сетке: «Август 2026 г.» (эталон
 * cleaning-07-grid-with-room.png). Диапазон полумесяца не дублируем —
 * он и так виден по номерам колонок. В СПИСКЕ документов остаётся
 * `getCleaningPeriodLabel` с «с 1 по 15», иначе два полумесячных
 * документа в списке выглядели бы одинаково.
 */
export function getCleaningGridMonthLabel(
  dateFrom: Date | string,
  dateTo: Date | string
) {
  const from = typeof dateFrom === "string" ? new Date(`${dateFrom}T00:00:00`) : dateFrom;
  const to = typeof dateTo === "string" ? new Date(`${dateTo}T00:00:00`) : dateTo;

  if (Number.isNaN(from.getTime())) return getCleaningPeriodLabel(dateFrom, dateTo);
  if (
    Number.isNaN(to.getTime()) ||
    from.getMonth() !== to.getMonth() ||
    from.getFullYear() !== to.getFullYear()
  ) {
    return getCleaningPeriodLabel(dateFrom, dateTo);
  }

  return `${RU_MONTHS[from.getMonth()]} ${from.getFullYear()} г.`;
}

export function getCleaningFilePrefix() {
  return "cleaning-journal";
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

export function createCleaningRoom(overrides: Partial<CleaningRoomItem> = {}): CleaningRoomItem {
  return {
    id: overrides.id || createId("cleaning-room"),
    areaId: overrides.areaId || null,
    name: normalizeText(overrides.name, "помещение"),
    detergent: normalizeText(overrides.detergent),
    currentScope: overrides.currentScope ? [...overrides.currentScope] : [],
    generalScope: overrides.generalScope ? [...overrides.generalScope] : [],
    currentDays: typeof overrides.currentDays === "number" ? overrides.currentDays : 127,
    generalDays: typeof overrides.generalDays === "number" ? overrides.generalDays : 0,
  };
}

export const createCleaningRoomRow = createCleaningRoom;

export function upsertCleaningRoom(items: CleaningRoomItem[], item: CleaningRoomItem) {
  const next = items.some((current) => current.id === item.id)
    ? items.map((current) => (current.id === item.id ? item : current))
    : [...items, item];
  return next;
}

export const upsertCleaningRoomRow = upsertCleaningRoom;

export function removeCleaningRoom(items: CleaningRoomItem[], id: string) {
  return items.filter((item) => item.id !== id);
}

export const removeCleaningRoomRow = removeCleaningRoom;

export function createCleaningResponsible(params: {
  kind: CleaningResponsibleKind;
  title: string;
  userId: string;
  userName: string;
  code?: string;
}): CleaningResponsible {
  return {
    id: createId(`cleaning-${params.kind}`),
    kind: params.kind,
    title: normalizeText(
      params.title,
      params.kind === "control" ? "Ответственный за контроль" : "Ответственный за уборку"
    ),
    userId: params.userId,
    userName: params.userName,
    code: normalizeText(params.code, "C1"),
  };
}

export const createCleaningResponsibleRow = createCleaningResponsible;

export function upsertCleaningResponsible(items: CleaningResponsible[], item: CleaningResponsible) {
  const next = items.some((current) => current.id === item.id)
    ? items.map((current) => (current.id === item.id ? item : current))
    : [...items, item];
  return reindexResponsibles(next);
}

export const upsertCleaningResponsibleRow = upsertCleaningResponsible;

export function removeCleaningResponsible(items: CleaningResponsible[], id: string) {
  return reindexResponsibles(items.filter((item) => item.id !== id));
}

export const removeCleaningResponsibleRow = removeCleaningResponsible;

export function toggleCleaningMatrixValue(currentValue: CleaningMatrixValue): CleaningMatrixValue {
  if (currentValue === "") return "T";
  if (currentValue === "T") return "G";
  if (currentValue === "G") return "/";
  if (currentValue === "/") return CLEANING_EMPTY_SENTINEL;
  if (currentValue === CLEANING_EMPTY_SENTINEL) return "T";
  return "T";
}

export function setCleaningMatrixValue(params: {
  config: CleaningDocumentConfig;
  rowId: string;
  dateKey: string;
  value: CleaningMatrixValue;
}) {
  const next = cloneConfig(params.config);
  next.matrix = setMatrixCell(next.matrix, params.rowId, params.dateKey, params.value);
  next.marks = next.matrix;
  return syncCompatibilityFields(next);
}

/**
 * Возвращает копию cleaning config'а без изменений (matrix/marks оставляем).
 * Используется при копировании предыдущего документа — нам нужны и
 * структура (rooms, ответственные, weekday-маски), и matrix (отметки
 * уборщицы из прошлого периода), чтобы потом применить шаблон по
 * dow-pattern'у к новому периоду через `copyMatrixByWeekday`.
 *
 * Возвращает Record<string, unknown> или null если config невалиден.
 */
export function stripPeriodSpecificCleaningFields(
  rawConfig: unknown,
): Record<string, unknown> | null {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return null;
  }
  return { ...(rawConfig as Record<string, unknown>) };
}

/**
 * Копирует matrix предыдущего периода в новый, маппинг через day-of-week.
 *
 * Алгоритм:
 *   1. Сканируем prevMatrix: для каждой ячейки (rowId, prevDateKey) считаем
 *      mondayIdx (Пн=0..Вс=6) и записываем value в map[rowId][mondayIdx].
 *      Если для одного dow в prev было несколько ячеек — побеждает
 *      последняя (most recent).
 *   2. Для каждого rowId и newDateKey считаем mondayIdx и пишем
 *      value из map.
 *
 * Эффект: если в прошлом месяце уборщица каждую среду делала G — в
 * новом месяце все среды получат G автоматически. Менеджер не
 * перенастраивает матрицу — план уборки фактически наследуется.
 */
export function copyMatrixByWeekday(
  prevMatrix: CleaningMatrixMap | undefined,
  newDateKeys: string[],
): CleaningMatrixMap {
  if (!prevMatrix || typeof prevMatrix !== "object") return {};
  const dowMap: Record<string, Record<number, CleaningMatrixValue>> = {};
  for (const [rowId, row] of Object.entries(prevMatrix)) {
    if (!row || typeof row !== "object") continue;
    dowMap[rowId] = dowMap[rowId] ?? {};
    for (const [dateKey, value] of Object.entries(row)) {
      if (typeof value !== "string" || !value) continue;
      const date = new Date(`${dateKey}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      const mondayIdx = (date.getUTCDay() + 6) % 7;
      dowMap[rowId][mondayIdx] = value as CleaningMatrixValue;
    }
  }
  const result: CleaningMatrixMap = {};
  for (const [rowId, byDow] of Object.entries(dowMap)) {
    const newRow: Record<string, CleaningMatrixValue> = {};
    for (const dateKey of newDateKeys) {
      const date = new Date(`${dateKey}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      const mondayIdx = (date.getUTCDay() + 6) % 7;
      const value = byDow[mondayIdx];
      if (value) newRow[dateKey] = value;
    }
    if (Object.keys(newRow).length > 0) {
      result[rowId] = newRow;
    }
  }
  return result;
}

/**
 * Ставит «/» (не проводилась) на все выходные и праздники РФ-календаря
 * для каждой комнаты. Используется когда копируем matrix из прошлого
 * периода в новый — прошлые отметки на выходных не релевантны для
 * нового, заменяем единообразно.
 *
 * Не трогает рабочие дни и не трогает строки responsibles (только rooms,
 * у responsibles свои code-метки типа «С1»). Чтобы не оверрайдить уже
 * запланированный G на subbота (когда менеджер явно поставил generalMask
 * на субботу) — ставим «/» только если ячейка пустая ИЛИ копия из прошлого
 * периода. Если в новом config'е room.generalDays включает Sat — мы
 * оставим то значение, что copyMatrixByWeekday скопировал.
 */
export function applyWeekendHolidayMark(
  matrix: CleaningMatrixMap,
  dateKeys: string[],
  config: CleaningDocumentConfig,
): CleaningMatrixMap {
  const next: CleaningMatrixMap = {};
  for (const [rowId, row] of Object.entries(matrix)) {
    next[rowId] = { ...row };
  }
  for (const room of config.rooms) {
    const generalMask = typeof room.generalDays === "number" ? room.generalDays : 0;
    const currentMask = typeof room.currentDays === "number" ? room.currentDays : 0;
    const row = next[room.id] ? { ...next[room.id] } : {};
    for (const dateKey of dateKeys) {
      const dayKind = getCalendarDayKind(dateKey).kind;
      if (dayKind !== "weekend" && dayKind !== "holiday") continue;
      const date = new Date(`${dateKey}T00:00:00Z`);
      const mondayIdx = (date.getUTCDay() + 6) % 7;
      const bit = 1 << mondayIdx;
      // Если менеджер ЯВНО запланировал уборку на этот день недели
      // (current/general bit set) — не трогаем; иначе «/».
      const isPlanned = (generalMask & bit) !== 0 || (currentMask & bit) !== 0;
      if (isPlanned) continue;
      row[dateKey] = "/" as CleaningMatrixValue;
    }
    if (Object.keys(row).length > 0) {
      next[room.id] = row;
    }
  }
  return next;
}

/**
 * Заполняет матрицу по weekday-маскам помещений (currentDays/generalDays).
 * Для каждой пары (room, dateKey):
 *   • если generalDays включает день недели → ставим "G"
 *   • иначе если currentDays включает → ставим "T"
 *   • иначе оставляем как есть
 *
 * `mode` управляет тем, что делать с уже заполненными ячейками:
 *   • "fill-empty"  — трогаем только пустые ячейки (default).
 *                     Пользовательские отметки сохраняются — план только
 *                     дозаполняет «нетронутое».
 *   • "overwrite"   — перезаписываем всё, включая существующие "/"/"T"/"G".
 *                     Используется для «применить план заново» button.
 *
 * Используется:
 *   1. При создании нового JournalDocument для cleaning — чтобы матрица
 *      сразу была размечена по плану из шаблона по умолчанию.
 *   2. При сохранении настроек помещения — auto-apply на пустые ячейки.
 *   3. По кнопке «Заполнить по плану» — overwrite-режим.
 *
 * Sun-first JS dayOfWeek (Date.getUTCDay) → Mon-first index через
 * `+6 % 7` (см. weekday-mask.ts/jsDayOfWeekToMondayIndex).
 */
export type RoomScheduleFromDb = {
  id: string;
  currentDays?: number;
  generalDays?: number;
  currentScheduleType?: "weekly" | "monthly";
  generalScheduleType?: "weekly" | "monthly";
  /** Список дней месяца ["1", "15", "last"] когда применяется monthly. */
  currentMonthDays?: string[];
  generalMonthDays?: string[];
};

/**
 * Расписание уборки, как оно лежит в таблице `Room` (сырые поля Prisma).
 * Отдельный тип, чтобы `cleaning-document.ts` не знал про Prisma.
 */
export type CleaningRoomScheduleSource = {
  id: string;
  currentDays?: number | null;
  generalDays?: number | null;
  currentScheduleType?: string | null;
  generalScheduleType?: string | null;
  currentMonthDays?: unknown;
  generalMonthDays?: unknown;
};

/** Map<roomId, расписание> для `applyRoomScheduleToMatrix`. */
export function toRoomScheduleMap(
  rooms: CleaningRoomScheduleSource[],
): Map<string, RoomScheduleFromDb> {
  const asStringArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  return new Map(
    rooms.map((room) => [
      room.id,
      {
        id: room.id,
        currentDays: typeof room.currentDays === "number" ? room.currentDays : undefined,
        generalDays: typeof room.generalDays === "number" ? room.generalDays : undefined,
        currentScheduleType: room.currentScheduleType === "monthly" ? "monthly" : "weekly",
        generalScheduleType: room.generalScheduleType === "monthly" ? "monthly" : "weekly",
        currentMonthDays: asStringArray(room.currentMonthDays),
        generalMonthDays: asStringArray(room.generalMonthDays),
      } satisfies RoomScheduleFromDb,
    ]),
  );
}

/**
 * C1 аудита журналов: переводит cleaning-конфиг на Room-first.
 *
 * ПОЧЕМУ: помещения уборки живут в таблице `Room` (/settings/buildings) —
 * так решила спека cleaning-unification. Но создание документа осталось в
 * мире `config.rooms` и сеяло четыре blueprint'а («гостевая зона»,
 * «помещение мойки», «горячий цех/кухня», «Бар»), а клиент рисует
 * ОБЪЕДИНЕНИЕ `config.rooms ∪ Room` — отсюда дубли строк, план,
 * проставленный blueprint'ам вместо настоящих помещений, и пустой
 * справочник scope внизу бланка.
 *
 * Есть Room → `rooms = []`, режим `rooms`, `selectedRoomIds` = все Room
 * (или прошлый выбор, если он ещё валиден). Нет Room → возвращаем конфиг
 * как есть: blueprint'ы остаются единственным, что можно показать.
 */
export function applyRoomsToCleaningConfig(
  config: unknown,
  roomIds: string[],
): unknown {
  if (roomIds.length === 0) return config;
  const base =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const previousSelected = Array.isArray(base.selectedRoomIds)
    ? (base.selectedRoomIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && roomIds.includes(id),
      )
    : [];
  // Уборщики: если ещё не выбраны — берём ответственных за уборку из
  // конфига. Пустой список НЕ значит «все»: адаптер TasksFlow при пустом
  // `selectedCleanerUserIds` не создаёт ни одной задачи, а PATCH конфига
  // отбивается валидатором. Поэтому нужен осмысленный дефолт.
  const previousCleaners = Array.isArray(base.selectedCleanerUserIds)
    ? (base.selectedCleanerUserIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];
  const responsibleCleanerIds = Array.isArray(base.cleaningResponsibles)
    ? (base.cleaningResponsibles as unknown[])
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>).userId
            : null,
        )
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return {
    ...base,
    rooms: [],
    referenceTable: [],
    cleaningMode: "rooms",
    selectedRoomIds: previousSelected.length > 0 ? previousSelected : roomIds,
    selectedCleanerUserIds:
      previousCleaners.length > 0 ? previousCleaners : responsibleCleanerIds,
  };
}

export function applyRoomScheduleToMatrix(
  config: CleaningDocumentConfig,
  dateKeys: string[],
  mode: "fill-empty" | "overwrite" = "fill-empty",
  /** Cleaning unification 2026-05-08: расписание в rooms-mode хранится
   *  в Room (DB), не в config.rooms. Если caller передаёт map dbRooms —
   *  они приоритетны для определения plan'a (scheduleType + monthDays). */
  dbRooms?: Map<string, RoomScheduleFromDb>,
  /** Ограничить применение плана этими помещениями. Без него overwrite по
   *  одному изменённому помещению стирал будущие отметки у всех. */
  options?: { roomIds?: string[] },
): CleaningDocumentConfig {
  const next = cloneConfig(config);
  const roomIdFilter =
    options?.roomIds && options.roomIds.length > 0
      ? new Set(options.roomIds)
      : null;
  // В overwrite-режиме («План заново») — выходные/праздники по умолчанию
  // помечаем «/» (не проводилась). Менеджер всё равно подтверждает overwrite
  // в confirm-dialog'е, так что неожиданности нет; зато новый период сразу
  // соответствует РФ-производственному календарю и не нужно отдельно
  // нажимать «Отметить выходные «/»». В fill-empty режиме (auto-apply) НЕ
  // делаем — пользовательские отметки сохраняются.

  // Список room-id'ов для применения плана. В pairs-mode = config.rooms[].
  // В rooms-mode также включаем selectedRoomIds которые ещё не имеют
  // config.rooms-entry — они работают с дефолтным расписанием
  // (currentDays=127, generalDays=0 → T каждый день, никогда G).
  // Без этого rooms-mode матрица оставалась бы пустой пока менеджер не
  // откроет каждое помещение и не сохранит scope.
  const configRoomById = new Map(next.rooms.map((r) => [r.id, r]));
  type SchedulableRoom = { id: string; currentDays?: number; generalDays?: number };
  const schedulable: SchedulableRoom[] = [...next.rooms];
  if (next.cleaningMode === "rooms" && Array.isArray(next.selectedRoomIds)) {
    for (const id of next.selectedRoomIds) {
      if (!configRoomById.has(id)) {
        schedulable.push({ id }); // дефолтные маски
      }
    }
  }

  for (const room of schedulable) {
    if (roomIdFilter && !roomIdFilter.has(room.id)) continue;
    // Cleaning unification: предпочитаем Room (DB) если caller её передал.
    const dbRoom = dbRooms?.get(room.id);
    const currentMask = typeof (dbRoom?.currentDays ?? room.currentDays) === "number"
      ? (dbRoom?.currentDays ?? room.currentDays ?? 127)
      : 127;
    const generalMask = typeof (dbRoom?.generalDays ?? room.generalDays) === "number"
      ? (dbRoom?.generalDays ?? room.generalDays ?? 0)
      : 0;
    const currentScheduleType = dbRoom?.currentScheduleType ?? "weekly";
    const generalScheduleType = dbRoom?.generalScheduleType ?? "weekly";
    const currentMonthDaysSet = new Set(dbRoom?.currentMonthDays ?? []);
    const generalMonthDaysSet = new Set(dbRoom?.generalMonthDays ?? []);
    const row = next.matrix[room.id] ? { ...next.matrix[room.id] } : {};
    for (const dateKey of dateKeys) {
      const date = new Date(`${dateKey}T00:00:00Z`);
      const jsDow = date.getUTCDay();
      const mondayIdx = (jsDow + 6) % 7;
      const bit = 1 << mondayIdx;
      const dayOfMonth = date.getUTCDate();
      // Last day of month detection — точно если у даты UTC это последний
      // календарный день.
      const lastDayOfThisMonth = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
      ).getUTCDate();
      const isLastDay = dayOfMonth === lastDayOfThisMonth;

      function matchesSchedule(
        scheduleType: "weekly" | "monthly",
        weeklyMask: number,
        monthDaysSet: Set<string>,
      ): boolean {
        if (scheduleType === "monthly") {
          if (monthDaysSet.has(String(dayOfMonth))) return true;
          if (isLastDay && monthDaysSet.has("last")) return true;
          return false;
        }
        // weekly
        return (weeklyMask & bit) !== 0;
      }

      // Generalная имеет приоритет над текущей: если день в обоих
      // масках — пишем G, иначе T. Если день — выходной/праздник
      // и mode=overwrite — пишем «/». Иначе пусто.
      let plan: CleaningMatrixValue = "";
      const dayKind = getCalendarDayKind(dateKey).kind;
      const isNonWorkingDay = dayKind === "weekend" || dayKind === "holiday";
      const generalMatch = matchesSchedule(
        generalScheduleType,
        generalMask,
        generalMonthDaysSet,
      );
      const currentMatch = matchesSchedule(
        currentScheduleType,
        currentMask,
        currentMonthDaysSet,
      );
      // План: general > current > /-на-выходных (только overwrite). Если
      // менеджер явно поставил Sat в generalMask — Sat остаётся G, потому
      // что это его осознанный выбор. Если Sat НЕ в маске — выходной по
      // календарю → «/».
      if (generalMatch) {
        plan = "G";
      } else if (currentMatch) {
        plan = "T";
      } else if (mode === "overwrite" && isNonWorkingDay) {
        plan = "/" as CleaningMatrixValue;
      }
      if (!plan) {
        // Overwrite + нет плана + рабочий день → стираем (если что было).
        if (mode === "overwrite") {
          delete row[dateKey];
        }
        continue;
      }
      const existing = row[dateKey];
      // Sentinel «—» (от bulk-clear) трактуется как empty: fill-empty
      // должен писать план поверх sentinel. Иначе после «Очистить всё»
      // → «Заполнить по плану» прошлые клетки оставались пустыми
      // (юзер: «клетки до сегодня не заполняются»).
      const isEmptyOrSentinel =
        !existing || existing === "" || existing === CLEANING_EMPTY_SENTINEL;
      if (mode === "fill-empty" && !isEmptyOrSentinel) continue;
      row[dateKey] = plan;
    }
    if (Object.keys(row).length > 0) {
      next.matrix[room.id] = row;
    } else {
      delete next.matrix[room.id];
    }
  }
  next.marks = next.matrix;
  return syncCompatibilityFields(next);
}

/**
 * Псевдо-rowId для подписей ответственных в matrix. Живут в той же
 * matrix, что и room-строки, но никогда не участвуют в плане/TF-синке.
 */
export const CLEANING_SIGNATURE_ROW_ID = "__cleaning_signature__";
export const CONTROL_SIGNATURE_ROW_ID = "__control_signature__";

/**
 * Маркер АВТОМАТИЧЕСКОЙ подписи. Значение в matrix хранится как
 * `auto:С1` — визуально это тот же «С1», но по префиксу мы отличаем
 * подпись, проставленную системой при ручном заполнении Т/Г, от
 * подписи, которую менеджер поставил кликом сам.
 *
 * Правила:
 *   • читатели (cleaningCodeForDay/controlCodeForDay) снимают префикс
 *     и работают с чистым кодом — отображение не меняется;
 *   • автоснятие подписи (когда день полностью очищен) трогает ТОЛЬКО
 *     значения с префиксом;
 *   • клик менеджера по подписи всегда пишет значение БЕЗ префикса —
 *     то есть подпись «становится ручной» и больше не снимается.
 *
 * Legacy-совместимость: старые конфиги хранят подпись без префикса,
 * `stripAutoSignatureMarker` для них — no-op, а автоснятие их не
 * трогает (трактуются как ручные).
 */
export const CLEANING_AUTO_SIGNATURE_PREFIX = "auto:";

export function isAutoSignatureValue(value: unknown): boolean {
  return (
    typeof value === "string" && value.startsWith(CLEANING_AUTO_SIGNATURE_PREFIX)
  );
}

export function markAutoSignature(code: string): string {
  return `${CLEANING_AUTO_SIGNATURE_PREFIX}${code}`;
}

export function stripAutoSignatureMarker(value: string): string {
  return isAutoSignatureValue(value)
    ? value.slice(CLEANING_AUTO_SIGNATURE_PREFIX.length)
    : value;
}

/**
 * Список room-id'ов, для которых имеет смысл план/матрица: строки из
 * `config.rooms` плюс (в rooms-режиме) `selectedRoomIds`, у которых нет
 * своей записи в `config.rooms`. Та же логика, что в
 * `applyRoomScheduleToMatrix` — вынесена, чтобы «/» за прошедшие дни
 * ставился ровно по тем же строкам.
 */
export function collectMatrixRoomIds(config: CleaningDocumentConfig): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const room of config.rooms) {
    if (room.id && !seen.has(room.id)) {
      seen.add(room.id);
      ids.push(room.id);
    }
  }
  if (config.cleaningMode === "rooms" && Array.isArray(config.selectedRoomIds)) {
    for (const id of config.selectedRoomIds) {
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/** Подпись строки помещения, которого больше нет в справочнике. */
export const CLEANING_DELETED_ROOM_SUFFIX = "помещение удалено";

/** Имя строки удалённого помещения: снимок из конфига + пометка. */
export function formatDeletedCleaningRoomName(name?: string | null): string {
  const base = (name ?? "").trim() || "Помещение";
  return `${base} (${CLEANING_DELETED_ROOM_SUFFIX})`;
}

/** Есть ли у строки помещения хоть одна непустая отметка в matrix. */
export function hasCleaningRoomMarks(
  config: Pick<CleaningDocumentConfig, "matrix">,
  roomId: string
): boolean {
  const row = config.matrix?.[roomId];
  if (!row) return false;
  return Object.values(row).some(
    (value) =>
      typeof value === "string" &&
      value !== "" &&
      value !== CLEANING_EMPTY_SENTINEL
  );
}

/**
 * Помещения, удалённые из справочника, но с отметками в журнале.
 *
 * ПОЧЕМУ строку оставляем: отметки уборки — данные ХАССП, молча стирать
 * их нельзя. Пустая строка удалённого помещения, наоборот, не нужна —
 * она только мешает. Нормализация конфига отметки не трогает вовсе; этот
 * список нужен экрану и печати, чтобы показывать строку одинаково.
 */
export function listDeletedCleaningRoomsWithMarks(
  config: CleaningDocumentConfig,
  knownRoomIds: Iterable<string>
): { id: string; name: string }[] {
  const known = new Set(knownRoomIds);
  const snapshotById = new Map(config.rooms.map((room) => [room.id, room.name]));
  const seen = new Set<string>();
  const result: { id: string; name: string }[] = [];
  for (const roomId of collectMatrixRoomIds(config)) {
    if (known.has(roomId) || seen.has(roomId)) continue;
    seen.add(roomId);
    if (!hasCleaningRoomMarks(config, roomId)) continue;
    result.push({
      id: roomId,
      name: formatDeletedCleaningRoomName(snapshotById.get(roomId)),
    });
  }
  return result;
}

/**
 * Проставляет «/» («уборка не проводилась») во все ПРОШЕДШИЕ дни
 * периода, у которых нет плановой отметки.
 *
 * Как на эталоне haccp-online: строка помещения, добавленная в середине
 * периода, не оставляет за собой «дыру» — дни до сегодняшнего явно
 * помечаются «уборка не проводилась».
 *
 * Правила:
 *   • трогаем только дни СТРОГО меньше `todayKey` — сегодня и будущее
 *     остаются как есть;
 *   • пишем только в ПУСТЫЕ ячейки (нет значения или пустая строка).
 *     Плановые Т/Г, ручные отметки и sentinel «—» (явная очистка
 *     менеджером) не перетираются;
 *   • строки подписей (`__cleaning_signature__` и др.) не трогаются —
 *     обходим только room-строки;
 *   • идемпотентно: повторный вызов ничего не меняет.
 *
 * `options.roomIds` ограничивает применение подмножеством помещений
 * (используется при добавлении новых строк, чтобы не влиять на уже
 * существующие).
 */
export function fillPastDaysNotPerformed(
  config: CleaningDocumentConfig,
  dateKeys: string[],
  options: { todayKey?: string; roomIds?: string[] } = {},
): CleaningDocumentConfig {
  const todayKey = options.todayKey || toDateKey(new Date());
  const pastKeys = dateKeys.filter((key) => key && key < todayKey);
  if (pastKeys.length === 0) return config;

  // Явный список помещений (добавление новых строк) имеет приоритет;
  // иначе берём все room-строки матрицы.
  const roomIds = (options.roomIds ?? collectMatrixRoomIds(config)).filter(
    Boolean,
  );
  if (roomIds.length === 0) return config;

  const next = cloneConfig(config);
  let changed = false;
  for (const roomId of roomIds) {
    const row = { ...(next.matrix[roomId] ?? {}) };
    let rowChanged = false;
    for (const dateKey of pastKeys) {
      const existing = row[dateKey];
      if (existing === undefined || existing === "") {
        row[dateKey] = "/";
        rowChanged = true;
      }
    }
    if (rowChanged) {
      next.matrix[roomId] = row;
      changed = true;
    }
  }
  if (!changed) return config;
  next.marks = next.matrix;
  return syncCompatibilityFields(next);
}

/**
 * Автоподписи ответственных — серверный порт клиентского
 * `applyAutoSignatures` (`cleaning-document-client.tsx`), для движка
 * автозаполнения (cron 06:00 и `/api/organizations/auto-journals/apply`).
 *
 * Правила (те же, что у клиента, — иначе крон и ручное заполнение
 * спорили бы за одни клетки):
 *   • день, где есть хоть одна отметка Т/Г в room-строках, получает
 *     `auto:С1` в строках подписей уборки и контроля;
 *   • дни из `options.completionDays` (TF-completions) не трогаем —
 *     подпись там считается по completions;
 *   • ручные подписи (без `auto:`-префикса, включая sentinel «—»)
 *     не перетираются и не снимаются;
 *   • устаревшие авто-подписи снимаются, когда все отметки дня сняты;
 *   • идемпотентно: повторный вызов на тех же данных возвращает config
 *     как есть.
 */
export function applyCleaningAutoSignatures(
  config: CleaningDocumentConfig,
  dateKeys: string[],
  options: { completionDays?: ReadonlySet<string> } = {},
): CleaningDocumentConfig {
  // Автоподпись хранит стабильную ссылку на сотрудника (`uid:<id>`), а не
  // код «СN»: код — только отображение и зависит от состава уборщиков.
  const cleaningCode =
    cleaningSignatureRef(listCleaningCodeEntries(config)[0]?.userId) ||
    config.cleaningResponsibles[0]?.code ||
    "";
  const controlCode =
    cleaningSignatureRef(listControlCodeEntries(config)[0]?.userId) ||
    config.controlResponsibles[0]?.code ||
    "";
  const roomIds = collectMatrixRoomIds(config);
  if (roomIds.length === 0) return config;

  const cleaningRow = { ...(config.matrix[CLEANING_SIGNATURE_ROW_ID] ?? {}) };
  const controlRow = { ...(config.matrix[CONTROL_SIGNATURE_ROW_ID] ?? {}) };
  let changed = false;

  function applyOne(
    row: Record<string, CleaningMatrixValue>,
    dateKey: string,
    performed: boolean,
    code: string,
  ): boolean {
    const current = row[dateKey];
    if (performed) {
      if (!code) return false;
      const want = markAutoSignature(code);
      if (current === undefined) {
        row[dateKey] = want;
        return true;
      }
      if (isAutoSignatureValue(current) && current !== want) {
        row[dateKey] = want;
        return true;
      }
      return false;
    }
    if (current !== undefined && isAutoSignatureValue(current)) {
      delete row[dateKey];
      return true;
    }
    return false;
  }

  for (const dateKey of dateKeys) {
    if (options.completionDays?.has(dateKey)) continue;
    const performed = roomIds.some((id) => {
      const value = config.matrix[id]?.[dateKey];
      return value === "T" || value === "G";
    });
    if (applyOne(cleaningRow, dateKey, performed, cleaningCode)) changed = true;
    if (applyOne(controlRow, dateKey, performed, controlCode)) changed = true;
  }
  if (!changed) return config;

  const nextMatrix = cloneMatrix(config.matrix);
  if (Object.keys(cleaningRow).length > 0) {
    nextMatrix[CLEANING_SIGNATURE_ROW_ID] = cleaningRow;
  } else {
    delete nextMatrix[CLEANING_SIGNATURE_ROW_ID];
  }
  if (Object.keys(controlRow).length > 0) {
    nextMatrix[CONTROL_SIGNATURE_ROW_ID] = controlRow;
  } else {
    delete nextMatrix[CONTROL_SIGNATURE_ROW_ID];
  }
  return { ...config, matrix: nextMatrix, marks: nextMatrix };
}

export function deleteCleaningRows(config: CleaningDocumentConfig, rowIds: string[]) {
  const rowIdSet = new Set(rowIds);
  const next = cloneConfig(config);

  next.rooms = next.rooms.filter((room) => !rowIdSet.has(room.id));
  next.cleaningResponsibles = next.cleaningResponsibles.filter((item) => !rowIdSet.has(item.id));
  next.controlResponsibles = next.controlResponsibles.filter((item) => !rowIdSet.has(item.id));
  next.matrix = clearRowsFromMatrix(next.matrix, rowIds);
  next.marks = next.matrix;

  if (next.referenceTable.length > 0) {
    next.referenceTable = next.referenceTable.filter((row) => !rowIdSet.has(row.roomId));
  }

  return syncCompatibilityFields(next);
}

export function addCleaningRoomRow(config: CleaningDocumentConfig, room = createCleaningRoom()) {
  return syncCompatibilityFields({
    ...cloneConfig(config),
    rooms: [...config.rooms, room],
  });
}

export function editCleaningRoomRow(
  config: CleaningDocumentConfig,
  roomId: string,
  patch: Partial<CleaningRoomItem>
) {
  return syncCompatibilityFields({
    ...cloneConfig(config),
    rooms: config.rooms.map((room) => (room.id === roomId ? { ...room, ...patch } : room)),
  });
}

export function deleteCleaningRoomRow(config: CleaningDocumentConfig, roomId: string) {
  return deleteCleaningRows(config, [roomId]);
}

export function addCleaningResponsibleRow(
  config: CleaningDocumentConfig,
  kind: CleaningResponsibleKind,
  responsible = createCleaningResponsible({
    kind,
    title: kind === "control" ? "Ответственный за контроль" : "Ответственный за уборку",
    userId: "",
    userName: "",
  })
) {
  const next = cloneConfig(config);
  if (kind === "cleaning") {
    next.cleaningResponsibles = [...next.cleaningResponsibles, responsible];
  } else {
    next.controlResponsibles = [...next.controlResponsibles, responsible];
  }
  return syncCompatibilityFields(next);
}

export function editCleaningResponsibleRow(
  config: CleaningDocumentConfig,
  kind: CleaningResponsibleKind,
  responsibleId: string,
  patch: Partial<CleaningResponsible>
) {
  const next = cloneConfig(config);
  if (kind === "cleaning") {
    next.cleaningResponsibles = next.cleaningResponsibles.map((item) =>
      item.id === responsibleId ? { ...item, ...patch, kind } : item
    );
  } else {
    next.controlResponsibles = next.controlResponsibles.map((item) =>
      item.id === responsibleId ? { ...item, ...patch, kind } : item
    );
  }
  return syncCompatibilityFields(next);
}

export function deleteCleaningResponsibleRow(
  config: CleaningDocumentConfig,
  kind: CleaningResponsibleKind,
  responsibleId: string
) {
  const next = cloneConfig(config);
  if (kind === "cleaning") {
    next.cleaningResponsibles = next.cleaningResponsibles.filter((item) => item.id !== responsibleId);
  } else {
    next.controlResponsibles = next.controlResponsibles.filter((item) => item.id !== responsibleId);
  }
  next.matrix = clearRowsFromMatrix(next.matrix, [responsibleId]);
  next.marks = next.matrix;
  return syncCompatibilityFields(next);
}

// ---------------------------------------------------------------------------
// Auto-fill
// ---------------------------------------------------------------------------

export function buildCleaningAutoFillMatrix(params: {
  config: CleaningDocumentConfig;
  dateFrom: string;
  dateTo: string;
}) {
  return applyCleaningAutoFillToConfig(params);
}

function getAutoFillDateKeys(params: {
  dateFrom: string;
  dateTo: string;
  skipWeekends: boolean;
  stopAtToday?: boolean;
}) {
  const todayKey = toDateKey(new Date());
  return buildDateKeys(params.dateFrom, params.dateTo).filter((dateKey) => {
    if (params.stopAtToday !== false && dateKey > todayKey) return false;
    if (params.skipWeekends && isWeekend(dateKey)) return false;
    return true;
  });
}

export function applyCleaningAutoFillToConfig(params: {
  config: CleaningDocumentConfig;
  dateFrom: string;
  dateTo: string;
}) {
  const config = syncCompatibilityFields(cloneConfig(params.config));
  const dateKeys = getAutoFillDateKeys({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    skipWeekends: config.autoFill.skipWeekends || config.settings.skipWeekends || config.skipWeekends,
    stopAtToday: config.autoFill.fillUntilToday,
  });

  const roomMark = normalizeMatrixValue(config.autoFill.defaultRoomMark || "T") || "T";

  for (const dateKey of dateKeys) {
    for (const room of config.rooms) {
      const row = config.matrix[room.id] || {};
      if (!row[dateKey]) {
        config.matrix = setMatrixCell(config.matrix, room.id, dateKey, roomMark);
      }
    }

    config.cleaningResponsibles.forEach((responsible, index) => {
      const row = config.matrix[responsible.id] || {};
      if (!row[dateKey]) {
        config.matrix = setMatrixCell(config.matrix, responsible.id, dateKey, responsible.code || `C${index + 1}`);
      }
    });

    config.controlResponsibles.forEach((responsible, index) => {
      const row = config.matrix[responsible.id] || {};
      if (!row[dateKey]) {
        config.matrix = setMatrixCell(config.matrix, responsible.id, dateKey, responsible.code || `C${index + 1}`);
      }
    });
  }

  config.marks = config.matrix;
  return syncCompatibilityFields(config);
}

export function buildCleaningAutoFillEntries(params: {
  config: CleaningDocumentConfig;
  dateFrom: string;
  dateTo: string;
  users: { id: string; name: string }[];
}): Array<{ date: string; data: CleaningEntryData }> {
  void params.users;
  const config = applyCleaningAutoFillToConfig({
    config: params.config,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  const dateKeys = getAutoFillDateKeys({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    skipWeekends: config.autoFill.skipWeekends || config.settings.skipWeekends || config.skipWeekends,
    stopAtToday: config.autoFill.fillUntilToday,
  });

  return dateKeys.map((dateKey) => ({
    date: dateKey,
    data: {
      activities: config.rooms
        .map((room): CleaningActivityEntry | null => {
          const value = config.matrix[room.id]?.[dateKey] || "";
          return value
            ? {
                type: "wetCleaning" as CleaningActivityType,
                times: [value],
                responsibleName: room.name,
              }
            : null;
        })
        .filter((item): item is CleaningActivityEntry => item !== null),
    },
  }));
}

// ---------------------------------------------------------------------------
// Legacy compatibility shims
// ---------------------------------------------------------------------------

/** @deprecated Part of the legacy room-by-day model */
export type CleaningMark = "routine" | "general";

/** @deprecated Part of the legacy room-by-day model */
export type CleaningConfigItem = {
  id: string;
  sourceAreaId: string | null;
  name: string;
  detergent: string;
  routineScope: string;
  generalScope: string;
};

export function createCleaningConfigItem(
  overrides: Partial<CleaningConfigItem> = {}
): CleaningConfigItem {
  return {
    id: overrides.id || createId("cleaning-item"),
    sourceAreaId: overrides.sourceAreaId || null,
    name: normalizeText(overrides.name, "помещение"),
    detergent: normalizeText(overrides.detergent),
    routineScope: normalizeText(overrides.routineScope),
    generalScope: normalizeText(overrides.generalScope),
  };
}

export function getCleaningMarkCode(mark: CleaningMark | null | undefined) {
  if (mark === "routine") return "T";
  if (mark === "general") return "G";
  return "";
}

export function createEmptyCleaningEntryData(mark: CleaningMark | null = null): { mark: CleaningMark | null } {
  return { mark };
}

export function getDefaultCleaningDocumentConfig() {
  return defaultCleaningDocumentConfig();
}

export function buildCleaningAutoFillRows(params: {
  config: CleaningDocumentConfig;
  dateFrom: Date | string;
  dateTo: Date | string;
  referenceDate?: Date | string;
}): Array<{ employeeId: string; date: Date; data: { mark: CleaningMark | null } }> {
  void params.referenceDate;
  const dateFrom = typeof params.dateFrom === "string" ? params.dateFrom : toDateKey(params.dateFrom);
  const dateTo = typeof params.dateTo === "string" ? params.dateTo : toDateKey(params.dateTo);
  const config = applyCleaningAutoFillToConfig({
    config: params.config,
    dateFrom,
    dateTo,
  });

  const dateKeys = getAutoFillDateKeys({
    dateFrom,
    dateTo,
    skipWeekends: config.autoFill.skipWeekends || config.settings.skipWeekends || config.skipWeekends,
    stopAtToday: config.autoFill.fillUntilToday,
  });

  return dateKeys.flatMap((dateKey) =>
    config.rooms.map((room) => ({
      employeeId: room.id,
      date: new Date(`${dateKey}T00:00:00`),
      data: {
        mark:
          config.matrix[room.id]?.[dateKey] === "G"
            ? "general"
            : config.matrix[room.id]?.[dateKey] === "T"
              ? "routine"
              : null,
      },
    }))
  );
}
