import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  buildColdEquipmentAutoFillEntryData,
  buildColdEquipmentAutoFillRows,
  createColdEquipmentConfigItem,
  mergeColdEquipmentEntryData,
  normalizeColdEquipmentDocumentConfig,
  normalizeColdEquipmentEntryData,
  syncColdEquipmentEntryDataWithConfig,
  type ColdEquipmentDocumentConfig,
} from "@/lib/cold-equipment-document";
import { syncEquipmentDirectoryItem } from "@/lib/equipment-directory";
import { toDateKey } from "@/lib/hygiene-document";
import { isManagementRole, pickPrimaryManager } from "@/lib/user-roles";

type ColdEquipmentAction =
  | "apply_auto_fill"
  | "sync_entries"
  /** Строка из диалога журнала: конфиг + запись справочника «Оборудование». */
  | "save_equipment"
  /** Несвязанные строки → записи справочника (для печати QR выбранных). */
  | "ensure_equipment";

type ColdEquipmentBody = {
  action?: ColdEquipmentAction;
  item?: unknown;
  itemIds?: unknown;
};

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
  const body = (await request.json().catch(() => ({}))) as ColdEquipmentBody;
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

  if (document.template.code !== COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    return NextResponse.json({ error: "Неверный тип документа" }, { status: 400 });
  }

  if (document.status === "closed") {
    return NextResponse.json(
      { error: "Закрытый документ нельзя изменять" },
      { status: 400 }
    );
  }

  const config = normalizeColdEquipmentDocumentConfig(document.config);
  const entriesByDate = new Map<string, (typeof document.entries)>();

  document.entries.forEach((entry) => {
    const dateKey = toDateKey(entry.date);
    const bucket = entriesByDate.get(dateKey);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    entriesByDate.set(dateKey, [entry]);
  });

  const duplicateDateKeys = Array.from(entriesByDate.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([dateKey]) => dateKey);

  if (duplicateDateKeys.length > 0) {
    return NextResponse.json(
      {
        error:
          duplicateDateKeys.length === 1
            ? `Обнаружено несколько строк с датой ${duplicateDateKeys[0]}. Удалите дубликаты и повторите действие.`
            : `Обнаружены дублирующиеся строки по датам: ${duplicateDateKeys.join(", ")}. Удалите дубликаты и повторите действие.`,
      },
      { status: 409 }
    );
  }

  /** Подгоняет `temperatures` всех записей под состав строк конфига. */
  async function syncEntriesWith(nextConfig: ColdEquipmentDocumentConfig) {
    await Promise.all(
      document!.entries.map((entry) =>
        db.journalDocumentEntry.update({
          where: { id: entry.id },
          data: {
            data: syncColdEquipmentEntryDataWithConfig(
              normalizeColdEquipmentEntryData(entry.data),
              nextConfig
            ),
          },
        })
      )
    );
  }

  async function persistConfig(nextConfig: ColdEquipmentDocumentConfig) {
    await db.journalDocument.update({
      where: { id: document!.id },
      data: { config: nextConfig },
    });
    await syncEntriesWith(nextConfig);
  }

  if (action === "sync_entries") {
    await syncEntriesWith(config);
    return NextResponse.json({ updated: document.entries.length });
  }

  if (action === "save_equipment") {
    const raw = body.item;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "Не передана строка оборудования" }, { status: 400 });
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name.trim() === "") {
      return NextResponse.json({ error: "Название обязательно" }, { status: 400 });
    }
    const draft = createColdEquipmentConfigItem({
      id: typeof record.id === "string" && record.id.trim() !== "" ? record.id : undefined,
      sourceEquipmentId:
        typeof record.sourceEquipmentId === "string" ? record.sourceEquipmentId : null,
      name: record.name,
      min: typeof record.min === "number" ? record.min : null,
      max: typeof record.max === "number" ? record.max : null,
      readingMode:
        record.readingMode === "once" ||
        record.readingMode === "twice" ||
        record.readingMode === "thrice"
          ? record.readingMode
          : undefined,
    });
    if (draft.min != null && draft.max != null && draft.min > draft.max) {
      return NextResponse.json(
        { error: "Минимум нормы не может быть больше максимума" },
        { status: 400 }
      );
    }

    const item = await syncEquipmentDirectoryItem(getActiveOrgId(session), draft);
    const exists = config.equipment.some((current) => current.id === item.id);
    const nextConfig = normalizeColdEquipmentDocumentConfig({
      ...config,
      equipment: exists
        ? config.equipment.map((current) => (current.id === item.id ? item : current))
        : [...config.equipment, item],
    });
    await persistConfig(nextConfig);
    return NextResponse.json({ item, config: nextConfig });
  }

  if (action === "ensure_equipment") {
    const itemIds = Array.isArray(body.itemIds)
      ? body.itemIds.filter((value): value is string => typeof value === "string")
      : [];
    if (itemIds.length === 0) {
      return NextResponse.json({ error: "Не выбраны строки" }, { status: 400 });
    }
    const wanted = new Set(itemIds);
    const equipment = [...config.equipment];
    let changed = false;
    for (let index = 0; index < equipment.length; index += 1) {
      const current = equipment[index];
      if (!wanted.has(current.id)) continue;
      const synced = await syncEquipmentDirectoryItem(getActiveOrgId(session), current);
      if (synced.sourceEquipmentId !== current.sourceEquipmentId) {
        equipment[index] = synced;
        changed = true;
      }
    }
    const nextConfig = normalizeColdEquipmentDocumentConfig({ ...config, equipment });
    if (changed) await persistConfig(nextConfig);
    const equipmentIds = itemIds
      .map((itemId) => nextConfig.equipment.find((current) => current.id === itemId)?.sourceEquipmentId)
      .filter((value): value is string => Boolean(value));
    return NextResponse.json({ config: nextConfig, equipmentIds });
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

  const generatedRows = buildColdEquipmentAutoFillRows({
    config,
    dateFrom: document.dateFrom,
    dateTo: document.dateTo,
    responsibleTitle: document.responsibleTitle,
    responsibleUserId,
  });

  const existingByDate = new Map<string, (typeof document.entries)[number]>(
    Array.from(entriesByDate.entries()).map(([dateKey, entries]) => [dateKey, entries[0]])
  );

  const rowsToCreate = generatedRows
    .filter((row) => !existingByDate.has(toDateKey(row.date)))
    .map((row) => ({
      documentId: document.id,
      employeeId: row.employeeId,
      date: row.date,
      data: row.data,
    }));

  const rowsToUpdate = generatedRows.reduce<Promise<unknown>[]>((acc, row) => {
      const existing = existingByDate.get(toDateKey(row.date));
      if (!existing) {
        return acc;
      }

      const merged = mergeColdEquipmentEntryData(
        syncColdEquipmentEntryDataWithConfig(
          normalizeColdEquipmentEntryData(existing.data),
          config
        ),
        buildColdEquipmentAutoFillEntryData({
          config,
          dateKey: toDateKey(row.date),
          responsibleTitle: document.responsibleTitle,
        })
      );

      acc.push(
        db.journalDocumentEntry.update({
          where: { id: existing.id },
          data: {
            employeeId: responsibleUserId,
            data: merged,
          },
        })
      );

      return acc;
    }, []);

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
