/**
 * Локальный стенд: ROOT отмечает «Оплата поступила» по счёту гостя (тот же
 * `markInvoicePaid`, что у кнопки в /root/invoices) — дальше путь оплаты
 * картой: новая организация с ИНН и названием из счёта, руководитель с почтой
 * заказа, ссылка на достройку. Счёт берёт из `local-flow-check.ts --keep`.
 * Запуск: npx tsx --env-file=.env .agent/tasks/growth-stage3-2026-11/e2e/guest-paid-check.ts
 */
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { markInvoicePaid } from "@/lib/invoices/service";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Только для локальной базы: DATABASE_URL должен указывать на 127.0.0.1 или localhost");
}

const EMAIL = "stage3-e2e-buyer@example.test";

async function main() {
  const order = await db.paymentOrder.findFirst({
    where: { email: EMAIL, paymentMethod: "invoice", status: "pending", organizationId: null },
    orderBy: { id: "desc" },
  });
  if (!order) throw new Error("Нет счёта гостя — сначала local-flow-check.ts --keep");
  const root = await db.user.findFirstOrThrow({ where: { isRoot: true }, select: { id: true } });

  const result = await markInvoicePaid(order.id, root.id);
  assert.equal(result.ok, true, JSON.stringify(result));
  const again = await markInvoicePaid(order.id, root.id);

  const paid = await db.paymentOrder.findUniqueOrThrow({
    where: { id: order.id },
    select: { status: true, paidAt: true, organizationId: true, userId: true, completeTokenHash: true },
  });
  assert.ok(paid.organizationId, "организация не заведена");
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: paid.organizationId },
    select: { name: true, inn: true, address: true, subscriptionPlan: true, subscriptionEnd: true },
  });
  const user = await db.user.findFirst({ where: { email: EMAIL }, select: { role: true, organizationId: true } });
  assert.equal(organization.inn, "5018215599");
  assert.equal(user?.organizationId, paid.organizationId);
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        orderId: order.id,
        markPaid: { ok: result.ok },
        markPaidAgain: again,
        order: { status: paid.status, paidAt: paid.paidAt?.toISOString(), hasCompletionLink: Boolean(paid.completeTokenHash) },
        organization: { ...organization, subscriptionEnd: organization.subscriptionEnd?.toISOString() ?? null },
        user,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
