import { NextResponse, after } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { startAiDigestNow } from "@/lib/mailing/ai-digest/run.server";
import { PLATFORM_ORG_ID } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — «Отправить сейчас»: сводка по сохранённому шаблону всем
 * пользователям root вне расписания. Ответ — сразу (запись «отправляется»),
 * ИИ и отправка идут после ответа; страница опрашивает GET ../ai-digest.
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  try {
    const actor = session.user.name || session.user.email || session.user.id;
    const result = await startAiDigestNow(actor);
    if (!result.started) {
      return NextResponse.json(
        { error: result.reason === "already-running" ? "Сводка уже отправляется — дождитесь окончания" : "Сервер занят — попробуйте через минуту" },
        { status: 409 }
      );
    }
    after(async () => {
      try {
        await result.finish();
      } catch (error) {
        console.error("[ai-digest] manual run failed", error);
      }
    });
    await recordAuditLog({
      request,
      session,
      organizationId: PLATFORM_ORG_ID,
      action: "mailing.ai_digest.send",
      entity: "platform_setting",
      entityId: result.run.id,
      details: {},
    });
    return NextResponse.json({ run: result.run });
  } catch (error) {
    return mailingErrorResponse(error, "ai-digest send");
  }
}
