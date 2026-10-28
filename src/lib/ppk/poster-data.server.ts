/**
 * Данные организации для плакатов (2026-10-27): средства из журнала учёта
 * дезсредств (порядок памяток), торговые точки для печати (2026-10-28) и QR
 * на гигиенический журнал точки («Ежедневный осмотр»). Запросы дешёвые, при
 * ошибке плакаты остаются как есть.
 */

import type { Session } from "next-auth";

import { listPersonBuildings, loadBuildingContext } from "@/lib/active-building";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { brandQrSvg } from "@/lib/brand-qr";
import { brandQrOptionsFor } from "@/lib/brand-qr-center.server";
import { buildingWhere } from "@/lib/building-scope";
import type { PrintBrand } from "@/lib/print-brand";
import { db } from "@/lib/db";
import { DISINFECTANT_TEMPLATE_CODE, normalizeDisinfectantConfig } from "@/lib/disinfectant-document";
import { posterPoints, type PosterPointSource } from "@/lib/ppk/poster-point";
import { normalizeDisinfectantName } from "@/lib/ppk/posters";
import { mainJournalQrUrl } from "@/lib/qr-fill-poster";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";

/**
 * Торговые точки, для которых человек печатает памятки (без офиса, с учётом
 * `User.buildingIds`, порядок — как у переключателя в шапке), и точка из шапки
 * кабинета — она выбирается по умолчанию.
 */
export async function loadPosterPoints(
  session: Session,
): Promise<{ points: PosterPointSource[]; headerPointId: string | null }> {
  const organizationId = getActiveOrgId(session);
  const [person, context] = await Promise.all([listPersonBuildings(session), loadBuildingContext(session)]);
  const allowed = posterPoints(person);
  if (allowed.length === 0) return { points: [], headerPointId: context.activeBuildingId };
  const rows = await db.building.findMany({
    where: { organizationId, id: { in: allowed.map((point) => point.id) } },
    select: { id: true, journalName: true },
  });
  const journalNames = new Map(rows.map((row) => [row.id, row.journalName]));
  return {
    points: allowed.map((point) => ({ ...point, journalName: journalNames.get(point.id) ?? null })),
    headerPointId: context.activeBuildingId,
  };
}

/** Сколько последних документов журнала дезсредств просматриваем. */
const DISINFECTANT_DOCUMENTS_LIMIT = 5;

/**
 * Названия средств из подразделений и приходов журнала учёта дезсредств,
 * нормализованные для сравнения с памятками. Нет журнала или ошибка — [].
 */
export async function loadDisinfectantJournalNames(organizationId: string): Promise<string[]> {
  try {
    const documents = await db.journalDocument.findMany({
      where: { organizationId, template: { code: DISINFECTANT_TEMPLATE_CODE } },
      orderBy: { dateTo: "desc" },
      take: DISINFECTANT_DOCUMENTS_LIMIT,
      select: { config: true },
    });
    const names = new Set<string>();
    for (const document of documents) {
      const config = normalizeDisinfectantConfig(document.config);
      for (const row of [...config.subdivisions, ...config.receipts]) {
        const name = normalizeDisinfectantName(row.disinfectantName);
        if (name) names.add(name);
      }
    }
    return [...names];
  } catch {
    return [];
  }
}

/**
 * SVG-код QR на журнал `templateCode` организации или null, если у неё нет
 * документа этого журнала (или не удалось собрать). `buildingId` — точка
 * памятки: у организации с журналами по точкам QR ведёт в журнал этой точки
 * (`mainJournalQrUrl`), иначе — в общий журнал; документ ищем свой или общий.
 */
export async function loadJournalQrSvg(
  organizationId: string,
  templateCode: string,
  brand?: PrintBrand,
  buildingId?: string | null,
): Promise<string | null> {
  try {
    const document = await db.journalDocument.findFirst({
      where: { organizationId, template: { code: templateCode }, ...buildingWhere(buildingId) },
      select: { id: true },
    });
    if (!document) return null;
    const origin = resolveQrPosterOrigin({
      requested: null,
      configured: process.env.NEXTAUTH_URL || process.env.PUBLIC_URL,
      production: process.env.NODE_ENV === "production",
    });
    const { url } = await mainJournalQrUrl({ organizationId, code: templateCode, origin, activeBuildingId: buildingId });
    // Рамка в фирменном цвете и значок организации в центре — как у QR-наклеек.
    return await brandQrSvg(url, brand ? await brandQrOptionsFor(organizationId, brand) : {});
  } catch {
    return null;
  }
}
