import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { ignoreSupplyDocument, SupplyError } from "@/lib/supply/documents.server";
import { guardSupply } from "@/lib/supply/guard.server";
import { loadSupplyPointAccess } from "@/lib/supply/point-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/edo/documents/[id]/ignore — «не принимать в журнал» (услуга, не товар). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, organizationId, denied } = await guardSupply();
  if (denied) return denied;
  const { id } = await params;
  // Накладная другой точки — для человека, привязанного к точкам, её нет (2026-11-01).
  const access = await loadSupplyPointAccess(session);
  const target = await db.supplyDocument.findFirst({ where: { id, organizationId, ...access.seeWhere }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "Накладная не найдена" }, { status: 404 });
  try {
    await ignoreSupplyDocument({ organizationId, documentId: id, actor: { id: session.user.id, name: session.user.name ?? null } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SupplyError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 409 });
    }
    throw error;
  }
}
