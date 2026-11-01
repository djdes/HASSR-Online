import { db } from "@/lib/db";
import { DEMO_SERVICE_KEY } from "@/lib/demo-request";
import { composeFunnelDigest, funnelDigestKey, previousWeekRange } from "@/lib/funnel-digest";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { PAID_TARIFF_ORDER_WHERE, loadFunnelOrgs } from "@/lib/signup-funnel.server";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type FunnelDigestReport = { sent: boolean; reason: string; weekStart?: string };

/**
 * Понедельничная сводка воронки админу в Telegram. Зовётся из ежечасного
 * крона `weekly-digest` в слот понедельника 08:00 по Москве; повторный
 * вызов за ту же неделю ничего не шлёт (`TelegramLog` по ключу недели) —
 * `notifyPlatformAdmin` сам повтор не отсекает.
 */
export async function sendFunnelDigest(options: { now?: Date; force?: boolean; appUrl?: string } = {}): Promise<FunnelDigestReport> {
  const now = options.now ?? new Date();
  const { start, end, weekStart } = previousWeekRange(now);
  const dedupeKey = funnelDigestKey(weekStart);
  if (!options.force) {
    const already = await db.telegramLog.findFirst({
      where: { status: "sent", createdAt: { gte: end }, dedupeKey },
      select: { id: true },
    });
    if (already) return { sent: false, reason: "already-sent", weekStart };
  }

  const lastMs = end.getTime() - 1;
  const [cohort, previousRegistrations, payments, demoRequests, demoBooked] = await Promise.all([
    loadFunnelOrgs(start, new Date(lastMs)),
    loadFunnelOrgs(new Date(start.getTime() - WEEK_MS), new Date(start.getTime() - 1)).then((orgs) => orgs.length),
    db.paymentOrder.aggregate({
      where: { ...PAID_TARIFF_ORDER_WHERE, paidAt: { gte: start, lt: end } },
      _count: { _all: true },
      _sum: { amountRub: true },
    }),
    db.serviceRequest.count({ where: { serviceKey: DEMO_SERVICE_KEY, createdAt: { gte: start, lt: end } } }),
    db.serviceRequest.count({ where: { serviceKey: DEMO_SERVICE_KEY, createdAt: { gte: start, lt: end }, scheduledAt: { not: null } } }),
  ]);

  const text = composeFunnelDigest(
    {
      weekStart,
      cohort,
      previousRegistrations,
      payments: { count: payments._count._all, amountRub: Number(payments._sum.amountRub ?? 0) },
      demo: { requests: demoRequests, booked: demoBooked },
    },
    options.appUrl ?? process.env.NEXTAUTH_URL ?? "https://wesetup.ru",
  );
  const sent = await notifyPlatformAdmin(text, { kind: "funnel_weekly", dedupeKey }).catch((error: unknown) => {
    console.error("[funnel-digest] send failed", error);
    return false;
  });
  return { sent, reason: sent ? "sent" : "send-failed", weekStart };
}
