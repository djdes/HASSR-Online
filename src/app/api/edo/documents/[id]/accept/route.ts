import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveBuildingId } from "@/lib/active-building";
import { acceptSupplyDocument, SupplyError } from "@/lib/supply/documents.server";
import { guardSupply } from "@/lib/supply/guard.server";

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
 * строки журнала приёмки (на точке из шапки, если журналы по точкам).
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
  try {
    const outcome = await acceptSupplyDocument({
      organizationId,
      documentId: id,
      actor: { id: session.user.id, name: session.user.name ?? null },
      delivery: parsed.data.delivery,
      items: parsed.data.items.map((item) => ({ ...item, expiryDate: item.expiryDate || undefined })),
      buildingId: await getActiveBuildingId(session),
    });
    return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof SupplyError) return NextResponse.json({ error: error.message }, { status: STATUS[error.code] });
    throw error;
  }
}
