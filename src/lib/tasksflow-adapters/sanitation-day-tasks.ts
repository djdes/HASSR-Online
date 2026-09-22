/**
 * TasksFlow для «Графика и учета генеральных уборок» — чистая часть.
 *
 * Модель (2026-09-22): одна задача на одну ПЛАНОВУЮ дату. Раньше каждая
 * строка графика была ежемесячной повторяющейся задачей на «1-е число»,
 * а выполнение ставило «✓» в текущий месяц: при двух-четырёх уборках в
 * месяц это не работало вовсе.
 *
 *   rowKey задачи   gc::<rowId>::<YYYY-MM-DD>  (дата — плановая)
 *   создание        в день уборки (часовой крон, после правки плана,
 *                   «Отправить всем»); через outbox, ключ
 *                   gc-create::<docId>::<rowId>::<дата> (П-13, П-15, П-19)
 *   удаление        дату убрали из плана, задача не выполнена —
 *                   gc-delete::<docId>::<taskId>
 *   закрытие        руководитель отметил уборку в журнале сам —
 *                   gc-complete::<docId>::<taskId>
 *
 * Статус задачи — у TasksFlow (П-10): выполненные задачи мы не трогаем.
 * Содержимое журнала — у WeSetup: выполнение задачи пишет отметку в ту
 * самую плановую уборку (`applyTaskCompletion`).
 *
 * Исполнитель — первый уборщик помещения, иначе ответственный документа;
 * проверяющий — первый проверяющий помещения, если это другой человек.
 * Строки без связи с помещением справочника задач не получают.
 */
import type { CreateTaskInput } from "@/lib/tasksflow-client";
import {
  reprojectSanitationRow,
  sanitationCleaningId,
  type SanitationCleaning,
  type SanitationDayConfig,
  type SanitationRoomRow,
} from "@/lib/sanitation-day-document";
import {
  WEEKDAY_FULL_RU,
  formatDayMonthWeekday,
  parseIsoDate,
  weekdayIndex,
} from "@/lib/wheel-date";

export const GC_JOURNAL_CODE = "general_cleaning";
export const GC_TASK_CATEGORY = "WeSetup · Ген. уборки";
export const GC_ROW_KEY_PREFIX = "gc::";

const GC_ROW_KEY_RE = /^gc::(.+)::(\d{4}-\d{2}-\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** QR по строке может закрыть плановую уборку, до которой не больше недели. */
const EARLY_DONE_DAYS = 7;

export function gcRowKey(rowId: string, dateKey: string): string {
  return `${GC_ROW_KEY_PREFIX}${rowId}::${dateKey}`;
}

export function parseGcRowKey(rowKey: string): { rowId: string; dateKey: string } | null {
  const match = GC_ROW_KEY_RE.exec(rowKey);
  if (!match || !parseIsoDate(match[2])) return null;
  return { rowId: match[1], dateKey: match[2] };
}

export function gcCreateIdempotencyKey(documentId: string, rowId: string, dateKey: string): string {
  return `gc-create::${documentId}::${rowId}::${dateKey}`;
}

export function gcDeleteIdempotencyKey(documentId: string, taskId: number): string {
  return `gc-delete::${documentId}::${taskId}`;
}

export function gcCompleteIdempotencyKey(documentId: string, taskId: number): string {
  return `gc-complete::${documentId}::${taskId}`;
}

/** «Генеральная уборка · Кухня · 25.09 (пт)» (+ точка). */
export function gcTaskTitle(roomName: string, dateKey: string, buildingName?: string | null): string {
  const base = `Генеральная уборка · ${roomName || "Помещение"} · ${formatDayMonthWeekday(dateKey)}`;
  const building = buildingName?.trim();
  return building ? `${base} · ${building}` : base;
}

function formatFullDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-");
  return `${day}.${month}.${year}, ${WEEKDAY_FULL_RU[weekdayIndex(dateKey)]}`;
}

export type GcPlannerRoom = {
  /** Только действующие сотрудники, в порядке приоритета. */
  cleanerUserIds: string[];
  verifierUserIds: string[];
  requirePhoto: boolean;
};

export type GcPlannerLink = {
  id: string;
  rowKey: string;
  tasksflowTaskId: number;
  remoteStatus: string;
  kind?: string;
};

export type GcPlanInput = {
  documentId: string;
  documentTitle: string;
  integrationId: string;
  baseUrl: string;
  /** Сегодня по поясу организации. */
  todayKey: string;
  /** Эффективный конфиг (названия помещений — из справочника). */
  config: SanitationDayConfig;
  rooms: ReadonlyMap<string, GcPlannerRoom>;
  /** Ответственный документа — исполнитель, если у помещения нет уборщика. */
  responsibleUserId: string | null;
  tfUserIdByWesetupId: ReadonlyMap<string, number>;
  /** Все TaskLink документа; не-gc строки игнорируются. */
  links: ReadonlyArray<GcPlannerLink>;
  buildingName?: string | null;
};

