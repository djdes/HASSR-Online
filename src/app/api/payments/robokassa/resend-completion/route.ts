import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { generateInviteToken, hashInviteToken, INVITE_TTL_DAYS, inviteExpiresAt } from "@/lib/invite-tokens";
import { findOrderByReturnProof } from "@/lib/payment-order-proof.server";
import {
  COMPLETION_RESEND_ACTION,
  COMPLETION_RESEND_MAX,
  completionResendDecision,
  composeCompletionLinkEmail,
} from "@/lib/completion-resend";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";

/**
 * «Выслать ссылку ещё раз» на странице возврата с оплаты (новый клиент, письмо
 * со ссылкой на достройку не пришло). Доказательство — то же, что у статуса
 * заказа: подпись возврата Робокассы или подпись запроса оплаты. Ответ всегда
 * `{ ok: true }`: по нему нельзя понять, есть ли такой заказ и ушло ли письмо.
 */
export async function POST(request: NextRequest) {
  try {
    const order = await findOrderByReturnProof(new URL(request.url));
    if (order?.organizationId) {
      const previous = await db.auditLog.findMany({
        where: { organizationId: order.organizationId, action: COMPLETION_RESEND_ACTION, entityId: String(order.id) },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: COMPLETION_RESEND_MAX,
      });
      const decision = completionResendDecision({
        status: order.status,
        hasCompletionToken: order.completeTokenHash !== null,
        previousSends: previous.map((row) => row.createdAt),
        now: new Date(),
      });
      if (decision === "send") {
        const token = generateInviteToken();
        await db.paymentOrder.update({
          where: { id: order.id },
          data: { completeTokenHash: hashInviteToken(token), completeTokenExpiresAt: inviteExpiresAt() },
        });
        await db.auditLog.create({
          data: {
            organizationId: order.organizationId,
            userName: "WeSetup",
            action: COMPLETION_RESEND_ACTION,
            entity: "paymentOrder",
            entityId: String(order.id),
          },
        });
        const mail = composeCompletionLinkEmail({
          link: `${APP_URL}/order?complete=${encodeURIComponent(token)}`,
          ttlDays: INVITE_TTL_DAYS,
        });
        try {
          await sendRawEmail(order.email, mail.subject, renderEmailLayout(mail.title, mail.html));
        } catch (error) {
          console.error("[resend-completion] email failed", { order: order.id, error });
        }
      }
    }
  } catch (error) {
    console.error("[resend-completion] failed", error);
  }
  return NextResponse.json({ ok: true });
}
