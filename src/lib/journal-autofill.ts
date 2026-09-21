/**
 * Единый движок ежедневного автозаполнения журналов.
 *
 * Точки входа:
 *   - cron 06:00 `/api/cron/journal-automation` (org-driven автоматика);
 *   - cron 05:00 `/api/cron/auto-fill-journals` (per-doc тумблер);
 *   - `POST /api/organizations/auto-journals/apply` (букфилл при
 *     включении mid-period);
 *   - per-doc действие `apply_auto_fill`.
 *
 * Диспетчеризация — по capability-карте (`journal-autofill-capability.ts`):
 *   • "staff"         → `applyStaffJournalAutoFill` (без изменений);
 *   • "per-day"       → одна строка на дату, матчинг записи ПО ДАТЕ
 *                       (не по employeeId — это чинит дубли строки при
 *                       IoT-записи climate от другого employeeId);
 *   • "config-matrix" → cleaning: план Т/Г по маскам помещений, «/» на
 *                       прошедшие пустые дни, авто-подписи `auto:С1`.
 *
 * Идемпотентность: пишем только в пустые строки/ячейки, строки создаём
 * через `createMany skipDuplicates`. Повторный прогон — no-op.
 */
import type { PrismaClient } from "@prisma/client";
import { toDateKey, isWeekend } from "@/lib/hygiene-document";
import { isAutoSeededEntry, NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import {
  recordAutoFillUndo,
  snapshotBeforeAutoFill,
} from "@/lib/journal-autofill-undo";
import { getAutofillCapability } from "@/lib/journal-autofill-capability";
import { applyStaffJournalAutoFill } from "@/lib/staff-journal-autofill";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  buildClimateAutoFillEntryData,
  mergeClimateEntryData,
  normalizeClimateDocumentConfig,
  normalizeClimateEntryData,
  syncClimateEntryDataWithConfig,
  type ClimateDocumentConfig,
  type ClimateEntryData,
} from "@/lib/climate-document";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  buildColdEquipmentAutoFillEntryData,
  mergeColdEquipmentEntryData,
  normalizeColdEquipmentDocumentConfig,
  normalizeColdEquipmentEntryData,
  syncColdEquipmentEntryDataWithConfig,
  type ColdEquipmentDocumentConfig,
  type ColdEquipmentEntryData,
} from "@/lib/cold-equipment-document";
import {
  UV_LAMP_RUNTIME_TEMPLATE_CODE,
  normalizeUvRuntimeDocumentConfig,
} from "@/lib/uv-lamp-runtime-document";
import { applyUvRuntimeAutoFill } from "@/lib/uv-lamp-runtime-autofill";
import {
  CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE,
  buildCleaningVentilationAutoFillEntryData,
  isCleaningVentilationEntryDataEmpty,
  normalizeCleaningVentilationConfig,
  normalizeCleaningVentilationEntryData,
} from "@/lib/cleaning-ventilation-checklist-document";
import {
  GLASS_CONTROL_TEMPLATE_CODE,
  buildGlassControlAutoFillEntryData,
} from "@/lib/glass-control-document";
import {
  FRYER_OIL_TEMPLATE_CODE,
  buildFryerOilAutoFillEntryData,
  isFryerOilEntryDataEmpty,
  normalizeFryerOilDocumentConfig,
  normalizeFryerOilEntryData,
  type FryerOilEntryData,
} from "@/lib/fryer-oil-document";
import {
  applyCleaningAutoSignatures,
  applyRoomScheduleToMatrix,
  fillPastDaysNotPerformed,
  listCleaningRoomCompletions,
  normalizeCleaningDocumentConfig,
  toRoomScheduleMap,
  type CleaningMatrixMap,
} from "@/lib/cleaning-document";
import { fetchCleaningRooms } from "@/lib/journal-auto-create";
import { pickPrimaryManager } from "@/lib/user-roles";

type EngineDb = Pick<
  PrismaClient,
  | "journalDocumentEntry"
  | "journalDocument"
  | "room"
  | "staffWorkOffDay"
  | "staffVacation"
  | "staffSickLeave"
  | "user"
