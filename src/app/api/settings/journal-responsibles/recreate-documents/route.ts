import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { buildingTargets } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { resolveJournalPeriod, parseJournalPeriodsJson } from "@/lib/journal-period";
import { prefillResponsiblesForNewDocument } from "@/lib/journal-responsibles-cascade";
import { seedEntriesForDocument } from "@/lib/journal-document-entries-seed";
import { destructiveOpsRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/journal-responsibles/recreate-documents
 *
 * Закрывает все активные документы и создаёт новые с дефолтным
 * config'ом и подтянутыми из settings ответственными. Полезно когда:
 *   - старые документы имели мусорный или пустой config (нет rows,
 *     неправильные позиции, тестовые данные)
 *   - сменилась структура журнала или схема ответственных
 *   - просто хочется начать с чистого листа после быстрой настройки
 *
 * Существующие entries (заполненные строки) — НЕ удаляем, они
 * привязаны к старому document.id и остаются в нём (со статусом
 * closed). Если потом понадобятся для отчёта — можно открыть закрытый
 * документ и посмотреть.
 *
 * Отдельно для журналов которые не считаются «daily/monthly» (вроде
 * план обучения на год) — пересоздание происходит только если период
 * у нового документа отличается от старого. Иначе оставляем как есть.
 */
/**
 * GET — preflight: сколько активных документов будет закрыто и сколько в
 * них уже заполненных строк. Раньше диалог «Пересоздать документы» не
 * называл ни одного числа, и управляющая не понимала, что закрывает
 * журналы в середине месяца.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasCapability(auth.session.user, "admin.full")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(auth.session);
  const [activeDocCount, filledEntryCount] = await Promise.all([
    db.journalDocument.count({ where: { organizationId, status: "active" } }),
    db.journalDocumentEntry.count({
      where: { document: { organizationId, status: "active" } },
    }),
  ]);
  return NextResponse.json({ activeDocCount, filledEntryCount });
}

export async function POST() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(session);
  // Rate-limit: 2 пересоздания / час / org. Иначе двойной клик
  // дублирует close+create — лишние closed-документы, лишние entries.
  if (!destructiveOpsRateLimiter.consume(`recreate-docs:${organizationId}`)) {
    const ms = destructiveOpsRateLimiter.remainingMs(
      `recreate-docs:${organizationId}`
    );
    return NextResponse.json(
      {
        error: `Лимит пересоздания: 2 раза в час. Подождите ${Math.ceil(ms / 60_000)} мин.`,
      },
      { status: 429 }
    );
  }
  const now = new Date();

  const [templates, org] = await Promise.all([
    db.journalTemplate.findMany({
      where: { code: { in: ACTIVE_JOURNAL_CATALOG.map((j) => j.code) } },
      select: { id: true, code: true, name: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { journalPeriods: true, disabledJournalCodes: true },
    }),
  ]);

  const overrides = parseJournalPeriodsJson(org?.journalPeriods ?? null);
  const disabledCodes = new Set<string>(
    Array.isArray(org?.disabledJournalCodes)
      ? (org!.disabledJournalCodes as unknown[]).filter(
          (c): c is string => typeof c === "string"
        )
      : []
  );

  let closed = 0;
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Точки: пересоздаём документ на каждую точку (или один общий).
  const targets = await buildingTargets(organizationId);

  for (const tpl of templates) {
    if (disabledCodes.has(tpl.code)) {
      skipped += 1;
      continue;
    }
    try {
      // Считаем prefill ВНЕ транзакции — он сам делает много read-only
      // запросов (org JSON, candidates), нет смысла держать lock.
      const period = resolveJournalPeriod(tpl.code, now, overrides);
      const prefill = await prefillResponsiblesForNewDocument({
        organizationId,
        journalCode: tpl.code,
        baseConfig: {},
      });
      for (const buildingId of targets) {
      // Атомарно: close existing + create new. Если что-то фейлит —
      // откатим. Без этого можно остаться с закрытыми старыми и без
      // нового → юзер открывает /journals и видит пустой журнал.
      const newDoc = await db.$transaction(async (tx) => {
        const existing = await tx.journalDocument.findMany({
          where: {
            organizationId,
            templateId: tpl.id,
            status: "active",
            ...buildingWhere(buildingId),
          },
          select: { id: true },
        });
        if (existing.length > 0) {
          await tx.journalDocument.updateMany({
            where: { id: { in: existing.map((d) => d.id) } },
            data: { status: "closed" },
          });
          closed += existing.length;
        }
        return tx.journalDocument.create({
          data: {
            organizationId,
            templateId: tpl.id,
            buildingId,
            title: `${tpl.name} · ${period.label}`,
            dateFrom: period.dateFrom,
            dateTo: period.dateTo,
            status: "active",
            autoFill: false,
            config: prefill.config as never,
            responsibleUserId: prefill.responsibleUserId,
            // Phase C: verifierUserId — без него bulk-assign-today
            // не создаёт verifier-task в TasksFlow, и заведующая не
            // получает «проверь» при готовности фили-задач. Раньше
            // это поле было пропущено в этом endpoint'е (а в
            // journal-auto-create.ts передавалось правильно), → все
            // документы пересозданные через «Создать все документы»
            // оставались без verifier'а.
            verifierUserId: prefill.verifierUserId,
          },
          select: { id: true, dateFrom: true, dateTo: true },
        });
      });
      // Сидим entries (по дням периода / по сотрудникам × дни) для
      // журналов где это имеет смысл (climate, cold_equipment, hygiene
      // и т.д. — см. PER_DAY_JOURNALS / PER_EMPLOYEE_PER_DAY_JOURNALS).
      await seedEntriesForDocument({
        documentId: newDoc.id,
        journalCode: tpl.code,
        organizationId,
        dateFrom: newDoc.dateFrom,
        dateTo: newDoc.dateTo,
        responsibleUserId: prefill.responsibleUserId,
      }).catch((err) => {
        // Сидинг — best-effort: если не получилось (например, нет
        // ответственного), документ всё равно остаётся создан, юзер
        // сможет добавить строки руками.
        console.warn(
          `[recreate-documents] seedEntries failed for ${tpl.code}`,
          err
        );
      });
      created += 1;
      }
    } catch (err) {
      errors.push(
        `${tpl.code}: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  await db.auditLog.create({
    data: {
      organizationId,
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? null,
      action: "journal.recreate_documents",
      entity: "JournalDocument",
      entityId: organizationId,
      details: {
        closed,
        created,
        skipped,
        errorsCount: errors.length,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    closed,
    created,
    skipped,
    errors: errors.slice(0, 10),
    errorsTotal: errors.length,
  });
}
