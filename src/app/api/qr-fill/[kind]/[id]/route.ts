import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveBuildingId, getViewedPointId } from "@/lib/active-building";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { brandQrOptionsFor } from "@/lib/brand-qr-center.server";
import { loadPrintBrand } from "@/lib/print-brand.server";
import { loadQrPoster, resolveMainJournalQrBuilding } from "@/lib/qr-fill-poster";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { decodeRouteParam } from "@/lib/route-param";
import { db } from "@/lib/db";
import { documentInWorkerScope, loadManagerPointScope } from "@/lib/worker-point-scope";
import { splitJournalPosterId } from "@/lib/journal-qr-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QR одного объекта для превью в диалоге строки журнала (холодильник или
 * помещение). Тот же билдер, что у страницы плакатов; токен минтится
 * на сервере — секрет в клиент не уходит.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot === true })) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { kind, id: rawId } = await params;
  const id = decodeRouteParam(rawId);
  if (kind !== "equipment" && kind !== "room" && kind !== "journal") {
    return NextResponse.json({ error: "Неизвестный вид объекта" }, { status: 400 });
  }

  const origin = resolveQrPosterOrigin({
    configured: process.env.NEXTAUTH_URL || process.env.PUBLIC_URL,
    production: process.env.NODE_ENV === "production",
  });

  try {
    const organizationId = getActiveOrgId(session);
    // Руководитель точки (аудит 2026-11-01): QR только объектов своих точек.
    if (kind !== "journal") {
      const objectPoint =
        kind === "equipment"
          ? (await db.equipment.findFirst({ where: { id, area: { organizationId } }, select: { area: { select: { buildingId: true } } } }))?.area.buildingId
          : (await db.room.findFirst({ where: { id, building: { organizationId } }, select: { buildingId: true } }))?.buildingId;
      if (!documentInWorkerScope(await loadManagerPointScope(organizationId, session.user.id), objectPoint)) {
        return NextResponse.json({ error: "Объект не найден" }, { status: 404 });
      }
    } else {
      // QR документа чужой точки — как несуществующий (аудит 2026-11-01): его
      // ссылка открывает запись в документ и список людей той точки.
      const documentId = splitJournalPosterId(id).documentId;
      if (documentId) {
        const document = await db.journalDocument.findFirst({ where: { id: documentId, organizationId }, select: { buildingId: true } });
        if (!document || !documentInWorkerScope(await loadManagerPointScope(organizationId, session.user.id), document.buildingId)) {
          return NextResponse.json({ error: "Объект не найден" }, { status: 404 });
        }
      }
    }
    const poster = await loadQrPoster({
      organizationId,
      // Превью в диалоге — тот же QR, что на печати: рамка и центр организации.
      qr: await brandQrOptionsFor(organizationId, await loadPrintBrand(organizationId)),
      kind,
      id,
      origin,
      // Основной QR журнала в сети точек — на активную точку (как на странице QR-кодов).
      activeBuildingId: kind === "journal" ? await getActiveBuildingId(session) : null,
      // Строка точки у оборудования цеха без точки — точка из шапки, как на печати.
      printPointId:
        kind === "journal" ? null : await resolveMainJournalQrBuilding(organizationId, await getViewedPointId(session)),
    });
    if (!poster) {
      return NextResponse.json({ error: "Объект не найден" }, { status: 404 });
    }
    return NextResponse.json({ poster });
  } catch (error) {
    console.error("qr-fill poster error:", error);
    return NextResponse.json({ error: "Не удалось собрать QR-код" }, { status: 500 });
  }
}
