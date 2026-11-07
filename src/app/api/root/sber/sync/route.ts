import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { syncSberInvoicePayments } from "@/lib/sber/invoice-payments.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/root/sber/sync — «Проверить выписку сейчас» на странице «СберБизнес». */
export async function POST() {
  await requireRoot();
  const result = await syncSberInvoicePayments({ trigger: "manual" });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
