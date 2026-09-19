import { redirect } from "next/navigation";

import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  normalizeClimateDocumentConfig,
} from "@/lib/climate-document";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  normalizeColdEquipmentDocumentConfig,
} from "@/lib/cold-equipment-document";
import { db } from "@/lib/db";
import { loadQrPosters } from "@/lib/qr-fill-poster";
import type { QrFillKind, QrPosterLayout } from "@/lib/qr-fill-types";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { QrPostersClient } from "./qr-posters-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "QR-плакаты" };

/**
 * QR-коды для заполнения без входа: склад — температура и влажность
 * помещения в журнал климата, холодильник — температура в журнал
 * холодильного оборудования. Сотрудник сканирует камерой телефона и вносит
 * показание без входа в кабинет.
 *
 *   ?kind=rooms|equipment|journals — что печатать (по умолчанию склады)
 *   &layout=poster|sheet    — плакат на лист A4 или наклейки сеткой
 *   &ids=a,b                — только эти объекты
 *   &doc=<id>               — только объекты из строк документа
 *   &autoprint=1            — сразу открыть диалог печати
 *   &origin=https://…       — домен ссылок (для проверки на стенде)
 */
export default async function QrPostersPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    layout?: string;
    ids?: string;
    doc?: string;
    autoprint?: string;
    origin?: string;
  }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");
  const organizationId = getActiveOrgId(session);
  const query = await searchParams;
  const kind: QrFillKind = query.kind === "equipment" ? "equipment" : query.kind === "journals" ? "journal" : "room";
  const layout: QrPosterLayout = query.layout === "sheet" ? "sheet" : "poster";
  const onlyIds = new Set(
    (query.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
  const origin = resolveQrPosterOrigin({
    requested: query.origin,
    configured: process.env.NEXTAUTH_URL || process.env.PUBLIC_URL,
    production: process.env.NODE_ENV === "production",
  });

  // Документ ограничивает список своими строками (кнопка «QR-плакаты» в журнале).
  let documentScope: { title: string; ids: Set<string> } | null = null;
  if (query.doc) {
    const document = await db.journalDocument.findFirst({
      where: { id: query.doc, organizationId },
      select: { title: true, config: true, template: { select: { code: true } } },
    });
    if (document?.template.code === CLIMATE_DOCUMENT_TEMPLATE_CODE && kind === "room") {
      const config = normalizeClimateDocumentConfig(document.config);
      documentScope = {
        title: document.title,
        ids: new Set(config.rooms.map((room) => room.roomId).filter((id): id is string => Boolean(id))),
      };
    } else if (document?.template.code === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE && kind === "equipment") {
      const config = normalizeColdEquipmentDocumentConfig(document.config);
      documentScope = {
        title: document.title,
        ids: new Set(
          config.equipment.map((item) => item.sourceEquipmentId).filter((id): id is string => Boolean(id))
        ),
      };
    }
  }

  const posters = await loadQrPosters({
    organizationId,
    kind,
    origin,
    allowed: (id) =>
      (onlyIds.size === 0 || onlyIds.has(id)) && (!documentScope || documentScope.ids.has(id)),
  });

  return (
    <QrPostersClient
      kind={kind}
      layout={layout}
      posters={posters}
      origin={origin}
      documentTitle={documentScope?.title ?? null}
      documentId={documentScope ? query.doc ?? null : null}
      selectedIds={onlyIds.size > 0 ? Array.from(onlyIds) : null}
      autoprint={query.autoprint === "1"}
    />
  );
}
