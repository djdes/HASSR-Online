import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * GET /api/bonus-entries/export?from=YYYY-MM-DD&to=YYYY-MM-DD&user=...
 *
 * Phase 3 → шаг 3.6. CSV-выгрузка для ручного импорта в payroll-сервис.
 *
 * Колонки:
 *   дата_claim, сотрудник_id, сотрудник_имя, журнал_код, журнал_название,
 *   статус, сумма_рублей, сумма_копейки, причина_отказа
 *
 * Только management. Менеджер платит — менеджер и видит. CSV в UTF-8 +
 * BOM, чтобы Excel в RU-локали корректно отображал кириллицу.
 */

const PERIOD_MAX_DAYS = 366;

export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const session = auth.session;
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    })
  ) {
    return NextResponse.json(
      { error: "Это действие доступно руководителю" },
      { status: 403 }
    );
  }

  const orgId = getActiveOrgId(session);
  const url = new URL(request.url);
  const fromIso = url.searchParams.get("from");
  const toIso = url.searchParams.get("to");
  const userIdRaw = url.searchParams.get("user");

  if (!isValidIsoDate(fromIso) || !isValidIsoDate(toIso)) {
    return NextResponse.json(
      { error: "Параметры from/to обязательны в формате YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const fromDate = new Date(`${fromIso}T00:00:00.000Z`);
  const toInclusive = new Date(`${toIso}T00:00:00.000Z`);
  if (toInclusive.getTime() < fromDate.getTime()) {
    return NextResponse.json(
      { error: "to должен быть не раньше from" },
      { status: 400 }
    );
  }

  const periodDays = Math.round(
    (toInclusive.getTime() - fromDate.getTime()) / 86400000
  );
  if (periodDays > PERIOD_MAX_DAYS) {
    return NextResponse.json(
      { error: `Период не может превышать ${PERIOD_MAX_DAYS} дней` },
      { status: 400 }
    );
  }

  const toExclusive = new Date(toInclusive.getTime() + 86400000);
  const userId =
    userIdRaw && userIdRaw !== "all" && userIdRaw.length > 0
      ? userIdRaw
      : null;

  const bonuses = await db.bonusEntry.findMany({
    where: {
      organizationId: orgId,
      createdAt: { gte: fromDate, lt: toExclusive },
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      amountKopecks: true,
      rejectedReason: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
      template: { select: { code: true, name: true } },
      obligation: { select: { claimedAt: true } },
    },
  });

  const headerRow = [
    "id",
    "claimed_at",
    "employee_id",
    "employee_name",
    "journal_code",
    "journal_name",
    "status",
    "amount_rubles",
    "amount_kopecks",
    "rejected_reason",
  ];

  const lines: string[] = [headerRow.map(csvCell).join(",")];
  for (const bonus of bonuses) {
    const claimedAt = bonus.obligation?.claimedAt ?? bonus.createdAt;
    const rubles = bonus.amountKopecks / 100;
    lines.push(
      [
        bonus.id,
        claimedAt.toISOString(),
        bonus.user.id,
        bonus.user.name ?? "",
        bonus.template.code,
        bonus.template.name,
        bonus.status,
        rubles.toFixed(2),
        String(bonus.amountKopecks),
        bonus.rejectedReason ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  // BOM (﻿) нужен Excel в RU-локали для корректной кириллицы.
  const body = "﻿" + lines.join("\r\n") + "\r\n";

  const filename = `bonuses_${fromIso}_${toIso}${userId ? `_${userId}` : ""}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function isValidIsoDate(value: string | null): value is string {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

// CSV-injection (CWE-1236): bonus.user.name / template.name /
// rejectedReason — пользовательский ввод. Открыв CSV в Excel, юзер
// исполнит формулу `=…`. Префиксим одинарной кавычкой если значение
// начинается с формула-триггера.
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (CSV_FORMULA_PREFIX.test(str)) {
    str = "'" + str;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
