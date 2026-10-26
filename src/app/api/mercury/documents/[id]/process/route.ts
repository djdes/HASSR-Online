import { NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { checkPlanFeature, limitResponse } from "@/lib/billing.server";
import { processIncomingVetDocument } from "@/lib/mercury/process-incoming";
import { getServerSession } from "@/lib/server-session";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Физический контроль вводит человек — поэтому поля обязательные, а не
 * с умолчаниями. Схема специально не позволяет «принять» партию, не
 * ответив на вопросы о транспорте, упаковке и документах: молчаливые
 * дефолты и есть тот путь, которым журнал превращается в формальность.
 */
const schema = z.object({
  transportConditionOk: z.boolean(),
  packagingOk: z.boolean(),
  organolepticOk: z.boolean(),
  documentsOk: z.boolean(),
  decision: z.enum(["ACCEPT", "PARTIALLY", "RETURN", "REJECT"]),
  deliveryHour: z.string().max(2).optional(),
  deliveryMinute: z.string().max(2).optional(),
  productTemperature: z.string().max(20).optional(),
  actualVolume: z.number().nullable().optional(),
  discrepancyReason: z.string().max(500).optional(),
  correctiveActions: z.string().max(1000).optional(),
  /** false — журнал заполняем, а гасит клиент сам в кабинете Меркурия. */
  withdraw: z.boolean().default(true),
});

/**
 * POST /api/mercury/documents/[id]/process
 *
 * Оформить приёмку по ВСД: строка в журнале входного контроля и, если
 * попросили, команда гашения в очередь.
 *
 * Отвечает СРАЗУ, не дожидаясь Меркурия (П-15): строка журнала уже
 * сохранена и от доступности шлюза не зависит, а гашение доедет само.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json(
      { error: "Гашение ВСД доступно руководству" },
      { status: 403 },
    );
  }

  const organizationId = getActiveOrgId(session);
  const feature = await checkPlanFeature(organizationId, "mercury", "mercury.process");
  if (!feature.ok) return limitResponse(feature);

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Проверьте поля приёмки", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  if (data.decision !== "ACCEPT" && !data.discrepancyReason) {
    // Ветис откажет в гашении без причины расхождения, и лучше сказать
    // это здесь, чем словить отказ асинхронно через минуту.
    return NextResponse.json(
      { error: "Укажите причину: без неё Меркурий не примет отказ или частичную приёмку" },
      { status: 400 },
    );
  }

  try {
    const result = await processIncomingVetDocument({
      vetDocumentId: id,
      organizationId,
      actor: {
        id: session.user.id,
        name: session.user.name ?? null,
        role: session.user.role,
      },
      check: {
        transportConditionOk: data.transportConditionOk,
        packagingOk: data.packagingOk,
        organolepticOk: data.organolepticOk,
        documentsOk: data.documentsOk,
        decision: data.decision,
        deliveryHour: data.deliveryHour,
        deliveryMinute: data.deliveryMinute,
        productTemperature: data.productTemperature,
        actualVolume: data.actualVolume ?? null,
        discrepancyReason: data.discrepancyReason,
        correctiveActions: data.correctiveActions,
      },
      withdraw: data.withdraw,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
