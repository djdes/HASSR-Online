import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveRequestLocale } from "@/i18n/site-locale";
import { translatorFor } from "@/i18n/translator";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { aiChatRateLimiter } from "@/lib/rate-limit";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import {
  buildChatJobText,
  parseAssistantReply,
  pathnameSchema,
} from "@/lib/ai-assistant/job-text";
import {
  prepareAction,
  verifyAndExecuteAction,
  type ActionActor,
} from "@/lib/ai-assistant/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Диспетчер отвечает 10–60 секунд; long-poll живёт в этом же запросе.
export const maxDuration = 120;

/**
 * POST /api/ai/sanpin-chat
 *
 * AI-помощник: СанПиН/ХАССП + контекст страницы + данные организации +
 * действия с подтверждением.
 *
 * Сайт к языковой модели НЕ ходит (Anthropic-ключа на проде нет).
 * Каждый вопрос — задание в невидимой очереди ProjectsFlow
 * `ai-prompt-jobs` (mode "assistant", карточек на доске не создаёт);
 * отвечает диспетчерская сессия Claude Code. См. `src/lib/ai-assistant/`.
 *
 * Body:
 *   { messages: [...], pathname?: string }            — обычный ход чата
 *   { messages: [...], confirmAction: { token } }     — подтверждение
 *     действия из карточки. Выполняется обычным серверным кодом (без AI
 *     и без расхода квоты) с полным набором guard'ов.
 */
const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      })
    )
    .min(1)
    .max(20),
  pathname: pathnameSchema.optional(),
  confirmAction: z.object({ token: z.string().min(1).max(8000) }).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const locale = resolveRequestLocale(request, { authenticated: true, userLocale: auth.session.user.locale, organizationLocale: auth.session.user.organizationLocale });
  const t = await translatorFor(locale);
  const localizedHeaders = { "Cache-Control": "private, no-store", "Content-Language": locale };
  const errorResponse = (code: string, error: string, status: number) => NextResponse.json({ code, error }, { status, headers: localizedHeaders });

  // Per-user rate limit: 10 запросов в минуту. Защищает от спама и
  // от расхода очереди диспетчера одним юзером. Месячная quota по org —
  // отдельно ниже.
  if (!aiChatRateLimiter.consume(`user:${auth.session.user.id}`)) {
    return NextResponse.json(
      {
        error:
          t("common.assistant.rateLimit"),
        code: "AI_RATE_LIMIT",
        retryAfterMs: aiChatRateLimiter.remainingMs(
          `user:${auth.session.user.id}`
        ),
      },
      { status: 429, headers: localizedHeaders }
    );
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { code: "AI_INVALID_REQUEST", error: t("common.assistant.invalidRequest") },
        { status: 400, headers: localizedHeaders }
      );
    }
    if (err instanceof SyntaxError) return errorResponse("AI_INVALID_REQUEST", t("common.assistant.invalidRequest"), 400);
    throw err;
  }

  const orgId = getActiveOrgId(auth.session);
  const actor: ActionActor = {
    id: auth.session.user.id,
    role: auth.session.user.role,
    isRoot: auth.session.user.isRoot === true,
    name: auth.session.user.name ?? null,
  };

  // --- Подтверждение действия: без AI и без квоты. --------------------
  if (parsed.confirmAction) {
    const result = await verifyAndExecuteAction(parsed.confirmAction.token, {
      orgId,
      actor,
      locale,
    });
    return NextResponse.json({ actionResult: result }, { headers: localizedHeaders });
  }

  // --- Обычный ход чата. Месячной квоты нет: AI-помощник без лимитов
  // на любом тарифе.
  const question = parsed.messages[parsed.messages.length - 1];
  const history = parsed.messages.slice(0, -1);

  let jobText: string;
  try {
    jobText = await buildChatJobText({
      orgId,
      userId: actor.id,
      pathname: parsed.pathname,
      history,
      question: question.content,
      locale,
    });
  } catch (err) {
    console.error("[sanpin-chat] job text build failed", err);
    return errorResponse("AI_CONTEXT_FAILED", t("common.assistant.unavailable"), 502);
  }

  const result = await enqueueAndWait(jobText);
  if (!result.ok) {
    return errorResponse("AI_UNAVAILABLE", t("common.assistant.unavailable"), result.code === "not_configured" ? 503 : 502);
  }

  const { reply, action } = parseAssistantReply(result.text);

  // Действие от исполнителя — недоверенный вход: валидация + резолв в
  // превью-карточку. Невалидное действие не роняет ответ — просто нет
  // карточки, а причина дописывается к reply.
  let pendingAction = null;
  let replyOut = reply || t("common.assistant.empty");
  if (action) {
    const prepared = await prepareAction(action, { orgId, actor, locale });
    if (prepared.ok) {
      pendingAction = prepared.preview;
    } else {
      replyOut = `${replyOut}\n\n${t("common.assistant.prepareFailed", { reason: prepared.error })}`;
    }
  }

  return NextResponse.json({
    reply: replyOut,
    pendingAction,
  }, { headers: localizedHeaders });
}
