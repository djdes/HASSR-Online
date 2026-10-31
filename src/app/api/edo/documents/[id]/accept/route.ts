import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { acceptSupplyDocument, SupplyError } from "@/lib/supply/documents.server";
import { guardSupply } from "@/lib/supply/guard.server";
import { loadSupplyPointAccess } from "@/lib/supply/point-access.server";
import { resolveAcceptancePoint } from "@/lib/supply/supply-points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z.object({
  delivery: z.object({
    deliveryDate: dateKey.optional(),
    deliveryHour: z.string().regex(/^\d{2}$/).optional(),
    deliveryMinute: z.string().regex(/^\d{2}$/).optional(),
    transportOk: z.boolean(),
    documentsOk: z.boolean(),
  }),
  items: z
    .array(
      z.object({
        line: z.number().int().min(1).max(10000),
        decision: z.enum(["accept", "reject"]),
        packagingOk: z.boolean(),
        organolepticOk: z.boolean(),
        productTemperature: z.string().trim().max(20).optional(),
        expiryDate: dateKey.optional().or(z.literal("")),
        correctiveActions: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(1000),
  /** Точка приёмки — обязательна, когда журналы по точкам. */
  buildingId: z.string().min(1).max(100).nullable().optional(),
});

const STATUS: Record<SupplyError["code"], number> = {
  not_found: 404,
  already_decided: 409,
  bad_check: 400,
  no_journal: 500,
  bad_building: 400,
};

/**
 * POST /api/edo/documents/[id]/accept — проверка товара по накладной →
 * строки журнала приёмки. Журналы по точкам — на точке, выбранной в форме
 * (2026-11-01: раньше бралась точка из шапки, а в режиме «Вся организация»
 * это офис или первая точка); точка должна быть доступна человеку.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, organizationId, denied } = await guardSupply();
  if (denied) return denied;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректные данные приёмки" }, { status: 400 });
  const rejectedWithoutAction = parsed.data.items.some(
    (item) => item.decision === "reject" && !item.correctiveActions,
  );
  if (rejectedWithoutAction) {
    return NextResponse.json({ error: "Для отклонённой строки укажите, что сделали с товаром" }, { status: 400 });
  }
  const access = await loadSupplyPointAccess(session);
  // Накладная другой точки — для человека, привязанного к точкам, её нет.
  const target = await db.supplyDocument.findFirst({ where: { id, organizationId, ...access.seeWhere }, select: { buildingId: true } });
  if (!target) {
    return NextResponse.json({ error: "Накладная не найдена" }, { status: 404 });
  }
  const point = resolveAcceptancePoint({
    pointsEnabled: access.enabled,
    requested: parsed.data.buildingId,
    allowedPointIds: access.points.map((item) => item.id),
  });
  if (!point.ok) {
    return NextResponse.json(
      { error: point.error === "point_required" ? "Выберите точку, где принимали товар" : "Эта точка вам недоступна", errorCode: point.error },
      { status: point.error === "point_required" ? 400 : 403 },
    );
  }
  try {
    const outcome = await acceptSupplyDocument({
      organizationId,
      documentId: id,
      actor: { id: session.user.id, name: session.user.name ?? null },
      delivery: parsed.data.delivery,
      items: parsed.data.items.map((item) => ({ ...item, expiryDate: item.expiryDate || undefined })),
      buildingId: point.buildingId,
    });
    return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof SupplyError) return NextResponse.json({ error: error.message }, { status: STATUS[error.code] });
    throw error;
  }
}
