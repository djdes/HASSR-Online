import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditLog } from "@/lib/audit-log";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { aiHeavyRateLimiter } from "@/lib/rate-limit";
import { buildDraftPrompt, cleanDraftReply, DRAFT_BLOCKS, draftTitle } from "@/lib/ppk/text-drafts";
import { loadDraftContext } from "@/lib/ppk/text-drafts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Помощник отвечает до ~90 с (очередь ИИ-диспетчера).
export const maxDuration = 120;

const bodySchema = z.object({ block: z.enum(DRAFT_BLOCKS) });

/**
 * POST { block } — черновик текста пункта ППК от ИИ-помощника (2026-11-25):
 * данные кабинета области ППК → самодостаточная инструкция → очередь
 * ИИ-диспетчера (сайт к модели не ходит) → простой текст. Черновик не
 * сохраняется: человек проверяет его в поле и сохраняет сам.
 */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  if (!aiHeavyRateLimiter.consume(`ppk-draft:${auth.session.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов, подождите минуту" }, { status: 429 });
  }
  const { block } = parsed.data;
  const context = await loadDraftContext(auth.scope, block);
  const result = await enqueueAndWait(buildDraftPrompt(block, context));
  if (!result.ok) {
    const status = result.code === "not_configured" ? 503 : result.code === "timeout" ? 504 : 502;
    const error =
      result.code === "not_configured"
        ? "ИИ-помощник не подключён: черновик сейчас недоступен"
        : result.code === "timeout"
          ? "ИИ-помощник не ответил вовремя. Попробуйте ещё раз"
          : "ИИ-помощник не смог подготовить черновик. Попробуйте ещё раз";
    return NextResponse.json({ error }, { status });
  }
  const text = cleanDraftReply(result.text);
  if (!text) return NextResponse.json({ error: "ИИ-помощник вернул пустой черновик. Попробуйте ещё раз" }, { status: 502 });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.scope.organizationId,
    action: "production-control.text-draft",
    entity: "PpkRecord",
    entityId: block,
    details: { block, title: draftTitle(block), buildingId: auth.scope.buildingId, chars: text.length },
  }).catch(() => undefined);
  return NextResponse.json({ text }, { headers: { "Cache-Control": "private, no-store" } });
}
