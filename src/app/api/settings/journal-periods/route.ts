import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  parseJournalPeriodsJson,
  resolveJournalPeriod,
  type JournalPeriodOverrideMap,
} from "@/lib/journal-period";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — текущая map переопределений периода per-template
 *       { [code]: { kind, days? } }.
 *
 * PUT — заменяет map целиком. Body:
 *       { periods: { [code]: { kind, days? } } }.
 *       kind ∈ "monthly" | "yearly" | "half-monthly" | "single-day"
 *               | "perpetual" | "days".
 *       Для kind="days" обязателен days ∈ [1..31].
 */
const Schema = z.object({
  periods: z.record(
    z.string(),
    z.object({
      kind: z.enum([
        "monthly",
        "yearly",
        "half-monthly",
        "single-day",
        "perpetual",
        "days",
      ]),
      days: z.number().int().min(1).max(31).optional(),
    })
  ),
});

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { journalPeriods: true },
  });
  const periods = parseJournalPeriodsJson(org?.journalPeriods ?? null);
  return NextResponse.json({ periods });
}

export async function PUT(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  // Валидация days для kind="days".
  for (const [code, entry] of Object.entries(body.periods)) {
    if (entry.kind === "days") {
      if (!entry.days || entry.days < 1 || entry.days > 31) {
        return NextResponse.json(
          {
            error: `${code}: для режима «по N дней» нужно число дней 1–31`,
          },
          { status: 400 }
        );
      }
    }
  }

  // Сохраняем старую map чтобы понять какие коды реально изменились —
  // только для них имеет смысл проверять активные документы.
  const beforeOrg = await db.organization.findUnique({
    where: { id: orgId },
    select: { journalPeriods: true },
  });
  const beforeMap = parseJournalPeriodsJson(beforeOrg?.journalPeriods ?? null);

  const map: JournalPeriodOverrideMap = body.periods;
  await db.organization.update({
    where: { id: orgId },
    data: { journalPeriods: map },
  });

  // «При первой возможности» — пробегаем по template'ам, у которых
  // запись изменилась (kind/days). Для каждой:
  //   • Если активного документа нет — пропускаем (cron auto-create
  //     создаст по новой настройке).
  //   • Если активный документ ПУСТОЙ (нет JournalDocumentEntry) —
  //     обновляем dateFrom/dateTo и title сразу. Безопасно, потому что
  //     заполнений нет.
  //   • Если активный с записями — НЕ трогаем (потеряли бы данные).
  //     Документ доживёт свой цикл, следующий создастся по новой настройке.
  const now = new Date();
  // Сравниваем с началом UTC-дня (а не с now): документ создаётся
  // c dateTo=00:00 UTC последнего дня периода, и query
  // `dateTo: { gte: now }` где now=14:00 UTC возвращает false →
  // active doc «не найден» во второй половине дня. См. fixes от
  // 2026-04-30 в bulk-assign-today + journal-auto-create.
  const todayUtcStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const allCodes = new Set([...Object.keys(beforeMap), ...Object.keys(map)]);
  const result: Array<{
    code: string;
    action: "updated_empty" | "skipped_has_entries" | "no_active" | "no_change";
  }> = [];

  for (const code of allCodes) {
    const beforeKey = JSON.stringify(beforeMap[code] ?? null);
    const afterKey = JSON.stringify(map[code] ?? null);
    if (beforeKey === afterKey) continue;

    const tpl = await db.journalTemplate.findFirst({
      where: { code, isActive: true },
      select: { id: true, name: true },
    });
    if (!tpl) continue;

    // Периодичность — настройка всей организации, а смотрели мы только
    // документ текущей точки: на других точках период молча расходился
    // (заполненный документ там не мешал смене, пустой не подхватывал
    // новые даты). Берём документы всех точек.
    const activeDocuments = await db.journalDocument.findMany({
      where: {
        organizationId: orgId,
        templateId: tpl.id,
        status: "active",
        dateFrom: { lte: todayUtcStart },
        dateTo: { gte: todayUtcStart },
      },
      select: {
        id: true,
        dateFrom: true,
        dateTo: true,
        // Считаем только реальные заполнения, без _autoSeeded
        // плейсхолдеров. Раньше: документ с пустыми seeded-rows
        // (создан bulk-assign-today / sync-* для отображения матрицы)
        // считался «filled» и менеджер не мог сменить период даже
        // на свежем документе, который никто не трогал.
        _count: {
          select: { entries: { where: NOT_AUTO_SEEDED } },
        },
      },
    });
    if (activeDocuments.length === 0) {
      result.push({ code, action: "no_active" });
      continue;
    }

    const period = resolveJournalPeriod(code, now, map);
    let updated = 0;
    let skipped = 0;
    let unchanged = 0;
    for (const active of activeDocuments) {
      const sameRange =
        period.dateFrom.getTime() === active.dateFrom.getTime() &&
        period.dateTo.getTime() === active.dateTo.getTime();
      if (sameRange) {
        unchanged += 1;
        continue;
      }
      if (active._count.entries > 0) {
        skipped += 1;
        continue;
      }
      // Пустой документ — обновляем под новые даты сразу.
      await db.journalDocument.update({
        where: { id: active.id },
        data: {
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
          title: `${tpl.name} · ${period.label}`,
        },
      });
      updated += 1;
    }
    if (updated > 0) result.push({ code, action: "updated_empty" });
    else if (skipped > 0) result.push({ code, action: "skipped_has_entries" });
    else if (unchanged > 0) result.push({ code, action: "no_change" });
  }

  return NextResponse.json({ ok: true, periods: map, applied: result });
}
