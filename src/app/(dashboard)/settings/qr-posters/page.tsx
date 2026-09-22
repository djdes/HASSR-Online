import { redirect } from "next/navigation";

import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isJournalObjectQrCode, journalQrHref, parseQrPosterKind, splitJournalPosterId } from "@/lib/journal-qr-target";
import { todayKeyFor } from "@/lib/journal-fill";
import { loadQrPosters } from "@/lib/qr-fill-poster";
import type { QrPosterLayout } from "@/lib/qr-fill-types";
import { resolveJournalObjectScope } from "@/lib/qr-journal-scope";
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
 *   ?kind=rooms|equipment|journals — что печатать (по умолчанию склады;
 *                           единственное число тоже принимается)
 *   &layout=poster|sheet    — плакат на лист A4 или наклейки сеткой
 *   &ids=a,b                — только эти объекты; у журналов — любые коды
 *                           организации (`код`, `код:документ`,
 *                           `hygiene@verify`), даже без документа на сегодня
 *   &journal=<код>          — наклейки объектов журнала (холодильники,
 *                           склады, УФ-лампы) — кнопка «QR-точка контроля»
 *   &doc=<id>               — только объекты из строк документа
 *                           (важнее `journal=`)
 *   &autoprint=1            — сразу открыть диалог печати
 *   &origin=https://…       — домен ссылок (для проверки на стенде)
 *
 * Журнал объектов в `ids=` (старые ссылки) перенаправляется на его
 * наклейки: плаката журнала у холодильников нет — сканируют сам объект.
 */
export default async function QrPostersPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    layout?: string;
    ids?: string;
    doc?: string;
    journal?: string;
    autoprint?: string;
    origin?: string;
  }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");
  const organizationId = getActiveOrgId(session);
  const query = await searchParams;
  const kind = parseQrPosterKind(query.kind);
  const layout: QrPosterLayout = query.layout === "sheet" ? "sheet" : "poster";
  const onlyIds = Array.from(
    new Set(
      (query.ids ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );
  const origin = resolveQrPosterOrigin({
    requested: query.origin,
    configured: process.env.NEXTAUTH_URL || process.env.PUBLIC_URL,
    production: process.env.NODE_ENV === "production",
  });

  // Журнал объектов вместо плаката журнала — на наклейки его объектов.
  if (kind === "journal") {
    const objectId = onlyIds.map(splitJournalPosterId).find((item) => isJournalObjectQrCode(item.code));
    if (objectId) redirect(journalQrHref(objectId.code, { documentId: objectId.documentId ?? query.doc ?? null }));
  }

  // Область наклеек: документ (`doc=`) важнее журнала (`journal=`).
  let scopeCode = isJournalObjectQrCode(query.journal) ? (query.journal as string) : null;
  if (query.doc && kind !== "journal") {
    const document = await db.journalDocument.findFirst({
      where: { id: query.doc, organizationId },
      select: { template: { select: { code: true } } },
    });
    if (document && isJournalObjectQrCode(document.template.code)) scopeCode = document.template.code;
  }
  const org = scopeCode
    ? await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } })
    : null;
  const scope = scopeCode
    ? await resolveJournalObjectScope(organizationId, scopeCode, todayKeyFor(org?.timezone), query.doc ?? null)
    : null;
  // Вид из адреса не совпал с журналом (склады ↔ холодильники) — на верный.
  if (scope && scope.kind !== kind) redirect(journalQrHref(scope.code, { documentId: scope.document?.id ?? null }));
  const scopeIds = scope ? new Set(scope.ids) : null;

  const { posters, missing } = await loadQrPosters({
    organizationId,
    kind,
    origin,
    explicitIds: onlyIds,
    allowed: (id) => !scopeIds || scopeIds.has(id),
  });

  return (
    <QrPostersClient
      kind={kind}
      layout={layout}
      posters={posters}
      missing={missing}
      origin={origin}
      documentTitle={scope?.document?.title ?? null}
      documentId={scope?.document?.id ?? null}
      journal={
        scope
          ? { code: scope.code, name: scope.journalName, source: scope.source }
          : null
      }
      selectedIds={onlyIds.length > 0 ? onlyIds : null}
      autoprint={query.autoprint === "1"}
    />
  );
}