export type GcCreateCommand = {
  rowId: string;
  dateKey: string;
  rowKey: string;
  idempotencyKey: string;
  /** WeSetup id исполнителя — для предпросмотра «Отправить всем». */
  assigneeUserId: string;
  task: CreateTaskInput;
};

export type GcLinkCommand = {
  linkId: string;
  rowKey: string;
  taskId: number;
  idempotencyKey: string;
};

export type GcTaskPlan = {
  create: GcCreateCommand[];
  complete: GcLinkCommand[];
  remove: GcLinkCommand[];
  /** rowKey сегодняшних уборок, исполнитель которых не привязан к TasksFlow. */
  skippedNoLink: string[];
  /** Строки без связи с помещением, у которых сегодня уборка по плану. */
  skippedNoRoom: string[];
};

/** Ближайшая открытая плановая уборка строки начиная с `fromKey`. */
export function nextOpenCleaning(
  row: Pick<SanitationRoomRow, "cleanings">,
  fromKey: string,
): SanitationCleaning | null {
  return (
    row.cleanings
      .filter((c) => c.planned && !c.done && (c.planned as string) >= fromKey)
      .sort((a, b) => (a.planned as string).localeCompare(b.planned as string))[0] ?? null
  );
}

/** Дата всё ещё в плане строки и не выполнена — outbox создаёт задачу только тогда. */
export function isGeneralCleaningDatePlanned(
  config: Pick<SanitationDayConfig, "rows">,
  rowId: string,
  dateKey: string,
): boolean {
  const row = config.rows.find((item) => item.id === rowId);
  return Boolean(row?.cleanings.some((c) => c.planned === dateKey && !c.done));
}

