import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { ensureClosingDocument, renderPdf } from "@/lib/closing-documents/service";
import { closingDocumentFilename } from "@/lib/closing-documents/types";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/closing-documents/[orderId]/pdf — УПД по заказу.
 *
 * Скачать может руководитель своей организации (полный доступ к
 * кабинету) и ROOT. Документ выпускается лениво при первом запросе —
 * так закрывающие появляются и у заказов, оплаченных до этой функции.
 */
const REASONS: Record<string, string> = {
  "not-paid": "Заказ не оплачен",
  test: "Тестовый платёж — закрывающие документы не выпускаются",
  zero: "Заказ закрыт баллами целиком — закрывать нечего",
  refunded: "По заказу оформлен возврат",
  requisites: "Реквизиты исполнителя ещё не заполнены — документ появится позже",
  advance: "Пополнение баланса — предоплата: закрывающий документ на него не выпускается",
};

export async function GET(_request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { orderId: raw } = await ctx.params;
  const orderId = Number.parseInt(raw, 10);
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const order = await db.paymentOrder.findUnique({
    where: { id: orderId },
    select: { organizationId: true },
  });
  if (!order) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const own =
    order.organizationId !== null &&
    order.organizationId === getActiveOrgId(session) &&
    hasFullWorkspaceAccess(session.user);
  if (!own && !session.user.isRoot) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const { document, eligibility } = await ensureClosingDocument(orderId);
  if (!document) {
    const reason = eligibility.ok ? "not-paid" : eligibility.reason;
    return NextResponse.json({ error: REASONS[reason] ?? "Документ недоступен", reason }, { status: 404 });
  }
  if (document.status === "voided") {
    return NextResponse.json({ error: REASONS.refunded, reason: "refunded" }, { status: 410 });
  }

  const pdf = await renderPdf(document);
  const name = closingDocumentFilename(document.number);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name.ascii}"; filename*=UTF-8''${encodeURIComponent(name.utf8)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
