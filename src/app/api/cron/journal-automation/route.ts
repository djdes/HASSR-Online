import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildingTargets } from "@/lib/active-building";
import { checkCronSecret } from "@/lib/cron-auth";
import { raisePlatformAlert } from "@/lib/platform-alerts";
import { toDateKey } from "@/lib/hygiene-document";
import {
  ensureActiveDocument,
  ensureNextPeriodDocument,
} from "@/lib/journal-auto-create";
import { applyJournalAutoFill } from "@/lib/journal-autofill";
import {
  AUTOFILL_SUPPORTED_CODES,
  getAutofillCapability,
} from "@/lib/journal-autofill-capability";
import { listAutomationCodes } from "@/lib/journal-automation";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { resolveAutomationStaff } from "@/lib/journal-automation-staff";
import { resolveDayStart } from "@/lib/today-compliance";
import { notifyOrganization, escapeTelegramHtml as esc } from "@/lib/telegram";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/journal-automation?secret=$CRON_SECRET
 *
 * Единый ежедневный прогон «журнал ведётся сам» (INFRA: внешний cron
 * 06:00 MSK). Для каждой организации и каждого журнала с включённой
 * автоматикой (`Organization.journalAutomationJson`):
 *
 *   1. Документ на текущий период — создаём, если его нет
 *      (`ensureActiveDocument` с `autoFill: true`, чтобы созданный
 *      документ действительно заполнялся, а не ждал ручного тумблера).
 *   2. Документ на следующий период за 7 дней до конца текущего —
 *      чтобы 1-го числа не было провала.
 *   3. Автозаполнение ТОЛЬКО сегодняшнего дня — через единый движок
 *      `applyJournalAutoFill`, который сам выбирает механику по
 *      capability-карте: кадровые журналы (гигиена, здоровье) получают
 *      «Здоров, t < 37» с учётом выходных/отпусков/больничных
 *      (`isStaffDayOff`), per-day журналы (климат, холодильники, УФ,
 *      чек-лист уборки и проветривания, стекло, фритюр) — строку на
 *      день из своего config, уборка — план Т/Г по маскам помещений и
 *      авто-подписи. «Сегодня» считается в часовом поясе организации.
 *
 * Идемпотентность: заполняются только ПУСТЫЕ ячейки, строки создаются
 * через `createMany skipDuplicates`. Повторный запуск в тот же день —
 * no-op, ручные отметки не перетираются.
 *
 * Ошибки изолированы по организациям (`Promise.allSettled`): падение
 * одной компании не должно останавливать остальные.
 */

type OrgRow = {
  id: string;
  name: string;
  timezone: string | null;
  journalAutomationJson: unknown;
  autoJournalCodes: unknown;
  /// Журналы, выключенные в /settings/journals — автоматика их не ведёт.
  disabledJournalCodes: unknown;
};

type OrgResult = {
  organizationId: string;
  documentsCreated: number;
  nextPeriodCreated: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesSkipped: number;
  codes: string[];
  errors: string[];
};