export function planGeneralCleaningTasks(input: GcPlanInput): GcTaskPlan {
  const plan: GcTaskPlan = { create: [], complete: [], remove: [], skippedNoLink: [], skippedNoRoom: [] };
  const linkByRowKey = new Map(input.links.map((link) => [link.rowKey, link]));
  const baseUrl = input.baseUrl.replace(/\/+$/, "");

  for (const row of input.config.rows) {
    const today = row.cleanings.find((c) => c.planned === input.todayKey && !c.done);
    if (!today) continue;
    const room = row.roomId ? input.rooms.get(row.roomId) : undefined;
    if (!room) {
      plan.skippedNoRoom.push(row.id);
      continue;
    }
    const rowKey = gcRowKey(row.id, input.todayKey);
    if (linkByRowKey.has(rowKey)) continue;
    const assigneeUserId = room.cleanerUserIds[0] ?? input.responsibleUserId ?? null;
    const workerId = assigneeUserId ? input.tfUserIdByWesetupId.get(assigneeUserId) : undefined;
    if (!assigneeUserId || workerId === undefined) {
      plan.skippedNoLink.push(rowKey);
      continue;
    }
    const verifierUserId = room.verifierUserIds.find((id) => id !== assigneeUserId) ?? null;
    const verifierTfId = verifierUserId ? input.tfUserIdByWesetupId.get(verifierUserId) : undefined;
    const title = gcTaskTitle(row.roomName, input.todayKey, input.buildingName);
    const journalLink = JSON.stringify({
      kind: `wesetup-${GC_JOURNAL_CODE}`,
      baseUrl,
      integrationId: input.integrationId,
      documentId: input.documentId,
      rowKey,
      label: title,
      isFreeText: false,
      bonusAmountKopecks: 0,
      taskScope: "personal",
      siblingVisibility: false,
    });
    const task: CreateTaskInput = {
      title,
      workerId,
      requiresPhoto: room.requirePhoto,
      isRecurring: false,
      category: GC_TASK_CATEGORY,
      description: [
        `Журнал: ${input.documentTitle}`,
        `Помещение: ${row.roomName || "—"}`,
        `Дата по графику: ${formatFullDate(input.todayKey)}`,
        input.buildingName?.trim() ? `Точка: ${input.buildingName.trim()}` : "",
        "Проведите генеральную уборку по шагам карточки помещения и нажмите «Сделал».",
      ]
        .filter(Boolean)
        .join("\n"),
      journalLink,
    };
    if (verifierTfId !== undefined && verifierTfId !== workerId) {
      task.verifierWorkerId = verifierTfId;
    }
    plan.create.push({
      rowId: row.id,
      dateKey: input.todayKey,
      rowKey,
      idempotencyKey: gcCreateIdempotencyKey(input.documentId, row.id, input.todayKey),
      assigneeUserId,
      task,
    });
  }

  const rowById = new Map(input.config.rows.map((row) => [row.id, row]));
  for (const link of input.links) {
    if (link.kind && link.kind !== "filler") continue;
    const parsed = parseGcRowKey(link.rowKey);
    if (!parsed) continue;
    const slot = rowById
      .get(parsed.rowId)
      ?.cleanings.find((c) => c.planned === parsed.dateKey);
    const command: GcLinkCommand = {
      linkId: link.id,
      rowKey: link.rowKey,
      taskId: link.tasksflowTaskId,
      idempotencyKey: "",
    };
    if (!slot) {
      // Выполненная в TF задача — история, её не удаляем.
      if (link.remoteStatus !== "completed") {
        plan.remove.push({
          ...command,
          idempotencyKey: gcDeleteIdempotencyKey(input.documentId, link.tasksflowTaskId),
        });
      }
      continue;
    }
    if (slot.done && slot.doneSource !== "task" && link.remoteStatus !== "completed") {
      plan.complete.push({
        ...command,
        idempotencyKey: gcCompleteIdempotencyKey(input.documentId, link.tasksflowTaskId),
      });
    }
  }
  return plan;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function taskMark(done: string): Pick<SanitationCleaning, "done" | "doneSource"> {
  return { done, doneSource: "task" };
}

function markSlot(slot: SanitationCleaning, done: string): SanitationCleaning {
  return { id: sanitationCleaningId(slot.planned, done), planned: slot.planned, ...taskMark(done) };
}

function openSlot(slot: SanitationCleaning): SanitationCleaning {
  return { id: sanitationCleaningId(slot.planned, null), planned: slot.planned, done: null };
}

/** Выполнение днём `doneKey` без привязки к дате плана (QR по строке). */
function markRowLevel(cleanings: SanitationCleaning[], doneKey: string): SanitationCleaning[] | null {
  if (cleanings.some((c) => c.done === doneKey)) return null;
  const month = doneKey.slice(0, 7);
  const open = cleanings.filter((c) => c.planned && !c.done && (c.planned as string).startsWith(month));
  const due = open
    .filter((c) => (c.planned as string) <= doneKey)
    .sort((a, b) => (b.planned as string).localeCompare(a.planned as string))[0];
  const soon = open
    .filter((c) => (c.planned as string) > doneKey && (c.planned as string) <= addDays(doneKey, EARLY_DONE_DAYS))
    .sort((a, b) => (a.planned as string).localeCompare(b.planned as string))[0];
  const target = due ?? soon;
  if (target) return cleanings.map((c) => (c === target ? markSlot(c, doneKey) : c));
  return [...cleanings, { id: sanitationCleaningId(null, doneKey), planned: null, ...taskMark(doneKey) }];
}

/**
 * Выполнение (или отмена) задачи → отметка в графике.
 *
 *   • gc::-задача — ровно её плановая уборка, днём выполнения (по поясу
 *     организации). Дату успели убрать из плана — выполнение остаётся
 *     внеплановой уборкой.
 *   • ключ строки (QR, старые задачи) — самая свежая открытая плановая
 *     уборка месяца, иначе ближайшая в пределах недели, иначе внеплановая.
 *   • отмена снимает только отметку, поставленную задачей.
 */
export function applyTaskCompletion(
  config: SanitationDayConfig,
  args: { rowKey: string; doneKey: string; completed: boolean },
): { config: SanitationDayConfig; changed: boolean } {
  const unchanged = { config, changed: false };
  if (!parseIsoDate(args.doneKey)) return unchanged;
  const gc = parseGcRowKey(args.rowKey);
  const rowId = gc ? gc.rowId : args.rowKey;
  const rowIndex = config.rows.findIndex((row) => row.id === rowId);
  if (rowIndex < 0) return unchanged;
  const row = config.rows[rowIndex];
  let next: SanitationCleaning[] | null = null;

  if (gc) {
    const slot = row.cleanings.find((c) => c.planned === gc.dateKey);
    if (args.completed) {
      if (slot && !slot.done) {
        next = row.cleanings.map((c) => (c === slot ? markSlot(c, args.doneKey) : c));
      } else if (!slot) {
        next = markRowLevelSameDay(row.cleanings, args.doneKey);
      }
    } else if (slot?.done && slot.doneSource === "task") {
      next = row.cleanings.map((c) => (c === slot ? openSlot(c) : c));
    }
  } else {
    if (!args.doneKey.startsWith(`${config.year}-`)) return unchanged;
    if (args.completed) {
      next = markRowLevel(row.cleanings, args.doneKey);
    } else {
      const mark = row.cleanings.find((c) => c.done === args.doneKey && c.doneSource === "task");
      if (mark) {
        next = mark.planned
          ? row.cleanings.map((c) => (c === mark ? openSlot(c) : c))
          : row.cleanings.filter((c) => c !== mark);
      }
    }
  }

  if (!next) return unchanged;
  const rows = [...config.rows];
  rows[rowIndex] = reprojectSanitationRow({ ...row, cleanings: next }, config.year);
  return { config: { ...config, rows }, changed: true };
}

/** Задача на снятую из плана дату: закрываем открытый план этого дня или добавляем внеплановую. */
function markRowLevelSameDay(cleanings: SanitationCleaning[], doneKey: string): SanitationCleaning[] | null {
  if (cleanings.some((c) => c.done === doneKey)) return null;
  const sameDay = cleanings.find((c) => c.planned === doneKey && !c.done);
  if (sameDay) return cleanings.map((c) => (c === sameDay ? markSlot(c, doneKey) : c));
  return [...cleanings, { id: sanitationCleaningId(null, doneKey), planned: null, ...taskMark(doneKey) }];
}
