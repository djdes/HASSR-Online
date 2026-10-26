import { Prisma } from "@prisma/client";
import { readBuildingJournalSettings, withBuildingJournalSettings } from "@/lib/building-settings";
import { db } from "@/lib/db";
import { detectTemperatureCapas } from "@/lib/capa-auto-detect";
import {
  canEditAutomationCell,
  canEditEntryAt,
  PAST_DAY_LOCKED_MESSAGE,
  type AutomationLockContext,
} from "@/lib/closed-day";
import { isJournalAutomationEnabled } from "@/lib/journal-automation";
import { isManagementRole } from "@/lib/user-roles";
import { orgTodayKey } from "@/lib/timezone";
import { FUTURE_DAY_LOCKED_MESSAGE } from "@/lib/journal-entry-scope";

/**
 * Общие проверки записи в сетку журнала (`JournalDocumentEntry`).
 *
 * Почему отдельный модуль. Раньше вся логика жила внутри PUT
 * `/api/journal-documents/[id]/entries`. Появился bulk-роут (покраска
 * мышью шлёт один запрос на весь штрих), и повторять там guard'ы
 * копипастой нельзя: разошедшиеся правила «прошлый день закрыт» — это
 * дыра в compliance, а не косметика. Поэтому контекст и решение по
 * каждой ячейке считаются здесь, а роуты только формируют ответ.
 */

export type EntryWriteActor = {
  id: string;
  role: string;
  isRoot: boolean;
  name: string | null;
};

export type EntryWriteDoc = {
  id: string;
  organizationId: string;
  autoFill: boolean;
  template?: { code: string } | null;
  /** Точка документа; не передана — читается из БД (автоматика точки). */
  buildingId?: string | null;
};

export type EntryWriteContext = {
  automation: AutomationLockContext;
  org: { lockPastDayEdits: boolean; shiftEndHour: number } | null;
  /** Сегодня в часовом поясе организации, `YYYY-MM-DD`. */
  todayKey: string;
};



/**
 * Контекст правила «изменения день в день» для документа.
 *
 * Живёт отдельно от `Organization.lockPastDayEdits`: тот тумблер
 * опциональный и пускает management, а автоматика запирает прошлые дни
 * для ВСЕХ, кроме ROOT (см. closed-day.ts). Иначе смысл автозаполнения
 * теряется: сайт проставил «Здоров» всем, а вчера кто-то дописал
 * «был с температурой» — и журнал перестаёт быть доказательством.
 */
export async function loadEntryWriteContext(
  doc: EntryWriteDoc
): Promise<EntryWriteContext> {
  const orgRow = await db.organization.findUnique({
    where: { id: doc.organizationId },
    select: {
      shiftEndHour: true,
      journalAutomationJson: true,
      autoJournalCodes: true,
      lockPastDayEdits: true,
      timezone: true,
    },
  });
  // У точки со своей автоматикой (слитая организация) — её настройки.
  const buildingId =
    doc.buildingId !== undefined
      ? doc.buildingId
      : (await db.journalDocument.findUnique({ where: { id: doc.id }, select: { buildingId: true } }))?.buildingId;
  const org = withBuildingJournalSettings(orgRow, await readBuildingJournalSettings(db, buildingId));

  return {
    todayKey: orgTodayKey(org?.timezone ?? undefined),
    automation: {
      documentAutoFill: doc.autoFill === true,
      automationEnabled: Boolean(
        doc.template?.code && isJournalAutomationEnabled(org, doc.template.code)
      ),
      shiftEndHour: org?.shiftEndHour ?? 0,
    },
    org: org
      ? {
          lockPastDayEdits: org.lockPastDayEdits,
          shiftEndHour: org.shiftEndHour,
        }
      : null,
  };
}

// Правила «чья строка и за какой день» переехали в чистый модуль — его
// импортирует и браузер. Реэкспорт оставлен, чтобы не переписывать
// десяток мест вызова.
export {
  hasFullDocumentAccess,
  checkEntryScope,
  FUTURE_DAY_LOCKED_MESSAGE,
  type EntryScopeDecision,
} from "@/lib/journal-entry-scope";

