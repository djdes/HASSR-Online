import { NextResponse } from "next/server";
import { z } from "zod";

import { exchangeErrorResponse, requireExchangeOwner } from "@/lib/directory-exchange/access.server";
import { transferOnce, transferPreview } from "@/lib/directory-exchange/run.server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewLimiter = createRateLimiter({ tokensPerInterval: 30, intervalMs: 60_000 });
const transferLimiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });
const TOO_MANY = "Слишком много запросов. Подождите минуту.";

const organizationId = z.string().trim().min(1).max(64);
/** «all» — весь список; массив — отмеченные записи (их родители подтянутся сами). */
const chosen = z.union([z.literal("all"), z.array(z.string().min(1).max(64)).max(5000)]);
const transferSchema = z.object({
  fromOrganizationId: organizationId,
  selection: z.object({
    products: chosen.optional(),
    staff: chosen.optional(),
    objects: chosen.optional(),
    equipment: chosen.optional(),
    journals: chosen.optional(),
    checklists: chosen.optional(),
  }),
});

/**
 * GET /api/settings/directory-exchange/transfer?from=<organizationId> — что
 * можно перенести из организации аккаунта в активную: `{ items: { products,
 * staff, objects, equipment, journals, checklists } }`, у записи `{ id, name,
 * detail, exists, entity, parentId }`; `exists` — у активной организации такая
 * уже есть (у настроек журналов — такие же).
 */
export async function GET(request: Request) {
  const owner = await requireExchangeOwner();
  if (!owner.ok) return owner.response;
  const { organizationId: toOrganizationId, actor } = owner.context;
  if (!previewLimiter.consume(`directory-exchange:preview:${actor.userId}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  const from = organizationId.safeParse(new URL(request.url).searchParams.get("from"));
  if (!from.success) {
    return NextResponse.json({ error: "Выберите организацию, из которой переносить" }, { status: 400 });
  }
  try {
    return NextResponse.json(await transferPreview({ fromOrganizationId: from.data, toOrganizationId }));
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}

/**
 * POST /api/settings/directory-exchange/transfer `{ fromOrganizationId,
 * selection }` — разовый перенос в активную организацию → `{ ok: true,
 * summary }`. Связь не сохраняется, дубли пропускаются. Только владелец
 * аккаунта; организация не из его аккаунта — 404, закрытая — 409.
 */
export async function POST(request: Request) {
  const owner = await requireExchangeOwner();
  if (!owner.ok) return owner.response;
  const { organizationId: toOrganizationId, actor } = owner.context;
  if (!transferLimiter.consume(`directory-exchange:transfer:${actor.userId}`)) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }
  const parsed = transferSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Выберите организацию и что перенести" }, { status: 400 });
  }
  try {
    const summary = await transferOnce({
      fromOrganizationId: parsed.data.fromOrganizationId,
      toOrganizationId,
      selection: parsed.data.selection,
      actor,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
}
