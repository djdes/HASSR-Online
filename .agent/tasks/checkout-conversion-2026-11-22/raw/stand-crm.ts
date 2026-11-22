// Стенд: прогон «незавершённые оплаты» и реакция на оплату на настоящей базе.
// node --env-file=.env --import tsx .agent/tasks/checkout-conversion-2026-11-22/raw/stand-crm.ts
import { db } from "@/lib/db";
import { onCheckoutPaid, runCheckoutFollowups } from "@/lib/crm/checkout.server";

const results: { name: string; ok: boolean; extra?: string }[] = [];
const check = (name: string, ok: boolean, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

async function main() {
  // Рабочее время по Москве (12:00 МСК сегодня), записи оформления — на 45 минут раньше.
  const now = new Date();
  now.setUTCHours(9, 0, 0, 0);
  const visitAt = new Date(now.getTime() - 45 * 60_000);
  await db.crmInteraction.updateMany({ where: { channel: "checkout", externalKey: { startsWith: "checkout:visit:" } }, data: { occurredAt: visitAt } });
  await db.paymentOrder.updateMany({ where: { email: "manager@stand.test" }, data: { createdAt: new Date(visitAt.getTime() + 5 * 60_000) } });

  const night = new Date(now);
  night.setUTCHours(22, 0, 0, 0); // 01:00 МСК
  const sleeping = await runCheckoutFollowups(night);
  check("AC7 ночью не шлёт", sleeping.scanned === 0 && sleeping.alerted === 0, JSON.stringify(sleeping));

  const first = await runCheckoutFollowups(now);
  check("AC7 гость без оплаты — одна задача, руководитель со счётом — пропуск", first.alerted === 1 && first.skipped.invoice === 1, JSON.stringify(first));
  const task = await db.crmTask.findFirst({ where: { kind: "checkout" }, orderBy: { createdAt: "desc" } });
  check("AC7 задача «Незавершённая оплата»", Boolean(task && task.status === "open" && task.title.startsWith("Незавершённая оплата: ")), `${task?.title} | ${task?.note?.replace(/\n/g, " | ")}`);
  const again = await runCheckoutFollowups(now);
  check("AC7 повторный прогон не дублирует", again.alerted === 0 && (await db.crmTask.count({ where: { kind: "checkout" } })) === 1, JSON.stringify(again));
  const timeline = await db.crmInteraction.count({ where: { externalKey: { startsWith: "checkout:abandoned:" } } });
  check("AC7 событие в ленте контакта", timeline === 1);

  // Гость оплатил картой — задача закрыта, оплата в ленте, контакт «Клиент», задача «созвон по запуску».
  const order = await db.paymentOrder.create({
    data: {
      email: "guest.e2e@example.ru",
      tariffKey: "premium_year",
      amountRub: 47880,
      description: "Тариф «Премиум» за год",
      status: "paid",
      paymentMethod: "card",
      changeKind: "new",
      points: 1,
      paidAt: now,
    },
  });
  const paid = await onCheckoutPaid({ order, organizationId: null, organizationIds: [], isNewClient: true, now });
  const closedTask = task ? await db.crmTask.findUnique({ where: { id: task.id } }) : null;
  check("AC8 задача по незавершённой оплате закрыта", paid.closed === 1 && closedTask?.status === "cancelled" && closedTask.result === "Клиент оплатил", JSON.stringify(paid));
  const onboarding = paid.onboardingTaskId ? await db.crmTask.findUnique({ where: { id: paid.onboardingTaskId } }) : null;
  check("AC8 задача «созвон по запуску»", onboarding?.kind === "onboarding" && onboarding.status === "open", `${onboarding?.title} | ${onboarding?.note?.replace(/\n/g, " | ")}`);
  const contact = await db.crmContact.findFirst({ where: { email: "guest.e2e@example.ru" } });
  check("AC8 контакт — «Клиент», оплата в ленте", contact?.stage === "won" && (await db.crmInteraction.count({ where: { externalKey: `payment:${order.id}` } })) === 1, contact?.stage ?? "нет контакта");
  const twice = await onCheckoutPaid({ order, organizationId: null, organizationIds: [], isNewClient: true, now });
  check("AC8 повтор не ставит вторую задачу", twice.onboardingTaskId === null && (await db.crmTask.count({ where: { kind: "onboarding" } })) === 1);

  const { writeFileSync } = await import("node:fs");
  writeFileSync(new URL("./stand-crm-results.json", import.meta.url), JSON.stringify(results, null, 2));
  const failed = results.filter((row) => !row.ok).length;
  console.log(`${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
