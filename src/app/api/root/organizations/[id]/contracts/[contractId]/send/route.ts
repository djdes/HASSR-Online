import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { sendClientContractEmail } from "@/lib/contracts/send.server";
import { findClientContract } from "@/lib/contracts/service.server";
import { contractErrorResponse, contractSendSchema } from "@/lib/contracts/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — отправить договор письмом с PDF. 200 — письмо принято транспортом
 * (договор «отправлен»); 503 `not_configured` — почта на сервере не
 * настроена, письмо только записано в лог; 502 — транспорт отказал.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; contractId: string }> }) {
  const session = await requireRoot();
  const { id, contractId } = await params;
  const parsed = contractSendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  try {
    const contract = await findClientContract(id, contractId);
    const result = await sendClientContractEmail({
      contractId,
      to: parsed.data.to,
      subject: parsed.data.subject,
      message: parsed.data.message,
      senderUserId: session.user.id ?? null,
    });
    await recordAuditLog({
      request,
      session,
      organizationId: id,
      action: result.ok ? "client_contract.send" : "client_contract.send_failed",
      entity: "ClientContract",
      entityId: contract.id,
      details: { number: contract.number, to: result.sentTo, ...(result.ok ? { via: result.via, from: result.from } : { reason: result.reason }) },
    });
    if (result.ok) return NextResponse.json({ ok: true, sentTo: result.sentTo, via: result.via, from: result.from, fallbackReason: result.fallbackReason });
    return NextResponse.json(
      {
        ok: false,
        code: result.reason,
        error:
          result.detail ??
          (result.reason === "not_configured"
            ? "Почта на сервере не настроена: письмо записано в лог, договор не отмечен отправленным"
            : "Почтовый сервер не принял письмо — попробуйте ещё раз позже"),
      },
      { status: result.reason === "not_configured" ? 503 : 502 },
    );
  } catch (error) {
    return contractErrorResponse(error);
  }
}