/** Дата ячейки → `YYYY-MM-DD`. Записи хранятся в UTC-полночь дня. */
function toEntryDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type EntryWriteDecision =
  | { allowed: true; isOverride: boolean }
  | { allowed: false; error: string; code: "past_day_locked" | "future_day_locked" };

/**
 * Можно ли писать в ячейку с этой датой. Два независимых запрета:
 * жёсткий автоматический (`canEditAutomationCell`, кроме ROOT никто) и
 * опциональный организационный (`canEditEntryAt`, management проходит с
 * записью override в аудит).
 */
export function checkEntryWrite(
  ctx: EntryWriteContext,
  actor: EntryWriteActor,
  entryDate: Date
): EntryWriteDecision {
  const closedActor = { role: actor.role, isRoot: actor.isRoot };

  // Будущее не заполняется никем. Проверка идёт ПЕРВОЙ: она не про
  // права, а про смысл записи, поэтому override'ов у неё нет.
  if (ctx.todayKey && toEntryDateKey(entryDate) > ctx.todayKey) {
    return {
      allowed: false,
      error: FUTURE_DAY_LOCKED_MESSAGE,
      code: "future_day_locked",
    };
  }

  const automationDecision = canEditAutomationCell(
    entryDate,
    closedActor,
    ctx.automation
  );
  if (!automationDecision.allowed) {
    return {
      allowed: false,
      error: PAST_DAY_LOCKED_MESSAGE,
      code: "past_day_locked",
    };
  }

  let isOverride = automationDecision.isOverride;

  if (ctx.org) {
    const orgDecision = canEditEntryAt(entryDate, closedActor, ctx.org);
    if (!orgDecision.allowed) {
      return {
        allowed: false,
        error:
          "День закрыт. Рядовые сотрудники не могут редактировать записи прошедших дней.",
        code: "past_day_locked",
      };
    }
    isOverride = isOverride || orgDecision.isOverride;
  }

  return { allowed: true, isOverride };
}

/**
 * Лог override закрытого дня — событие, на которое смотрит ХАССП-аудит.
 * `dates` списком: у покраски это один штрих, и 60 отдельных строк
 * аудита вместо одной только зашумили бы журнал событий.
 */
export async function logPastDayOverride(args: {
  organizationId: string;
  actor: EntryWriteActor;
  documentId: string;
  employeeId: string | null;
  dates: Date[];
  templateCode: string | null;
  rule?: string;
}) {
  if (args.dates.length === 0) return;
  await db.auditLog.create({
    data: {
      organizationId: args.organizationId,
      userId: args.actor.id,
      userName: args.actor.name,
      action: "closed_day.override",
      entity: "journal_document_entry",
      entityId: args.documentId,
      details: {
        documentId: args.documentId,
        employeeId: args.employeeId,
        date: args.dates[0].toISOString(),
        dates: args.dates.map((date) => date.toISOString()),
        templateCode: args.templateCode,
        ...(args.rule ? { rule: args.rule } : {}),
      },
    },
  });
}

/**
 * Fire-and-forget авто-детектор CAPA по температуре. Дёргается после
 * записи в документ `cold_equipment_control` — если среди трёх последних
 * дней по одному холодильнику есть отклонение от нормы, откроется CAPA.
 * Идемпотентно.
 */
export function maybeTriggerColdEquipmentCapaDetection(
  templateCode: string | undefined,
  organizationId: string
): void {
  if (templateCode !== "cold_equipment_control") return;
  detectTemperatureCapas({ organizationId }).catch((err) => {
    console.warn("[capa-auto] cold-equipment detect failed:", err);
  });
}

export function isValidDate(value: Date) {
  return Number.isFinite(value.getTime());
}

export function toPrismaJsonValue(
  value: unknown
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

/** Дата ячейки → полночь UTC. `null`, если строка не парсится. */
export function toEntryDayUtc(value: string): Date | null {
  const dateObj = new Date(value);
  if (!isValidDate(dateObj)) return null;
  dateObj.setUTCHours(0, 0, 0, 0);
  return dateObj;
}
