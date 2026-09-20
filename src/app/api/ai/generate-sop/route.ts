import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { aiHeavyRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * L3 — AI-генератор «инструкции по гигиене для нашей кухни» с
 * учётом профиля org (тип, оборудование, штат).
 *
 * POST /api/ai/generate-sop
 * Body: { topic: "гигиена" | "уборка" | "прием_сырья" | "термообработка" | "хранение" }
 *
 * Возвращает draft-инструкцию ~400-600 слов в формате markdown,
 * учитывающий конкретный профиль организации (количество сотрудников,
 * наличие активных журналов, тип кухни).
 *
 * Менеджер использует draft как стартовую точку, правит под себя
 * и вешает на кухне.
 *
 * Auth: management.
 */

const Schema = z.object({
  topic: z.enum([
    "гигиена",
    "уборка",
    "прием_сырья",
    "термообработка",
    "хранение",
  ]),
});

const TOPIC_BRIEFS: Record<string, string> = {
  гигиена:
    "Инструкция по гигиене сотрудников: ежедневный медосмотр, личная гигиена, форма, мытьё рук, ведение журнала здоровья.",
  уборка:
    "Инструкция по уборке производственных и подсобных помещений: ежедневная, недельная (генеральная), используемые средства, документирование.",
  прием_сырья:
    "Инструкция по входному контролю: проверка маркировки, температуры, целостности упаковки, соответствия документам, отбраковка некачественных партий.",
  термообработка:
    "Инструкция по термической обработке продуктов: критические температуры (>75°C centre), время выдержки, контроль готовности, ведение журнала ККТ.",
  хранение:
    "Инструкция по хранению продуктов: температурные режимы, разделение сырого/готового, маркировка с датой, контроль сроков годности.",
};

const SYSTEM_PROMPT = `Ты — технолог-консультант с 20 годами опыта в общественном питании, спецализация — внедрение HACCP и инструкций для линейного персонала российских ресторанов и пищевых производств.

Твоя задача — написать инструкцию (SOP, Standard Operating Procedure) по запросу руководителя для конкретного предприятия. Опираешься на:
- ТР ТС 021/2011, СанПиН 2.3/2.4.4282-26, ГОСТ Р 51705.1
- Реалии российской кухни: текучка кадров, слабое знание норм у линейного персонала, мигранты с базовым русским

Структура инструкции:
1. Заголовок (1 строка) — название инструкции с org name
2. Цель (1 предложение) — зачем
3. Кто отвечает (1 строка) — роль / должность
4. Шаги — нумерованный список 5-12 шагов, каждый шаг 1-2 предложения. КОНКРЕТНЫЕ, не «соблюдайте нормы» а «руки моем 30 секунд с антибактериальным мылом до локтей перед каждым началом работы и после контакта с сырьём».
5. Контроль — 2-3 конкретных метрики (журнал, частота, кто проверяет)
6. Ответственность — что будет при нарушении
7. Ссылки — нормативы

Формат: чистый Markdown без артефактов. Заголовки h2/h3, списки. ~400-600 слов.

На русском, в простых словах. Юридические формулировки минимизируй — пишем для повара, не для юриста.`;

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  if (!aiHeavyRateLimiter.consume(`ai-sop:${auth.session.user.id}`)) {
    return NextResponse.json(
      { error: "Слишком много запросов" },
      { status: 429 }
    );
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  const orgId = getActiveOrgId(auth.session);
  const [org, userCount, equipmentCount] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      select: { name: true, type: true },
    }),
    db.user.count({
      where: { organizationId: orgId, isActive: true, archivedAt: null },
    }),
    db.equipment.count({ where: { area: { organizationId: orgId } } }),
  ]);

  const userPrompt =
    `Контекст организации:\n` +
    `- Название: ${org?.name ?? "—"}\n` +
    `- Тип: ${org?.type ?? "—"}\n` +
    `- Активных сотрудников: ${userCount}\n` +
    `- Единиц оборудования: ${equipmentCount}\n\n` +
    `Тема: ${TOPIC_BRIEFS[body.topic]}\n\n` +
    `Сгенерируй полную инструкцию.`;

  // Сайт к LLM не ходит — задание уезжает в очередь диспетчера
  // ProjectsFlow (см. src/lib/ai-assistant/pf-client.ts). Инструкция
  // самодостаточна: system-промпт + контекст организации одной строкой.
  const result = await enqueueAndWait(
    ["type: wesetup_generate_sop", "---", SYSTEM_PROMPT, "---", userPrompt].join(
      "\n"
    )
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.code === "not_configured" ? 503 : 502 }
    );
  }
  return NextResponse.json({
    sop: result.text.trim(),
    topic: body.topic,
    orgContext: {
      name: org?.name,
      type: org?.type,
      userCount,
      equipmentCount,
    },
  });
}
