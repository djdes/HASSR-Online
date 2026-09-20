import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  applyCleaningAutoFillToConfig,
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  normalizeCleaningDocumentConfig,
} from "@/lib/cleaning-document";
import { toDateKey } from "@/lib/hygiene-document";
import { isManagementRole } from "@/lib/user-roles";

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
  const body = (await request.json().catch(() => ({}))) as { action?: string };

  if (body.action !== "apply_auto_fill") {
    return NextResponse.json({ error: "Неверное действие" }, { status: 400 });
  }

  const [document, users, areas] = await Promise.all([
    db.journalDocument.findUnique({
      where: { id },
      include: { template: true },
    }),
    db.user.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        isActive: true,
      },
      select: { id: true, name: true, role: true, positionTitle: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    db.area.findMany({
      where: {
        organizationId: getActiveOrgId(session),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!document || document.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  if (document.template.code !== CLEANING_DOCUMENT_TEMPLATE_CODE) {
    return NextResponse.json({ error: "Неверный тип документа" }, { status: 400 });
  }

  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }

  const config = normalizeCleaningDocumentConfig(document.config, { users, areas });
  const nextConfig = applyCleaningAutoFillToConfig({
    config,
    dateFrom: toDateKey(document.dateFrom),
    dateTo: toDateKey(document.dateTo),
  });

  await db.journalDocument.update({
    where: { id: document.id },
    data: {
      config: nextConfig,
      autoFill: nextConfig.autoFill.enabled,
    },
  });

  return NextResponse.json({ success: true });
}
