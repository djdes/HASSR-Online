import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";

/**
 * Построитель CSV-файла со списаниями (LossRecord) за период в формате,
 * который безболезненно открывается в Excel (UTF-8 BOM, разделитель `;`)
 * и принимается типовыми импортёрами 1С:Бухгалтерия.
 *
 * Формат — простой реестр, не CommerceML. На практике 1С-юзер открывает
 * этот CSV в «Загрузка данных из табличного документа» и мапит колонки
 * на свой документ «Списание товаров». XML-CommerceML — overhead для
 * MVP; добавим если будет конкретный запрос.
 *
 * Колонки:
 *   Дата | Категория | Продукт | Кол-во | Ед.изм | Сумма ₽ | Причина
 *   (+ «Точка» последней колонкой, если организация работает по точкам:
 *   в 1С списание проводится по складу точки, 2026-11-01)
 */

const HEADERS = [
  "Дата",
  "Категория",
  "Продукт",
  "Кол-во",
  "Ед.изм",
  "Сумма (₽)",
  "Причина",
] as const;

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Если содержит ; " или \n — оборачиваем в "" и удваиваем кавычки.
  if (/[";\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export type Losses1cRecord = {
  date: Date;
  category: string;
  productName: string;
  quantity: number;
  unit: string;
  costRub: number | null;
  cause: string | null;
};

/**
 * CSV из записей. `pointNameOf` задан — последней колонкой «Точка»
 * (колонки 1С-импорта по позиции не сдвигаются).
 */
export function formatLosses1cCsv<T extends Losses1cRecord>(
  records: readonly T[],
  pointNameOf?: (record: T) => string,
): { csv: string; rowCount: number; totalSumKopecks: number } {
  const rows: string[] = [];
  rows.push([...HEADERS, ...(pointNameOf ? ["Точка"] : [])].map(csvEscape).join(";"));

  let totalSumKopecks = 0;
  for (const r of records) {
    const costRub = r.costRub ?? 0;
    totalSumKopecks += Math.round(costRub * 100);

    rows.push(
      [
        r.date.toISOString().slice(0, 10).split("-").reverse().join("."), // ДД.MM.ГГГГ
        r.category,
        r.productName,
        String(r.quantity).replace(".", ","),
        r.unit,
        costRub.toFixed(2).replace(".", ","),
        r.cause ?? "",
        ...(pointNameOf ? [pointNameOf(r)] : []),
      ]
        .map(csvEscape)
        .join(";")
    );
  }

  // BOM для корректного открытия в Excel и импорта в 1С
  // (windows-1251 сейчас не нужен, 1С 8.x понимает UTF-8 с BOM).
  const csv = "﻿" + rows.join("\r\n");

  return { csv, rowCount: records.length, totalSumKopecks };
}

export async function buildLosses1cCsv(
  organizationId: string,
  fromDate: Date,
  toDate: Date
): Promise<{ csv: string; rowCount: number; totalSumKopecks: number }> {
  const records = await db.lossRecord.findMany({
    where: {
      organizationId,
      date: { gte: fromDate, lte: toDate },
    },
    orderBy: { date: "asc" },
  });

  // Точка записи: своя (акт списания склада точки), иначе точка цеха.
  const pointsEnabled = (await buildingTargets(organizationId)).some(Boolean);
  if (!pointsEnabled) return formatLosses1cCsv(records);
  const [buildings, areas] = await Promise.all([
    db.building.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db.area.findMany({
      where: {
        organizationId,
        id: { in: [...new Set(records.map((r) => r.areaId).filter((id): id is string => Boolean(id)))] },
      },
      select: { id: true, buildingId: true },
    }),
  ]);
  const nameById = new Map(buildings.map((b) => [b.id, b.name] as const));
  const areaPoint = new Map(areas.map((a) => [a.id, a.buildingId] as const));
  return formatLosses1cCsv(records, (r) => {
    const pointId = r.buildingId ?? (r.areaId ? areaPoint.get(r.areaId) ?? null : null);
    return pointId ? nameById.get(pointId) ?? "" : "";
  });
}