>;

export type AutoFillUser = { id: string; name: string; role: string };

export type AutoFillDocumentInput = {
  id: string;
  organizationId: string;
  /** Точка документа: помещения уборки берутся только её. */
  buildingId?: string | null;
  templateCode: string;
  config: unknown;
  responsibleUserId: string | null;
  responsibleTitle: string | null;
  dateFrom: Date;
  dateTo: Date;
};

export type AutoFillResult = {
  created: number;
  updated: number;
  skipped: number;
  skipReasons: string[];
};

type EntryRow = {
  id: string;
  employeeId: string;
  date: Date;
  data: unknown;
};

function emptyResult(): AutoFillResult {
  return { created: 0, updated: 0, skipped: 0, skipReasons: [] };
}

function utcDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Сырые данные записи «пустые»: null / `{}` / сид-болванка. */
function isRawEntryDataEmpty(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  if (typeof data !== "object" || Array.isArray(data)) return false;
  if (isAutoSeededEntry(data)) return true;
  return Object.keys(data as Record<string, unknown>).length === 0;
}

// ---------------------------------------------------------------------------
// Copy-forward утилиты («на основе последнего журнала»)
// ---------------------------------------------------------------------------

/**
 * Ключи, которые НЕ переносятся copy-forward'ом: повторяющийся каждый
 * день текст инцидента/корректировки выглядит абсурдно, а сид-маркер —
 * служебный.
 */
export const COPY_FORWARD_SKIP_KEYS: readonly string[] = [
  "corrections",
  "measures",
  "comment",
  "note",
  "damageInfo",
  "_autoSeeded",
];

/** Детерминированный хеш строки → [0, 1). FNV-1a 32-bit. */
export function hashToUnit(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}

function decimalsOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Deep-walk copy-forward источника с детерминированным джиттером чисел.
 *
 * v1 подключает только fryer_oil, и там `jitterPct = 0` (перенос
 * байт-в-байт через `buildFryerOilAutoFillEntryData`) — сам джиттер
 * задел на будущее «с использованием ИИ»: числа сдвигаются в пределах
 * ±jitterPct с сохранением точности источника, seed делает результат
 * воспроизводимым.
 */
export function copyForwardWithJitter(
  source: Record<string, unknown>,
  seedBase: string,
  options: {
    skipKeys?: readonly string[];
    jitterPct?: number;
    overrides?: Record<string, unknown>;
  } = {}
): Record<string, unknown> {
  const skip = new Set(options.skipKeys ?? COPY_FORWARD_SKIP_KEYS);
  const jitterPct = options.jitterPct ?? 0;

  function walk(value: unknown, path: string): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, `${path}[${index}]`));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (skip.has(key)) continue;
        out[key] = walk(item, `${path}.${key}`);
      }
      return out;
    }
    if (typeof value === "number" && Number.isFinite(value) && jitterPct > 0) {
      const shift = (hashToUnit(`${seedBase}:${path}`) - 0.5) * 2 * jitterPct;
      const decimals = decimalsOf(value);
      const factor = 10 ** decimals;
      return Math.round(value * (1 + shift) * factor) / factor;
    }
    return value;
  }

  const walked = walk(source, "$") as Record<string, unknown>;
  return { ...walked, ...(options.overrides ?? {}) };
}

/**
 * Первый пригодный источник copy-forward из списка записей (свежие —
 * первыми): не сид-болванка и не пустая строка.
 */
export function pickCopyForwardCandidate(
  entries: Array<{ data: unknown }>
): FryerOilEntryData | null {
  for (const entry of entries) {
    if (isRawEntryDataEmpty(entry.data)) continue;
    const normalized = normalizeFryerOilEntryData(entry.data);
    if (!isFryerOilEntryDataEmpty(normalized)) return normalized;
  }
  return null;
}

/**
 * «Последнее успешное заполнение» журнала — сырые данные записи:
 *   1) предыдущий заполненный день ЭТОГО документа;
 *   2) последний заполненный день ПРЕДЫДУЩЕГО документа шаблона
 *      (фильтр `NOT_AUTO_SEEDED` — см. Postgres-gotcha в
 *      journal-entry-filters.ts);
 *   3) null — источника нет, билдер сгенерирует по config.
 *
 * `pick` отсеивает кандидатов (по умолчанию — непустые данные).
 */