async function runForOrganization(
  org: OrgRow,
  now: Date
): Promise<OrgResult> {
  const result: OrgResult = {
    organizationId: org.id,
    documentsCreated: 0,
    nextPeriodCreated: 0,
    entriesCreated: 0,
    entriesUpdated: 0,
    entriesSkipped: 0,
    codes: [],
    errors: [],
  };

  // «Сегодня» — в зоне организации, а не процесса: на проде процесс живёт
  // в UTC, и с 00:00 до 03:00 МСК его «сегодня» — это ещё вчера.
  const todayKey = toDateKey(resolveDayStart(org.timezone, now));

  // Отключённый в /settings/journals журнал не должен возвращаться сам:
  // его страница отвечает «журнал отключён», а автоматика всё равно
  // заводила документ и заполняла его.
  const disabledCodes = parseDisabledCodes(org.disabledJournalCodes);
  const rows = listAutomationCodes(org).filter(
    (row) => row.automation.autoCreate && !disabledCodes.has(row.code)
  );
  if (rows.length === 0) return result;
  // Точки: каждый журнал автоматики ведётся на каждой точке отдельно.
  const targets = await buildingTargets(org.id);
  const jobs = rows.flatMap((row) =>
    targets.map((buildingId) => ({ ...row, buildingId })),
  );

  const todayDate = new Date(`${todayKey}T00:00:00.000Z`);

  // Уволенные (StaffDismissal с датой не позже сегодня) и неактивные в
  // автозаполнение не попадают — но их СТРОКИ в документе остаются:
  // журнал прошлых дней должен читаться так же, как его подписали.
  const employees = await db.user.findMany({
    where: {
      organizationId: org.id,
      isActive: true,
      archivedAt: null,
      OR: [{ dismissal: null }, { dismissal: { date: { gt: todayDate } } }],
    },
    // name + role нужны движку: имя уходит в подпись контролёра фритюра,
    // роль — в фолбэк «ответственный не задан → primary-менеджер».
    select: { id: true, name: true, role: true },
    orderBy: { id: "asc" },
  });
  const employeeIds = employees.map((employee) => employee.id);

  for (const row of jobs) {
    const { code, automation, buildingId } = row;
    try {
      const current = await ensureActiveDocument(db, {
        organizationId: org.id,
        templateCode: code,
        autoFill: automation.autoFill,
        buildingId,
      });
      if (current.created) result.documentsCreated += 1;

      const next = await ensureNextPeriodDocument(db, {
        organizationId: org.id,
        templateCode: code,
        lookaheadDays: 7,
        autoFill: automation.autoFill,
        buildingId,
      });
      if (next.created) result.nextPeriodCreated += 1;

      const capability = getAutofillCapability(code);
      if (!automation.autoFill || !capability) continue;
      if (!current.documentId) continue;

      const document = await db.journalDocument.findFirst({
        where: {
          id: current.documentId,
          organizationId: org.id,
          status: "active",
          dateFrom: { lte: todayDate },
          dateTo: { gte: todayDate },
        },
        select: {
          id: true,
          autoFill: true,
          buildingId: true,
          config: true,
          responsibleUserId: true,
          responsibleTitle: true,
          dateFrom: true,
          dateTo: true,
        },
      });
      if (!document) continue;

      // Выключенный в документе тумблер — это решение человека, и крон
      // его уважает. Раньше здесь стоял принудительный подъём флага:
      // выключил вечером — утром снова включилось, и выключатель
      // выглядел сломанным. Документы, которые крон создаёт сам,
      // получают autoFill=true при создании, так что «журнал ведётся
      // сам» продолжает работать без этой правки.
      if (!document.autoFill) continue;

      // Состав строк кадровых журналов: политика списка, если она задана,
      // иначе прежний расчёт крона (все активные сотрудники).
      let staffIds = employeeIds;
      if (capability === "staff") {
        if (employeeIds.length === 0) continue;
        const staffPolicy = automation.staff;
        if (staffPolicy) {
          const resolved = await resolveAutomationStaff(db, {
            organizationId: org.id,
            templateCode: code,
            staffPolicy,
          });
          if (resolved.employeeIds.length > 0) staffIds = resolved.employeeIds;
        }
      }

      const filled = await applyJournalAutoFill(db, {
      // Пишем журнал отката: выключение тумблера сможет вернуть как было.
      recordUndo: true,
        document: {
          id: document.id,
          organizationId: org.id,
          templateCode: code,
          config: document.config,
          responsibleUserId: document.responsibleUserId,
          responsibleTitle: document.responsibleTitle,
          dateFrom: document.dateFrom,
          dateTo: document.dateTo,
        },
        dateKeys: [todayKey],
        employeeIds: staffIds,
        users: employees,
      });
      result.entriesCreated += filled.created;
      result.entriesUpdated += filled.updated;
      result.entriesSkipped += filled.skipped;
      if (filled.created > 0 || filled.updated > 0) result.codes.push(code);
    } catch (err) {
      result.errors.push(
        `code=${code}: ${(err as Error).message ?? "ошибка"}`
      );
    }
  }

  if (
    result.documentsCreated > 0 ||
    result.entriesCreated > 0 ||
    result.entriesUpdated > 0
  ) {
    await db.auditLog.create({
      data: {
        organizationId: org.id,
        action: "journal.automation.run",
        entity: "organization",
        entityId: org.id,
        details: {
          date: todayKey,
          documentsCreated: result.documentsCreated,
          nextPeriodCreated: result.nextPeriodCreated,
          entriesCreated: result.entriesCreated,
          entriesUpdated: result.entriesUpdated,
          codes: result.codes,
        },
      },
    });
  }

  // Сводка владельцу — только когда автоматика реально что-то сделала,
  // иначе бот превращается в ежедневный шум.
  if (result.documentsCreated > 0 || result.entriesCreated > 0) {
    const message =
      `🤖 <b>Журналы заполнены автоматически</b>\n\n` +
      `Дата: ${esc(todayKey)}\n` +
      `Создано документов: <b>${result.documentsCreated}</b>\n` +
      `Заполнено строк: <b>${result.entriesCreated + result.entriesUpdated}</b>\n\n` +
      `Если у кого-то температура или больничный — отметьте это сегодня: прошлые дни закрыты.`;
    await notifyOrganization(org.id, message, ["owner"]).catch(() => {
      /* Telegram недоступен — журнал всё равно заполнен */
    });
  }

  return result;
}

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  const now = new Date();
  // Ключ для отчёта и алерта — по зоне процесса; у каждой организации
  // внутри прогона свой день (см. runForOrganization).
  const todayKey = toDateKey(now);
  const orgs = await db.organization.findMany({
    // Пауза за неактивность обещает «автозаполнение остановится» —
    // выполняем обещание: приостановленные и отменённые не трогаем.
    where: { subscriptionPlan: { notIn: ["paused", "cancelled"] }, ...NOT_DIRECTORY_ORG_WHERE },
    select: {
      id: true,
      name: true,
      timezone: true,
      journalAutomationJson: true,
      autoJournalCodes: true,
      disabledJournalCodes: true,
    },
  });

  const settled = await Promise.allSettled(
    orgs.map((org) => runForOrganization(org, now))
  );

  let documentsCreated = 0;
  let nextPeriodCreated = 0;
  let entriesCreated = 0;
  let entriesUpdated = 0;
  let entriesSkipped = 0;
  let organizationsTouched = 0;
  const errors: string[] = [];

  settled.forEach((item, index) => {
    if (item.status === "rejected") {
      errors.push(
        `org=${orgs[index]?.id}: ${(item.reason as Error)?.message ?? "ошибка"}`
      );
      return;
    }
    const value = item.value;
    documentsCreated += value.documentsCreated;
    nextPeriodCreated += value.nextPeriodCreated;
    entriesCreated += value.entriesCreated;
    entriesUpdated += value.entriesUpdated;
    entriesSkipped += value.entriesSkipped;
    if (
      value.documentsCreated > 0 ||
      value.entriesCreated > 0 ||
      value.entriesUpdated > 0
    ) {
      organizationsTouched += 1;
    }
    value.errors.forEach((error) => errors.push(`org=${value.organizationId} ${error}`));
  });

  // Ночная автоматика — единственный шанс создать журналы на день: она
  // ходит раз в сутки, и если упала, то до завтра никто ничего не создаст,
  // а сотрудники утром увидят пустой список. Поэтому будим сразу, без
  // серии провалов — второго запуска, который «сам починится», не будет.
  //
  // dedupeKey с датой: одна новость в сутки, но завтрашняя поломка не
  // будет заглушена сегодняшним кулдауном.
  if (errors.length > 0) {
    await raisePlatformAlert({
      kind: "journal-automation",
      dedupeKey: `failed:${todayKey}`,
      text:
        `<b>Автосоздание журналов: ошибки</b>
` +
        `Дата ${todayKey}, организаций затронуто ${organizationsTouched} из ${orgs.length}.
` +
        `Ошибок: ${errors.length}
` +
        `Первая: ${errors[0]}
` +
        `Журналы за день могли не создаться.`,
    });
  }

  return NextResponse.json({
    ok: true,
    date: todayKey,
    supportedCodes: [...AUTOFILL_SUPPORTED_CODES],
    organizationsScanned: orgs.length,
    organizationsTouched,
    documentsCreated,
    nextPeriodCreated,
    entriesCreated,
    entriesUpdated,
    entriesSkipped,
    errors: errors.slice(0, 10),
  });
}

export const GET = handle;
export const POST = handle;
