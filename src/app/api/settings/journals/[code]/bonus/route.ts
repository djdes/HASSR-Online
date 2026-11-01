import { NextResponse, type NextRequest } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { saveOrgJournalSetting } from "@/lib/org-journal-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/settings/journals/<code>/bonus
 *
 * Body: { rubles: number }   // 0 = убрать бонус
 *
 * Точечный апдейт бонуса журнала без необходимости передавать остальные
 * параметры distribution. Полная форма редактируется в /settings/journals
 * (DistributionEditor); тут — отдельный экран «премии» для быстрого обзора
 * и редактирования всех бонусов сразу.
 *
 * Management-only. Бонус — настройка текущей организации
 * (`OrganizationJournalSetting`); общий `JournalTemplate` не трогаем —
 * до 2026-11-01 правка одного клиента меняла бонус у всех.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { code } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const rublesRaw = (body as { rubles?: unknown }).rubles;
  const rubles =
    typeof rublesRaw === "number" && Number.isFinite(rublesRaw) && rublesRaw >= 0
      ? Math.floor(rublesRaw)
      : null;
  if (rubles === null) {
    return NextResponse.json(
      { error: "rubles должен быть целым ≥ 0" },
      { status: 400 }
    );
  }
  // Сразу клампим, чтобы хранить в kopecks без переполнения int4.
  if (rubles > 1_000_000) {
    return NextResponse.json(
      { error: "Максимум 1 000 000 ₽ на одну запись" },
      { status: 400 }
    );
  }

  const template = await db.journalTemplate.findUnique({
    where: { code },
    select: { id: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  }

  const bonusAmountKopecks = rubles * 100;
  await saveOrgJournalSetting(getActiveOrgId(auth.session), template.id, { bonusAmountKopecks });

  return NextResponse.json({ ok: true, bonusAmountKopecks });
}