export async function loadLastFilledEntryData(
  db: Pick<PrismaClient, "journalDocumentEntry" | "journalDocument">,
  params: {
    document: AutoFillDocumentInput;
    before: Date;
    pick?: (data: unknown) => boolean;
  }
): Promise<Record<string, unknown> | null> {
  const { document, before } = params;
  const accept = params.pick ?? ((data: unknown) => !isRawEntryDataEmpty(data));
  const choose = (rows: Array<{ data: unknown }>) => {
    for (const row of rows) {
      if (isRawEntryDataEmpty(row.data)) continue;
      if (!accept(row.data)) continue;
      return row.data as Record<string, unknown>;
    }
    return null;
  };
  const ownCandidates = await db.journalDocumentEntry.findMany({
    where: {
      documentId: document.id,
      date: { lt: before },
      ...NOT_AUTO_SEEDED,
    },
    orderBy: { date: "desc" },
    take: 15,
    select: { data: true },
  });
  const own = choose(ownCandidates);
  if (own) return own;

  const previousDoc = await db.journalDocument.findFirst({
    where: {
      organizationId: document.organizationId,
      template: { code: document.templateCode },
      id: { not: document.id },
      dateFrom: { lt: document.dateFrom },
    },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!previousDoc) return null;

  const prevCandidates = await db.journalDocumentEntry.findMany({
    where: { documentId: previousDoc.id, ...NOT_AUTO_SEEDED },
    orderBy: { date: "desc" },
    take: 15,
    select: { data: true },
  });
  return choose(prevCandidates);
}

/** Источник copy-forward для фритюра (см. loadLastFilledEntryData). */
export async function loadCopyForwardSource(
  db: Pick<PrismaClient, "journalDocumentEntry" | "journalDocument">,
  params: { document: AutoFillDocumentInput; before: Date }
): Promise<FryerOilEntryData | null> {
  const raw = await loadLastFilledEntryData(db, {
    ...params,
    pick: (data) => !isFryerOilEntryDataEmpty(normalizeFryerOilEntryData(data)),
  });
  return raw ? normalizeFryerOilEntryData(raw) : null;
}

/** Разброс при переносе замеров «на основании прошлого заполнения». */
export const COPY_FORWARD_JITTER_PCT = 0.02;

/** Зажимает замеры климата в нормы помещения из config. */
export function clampClimateToNorms(
  data: ClimateEntryData,
  config: ClimateDocumentConfig
): ClimateEntryData {
  const clamp = (value: number | null, min: number | null, max: number | null) => {
    if (value === null) return null;
    let next = value;
    if (typeof min === "number") next = Math.max(next, min);
    if (typeof max === "number") next = Math.min(next, max);
    return next;
  };
  for (const room of config.rooms) {
    const byTime = data.measurements[room.id];
    if (!byTime) continue;
    for (const time of Object.keys(byTime)) {
      const m = byTime[time];
      if (!m) continue;
      byTime[time] = {
        temperature: room.temperature.enabled
          ? clamp(m.temperature, room.temperature.min, room.temperature.max)
          : null,
        humidity: room.humidity.enabled
          ? clamp(m.humidity, room.humidity.min, room.humidity.max)
          : null,
      };
    }
  }
  return data;
}

/** Зажимает температуры холодильников в нормы оборудования из config. */
export function clampColdEquipmentToNorms(
  data: ColdEquipmentEntryData,
  config: ColdEquipmentDocumentConfig
): ColdEquipmentEntryData {
  for (const item of config.equipment) {
    const value = data.temperatures[item.id];
    if (typeof value !== "number") continue;
    let next = value;
    if (typeof item.min === "number") next = Math.max(next, item.min);
    if (typeof item.max === "number") next = Math.min(next, item.max);
    data.temperatures[item.id] = next;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Диспетчер
// ---------------------------------------------------------------------------

/**
 * Автозаполнение документа на переданные даты. Возвращает счётчики для
 * тостов/логов; `skipReasons` объясняет пропуски («no-responsible» и пр.).
 */
export async function applyJournalAutoFill(
  db: EngineDb,
  params: {
    document: AutoFillDocumentInput;
    /** Даты YYYY-MM-DD, все ≤ сегодня (cron передаёт только сегодня). */
    dateKeys: string[];
    /** Список сотрудников для staff-журналов. */
    employeeIds?: string[];
    /** Ростер орги — fallback-ответственный и имена для подписей. */
    users?: AutoFillUser[];
    /**
     * «Закрыть день»: замеры (климат, холодильники) переносятся с
     * последнего заполненного дня с небольшим разбросом и зажимом в
     * нормы, а не генерируются заново. Cron по умолчанию не включает.
     */
    copyForward?: boolean;
    /**
     * Записать журнал отката (`config.autoFillUndo`), чтобы выключение
     * тумблера могло вернуть журнал как было. Включают автоматические
     * пути: ночной крон и догон при включении тумблера.
     */
    recordUndo?: boolean;
  }
): Promise<AutoFillResult> {
  const capability = getAutofillCapability(params.document.templateCode);
  const dateKeys = [...new Set(params.dateKeys)].sort();
  if (!capability) {
    return {
      created: 0,
      updated: 0,
      skipped: dateKeys.length,
      skipReasons: ["unsupported"],
    };
  }
  if (dateKeys.length === 0) return emptyResult();

  const run = async (): Promise<AutoFillResult> => {
    if (capability === "staff") {
      return applyStaffCapability(db, { ...params, dateKeys });
    }
    if (capability === "config-matrix") {
      return applyCleaningConfigAutoFill(db, {
        document: params.document,
        dateKeys,
      });
    }
    return applyPerDayJournalAutoFill(db, { ...params, dateKeys });
  };

  // Без журнала отката — ручные сценарии («Закрыть день»): человек сам
  // нажал кнопку и ждёт, что запись останется.
  if (!params.recordUndo) return run();

  const before = await snapshotBeforeAutoFill(db, {
    documentId: params.document.id,
    dateKeys,
    config: params.document.config,
  });
  const result = await run();
  // Конфиг мог измениться прямо в прогоне (журнал уборки пишет матрицу),
  // поэтому перечитываем его, а не берём из входных параметров.
  const fresh = await db.journalDocument.findUnique({
    where: { id: params.document.id },
    select: { config: true },
  });
  await recordAutoFillUndo(db, {
    documentId: params.document.id,
    dateKeys,
    before,
    configAfter: fresh?.config ?? params.document.config,
  }).catch(() => 0);
  return result;
}

async function applyStaffCapability(
  db: EngineDb,
  params: {
    document: AutoFillDocumentInput;
    dateKeys: string[];
    employeeIds?: string[];
  }
): Promise<AutoFillResult> {
  const employeeIds = params.employeeIds ?? [];
  if (employeeIds.length === 0) {
    return {
      created: 0,
      updated: 0,
      skipped: params.dateKeys.length,
      skipReasons: ["no-employees"],
    };
  }
  const entries = await db.journalDocumentEntry.findMany({
    where: {
      documentId: params.document.id,
      date: { in: params.dateKeys.map(utcDate) },
    },
    select: { id: true, employeeId: true, date: true, data: true },
  });
  const filled = await applyStaffJournalAutoFill(db, {
    documentId: params.document.id,
    organizationId: params.document.organizationId,
    templateCode: params.document.templateCode,
    employeeIds,
    dateKeys: params.dateKeys,
    entries,
  });
  return { ...filled, skipped: 0, skipReasons: [] };
}

// ---------------------------------------------------------------------------
// Per-day журналы
// ---------------------------------------------------------------------------

/**
 * Записи по датам: если на дату несколько строк (сид + IoT-запись от
 * другого employeeId) — берём строку с реальными данными. Merge идёт в
 * неё, дубль не создаётся.
 */
function groupEntriesByDate(entries: EntryRow[]): Map<string, EntryRow> {
  const byDate = new Map<string, EntryRow>();
  for (const entry of entries) {
    const key = toDateKey(entry.date);
    const existing = byDate.get(key);
    if (!existing) {
      byDate.set(key, entry);
      continue;
    }
    if (isRawEntryDataEmpty(existing.data) && !isRawEntryDataEmpty(entry.data)) {
      byDate.set(key, entry);
    }
  }
  return byDate;
}

export async function applyPerDayJournalAutoFill(
  db: EngineDb,
  params: {
    document: AutoFillDocumentInput;
    dateKeys: string[];
    users?: AutoFillUser[];
    copyForward?: boolean;
  }
): Promise<AutoFillResult> {
  const { document, dateKeys } = params;
  const copyForward = params.copyForward === true;
  const users = params.users ?? [];
  const result = emptyResult();

  const responsibleUserId =
    document.responsibleUserId || pickPrimaryManager(users)?.id || null;
  if (!responsibleUserId) {
    result.skipped += dateKeys.length;
    result.skipReasons.push("no-responsible");
    return result;
  }

  const entries = await db.journalDocumentEntry.findMany({
    where: { documentId: document.id, date: { in: dateKeys.map(utcDate) } },
    select: { id: true, employeeId: true, date: true, data: true },
    orderBy: { createdAt: "asc" },
  });
  const byDate = groupEntriesByDate(entries);

  async function createEntry(dateKey: string, data: unknown): Promise<void> {
    const created = await db.journalDocumentEntry.createMany({
      data: [
        {
          documentId: document.id,
          employeeId: responsibleUserId as string,
          date: utcDate(dateKey),
          data: data as never,
        },
      ],
      skipDuplicates: true,
    });
    result.created += created.count;
  }

  async function updateEntry(entryId: string, data: unknown): Promise<void> {
    await db.journalDocumentEntry.update({
      where: { id: entryId },
      data: { data: data as never },
    });
    result.updated += 1;
  }

  const code = document.templateCode;

  if (code === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    const config = normalizeClimateDocumentConfig(document.config);
    // Источник «прошлое успешное заполнение»: последний заполненный
    // день до первой даты; по ходу — каждый человеком заполненный день.
    let source: Record<string, unknown> | null = copyForward
      ? await loadLastFilledEntryData(db, { document, before: utcDate(dateKeys[0]) })
      : null;
    for (const dateKey of dateKeys) {
      if (config.skipWeekends && isWeekend(dateKey)) continue;
      const fromConfig = buildClimateAutoFillEntryData({
        config,
        dateKey,
        responsibleTitle: document.responsibleTitle,
      });
      const generated = source
        ? clampClimateToNorms(
            mergeClimateEntryData(
              syncClimateEntryDataWithConfig(
                normalizeClimateEntryData(
                  copyForwardWithJitter(source, `${document.id}:${dateKey}`, {
                    jitterPct: COPY_FORWARD_JITTER_PCT,
                    overrides: { responsibleTitle: document.responsibleTitle },
                  })
                ),
                config
              ),
              fromConfig
            ),
            config
          )
        : fromConfig;
      const existing = byDate.get(dateKey);
      if (copyForward && existing && !isRawEntryDataEmpty(existing.data)) {
        source = existing.data as Record<string, unknown>;
      }
      if (!existing) {
        await createEntry(dateKey, generated);
        continue;
      }
      const current = syncClimateEntryDataWithConfig(
        normalizeClimateEntryData(existing.data),
        config
      );
      // Строка дня может принадлежать не ответственному (QR, TasksFlow):
      // должность документа — его должность, в чужую строку её не пишем.
      const merged = mergeClimateEntryData(
        current,
        existing.employeeId === responsibleUserId
          ? generated
          : { ...generated, responsibleTitle: null }
      );
      // Сравниваем с уже приведённой к настройкам записью: дописывать
      // нечего — не пишем. Раньше сравнение шло с сырой записью, и любое
      // расхождение формы (лишний ключ, слот без нормы) давало запись на
      // каждом прогоне «Закрыть день».
      if (
        JSON.stringify(merged) === JSON.stringify(current) ||
        JSON.stringify(merged) ===
          JSON.stringify(normalizeClimateEntryData(existing.data))
      ) {
        continue;
      }
      await updateEntry(existing.id, merged);
    }
    return result;
  }

  if (code === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    const config = normalizeColdEquipmentDocumentConfig(document.config);
    let source: Record<string, unknown> | null = copyForward
      ? await loadLastFilledEntryData(db, { document, before: utcDate(dateKeys[0]) })
      : null;
    for (const dateKey of dateKeys) {
      if (config.skipWeekends && isWeekend(dateKey)) continue;
      const fromConfig = buildColdEquipmentAutoFillEntryData({
        config,
        dateKey,
        responsibleTitle: document.responsibleTitle,
      });
      const generated = source
        ? clampColdEquipmentToNorms(
            mergeColdEquipmentEntryData(
              syncColdEquipmentEntryDataWithConfig(
                normalizeColdEquipmentEntryData(
                  copyForwardWithJitter(source, `${document.id}:${dateKey}`, {
                    jitterPct: COPY_FORWARD_JITTER_PCT,
                    overrides: { responsibleTitle: document.responsibleTitle },
                  })
                ),
                config
              ),
              fromConfig
            ),
            config
          )
        : fromConfig;
      const existing = byDate.get(dateKey);
      if (copyForward && existing && !isRawEntryDataEmpty(existing.data)) {
        source = existing.data as Record<string, unknown>;
      }
      if (!existing) {
        await createEntry(dateKey, generated);
        continue;
      }
      const current = syncColdEquipmentEntryDataWithConfig(
        normalizeColdEquipmentEntryData(existing.data),
        config
      );
      const merged = mergeColdEquipmentEntryData(current, generated);
      // См. климат выше: нечего дописывать — повторный прогон ничего не
      // пишет (раньше холодильники перезаписывались на каждом прогоне).
      if (
        JSON.stringify(merged) === JSON.stringify(current) ||
        JSON.stringify(merged) ===
          JSON.stringify(normalizeColdEquipmentEntryData(existing.data))
      ) {
        continue;
      }
      await updateEntry(existing.id, merged);
    }
    return result;
  }

  if (code === UV_LAMP_RUNTIME_TEMPLATE_CODE) {
    const filled = await applyUvRuntimeAutoFill(db, {
      documentId: document.id,
      spec: normalizeUvRuntimeDocumentConfig(document.config).spec,
      responsibleUserId,
      dateKeys,
      entries,
    });
    result.created += filled.created;
    result.updated += filled.updated;
    return result;
  }

  if (code === CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE) {
    const config = normalizeCleaningVentilationConfig(document.config, users);
    const data = buildCleaningVentilationAutoFillEntryData(config);
    if (isCleaningVentilationEntryDataEmpty(data)) {
      result.skipped += dateKeys.length;
      result.skipReasons.push("no-enabled-procedures");
      return result;
    }
    const hiddenDates = new Set(config.hiddenDates);
    const checklistEmployeeId =
      config.mainResponsibleUserId &&
      users.some((user) => user.id === config.mainResponsibleUserId)
        ? config.mainResponsibleUserId
        : responsibleUserId;
    for (const dateKey of dateKeys) {
      if (config.skipWeekends && isWeekend(dateKey)) continue;
      if (hiddenDates.has(dateKey)) continue;
      const existing = byDate.get(dateKey);
      if (!existing) {
        const created = await db.journalDocumentEntry.createMany({
          data: [
            {
              documentId: document.id,
              employeeId: checklistEmployeeId,
              date: utcDate(dateKey),
              data: data as never,
            },
          ],
          skipDuplicates: true,
        });
        result.created += created.count;
        continue;
      }
      const currentData = normalizeCleaningVentilationEntryData(existing.data);
      if (!isCleaningVentilationEntryDataEmpty(currentData)) continue;
      await updateEntry(existing.id, data);
    }
    return result;
  }

  if (code === GLASS_CONTROL_TEMPLATE_CODE) {
    const data = buildGlassControlAutoFillEntryData();
    for (const dateKey of dateKeys) {
      const existing = byDate.get(dateKey);
      if (!existing) {
        await createEntry(dateKey, data);
        continue;
      }
      // Перезаписываем только болванки — «повреждений нет» уже
      // содержательная запись, её и любую ручную не трогаем.
      if (!isRawEntryDataEmpty(existing.data)) continue;
      await updateEntry(existing.id, data);
    }
    return result;
  }

  if (code === FRYER_OIL_TEMPLATE_CODE) {
    const config = normalizeFryerOilDocumentConfig(document.config);
    const controllerFallback =
      users.find((user) => user.id === responsibleUserId)?.name ?? "";
    // Copy-forward: v1 идёт через явный билдер (эквивалент
    // `copyForwardWithJitter` с jitterPct 0); джиттер — задел.
    let source = await loadCopyForwardSource(db, {
      document,
      before: utcDate(dateKeys[0]),
    });
    for (const dateKey of dateKeys) {
      const existing = byDate.get(dateKey);
      const existingData = existing
        ? normalizeFryerOilEntryData(existing.data)
        : null;
      if (existing && existingData && !isFryerOilEntryDataEmpty(existingData)) {
        // День уже заполнен человеком — он же и есть свежий источник.
        source = existingData;
        continue;
      }
      const data = buildFryerOilAutoFillEntryData({
        config,
        dateKey,
        source,
        controllerFallback,
      });
      if (!existing) {
        await createEntry(dateKey, data);
      } else {
        await updateEntry(existing.id, data);
      }
      source = data;
    }
    return result;
  }

  result.skipped += dateKeys.length;
  result.skipReasons.push("unsupported");
  return result;
}

// ---------------------------------------------------------------------------
// Cleaning (config-matrix)
// ---------------------------------------------------------------------------

/** Число ячеек, отличающихся между двумя матрицами. */
export function countMatrixDiff(
  before: CleaningMatrixMap,
  after: CleaningMatrixMap
): number {
  let diff = 0;
  const rowIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const rowId of rowIds) {
    const beforeRow = before[rowId] ?? {};
    const afterRow = after[rowId] ?? {};
    const dateKeys = new Set([
      ...Object.keys(beforeRow),
      ...Object.keys(afterRow),
    ]);
    for (const dateKey of dateKeys) {
      if ((beforeRow[dateKey] ?? "") !== (afterRow[dateKey] ?? "")) diff += 1;
    }
  }
  return diff;
}

async function applyCleaningConfigAutoFill(
  db: EngineDb,
  params: { document: AutoFillDocumentInput; dateKeys: string[] }
): Promise<AutoFillResult> {
  const { document, dateKeys } = params;
  const todayKey = dateKeys[dateKeys.length - 1];

  const rooms = await fetchCleaningRooms(
    db,
    document.organizationId,
    document.buildingId ?? null,
  );
  const baseline = normalizeCleaningDocumentConfig(document.config);
  let config = applyRoomScheduleToMatrix(
    baseline,
    dateKeys,
    "fill-empty",
    rooms.length > 0 ? toRoomScheduleMap(rooms) : undefined
  );
  config = fillPastDaysNotPerformed(config, dateKeys, { todayKey });

  // Дни с TF-completions авто-подписи не трогают — там подпись
  // считается по completions (паритет с клиентом).
  const completionEntries = await db.journalDocumentEntry.findMany({
    where: { documentId: document.id },
    select: { data: true },
  });
  const completionDays = new Set<string>();
  for (const entry of completionEntries) {
    for (const c of listCleaningRoomCompletions(entry.data)) {
      if (c.dateKey) completionDays.add(c.dateKey);
    }
  }
  config = applyCleaningAutoSignatures(config, dateKeys, { completionDays });

  const changedCells = countMatrixDiff(baseline.matrix, config.matrix);
  if (changedCells === 0) return emptyResult();

  await db.journalDocument.update({
    where: { id: document.id },
    data: { config: config as never },
  });
  return { created: 0, updated: changedCells, skipped: 0, skipReasons: [] };
}
