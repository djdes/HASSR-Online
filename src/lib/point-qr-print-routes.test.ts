import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * QR, печать и «Вся организация» (аудит изоляции 2026-11-01, вторая волна):
 * проверки держатся на месте по тексту маршрутов и страниц.
 */
const read = (path: string) => readFileSync(path, "utf8");

test("«QR-коды»: документы — точек человека и экрана; руководитель точки не сбрасывает точку", () => {
  const page = read("src/app/(dashboard)/settings/qr-posters/page.tsx");
  assert.match(page, /visibleDocumentWhere: \{ AND: \[documentVisibleWhere\(buildingContext\), buildingWhere\(activeBuildingId\)\] \}/);
  assert.match(page, /if \(!isPointScoped\(session\.user\)\) activeBuildingId = null;/);
  const view = read("src/lib/qr-posters-view.ts");
  assert.equal(view.match(/AND: \[ctx\.docWhere\]/g)?.length, 3, "список, документы из адреса и проверка документа");
  assert.match(view, /docVisible\(ctx, linkedDocument\)/);
  assert.match(view, /buildingId: ctx\.pointId,\n/);
});

test("QR документа по id — только своей точки", () => {
  const route = read("src/app/api/qr-fill/[kind]/[id]/route.ts");
  assert.match(route, /splitJournalPosterId\(id\)\.documentId/);
  assert.match(route, /documentInWorkerScope\(await loadManagerPointScope\(organizationId, session\.user\.id\), document\.buildingId\)/);
});

test("печать: общий журнал — на точку, откуда печатают; одноимённый принтер другой точки не отзывается", () => {
  const jobs = read("src/app/api/print/jobs/route.ts");
  assert.match(jobs, /const jobBuildingId = doc\.buildingId \?\? \(await getViewedPointId\(session\)\)/);
  assert.match(jobs, /buildingId: jobBuildingId/);
  assert.match(jobs, /agentMayTakeJob\(agent, jobBuildingId, pointsWithAgent\)/);
  assert.match(read("src/app/api/print/agents/auth/route.ts"), /name: deviceName,\n\s+buildingId,\n\s+revokedAt: null/);
});

test("«Сегодня» и наборы журналов в «Вся организация» — по всем точкам", () => {
  const dashboard = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.match(dashboard, /getDisabledJournalCodes\(organizationId, viewedPoint\)/);
  assert.match(dashboard, /buildingId: viewedPoint \}/);
  const sets = read("src/components/journals/journal-set-page.tsx");
  assert.doesNotMatch(sets, /getActiveBuildingId/);
  assert.match(sets, /getViewedPointId\(session\)/);
});

test("QR в шапке бланка — точки документа", () => {
  assert.match(read("src/lib/document-pdf.ts"), /journalDocumentPdfQr\(journalPdfQrOrigin\(\), organizationId, document\.template\.code, document\.buildingId\)/);
  assert.match(read("src/app/qj/[orgId]/[code]/[sig]/route.ts"), /isJournalPointShortQr\(orgId, code, sig\)/);
});
