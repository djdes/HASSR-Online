import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  buildClimateAutoFillEntryData,
  buildClimateAutoFillRows,
  mergeClimateEntryData,
  normalizeClimateDocumentConfig,
  normalizeClimateControlTime,
  normalizeClimateEntryData,
  renameClimateControlTimes,
  syncClimateEntryDataWithConfig,
} from "@/lib/climate-document";
import { toDateKey } from "@/lib/hygiene-document";
import { isManagementRole, pickPrimaryManager } from "@/lib/user-roles";

type ClimateAction =
  | "apply_auto_fill"
  | "sync_entries"
  /** Смена времён контроля с переносом уже внесённых замеров. */
  | "set_control_times";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  if (!isManagementRole(session.user.role)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: ClimateAction;
    times?: unknown;
  };
  const action = body.action;

  if (!action) {
    return NextResponse.json({ error: "Не указано действие" }, { status: 400 });
  }

  const document = await db.journalDocument.findUnique({
    where: { id },
    include: {
      template: true,
      entries: {
        orderBy: [{ date: "asc" }, { employeeId: "asc" }],
      },
    },
  });

  if (!document || document.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  if (document.template.code !== CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    return NextResponse.json({ error: "Неверный тип документа" }, { status: 400 });
  }

  // Раньше: closed-check отсутствовал, в отличие от cold-equipment
  // route. Менеджер мог автозаполнить или синхронизировать строки в
  // ЗАКРЫТОМ климат-документе, что ломает аудитный «freeze»-семантик.
  if (document.status === "closed") {
    return NextResponse.json(
      { error: "Закрытый документ нельзя изменять" },
      { status: 400 }
    );
  }

  const config = normalizeClimateDocumentConfig(document.config);

  if (action === "set_control_times") {
    const raw = Array.isArray(body.times) ? body.times : [];
    const times = raw.map(normalizeClimateControlTime);
    if (times.length === 0 || times.length > 2 || times.some((time) => time === null)) {
      return NextResponse.json(
        { error: "Укажите одно или два времени контроля в формате ЧЧ:ММ" },
        { status: 400 }
      );
    }
    const nextTimes = times as string[];
    if (new Set(nextTimes).size !== nextTimes.length) {
      return NextResponse.json({ error: "Времена контроля не должны совпадать" }, { status: 400 });
    }

    // Слот i переезжает в слот i: «10:00 → 09:30». Удалённый второй слот
    // просто исчезает (как и раньше), добавленный — пустой.
    const mapping: Record<string, string> = {};
    config.controlTimes.forEach((from, index) => {
      const to = nextTimes[index];
      if (to && to !== from) mapping[from] = to;
    });
    const nextConfig = normalizeClimateDocumentConfig({ ...config, controlTimes: nextTimes });

    await db.journalDocument.update({
      where: { id: document.id },
      data: { config: nextConfig },
    });
    await Promise.all(
      document.entries.map((entry) =>
        db.journalDocumentEntry.update({
          where: { id: entry.id },
          data: {
            data: syncClimateEntryDataWithConfig(
              renameClimateControlTimes(normalizeClimateEntryData(entry.data), mapping),
              nextConfig
            ),
          },
        })
      )
    );

    return NextResponse.json({ config: nextConfig, updated: document.entries.length });
  }

  if (action === "sync_entries") {
    await Promise.all(
      document.entries.map((entry) =>
        db.journalDocumentEntry.update({
          where: { id: entry.id },
          data: {
            data: syncClimateEntryDataWithConfig(
              normalizeClimateEntryData(entry.data),
              config
            ),
          },
        })
      )
    );

    return NextResponse.json({ updated: document.entries.length });
  }

  const users = await db.user.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      isActive: true,
    },
    select: { id: true, role: true },
    orderBy: [{ role: "asc" }, { id: "asc" }],
  });

  const responsibleUserId =
    document.responsibleUserId || pickPrimaryManager(users)?.id;

  if (!responsibleUserId) {
    return NextResponse.json(
      { error: "Нет активного сотрудника для автозаполнения" },
      { status: 400 }
    );
  }

  const generatedRows = buildClimateAutoFillRows({
    config,
    dateFrom: document.dateFrom,
    dateTo: document.dateTo,
    responsibleTitle: document.responsibleTitle,
    responsibleUserId,
  });

  const existingByKey = new Map(
    document.entries.map((entry) => [
      `${entry.employeeId}:${toDateKey(entry.date)}`,
      entry,
    ])
  );

  const rowsToCreate = generatedRows
    .filter((row) => !existingByKey.has(`${row.employeeId}:${toDateKey(row.date)}`))
    .map((row) => ({
      documentId: document.id,
      employeeId: row.employeeId,
      date: row.date,
      data: row.data,
    }));

  const rowsToUpdate = generatedRows.flatMap((row) => {
    const key = `${row.employeeId}:${toDateKey(row.date)}`;
    const existing = existingByKey.get(key);
    if (!existing) return [];

    const merged = mergeClimateEntryData(
      syncClimateEntryDataWithConfig(normalizeClimateEntryData(existing.data), config),
      buildClimateAutoFillEntryData({
        config,
        dateKey: toDateKey(row.date),
        responsibleTitle: document.responsibleTitle,
      })
    );

    return [
      db.journalDocumentEntry.update({
        where: { id: existing.id },
        data: { data: merged },
      }),
    ];
  });

  if (rowsToCreate.length > 0) {
    await db.journalDocumentEntry.createMany({
      data: rowsToCreate,
      skipDuplicates: true,
    });
  }

  if (rowsToUpdate.length > 0) {
    await Promise.all(rowsToUpdate);
  }

  return NextResponse.json({
    created: rowsToCreate.length,
    updated: rowsToUpdate.length,
  });
}
