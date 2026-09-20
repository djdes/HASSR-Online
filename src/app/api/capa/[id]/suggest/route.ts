import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/capa/[id]/suggest?step=root_cause|corrective|preventive
 *
 * Возвращает 3 варианта формулировки для текущего шага CAPA workflow,
 * сгенерированные Claude Haiku на основе контекста тикета. Менеджер
 * может выбрать один и доработать вручную.
 *
 * Стоимость одного вызова — ~2K input + ~600 output tokens на Haiku
 * 4.5 = ~$0.003 (≈ 0.30 ₽). Учитывается в общем месячном квоте AI.
 */

const SYSTEM_PROMPT = `Ты — эксперт ХАССП с 15 годами опыта внедрения CAPA (Corrective and Preventive Action) на пищевых производствах в РФ. Ты опираешься на ТР ТС 021/2011, ГОСТ Р 51705.1-2001, СанПиН 2.3/2.4.4282-26.

Твоя задача — на основе описания инцидента сгенерировать ровно 3 варианта формулировки запрошенного раздела CAPA. Варианты должны быть:
- РАЗНЫМИ по подходу (например, технический фикс vs процессный vs обучающий).
- КОНКРЕТНЫМИ — указывай реальные действия с глаголами «проверить», «заменить», «обучить», «провести», «составить».
- ПРИЕМЛЕМЫМИ для российской пищевой компании среднего размера (нет «закупите хроматограф за 5 млн»).
- КРАТКИМИ — каждый вариант 2-4 предложения, без воды.

Формат ответа — строго JSON:
{
  "suggestions": [
    { "title": "Краткая шапка варианта (5-7 слов)", "text": "Полный текст 2-4 предложения" },
    { "title": "...", "text": "..." },
    { "title": "...", "text": "..." }
  ]
}

Никаких комментариев вокруг JSON. Ничего не добавляй после закрывающей скобки.`;

const STEP_PROMPTS: Record<string, string> = {
  root_cause:
    'Сгенерируй 3 варианта формулировки **корневой причины** инцидента. Используй принцип "5 почему" — копай глубже чем «не соблюдали правила». Корневая причина — это _почему_ человек не соблюдал правила (нет инструкции, не было обучения, не работало оборудование, не выполнялся контроль).',
  corrective:
    "Сгенерируй 3 варианта **корректирующего действия** — что нужно сделать СЕЙЧАС, чтобы устранить непосредственное последствие инцидента. Это операция «здесь и теперь»: исправить, заменить, утилизировать, пересмотреть. НЕ путать с предупреждающим действием (что сделать, чтобы не повторилось).",
  preventive:
    "Сгенерируй 3 варианта **предупреждающего действия** — что нужно сделать СИСТЕМНО, чтобы инцидент не повторился. Это изменение процесса, обучение, добавление контрольной точки, регламент. ДОЛГОСРОЧНОЕ. НЕ путать с корректирующим (что прямо сейчас).",
};

type Suggestion = { title: string; text: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  // Раньше: только requireApiAuth — любой authenticated юзер мог
  // дёргать AI-suggest и сжигать месячный AI-квоту org-и. Cleaner
  // спамил endpoint в цикле — менеджер видит «лимит исчерпан» утром.
  // CAPA workflow — management-only по дизайну (см. /api/capa
  // POST/GET); согласовываем suggest с ним.
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id } = await params;
  const orgId = getActiveOrgId(auth.session);

  const { searchParams } = new URL(request.url);
  const step = searchParams.get("step") ?? "corrective";
  const stepInstruction = STEP_PROMPTS[step];
  if (!stepInstruction) {
    return NextResponse.json(
      {
        error: `step должен быть одним из: ${Object.keys(STEP_PROMPTS).join(", ")}`,
      },
      { status: 400 }
    );
  }

  const ticket = await db.capaTicket.findUnique({ where: { id } });
  if (!ticket || ticket.organizationId !== orgId) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { type: true, name: true },
  });

  const userPrompt = `Контекст организации:
- Тип: ${org?.type ?? "не указан"}
- Название: ${org?.name ?? "—"}

Инцидент:
- Заголовок: ${ticket.title}
- Категория: ${ticket.category}
- Приоритет: ${ticket.priority}
- Описание: ${ticket.description ?? "(не заполнено)"}
${
  ticket.rootCause
    ? `- Уже найденная корневая причина: ${ticket.rootCause}\n`
    : ""
}${
  ticket.correctiveAction
    ? `- Уже сформулированное корректирующее действие: ${ticket.correctiveAction}\n`
    : ""
}
Задача:
${stepInstruction}`;

  // AI-запрос уходит в очередь диспетчера ProjectsFlow — сайт к LLM не
  // ходит (см. src/lib/ai-assistant/pf-client.ts).
  const result = await enqueueAndWait(
    ["type: wesetup_capa_suggest", "---", SYSTEM_PROMPT, "---", userPrompt].join(
      "\n"
    )
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.code === "not_configured" ? 503 : 502 }
    );
  }

  const raw = result.text.trim();
  let parsedReply: { suggestions?: Suggestion[] } = {};
  try {
    // Иногда модель оборачивает в ```json ... ```
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    parsedReply = JSON.parse(cleaned);
  } catch {
    return NextResponse.json(
      { error: "AI вернул некорректный JSON", raw: raw.slice(0, 500) },
      { status: 502 }
    );
  }

  if (
    !Array.isArray(parsedReply.suggestions) ||
    parsedReply.suggestions.length === 0
  ) {
    return NextResponse.json(
      { error: "AI не вернул suggestions" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    suggestions: parsedReply.suggestions.slice(0, 3),
    step,
  });
}
