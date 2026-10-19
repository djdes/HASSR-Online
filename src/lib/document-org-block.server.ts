/**
 * Загрузка блока сведений для документов из БД (server-only). Сборка и
 * правила — чистый `document-org-block.ts`.
 */

import { db } from "@/lib/db";
import {
  DOCUMENT_ORG_SELECT,
  DOCUMENT_POINT_SELECT,
  buildDocumentOrgBlock,
  type DocumentOrgBlock,
} from "@/lib/document-org-block";

/**
 * Блок организации и (если задана) её точки. Чужая точка не подмешивается:
 * здание ищется только внутри организации. Организации нет — null.
 */
export async function loadDocumentOrgBlock(
  organizationId: string,
  opts: { buildingId?: string | null; documentConfig?: unknown } = {},
): Promise<DocumentOrgBlock | null> {
  const [org, point] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: DOCUMENT_ORG_SELECT }),
    opts.buildingId
      ? db.building.findFirst({ where: { id: opts.buildingId, organizationId }, select: DOCUMENT_POINT_SELECT })
      : Promise.resolve(null),
  ]);
  if (!org) return null;
  return buildDocumentOrgBlock({ org, point, documentConfig: opts.documentConfig });
}
