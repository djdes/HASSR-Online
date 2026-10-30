import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { invoiceFilename } from "@/lib/invoices/build";
import { renderInvoice } from "@/lib/invoices/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — PDF счёта клиента для панели платформы (раздел «Оплаты»): у
 * `/api/payments/invoice/[id]/pdf` доступ только у владельца организации и
 * суперадмина, а счёт из карточки выставляет и бухгалтерия.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; orderId: string }> }) {
  await requireRoot();
  const { id, orderId } = await params;
  const order = Number(orderId);
  if (!Number.isInteger(order) || order <= 0) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 });
  const rendered = await renderInvoice(order);
  if (!rendered || rendered.order.organizationId !== id) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 });
  const name = invoiceFilename(String(order));
  return new Response(new Uint8Array(rendered.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name.ascii}"; filename*=UTF-8''${encodeURIComponent(name.utf8)}`,
      "Cache-Control": "no-store",
    },
  });
}
