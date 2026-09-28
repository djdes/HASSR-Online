import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { normalizePhone } from "@/lib/phone";
import { DEFAULT_WEEKLY_DAYS_OFF } from "@/lib/staff-days-off";
import { parseStaffRows } from "@/lib/staff-bulk-parse";
import { tryAutolinkTasksflowByPhone } from "@/lib/tasksflow-autolink";
import { recordAuditLog } from "@/lib/audit-log";
import { ensurePlanForHeadcount } from "@/lib/plan-limits.server";
import { seatAllowance, seatLimitSummary } from "@/lib/billing.server";
import { FREE_LIMIT_MESSAGE } from "@/lib/billing-period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/staff/bulk
 *
 * Массовое добавление сотрудников из CSV/Excel-paste. Принимает либо
 * массив `rows`, либо raw `csv`-строку (TSV/CSV — auto-detect разделителя
 * по первой строке).
 *
 * Колонки (обязательны в этом порядке):
 *   ФИО \t Должность \t Телефон
 *
 * Должность матчится по точному имени `JobPosition.name` для текущей
 * org. Если не найдено — строка идёт в `errors`. Если телефон не
 * парсится в +7 — тоже в `errors`. Дубли (по phone в текущей org)
 * skipятся как `skipped`.
 *
 * Идемпотентно: повторная заливка того же CSV увеличит только `skipped`.
 *
 * Body (один из):
 *   { rows: [{ fullName, positionName, phone }, ...] }
 *   { csv: "ФИО\tДолжность\tТелефон\nИван Петров\tПовар\t+7..." }
 *
 * Доступ: management.
 */

const rowSchema = z.object({
  fullName: z.string().trim().min(2),
  /// Имя должности — путь для вставленного текста и файла.
  positionName: z.string().trim().min(2),
  /// Id должности — путь для таблицы в интерфейсе: там человек выбирает
  /// из списка, и матчить обратно по имени значит терять выбор на
  /// омонимах вроде двух «Поваров» в разных категориях.
  jobPositionId: z.string().trim().optional(),
  /**
   * Телефон необязателен: одиночное добавление его не требует, и
   * расходиться в требованиях между «добавить одного» и «добавить
   * десятерых» нельзя — это читается как поломка, а не как правило.
   */
  phone: z.string().trim().optional(),
  contactEmail: z.string().trim().max(200).optional(),
  weeklyDaysOff: z.array(z.number().int().min(0).max(6)).optional(),
  /// Пусто — доступ наследуется от должности, как при одиночном
  /// добавлении. Явный список переопределяет наследование.
  journalCodes: z.array(z.string()).optional(),
  telegramInvite: z.boolean().optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).optional(),
  csv: z.string().optional(),
});

function syntheticEmail(orgId: string) {
  const salt = crypto.randomBytes(6).toString("hex");
  return `staff-${salt}@${orgId}.local.haccp`;
}

