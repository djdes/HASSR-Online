import { NextResponse } from "next/server";
import JSZip from "jszip";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * I3 — GDPR-style полный экспорт данных организации.
 *
 * GET /api/settings/organization/export → ZIP с 7 JSON-файлами:
 *   - organization.json — meta
 *   - users.json — все сотрудники (включая archived)
 *   - journal-templates.json — каталог шаблонов
 *   - journal-documents.json — все документы
 *   - journal-document-entries.json — записи
 *   - journal-entries.json — field-based записи
 *   - capa-tickets.json
 *   - loss-records.json
 *   - audit-log.json (последние 12 месяцев)
 *
 * ФЗ-152 ст. 14: право на получение информации, касающейся обработки
 * его персональных данных. Менеджер может выгрузить всё одним кликом.
 *
 * Auth: management. Большой response — клиент получает blob.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const [
    organizationRaw,
    users,
    templates,
    documents,
    docEntries,
    fieldEntries,
    capa,
    losses,
    auditLog,
  ] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    // ВАЖНО: НЕ экспортируем passwordHash и telegramChatId — это
    // credentials/identifiers, не пользовательские ПД из ФЗ-152.
    // Раньше findMany() возвращал ВСЕ поля, включая passwordHash
    // всех сотрудников. Менеджер скачивал ZIP и получал bcrypt-хеши
    // owner'а / админов — offline brute-force на досуге.
    db.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        positionTitle: true,
        jobPositionId: true,
        organizationId: true,
        isActive: true,
        isRoot: true,
        archivedAt: true,
        journalAccessMigrated: true,
        permissionPreset: true,
        notificationPrefs: true,
        createdAt: true,
      },
    }),
    db.journalTemplate.findMany({ where: { isActive: true } }),
    db.journalDocument.findMany({ where: { organizationId: orgId } }),
    db.journalDocumentEntry.findMany({
      where: { document: { organizationId: orgId } },
    }),
    db.journalEntry.findMany({ where: { organizationId: orgId } }),
    db.capaTicket.findMany({ where: { organizationId: orgId } }),
    db.lossRecord.findMany({ where: { organizationId: orgId } }),
    db.auditLog.findMany({
      where: { organizationId: orgId, createdAt: { gte: yearAgo } },
    }),
  ]);

  // Аналогично у Organization вычищаем integration-секреты — это не
  // ПД сотрудников, а креды для внешних систем.
  const organization = organizationRaw
    ? Object.fromEntries(
        Object.entries(organizationRaw).filter(
          ([k]) => k !== "externalApiToken" && k !== "yandexDiskToken"
        )
      )
    : null;

  // Точки: справочник точек, чтобы buildingId в документах читался.
  const buildings = await db.building.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, address: true, kpp: true, phone: true },
  });

  const zip = new JSZip();
  const fmt = (data: unknown) => JSON.stringify(data, null, 2);
  zip.file("organization.json", fmt(organization));
  zip.file("users.json", fmt(users));
  zip.file("journal-templates.json", fmt(templates));
  zip.file("buildings.json", fmt(buildings));
  zip.file("journal-documents.json", fmt(documents));
  zip.file("journal-document-entries.json", fmt(docEntries));
  zip.file("journal-entries.json", fmt(fieldEntries));
  zip.file("capa-tickets.json", fmt(capa));
  zip.file("loss-records.json", fmt(losses));
  zip.file("audit-log.json", fmt(auditLog));
  zip.file(
    "README.txt",
    `GDPR-экспорт данных организации\n` +
      `Дата выгрузки: ${new Date().toISOString()}\n` +
      `Соответствует ФЗ-152 ст. 14 (право доступа к ПД).\n\n` +
      `Содержимое:\n` +
      `- organization.json: основные данные org\n` +
      `- users.json: все пользователи (с архивированными)\n` +
      `- journal-templates.json: каталог шаблонов журналов (общий)\n` +
      `- journal-documents.json: документы журналов\n` +
      `- journal-document-entries.json: записи в журналах\n` +
      `- journal-entries.json: field-based записи\n` +
      `- capa-tickets.json: тикеты корректирующих/предупреждающих действий\n` +
      `- loss-records.json: записи о потерях/списаниях\n` +
      `- audit-log.json: журнал действий за последние 365 дней\n`
  );

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const filename = `wesetup-export-${orgId.slice(0, 8)}-${new Date()
    .toISOString()
    .slice(0, 10)}.zip`;

  // Audit-log себя: скачивание GDPR-экспорта.
  await db.auditLog.create({
    data: {
      organizationId: orgId,
      userId: auth.session.user.id,
      userName: auth.session.user.name ?? null,
      action: "organization.export_downloaded",
      entity: "organization",
      entityId: orgId,
      details: { sizeBytes: buffer.length, filename },
    },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
