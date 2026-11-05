import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import {
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import {
  approvePlannedSlot,
  GglOrderError,
  resolveGglActorFromSession,
} from "@/lib/seo/gogetlinks-orders.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const approveSlotBodySchema = z.object({
  idempotencyKey: z
    .string()
    .trim()
    .min(1, "Укажите ключ идемпотентности (idempotencyKey)")
    .max(160),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireRoot();
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Не указан идентификатор слота" }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = approveSlotBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные параметры подтверждения слота" },
      { status: 400 },
    );
  }

  try {
    const actor = await resolveGglActorFromSession(session);
    const result = await approvePlannedSlot({
      slotId: id,
      idempotencyKey: parsed.data.idempotencyKey,
      actor,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GglOrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof GglIsolationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof GglAuthError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof GglCallError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[ggl-slot-approve] unexpected error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Не удалось подтвердить и отправить заявку в GoGetLinks",
      },
      { status: 500 },
    );
  }
}
