import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { toDateKey } from "@/lib/hygiene-document";
import { applyJournalAutoFill } from "@/lib/journal-autofill";
import {
  AUTOFILL_SUPPORTED_CODES,
  getAutofillCapability,
} from "@/lib/journal-autofill-capability";
import { listAutomationOwnedCodes } from "@/lib/journal-automation";
import { parseDisabledCodes } from "@/lib/disabled-journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/auto-fill-journals?secret=$CRON_SECRET
 *
 * Ежедневное автозаполнение журналов, у которых включён тумблер
 * «Автоматически заполнять журнал» (`JournalDocument.autoFill = true`).
 *
 * Правило эталона (haccp-online): тумблер работает ЕЖЕДНЕВНО, а не
 * однократно в момент включения. Cron дозаполняет ТОЛЬКО сегодняшний
 * день и ТОЛЬКО пустые значения — ручные записи не перетираются.
 *
 * Механику выбирает единый движок `applyJournalAutoFill` по
 * capability-карте: кадровые журналы (гигиена, здоровье) — по графику
 * сотрудников, per-day (климат, холодильники, УФ, чек-лист уборки и
 * проветривания, стекло, фритюр) — строкой на день из config документа.
 *
 * Уборка (`cleaning`) сюда НЕ входит: её матрица живёт в config и
 * заполняется org-driven cron'ом автоматизации в 06:00, у которого есть
 * помещения организации. Дублировать эту работу здесь нельзя — два
 * прогона спорили бы за одни ячейки.
 *
 * Идемпотентно: повторный прогон в тот же день не делает изменений.
 *
 * INFRA NEXT: внешний cron 05:00 MSK ежедневно (после
 * /api/cron/auto-create-journals в 04:00 — чтобы документ на сегодня
 * уже существовал).
 */
const SUPPORTED_CODES = AUTOFILL_SUPPORTED_CODES.filter(
  (code) => getAutofillCapability(code) !== "config-matrix",
);

type OrgUser = { id: string; name: string; role: string };

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  const todayKey = toDateKey(new Date());
  const todayDate = new Date(`${todayKey}T00:00:00.000Z`);

  const documents = await db.journalDocument.findMany({
    where: {
      status: "active",
      autoFill: true,
      dateFrom: { lte: todayDate },
      dateTo: { gte: todayDate },
      template: { code: { in: [...SUPPORTED_CODES] } },
    },
    select: {
      id: true,
      organizationId: true,
      buildingId: true,
      config: true,
      responsibleUserId: true,
      responsibleTitle: true,
      dateFrom: true,
      dateTo: true,
      template: { select: { code: true } },
    },
  });

  // Пропускаемые коды организации (кэш на прогон):
  //  • журналы, которые целиком ведёт cron автоматизации 06:00, — иначе
  //    одну и ту же работу делают два разных cron'а и в логах невозможно
  //    понять, кто что заполнил;
  //  • журналы, отключённые в /settings/journals (например, журнал
  //    здоровья, выключенный по умолчанию), — у старого документа мог
  //    остаться `autoFill: true`, и cron заполнял бы журнал, который
  //    организация не ведёт.
  const skippedByOrg = new Map<string, Set<string>>();
  async function getSkippedCodes(organizationId: string): Promise<Set<string>> {
    const cached = skippedByOrg.get(organizationId);
    if (cached) return cached;
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: {
        journalAutomationJson: true,
        autoJournalCodes: true,
        disabledJournalCodes: true,
      },
    });
    const skipped = new Set([
      ...listAutomationOwnedCodes(org),
      ...parseDisabledCodes(org?.disabledJournalCodes),
    ]);
    skippedByOrg.set(organizationId, skipped);
    return skipped;
  }

  const usersByOrg = new Map<string, OrgUser[]>();
  async function getUsers(organizationId: string): Promise<OrgUser[]> {
    const cached = usersByOrg.get(organizationId);
    if (cached) return cached;
    const users = await db.user.findMany({
      where: { organizationId, isActive: true },
      // name нужен движку для подписи контролёра (фритюр), role — для
      // фолбэка «ответственный не задан → primary-менеджер».
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { id: "asc" }],
    });
    usersByOrg.set(organizationId, users);
    return users;
  }

  let created = 0;
  let updated = 0;
  let documentsTouched = 0;
  const byTemplate: Record<string, number> = {};
  const errors: string[] = [];

  for (const document of documents) {
    const code = document.template.code;
    try {
      const skipped = await getSkippedCodes(document.organizationId);
      if (skipped.has(code)) continue;
      const users = await getUsers(document.organizationId);
      if (users.length === 0) continue;

      const result = await applyJournalAutoFill(db, {
      // Пишем журнал отката: выключение тумблера сможет вернуть как было.
      recordUndo: true,
        document: {
          id: document.id,
          organizationId: document.organizationId,
          templateCode: code,
          config: document.config,
          responsibleUserId: document.responsibleUserId,
          responsibleTitle: document.responsibleTitle,
          dateFrom: document.dateFrom,
          dateTo: document.dateTo,
        },
        dateKeys: [todayKey],
        // Состав кадровых журналов здесь остаётся прежним (весь активный
        // ростер): политика списка — забота org-driven крона в 06:00.
        employeeIds: users.map((user) => user.id),
        users,
      });

      created += result.created;
      updated += result.updated;
      if (result.created > 0 || result.updated > 0) {
        documentsTouched += 1;
        byTemplate[code] = (byTemplate[code] ?? 0) + result.created + result.updated;
      }
    } catch (err) {
      errors.push(
        `document=${document.id} code=${code}: ${(err as Error).message ?? "ошибка"}`
      );
    }
  }

  return NextResponse.json({
    ok: true,
    date: todayKey,
    documentsScanned: documents.length,
    documentsTouched,
    entriesCreated: created,
    entriesUpdated: updated,
    byTemplate,
    errors: errors.slice(0, 10),
  });
}

export const GET = handle;
export const POST = handle;
