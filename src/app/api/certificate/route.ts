import { NextResponse } from "next/server";
import { z } from "zod";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { findOrCreateOrgInspectorQr, inspectorQrUrl } from "@/lib/inspector-qr-service";
import { registerUnicodeFont } from "@/lib/closing-documents/pdf-font";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { parseDisabledCodes } from "@/lib/disabled-journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/certificate?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Generates a printable A4 PDF compliance-certificate that the
 * restaurant can hang in the lobby. The QR-code on the certificate
 * links to a public read-only inspector portal (TTL 90 days) with a
 * fixed period — third parties (customers, regulators, insurers) can
 * scan and verify «yes, this place really keeps journals».
 *
 * Side-effects:
 *   - QR ведёт на действующий «QR для проверяющих» организации; если его
 *     нет — выпускается ОДИН (до отзыва). Раньше каждое скачивание
 *     создавало новый 90-дневный токен.
 *
 * Returns: application/pdf attachment.
 *
 * Auth: management-only (requireAdminForJournalEdit doesn't matter).
 */
const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  let parsed;
  try {
    parsed = querySchema.parse({
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Параметры from/to обязательны (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    throw err;
  }

  const orgId = getActiveOrgId(session);
  const periodFrom = utcDayStart(new Date(`${parsed.from}T00:00:00.000Z`));
  const periodTo = utcDayStart(new Date(`${parsed.to}T00:00:00.000Z`));
  // Zod regex ловит формат, но `2026-13-99` пройдёт regex и даст
  // Invalid Date. Без явной проверки мы (1) персистим InspectorToken
  // с Invalid periodFrom/periodTo, (2) генерим сертификат с 0% (NaN-
  // сравнения в loop'е тихо отдают пустой массив). Лучше явный 400.
  if (
    !Number.isFinite(periodFrom.getTime()) ||
    !Number.isFinite(periodTo.getTime())
  ) {
    return NextResponse.json(
      { error: "Некорректная дата периода" },
      { status: 400 }
    );
  }
  if (periodFrom > periodTo) {
    return NextResponse.json(
      { error: "from не может быть позже to" },
      { status: 400 }
    );
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { name: true, disabledJournalCodes: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }

  const templates = await db.journalTemplate.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });
  const disabledCodes = parseDisabledCodes(org.disabledJournalCodes);
  const visibleTemplates = templates.filter((t) => !disabledCodes.has(t.code));

  // Calculate compliance % across the period: for each day,
  // count templates filled / total visible.
  const days: Array<{ date: Date; filled: number; total: number }> = [];
  const totalDays =
    Math.floor((periodTo.getTime() - periodFrom.getTime()) / 86400000) + 1;
  if (totalDays > 366) {
    return NextResponse.json(
      { error: "Период не может быть больше года" },
      { status: 400 }
    );
  }
  for (let i = 0; i < totalDays; i++) {
    const day = new Date(periodFrom);
    day.setUTCDate(day.getUTCDate() + i);
    const filled = await getTemplatesFilledToday(
      orgId,
      day,
      visibleTemplates,
      disabledCodes,
      { treatAperiodicAsFilled: false }
    );
    days.push({ date: day, filled: filled.size, total: visibleTemplates.length });
  }
  const totalSlots = days.reduce((s, d) => s + d.total, 0);
  const filledSlots = days.reduce((s, d) => s + d.filled, 0);
  const compliancePct = totalSlots
    ? Math.round((filledSlots / totalSlots) * 100)
    : 0;
  const cleanDays = days.filter(
    (d) => d.total > 0 && d.filled === d.total
  ).length;

  // QR — постоянный доступ проверяющих организации (переиспользуется).
  const qrToken = await findOrCreateOrgInspectorQr(orgId, session.user.id);
  const expiresAt = qrToken.expiresAt;
  const verifyUrl = inspectorQrUrl(qrToken.id);

  // Generate QR data URL
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
  });

  // Generate PDF (A4 portrait, premium-look certificate)
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  // Кириллица: штатная helvetica jsPDF её не знает (кракозябры).
  const font = registerUnicodeFont(doc);

  // Frame
  doc.setDrawColor(85, 102, 246);
  doc.setLineWidth(2);
  doc.rect(8, 8, pageW - 16, pageH - 16, "S");
  doc.setLineWidth(0.5);
  doc.rect(12, 12, pageW - 24, pageH - 24, "S");
  doc.setDrawColor(0);

  // Header
  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.setFont(font, "normal");
  doc.text("WeSetup - электронные журналы СанПиН и ХАССП", pageW / 2, 26, {
    align: "center",
  });

  doc.setFontSize(28);
  doc.setTextColor(11, 16, 36);
  doc.setFont(font, "normal");
  doc.text("СЕРТИФИКАТ", pageW / 2, 50, { align: "center" });
  doc.setFontSize(20);
  doc.setFont(font, "normal");
  doc.text("соответствия", pageW / 2, 60, { align: "center" });

  // Org name
  doc.setFontSize(20);
  doc.setFont(font, "normal");
  doc.setTextColor(56, 72, 199);
  doc.text(org.name, pageW / 2, 80, { align: "center" });

  // Body text
  doc.setFontSize(13);
  doc.setTextColor(60, 64, 83);
  doc.setFont(font, "normal");
  const bodyText = [
    "Настоящим подтверждается, что организация на протяжении периода",
    `с ${parsed.from} по ${parsed.to} вела электронные журналы`,
    "санитарно-гигиенического и производственного контроля",
    "в системе WeSetup.",
  ];
  let y = 96;
  for (const line of bodyText) {
    doc.text(line, pageW / 2, y, { align: "center" });
    y += 6;
  }

  // Stats
  doc.setFillColor(245, 246, 255);
  doc.rect(30, 130, pageW - 60, 30, "F");
  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.text("Уровень соответствия", pageW / 2, 140, { align: "center" });
  doc.setFontSize(36);
  doc.setTextColor(85, 102, 246);
  doc.setFont(font, "normal");
  doc.text(`${compliancePct}%`, pageW / 2, 154, { align: "center" });

  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.setFont(font, "normal");
  doc.text(
    `Дней с полной отчётностью: ${cleanDays} из ${totalDays}`,
    pageW / 2,
    170,
    { align: "center" }
  );
  doc.text(
    `Записей по журналам: ${filledSlots} из ${totalSlots}`,
    pageW / 2,
    176,
    { align: "center" }
  );

  // QR code
  const qrSize = 50;
  const qrX = (pageW - qrSize) / 2;
  doc.addImage(qrDataUrl, "PNG", qrX, 195, qrSize, qrSize);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "Отсканируйте QR-код любым смартфоном чтобы проверить",
    pageW / 2,
    253,
    { align: "center" }
  );
  doc.text(
    "журналы организации онлайн. Действует до:",
    pageW / 2,
    258,
    { align: "center" }
  );
  doc.setFont(font, "normal");
  doc.text(
    expiresAt.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
    pageW / 2,
    265,
    { align: "center" }
  );

  // Footer
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(
    `Сформировано: ${new Date().toLocaleString("ru-RU")}`,
    pageW / 2,
    pageH - 16,
    { align: "center" }
  );

  const buffer = Buffer.from(doc.output("arraybuffer"));
  const filename = `wesetup-certificate-${org.name.replace(
    /[^A-Za-zА-Яа-я0-9]+/g,
    "_"
  )}-${parsed.from}-${parsed.to}.pdf`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
