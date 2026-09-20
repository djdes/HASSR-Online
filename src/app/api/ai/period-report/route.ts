import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { parseDisabledCodes } from "@/lib/disabled-journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/period-report
 *
 * Body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *
 * Собирает summary всех журналов за период (compliance %, проблемные
 * journals, top employee, инциденты CAPA, потери) → Claude Haiku 4.5
 * → текстовый отчёт ~300-500 слов «вот что было хорошо, вот проблемы,
 * вот рекомендации».
 *
 * Менеджер раньше тратил 2 часа на отчёт собственнику в конце
 * месяца. Теперь — 10 секунд + правки.
 *
 * Auth: management.
 */
const bodySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const SYSTEM_PROMPT = `Ты — аналитик-консультант по СанПиН/ХАССП в системе WeSetup. Твоя задача — написать сжатый отчёт о работе пищевого предприятия за указанный период по данным электронных журналов.

Структура отчёта:
1. Краткое резюме (1-2 предложения, общая оценка периода)
2. Что было хорошо — конкретные факты с цифрами
3. Проблемные точки — конкретные журналы/инциденты с цифрами
4. Рекомендации — 3-5 действий для улучшения

Стиль:
- Профессиональный, без воды
- Все числа с цифрами и единицами («заполнено 92%», «5 жалоб», «3 CAPA»)
- 250-400 слов всего
- Никаких вступлений типа «Уважаемый собственник» — сразу к делу
- На русском, в нейтрально-деловом тоне

Никогда не выдумывай данные. Если в выгрузке нет инцидентов — значит их не было, прямо это и пиши.`;

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad body" },
        { status: 400 }
      );
    }
    throw err;
  }

  const orgId = getActiveOrgId(session);
  const periodFrom = new Date(`${parsed.from}T00:00:00.000Z`);
  const periodTo = new Date(`${parsed.to}T23:59:59.999Z`);
  // Zod regex /^\d{4}-\d{2}-\d{2}$/ пропускает '2026-13-99' — это
  // не реальная дата но соответствует pattern'у. new Date() даст
  // Invalid Date, .getTime() = NaN, days вычисляется как NaN,
  // 'NaN > 92' = false → дальше Prisma падает с невнятной ошибкой
  // и AI квота тратится на пустую попытку. Проверяем явно.
  if (
    !Number.isFinite(periodFrom.getTime()) ||
    !Number.isFinite(periodTo.getTime())
  ) {
    return NextResponse.json(
      { error: "Некорректная дата периода" },
      { status: 400 }
    );
  }
  if (periodTo < periodFrom) {
    return NextResponse.json(
      { error: "Дата окончания раньше даты начала" },
      { status: 400 }
    );
  }
  const days =
    Math.floor((periodTo.getTime() - periodFrom.getTime()) / 86400000) + 1;
  if (days > 92) {
    return NextResponse.json(
      { error: "Максимальный период — 3 месяца" },
      { status: 400 }
    );
  }

  // Собираем данные параллельно.
  const [
    org,
    templates,
    capaCount,
    capaOpen,
    losses,
    documentEntries,
    legacyEntries,
    closeEvents,
    bonusEntries,
  ] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      select: { name: true, type: true, disabledJournalCodes: true },
    }),
    db.journalTemplate.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
    }),
    db.capaTicket.count({
      where: { organizationId: orgId, createdAt: { gte: periodFrom, lte: periodTo } },
    }),
    db.capaTicket.count({
      where: { organizationId: orgId, status: { not: "closed" } },
    }),
    db.lossRecord.count({
      where: { organizationId: orgId, date: { gte: periodFrom, lte: periodTo } },
    }),
    db.journalDocumentEntry.count({
      where: {
        document: { organizationId: orgId },
        createdAt: { gte: periodFrom, lte: periodTo },
        ...NOT_AUTO_SEEDED,
      },
    }),
    db.journalEntry.count({
      where: { organizationId: orgId, createdAt: { gte: periodFrom, lte: periodTo } },
    }),
    db.journalCloseEvent.findMany({
      where: { organizationId: orgId, date: { gte: periodFrom, lte: periodTo } },
      select: { kind: true, templateId: true },
    }),
    db.bonusEntry.count({
      where: {
        organizationId: orgId,
        status: "approved",
        createdAt: { gte: periodFrom, lte: periodTo },
      },
    }),
  ]);

  if (!org) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }

  // Compliance % за период.
  const disabledCodes = parseDisabledCodes(org.disabledJournalCodes);
  const visibleTemplates = templates.filter((t) => !disabledCodes.has(t.code));
  const dailyResults: Array<{ filled: number; total: number }> = [];
  // Sample: каждый 3-й день для скорости (если период > 30 дней).
  const sampleStep = days > 30 ? 3 : 1;
  for (let i = 0; i < days; i += sampleStep) {
    const day = new Date(periodFrom);
    day.setUTCDate(day.getUTCDate() + i);
    const filled = await getTemplatesFilledToday(
      orgId,
      day,
      visibleTemplates,
      disabledCodes,
      { treatAperiodicAsFilled: false }
    );
    dailyResults.push({ filled: filled.size, total: visibleTemplates.length });
  }
  const totalSlots = dailyResults.reduce((s, d) => s + d.total, 0);
  const filledSlots = dailyResults.reduce((s, d) => s + d.filled, 0);
  const compliancePct = totalSlots
    ? Math.round((filledSlots / totalSlots) * 100)
    : 0;

  // Auto-closed (флаг халатности) vs no-events
  const autoClosedCount = closeEvents.filter(
    (c) => c.kind === "auto-closed-empty"
  ).length;
  const noEventsCount = closeEvents.filter((c) => c.kind === "no-events").length;

  // Top problematic templates — группируем close-events по template.
  const closesByTpl = new Map<string, number>();
  for (const c of closeEvents) {
    if (c.kind !== "auto-closed-empty") continue;
    closesByTpl.set(c.templateId, (closesByTpl.get(c.templateId) ?? 0) + 1);
  }
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const topProblematic = [...closesByTpl.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => ({ name: tplById.get(id)?.name ?? "?", count: n }));

  const factsBlock = `
Организация: ${org.name} (тип: ${org.type ?? "не указан"})
Период: ${parsed.from} — ${parsed.to} (${days} дней)

КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ:
- Compliance: ${compliancePct}% (${filledSlots} из ${totalSlots} ячеек заполнено)
- Записей в журналах: ${documentEntries + legacyEntries} (${documentEntries} document-based + ${legacyEntries} field-based)
- Закрыто без событий («не требуется»): ${noEventsCount}
- Автозакрыто без действий (флаг халатности): ${autoClosedCount}
- CAPA-тикетов открыто за период: ${capaCount}, всего активных сейчас: ${capaOpen}
- Списаний (losses): ${losses}
- Премий начислено: ${bonusEntries}

ПРОБЛЕМНЫЕ ЖУРНАЛЫ (чаще всего auto-closed):
${
  topProblematic.length === 0
    ? "Все журналы заполнялись вовремя"
    : topProblematic
        .map((t) => `- ${t.name}: ${t.count} автозакрытий`)
        .join("\n")
}
`.trim();

  // AI-запрос уходит в очередь диспетчера ProjectsFlow — сайт к LLM не
  // ходит (см. src/lib/ai-assistant/pf-client.ts).
  const result = await enqueueAndWait(
    [
      "type: wesetup_period_report",
      "---",
      SYSTEM_PROMPT,
      "---",
      `Сгенерируй отчёт за период по этим данным:\n\n${factsBlock}`,
    ].join("\n")
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.code === "not_configured" ? 503 : 502 }
    );
  }

  return NextResponse.json({
    report: result.text,
    facts: factsBlock,
  });
}
