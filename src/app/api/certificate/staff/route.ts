import { NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O5 — Сертификат «знаток ХАССП» для конкретного сотрудника.
 *
 * GET /api/certificate/staff?userId=X
 *
 * PDF A4 landscape с именем сотрудника, текущей датой, числом
 * заполненных записей за 90 дней и подписью «Сертификат знатока
 * ХАССП».
 *
 * Менеджер может выдать такой сертификат сотруднику для мотивации
 * + повесить копию на стене. Без верификации (это не official-
 * государственный, а внутренний маркер).
 *
 * Auth: management.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId обязателен" }, { status: 400 });
  }

  const user = await db.user.findFirst({
    where: { id: userId, organizationId: orgId },
    select: { name: true, positionTitle: true, role: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [fieldEntries, docEntries] = await Promise.all([
    db.journalEntry.count({
      where: { organizationId: orgId, filledById: userId, createdAt: { gte: since } },
    }),
    db.journalDocumentEntry.count({
      where: {
        employeeId: userId,
        document: { organizationId: orgId },
        createdAt: { gte: since },
        ...NOT_AUTO_SEEDED,
      },
    }),
  ]);
  const totalEntries = fieldEntries + docEntries;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });

  // Generate PDF.
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Frame. Сертификат вешают на стену, печатают на ч/б принтерах:
  // рамка и акценты — чёрный и серые, без фирменного индиго.
  doc.setDrawColor(64);
  doc.setLineWidth(2);
  doc.rect(15, 15, 267, 180);
  doc.setLineWidth(0.5);
  doc.rect(20, 20, 257, 170);

  // Header — название org.
  doc.setFontSize(11);
  doc.setTextColor(115);
  doc.text(org?.name ?? "WeSetup", 148, 35, { align: "center" });

  // Заголовок.
  doc.setFontSize(36);
  doc.setTextColor(0);
  doc.text("Сертификат", 148, 65, { align: "center" });

  doc.setFontSize(20);
  doc.setTextColor(0);
  doc.text("«Знаток ХАССП»", 148, 80, { align: "center" });

  // Имя.
  doc.setFontSize(14);
  doc.setTextColor(64);
  doc.text("выдаётся сотруднику:", 148, 100, { align: "center" });

  doc.setFontSize(28);
  doc.setTextColor(0);
  doc.text(user.name, 148, 120, { align: "center" });

  if (user.positionTitle) {
    doc.setFontSize(13);
    doc.setTextColor(160);
    doc.text(user.positionTitle, 148, 130, { align: "center" });
  }

  // Tagline.
  doc.setFontSize(12);
  doc.setTextColor(64);
  doc.text(
    `за активное ведение журналов СанПиН/ХАССП — ${totalEntries} записей за 90 дней.`,
    148,
    150,
    { align: "center" }
  );

  // Footer.
  doc.setFontSize(10);
  doc.setTextColor(160);
  const dateStr = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  doc.text(`Дата выдачи: ${dateStr}`, 30, 180);
  doc.text("Сформировано системой WeSetup", 263, 180, { align: "right" });

  const buffer = Buffer.from(doc.output("arraybuffer"));

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="certificate-${userId.slice(
        0,
        8
      )}.pdf"`,
    },
  });
}
