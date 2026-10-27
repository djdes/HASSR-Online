/**
 * Данные организации для плакатов (2026-10-27): средства из журнала учёта
 * дезсредств (порядок памяток) и QR на гигиенический журнал («Ежедневный
 * осмотр»). Оба запроса дешёвые, при ошибке плакаты остаются как есть.
 */

import { brandQrSvg } from "@/lib/brand-qr";
import { brandQrOptionsFor } from "@/lib/brand-qr-center.server";
import type { PrintBrand } from "@/lib/print-brand";
import { db } from "@/lib/db";
import { DISINFECTANT_TEMPLATE_CODE, normalizeDisinfectantConfig } from "@/lib/disinfectant-document";
import { normalizeDisinfectantName } from "@/lib/ppk/posters";
import { mainJournalQrUrl } from "@/lib/qr-fill-poster";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";

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
 * документа этого журнала (или не удалось собрать).
 */
export async function loadJournalQrSvg(
  organizationId: string,
  templateCode: string,
  brand?: PrintBrand,
): Promise<string | null> {
  try {
    const document = await db.journalDocument.findFirst({
      where: { organizationId, template: { code: templateCode } },
      select: { id: true },
    });
    if (!document) return null;
    const origin = resolveQrPosterOrigin({
      requested: null,
      configured: process.env.NEXTAUTH_URL || process.env.PUBLIC_URL,
      production: process.env.NODE_ENV === "production",
    });
    const { url } = await mainJournalQrUrl({ organizationId, code: templateCode, origin });
    // Рамка в фирменном цвете и значок организации в центре — как у QR-наклеек.
    return await brandQrSvg(url, brand ? await brandQrOptionsFor(organizationId, brand) : {});
  } catch {
    return null;
  }
}
