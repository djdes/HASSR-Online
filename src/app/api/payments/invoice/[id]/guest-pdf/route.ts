import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { invoiceFilename } from "@/lib/invoices/build";
import { readGuestBuyer, verifyGuestInvoice } from "@/lib/invoices/guest";
import { renderInvoice } from "@/lib/invoices/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payments/invoice/<id>/guest-pdf?sig=… — PDF счёта без регистрации
 * по подписанной ссылке (подпись — номер заказа и почта покупателя). Без
 * подписи или с чужой — 404, как будто счёта нет.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const orderId = Number.parseInt(raw, 10);
  const signature = new URL(request.url).searchParams.get("sig") ?? "";
  if (!Number.isFinite(orderId) || !signature) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const order = await db.paymentOrder.findUnique({
    where: { id: orderId },
    select: { email: true, paymentMethod: true, status: true, buyerJson: true },
  });
  if (!order || order.paymentMethod !== "invoice" || !readGuestBuyer(order.buyerJson) || !verifyGuestInvoice(orderId, order.email, signature)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  if (order.status === "cancelled") return NextResponse.json({ error: "Счёт отменён" }, { status: 410 });

  const rendered = await renderInvoice(orderId);
  if (!rendered) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const name = invoiceFilename(String(orderId));
  return new NextResponse(new Uint8Array(rendered.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name.ascii}"; filename*=UTF-8''${encodeURIComponent(name.utf8)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