export async function POST(request: Request) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  let rows = body.data.rows ?? [];
  const errors: Array<{ line: number; message: string; raw?: unknown }> = [];

  if (body.data.csv && rows.length === 0) {
    // Разбор общий с браузером (`staff-bulk-parse`): две реализации
    // одного формата однажды разойдутся, и получится «на сайте
    // распозналось, в файле нет».
    const parsed = parseStaffRows(body.data.csv);
    rows = parsed.rows;
    errors.push(...parsed.errors);
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Не нашёл ни одной строки. Колонки: ФИО / Должность / Телефон." },
      { status: 400 }
    );
  }

  const positions = await db.jobPosition.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, categoryKey: true },
  });
  const posByName = new Map(positions.map((p) => [p.name.toLowerCase(), p]));
  const posById = new Map(positions.map((p) => [p.id, p]));

  // Pre-compute position → templateCodes map один раз, чтобы каждой
  // импортируемой строке проставить тот же ACL что одиночное создание
  // через /api/staff (commit 6b7a061c). Раньше bulk создавал юзера с
  // journalAccessMigrated: false → пользователь получал full access ко
  // ВСЕМ журналам через legacy back-compat. Например, повар импортировался
  // и сразу видел медкнижки коллег.
  const positionAccess = await db.jobPositionJournalAccess.findMany({
    where: { organizationId: orgId },
    include: { template: { select: { code: true } } },
  });
  const posIdToCodes = new Map<string, string[]>();
  for (const a of positionAccess) {
    const codes = posIdToCodes.get(a.jobPositionId) ?? [];
    codes.push(a.template.code);
    posIdToCodes.set(a.jobPositionId, codes);
  }

  // Fuzzy-match для всех уникальных имён должностей в импорте — одной
  // batch-операцией. Используется как fallback если exact-match не
  // сработал. Confidence ≥ 0.7 → авто-применяем, < 0.7 → ошибка для
  // ручного выбора.
  const { matchJobPositions } = await import("@/lib/job-position-match");
  const uniquePositionNames = Array.from(
    new Set(rows.map((r) => r.positionName))
  );
  const fuzzyMatches = matchJobPositions(
    uniquePositionNames,
    positions.map((p) => ({ id: p.id, name: p.name }))
  );
  const fuzzyByInput = new Map(fuzzyMatches.map((m) => [m.input, m]));

  let created = 0;
  let skipped = 0;
  let autoMatched = 0;
  // Лимит тарифа — по строкам ДО создания каждой: после бесплатного
  // периода на бесплатном тарифе второго активного добавить нельзя.
  // Сторонняя бракеражная комиссия в тариф не входит.
  let seatsLeft = (await seatAllowance(orgId)).left;
  let seatBlocked = 0;
  const createdUsers: Array<{
    id: string;
    name: string;
    telegramInvite: boolean;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let pos =
      (row.jobPositionId ? posById.get(row.jobPositionId) : null) ??
      posByName.get(row.positionName.toLowerCase()) ??
      null;

    // Fallback: fuzzy match если exact не нашёл.
    if (!pos) {
      const fuzzy = fuzzyByInput.get(row.positionName);
      if (fuzzy && fuzzy.positionId && fuzzy.confidence >= 0.7) {
        const matched = posById.get(fuzzy.positionId);
        if (matched) {
          pos = matched;
          autoMatched += 1;
        }
      }
    }

    if (!pos) {
      const fuzzy = fuzzyByInput.get(row.positionName);
      const hint =
        fuzzy && fuzzy.positionName
          ? ` Возможно, имели в виду «${fuzzy.positionName}» (точность ${Math.round(fuzzy.confidence * 100)}%)? Уточните название.`
          : "";
      errors.push({
        line: i + 1,
        message: `Должность «${row.positionName}» не найдена.${hint}`,
        raw: row,
      });
      continue;
    }
    // Пустой телефон — норма (одиночное добавление его не требует).
    // Заполненный, но неразобранный — ошибка: молча сохранить кривой
    // номер хуже, чем не сохранить никакого.
    const rawPhone = (row.phone ?? "").trim();
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (rawPhone && !phone) {
      errors.push({
        line: i + 1,
        message: `Не разобрал телефон «${rawPhone}»`,
        raw: row,
      });
      continue;
    }

    // Дубли: по телефону, если он есть, иначе по паре ФИО + должность.
    // Без второго условия повторная заливка списка без телефонов
    // плодила бы копии людей на каждый заход.
    const existing = await db.user.findFirst({
      where: phone
        ? { organizationId: orgId, phone }
        : {
            organizationId: orgId,
            name: row.fullName,
            jobPositionId: pos.id,
          },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    if (pos.categoryKey !== "commission") {
      if (seatsLeft <= 0) {
        errors.push({ line: i + 1, message: `«${row.fullName}»: ${FREE_LIMIT_MESSAGE}`, raw: row });
        seatBlocked += 1;
        continue;
      }
      seatsLeft -= 1;
    }

    const explicitCodes = row.journalCodes ?? null;
    const codesForPosition = explicitCodes ?? posIdToCodes.get(pos.id) ?? [];
    const useStrictAcl = explicitCodes !== null || codesForPosition.length > 0;

    const user = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          organizationId: orgId,
          name: row.fullName,
          email: syntheticEmail(orgId),
          passwordHash: "",
          role: pos.categoryKey === "management" ? "manager" : "cook",
          phone,
          contactEmail: row.contactEmail?.trim() || null,
          weeklyDaysOff: row.weeklyDaysOff ?? [...DEFAULT_WEEKLY_DAYS_OFF],
          jobPositionId: pos.id,
          positionTitle: pos.name,
          isActive: true,
          // Если позиция имеет explicit JobPositionJournalAccess —
          // переключаем юзера в migrated-режим, чтобы ACL фильтровал
          // журналы. Иначе — legacy back-compat (полный доступ).
          journalAccessMigrated: useStrictAcl,
        },
        select: { id: true, name: true },
      });
      if (useStrictAcl) {
        await tx.userJournalAccess.createMany({
          data: codesForPosition.map((templateCode) => ({
            userId: u.id,
            templateCode,
            canRead: true,
            canWrite: true,
            canFinalize: false,
          })),
          skipDuplicates: true,
        });
      }
      return u;
    });
    createdUsers.push({
      ...user,
      // Кому обещали пригласить в Telegram — интерфейс покажет QR сразу
      // после импорта, чтобы не искать этих людей заново в списке.
      telegramInvite: row.telegramInvite === true,
    });
    created++;

    if (phone) {
      tryAutolinkTasksflowByPhone({
        organizationId: orgId,
        weSetupUserId: user.id,
        phone,
        name: user.name,
      }).catch((err) => console.error("[bulk] autolink failed", err));
    }
  }

  // До конца бесплатного периода импорт может разом перевалить за
  // бесплатные места — тихий перевод проверяем один раз после пачки.
  const planCheck = await ensurePlanForHeadcount(orgId);
  const billingLimit = seatLimitSummary(seatBlocked, "staff.bulk", orgId);

  await recordAuditLog({
    request,
    session,
    organizationId: orgId,
    action: "staff.bulk-import",
    entity: "User",
    entityId: null,
    details: {
      attempted: rows.length,
      created,
      skipped,
      autoMatched,
      errorCount: errors.length,
    },
  });

  return NextResponse.json({
    ok: true,
    created,
    skipped,
    autoMatched,
    errors,
    createdUsers,
    planUpgraded: planCheck.upgraded,
    billingLimit,
  });
}
