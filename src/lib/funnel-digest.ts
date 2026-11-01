import { SIGNUP_CHANNEL_LABELS, SIGNUP_CHANNELS, type SignupChannel } from "@/lib/signup-channel";
import { funnelWindowStart, weekLabel, type FunnelCounts, type FunnelOrg } from "@/lib/signup-funnel";

/**
 * Сводка воронки в Telegram админу (2026-11-01): каждый понедельник в 08:00
 * по Москве — итоги прошлой недели, чтобы смотреть цифры, не открывая ROOT.
 * Чистый модуль: границы недели, подсчёт и текст. Отправка —
 * `funnel-digest.server.ts` из ежечасного крона `weekly-digest`.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Прошлая неделя по Москве: [пн 00:00, следующий пн 00:00). */
export function previousWeekRange(now: Date): { start: Date; end: Date; weekStart: string } {
  const end = funnelWindowStart(now, 1);
  const start = new Date(end.getTime() - WEEK_MS);
  // Понедельник прошлой недели по Москве — та же строка, что у воронки.
  const weekStart = new Date(start.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { start, end, weekStart };
}

export function funnelDigestKey(weekStart: string): string {
  return `funnel-weekly:${weekStart}`;
}

export type FunnelDigestFacts = {
  weekStart: string;
  /** Организации, созданные за неделю, с их шагами на сегодня. */
  cohort: FunnelOrg[];
  previousRegistrations: number;
  payments: { count: number; amountRub: number };
  demo: { requests: number; booked: number };
};

export function cohortCounts(cohort: readonly FunnelOrg[]): FunnelCounts {
  return {
    registered: cohort.length,
    profile: cohort.filter((org) => org.profileDone).length,
    firstEntry: cohort.filter((org) => org.hasEntry).length,
    team: cohort.filter((org) => org.activeUsers >= 2).length,
    paid: cohort.filter((org) => org.paid).length,
  };
}

/** Канал с наибольшим числом по признаку; ничья — по порядку каналов, «нет данных» — последним. */
export function leadingChannel(
  cohort: readonly FunnelOrg[],
  pick: (org: FunnelOrg) => boolean = () => true,
): { channel: SignupChannel; count: number } | null {
  const counts = new Map<SignupChannel, number>();
  for (const org of cohort) if (pick(org)) counts.set(org.channel, (counts.get(org.channel) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => {
    if (a[0] === "unknown" && b[0] !== "unknown") return 1;
    if (b[0] === "unknown" && a[0] !== "unknown") return -1;
    return b[1] - a[1] || SIGNUP_CHANNELS.indexOf(a[0]) - SIGNUP_CHANNELS.indexOf(b[0]);
  });
  const top = ranked[0];
  return top ? { channel: top[0], count: top[1] } : null;
}

function rub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

export function composeFunnelDigest(facts: FunnelDigestFacts, appUrl: string): string {
  const counts = cohortCounts(facts.cohort);
  const delta = counts.registered - facts.previousRegistrations;
  const deltaText = delta === 0 ? "столько же" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
  const best = leadingChannel(facts.cohort);
  const bestPaid = leadingChannel(facts.cohort, (org) => org.paid);
  return [
    `<b>📊 Воронка за неделю ${weekLabel(facts.weekStart)}</b>`,
    `Регистраций: <b>${counts.registered}</b> (неделей раньше ${facts.previousRegistrations}, ${deltaText})`,
    counts.registered > 0
      ? `Из них дошли: анкета ${counts.profile} · первая запись ${counts.firstEntry} · команда ${counts.team} · оплата ${counts.paid}`
      : null,
    `Оплат за неделю: <b>${facts.payments.count}</b>${facts.payments.count > 0 ? ` на ${rub(facts.payments.amountRub)}` : ""}`,
    `Заявок на показ: ${facts.demo.requests}${facts.demo.booked > 0 ? ` (записались на время — ${facts.demo.booked})` : ""}`,
    best ? `Больше всего регистраций: ${SIGNUP_CHANNEL_LABELS[best.channel]} — ${best.count}` : null,
    bestPaid ? `Оплатили из канала: ${SIGNUP_CHANNEL_LABELS[bestPaid.channel]} — ${bestPaid.count}` : null,
    `Подробно: ${appUrl}/root/funnel`,
  ]
    .filter(Boolean)
    .join("\n");
}
