import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { decideQrPinRequest } from "@/lib/qr-pin-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(300).optional().nullable(),
});

/**
 * POST /api/staff/pin-requests/[id] — одобрить или отклонить запрос PIN
 * сотрудника с QR-страницы. Одобрение включает PIN, который сотрудник
 * придумал сам; решает только руководитель (как выдачу PIN в карточке).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  const { id } = await params;
  const result = await decideQrPinRequest({
    organizationId: getActiveOrgId(auth.session),
    requestId: id,
    decidedById: auth.session.user.id,
    approve: body.decision === "approve",
    note: body.note ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
