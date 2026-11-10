import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { creditBalance, InsufficientBalanceError } from "@/lib/balance/ledger";
import { formatPoints } from "@/lib/balance/constants";
import { publishToOrganization } from "@/lib/live-events";
import { notifyManagement } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/organizations/<id>/balance — ручная корректировка баллов.
 *
 * Единственный способ изменить баланс не по правилам программы: компенсация,
 * исправление ошибки, промо. Каждая правка идёт строкой в леджер и в
 * `AuditLog` — «баланс поменялся сам» не должно случаться никогда.
 */
const bodySchema = z.object({
  amount: z
    .number()
    .int("Сумма — целое число баллов")
    .refine((value) => value !== 0, "Сумма не может быть нулевой")
    .refine((value) => Math.abs(value) <= 1_000_000, "Слишком большая сумма"),
  comment: z.string().trim().min(3, "Напишите, за что").max(300),
  /**
   * Откуда деньги. `adjust` — корректировка баллов (бонус, исправление);
   * остальное — живые деньги клиента мимо кассы и выписки: строка
   * «Пополнение» в истории баланса (владелец, 2026-11-10: поступления
   * зачисляются на баланс при любом способе оплаты).
   */
  method: z.enum(["adjust", "cash", "transfer", "card"]).default("adjust"),
});

const METHOD_PREFIX: Record<"cash" | "transfer" | "card", string> = {
  cash: "Пополнение наличными",
  transfer: "Пополнение безналичным переводом",
  card: "Пополнение картой",
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRoot();
  const { id } = await ctx.params;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные", errorCode: "ORG_BALANCE_INVALID" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Не удалось прочитать запрос", errorCode: "ORG_BALANCE_READ_FAILED" }, { status: 400 });
  }

  if (parsed.method !== "adjust" && parsed.amount < 0) {
    return NextResponse.json(
      { error: "Пополнение — только начисление. Чтобы списать, выберите «Корректировка»", errorCode: "ORG_BALANCE_INVALID" },
      { status: 400 },
    );
  }
  const isTopup = parsed.method !== "adjust";
  const description = parsed.method === "adjust" ? parsed.comment : `${METHOD_PREFIX[parsed.method]}: ${parsed.comment}`;

  const organization = await db.organization.findUnique({
    where: { id },
    select: { id: true, name: true, balanceRub: true },
  });
  if (!organization) {
    return NextResponse.json({ error: "Организация не найдена", errorCode: "ORG_NOT_FOUND" }, { status: 404 });
  }

  try {
    await creditBalance({
      organizationId: organization.id,
      amount: parsed.amount,
      kind: isTopup ? "topup" : "manual_adjust",
      description,
      actorUserId: session.user.id,
    });
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      return NextResponse.json(
        {
          error: `На балансе только ${formatPoints(organization.balanceRub)} — списать больше нельзя`,
          errorCode: "ORG_BALANCE_INSUFFICIENT",
          errorParams: { amount: organization.balanceRub },
        },
        { status: 409 },
      );
    }
    throw error;
  }

  await recordAuditLog({
    organizationId: organization.id,
    session,
    request,
    action: isTopup ? "balance.topup.manual" : parsed.amount > 0 ? "balance.credit" : "balance.debit",
    entity: "Organization",
    entityId: organization.id,
    details: { amount: parsed.amount, comment: parsed.comment, method: parsed.method },
  });

  // Человек должен узнать о баллах сразу, а не когда сам откроет
  // «Баланс». Уведомление — руководству организации, с текстом «за что»;
  // живое событие — всем открытым вкладкам этой организации, чтобы
  // цифра на экране баланса обновилась без перезагрузки.
  //
  // Оба вызова best-effort: проводка уже записана, и сбой оповещения
  // не должен превратить успешное начисление в ошибку 500 у админа.
  const credited = parsed.amount > 0;
  await notifyManagement({
    organizationId: organization.id,
    kind: credited ? "balance.credited" : "balance.debited",
    // Каждое начисление — отдельное уведомление, а не слияние в одно.
    dedupeKey: `balance.${credited ? "credited" : "debited"}:${Date.now()}`,
    title: isTopup
      ? `Баланс пополнен на ${formatPoints(parsed.amount)}`
      : credited
        ? `Начислено ${formatPoints(parsed.amount)}`
        : `Списано ${formatPoints(Math.abs(parsed.amount))}`,
    linkHref: "/settings/balance",
    linkLabel: "Открыть баланс",
    items: [{ id: "comment", label: description }],
  }).catch((error) => console.error("[balance] notify failed", error));

  publishToOrganization(organization.id, {
    type: "balance",
    data: { amount: parsed.amount, comment: description },
  });

  // Начислили, а срок на исходе и автопродление включено — продлеваем сразу
  // (best-effort: сбой только в лог, начисление уже проведено).
  if (credited) {
    const { tryAutoRenewForOrganization } = await import("@/lib/balance/auto-renew.server");
    await tryAutoRenewForOrganization(organization.id);
  }

  const updated = await db.organization.findUnique({
    where: { id: organization.id },
    select: { balanceRub: true },
  });
  return NextResponse.json({ ok: true, balanceRub: updated?.balanceRub ?? 0 });
}
