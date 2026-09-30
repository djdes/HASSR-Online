import { NextResponse, after } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, isImpersonating, requireAuth } from "@/lib/auth-helpers";
import { parseTopupAmount } from "@/lib/balance/constants";
import { createTopupCardOrder, topupReceiptItems } from "@/lib/balance/topup";
import { db } from "@/lib/db";
import { createTopupInvoiceOrder, deliverInvoice } from "@/lib/invoices/service";
import { refuseMobileAppPayment } from "@/lib/mobile-app-payments";
import { hasCapability } from "@/lib/permission-presets";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  buildPaymentParams,
  buildPaymentUrl,
  isConfigured,
  sendReceipt,
} from "@/lib/robokassa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/balance/topup { amountRub, method: "card" | "invoice" } —
 * пополнить баланс организации деньгами (1 ₽ = 1 балл).
 *
 * Сумму проверяет сервер (`parseTopupAmount`: целые рубли, 500–300 000),
 * промокоды и акции к пополнению не применяются. Зачисление — только
 * после подтверждённой оплаты: ResultURL кассы или ROOT «Оплата
 * поступила» по счёту (settlePaidOrder), не здесь.
 *
 * Кто может: руководитель, который видит баланс, — не сотрудник, не ROOT
 * в режиме «войти как» (чужие деньги) и не приложение WeSetup (правила
 * магазинов приложений, как у оплаты подписки).
 */

// 10 заказов за 10 минут на организацию: живому человеку хватит на
// несколько попыток и смену суммы, скрипту — нет.
const topupRateLimiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 10 * 60 * 1000 });

export async function POST(request: Request) {
  const appRefusal = refuseMobileAppPayment(request);
  if (appRefusal) {
    console.info("[balance] topup refused: mobile app");
    return appRefusal;
  }
  const session = await requireAuth();
  if (
    !hasFullWorkspaceAccess(session.user) ||
    !hasCapability(session.user, "admin.full") ||
    isImpersonating(session)
  ) {
    console.info(`[balance] topup refused: no access user=${session.user.id}`);
    return NextResponse.json(
      { error: "Пополнить баланс может руководитель организации" },
      { status: 403 },
    );
  }
  const organizationId = getActiveOrgId(session);

  const body = (await request.json().catch(() => null)) as { amountRub?: unknown; method?: unknown } | null;
  const method = body?.method === "invoice" ? "invoice" : body?.method === "card" ? "card" : null;
  if (!method) {
    return NextResponse.json({ error: "Выберите способ оплаты: картой или счётом" }, { status: 400 });
  }
  const amount = parseTopupAmount(body?.amountRub);
  if (!amount.ok) {
    console.info(`[balance] topup refused org=${organizationId} method=${method}: ${amount.error}`);
    return NextResponse.json({ error: amount.error }, { status: 400 });
  }
  const email = (session.user.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "В профиле нет почты — некуда отправить чек и письмо о зачислении" },
      { status: 400 },
    );
  }
  if (!topupRateLimiter.consume(`topup:${organizationId}`)) {
    console.info(`[balance] topup refused org=${organizationId}: rate limit`);
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте через несколько минут" },
      { status: 429 },
    );
  }

  if (method === "invoice") {
    const result = await createTopupInvoiceOrder({
      organizationId,
      userId: session.user.id,
      email,
      amountRub: amount.amountRub,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    if (result.created) {
      await recordAuditLog({
        request,
        session,
        organizationId,
        action: "balance.topup.create",
        entity: "PaymentOrder",
        entityId: String(result.order.id),
        details: { amountRub: amount.amountRub, paymentMethod: method },
      });
      const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
      // Письмо со счётом и заметка админу — после ответа: не ждём SMTP.
      after(() =>
        deliverInvoice(result.order.id, org?.name ?? organizationId).catch((error) =>
          console.error("[balance] topup invoice deliver failed", error),
        ),
      );
    }
    return NextResponse.json({
      method,
      orderId: result.order.id,
      amountRub: Number(result.order.amountRub),
      dueAt: result.order.invoiceDueAt,
      created: result.created,
      pdfUrl: `/api/payments/invoice/${result.order.id}/pdf`,
    });
  }

  // Картой — нужна касса. Проверяем ДО заказа: незачем плодить заказы,
  // которые нельзя оплатить.
  if (!isConfigured()) {
    console.info(`[balance] topup refused org=${organizationId}: robokassa not configured`);
    return NextResponse.json(
      { error: "Оплата картой пока не настроена. Выставьте счёт или напишите на support@wesetup.ru" },
      { status: 503 },
    );
  }
  const order = await createTopupCardOrder({
    organizationId,
    userId: session.user.id,
    email,
    amountRub: amount.amountRub,
  });
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "balance.topup.create",
    entity: "PaymentOrder",
    entityId: String(order.id),
    details: { amountRub: order.amountRub, paymentMethod: method, isTest: order.isTest },
  });

  // Чек 54-ФЗ — только если чеки включены env (как у подписки): полный
  // расчёт за услугу (решение бухгалтера 2026-09-30).
  const params = buildPaymentParams({
    id: order.id,
    amountRub: order.amountRub,
    description: order.description,
    email,
    isTest: order.isTest,
    receiptItems: sendReceipt() ? topupReceiptItems(order.amountRub, order.description) : undefined,
  });
  return NextResponse.json({
    method,
    invId: order.id,
    amountRub: order.amountRub,
    description: order.description,
    params,
    // Фолбэк на обычную форму оплаты, если iframe-скрипт не загрузился.
    paymentUrl: buildPaymentUrl(params),
  });
}
