import { SIGNUP_CHANNEL_LABELS, SIGNUP_CHANNELS, type SignupChannel } from "@/lib/signup-channel";

/**
 * Воронка регистраций для /root/funnel: регистрация → анкета → первая
 * запись → команда → оплата, по неделям регистрации и по каналам.
 *
 * Шаги считаются как «дошла ли организация до шага к сегодняшнему дню»,
 * доля — от регистраций той же недели (канала). Чистый модуль: факты об
 * организациях собирает `signup-funnel.server.ts`.
 */

export const FUNNEL_STEPS = ["registered", "profile", "firstEntry", "team", "paid"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export const FUNNEL_STEP_LABELS: Record<FunnelStep, string> = {
  registered: "Регистрация",
  profile: "Анкета",
  firstEntry: "Первая запись",
  team: "Команда",
  paid: "Оплата",
};

export const FUNNEL_STEP_HINTS: Record<FunnelStep, string> = {
  registered: "Новые организации без демо и служебных",
  profile: "Заполнена анкета: телефон владельца и название",
  firstEntry: "Есть хотя бы одна запись в журналах",
  team: "Два и больше активных сотрудника",
  paid: "Оплачен тариф (не пробный платёж, не пополнение баланса, без возврата)",
};

/** Сколько недель показывает воронка. */
export const FUNNEL_WEEKS = 12;
/** «Команда» — от двух активных сотрудников вместе с владельцем. */
export const TEAM_MIN_USERS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Москва без перехода на летнее время с 2014 года. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

export type FunnelOrg = {
  createdAt: Date;
  channel: SignupChannel;
  profileDone: boolean;
  hasEntry: boolean;
  activeUsers: number;
  paid: boolean;
};

export type FunnelCounts = Record<FunnelStep, number>;
export type FunnelRow = { key: string; label: string; counts: FunnelCounts };
export type Funnel = { weeks: FunnelRow[]; channels: FunnelRow[]; total: FunnelRow };

/** Понедельник недели по Москве: `YYYY-MM-DD`. */
export function moscowWeekStart(date: Date): string {
  const msk = new Date(date.getTime() + MSK_OFFSET_MS);
  const sinceMonday = (msk.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() - sinceMonday));
  return monday.toISOString().slice(0, 10);
}

/** Момент начала окна: 00:00 по Москве в понедельник `weeks - 1` недель назад. */
export function funnelWindowStart(now: Date, weeks = FUNNEL_WEEKS): Date {
  const [year, month, day] = moscowWeekStart(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 7 * (weeks - 1)) - MSK_OFFSET_MS);
}

/** Недели окна, новые сверху. */
export function funnelWeekKeys(now: Date, weeks = FUNNEL_WEEKS): string[] {
  const [year, month, day] = moscowWeekStart(now).split("-").map(Number);
  return Array.from({ length: weeks }, (_, index) =>
    new Date(Date.UTC(year, month - 1, day - 7 * index)).toISOString().slice(0, 10),
  );
}

/** «27.10 – 02.11» для недели с понедельника `weekStart`. */
export function weekLabel(weekStart: string): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const short = (date: Date) =>
    `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${short(start)} – ${short(end)}`;
}

function emptyCounts(): FunnelCounts {
  return { registered: 0, profile: 0, firstEntry: 0, team: 0, paid: 0 };
}

function addOrg(counts: FunnelCounts, org: FunnelOrg): void {
  counts.registered += 1;
  if (org.profileDone) counts.profile += 1;
  if (org.hasEntry) counts.firstEntry += 1;
  if (org.activeUsers >= TEAM_MIN_USERS) counts.team += 1;
  if (org.paid) counts.paid += 1;
}

/** Доля шага от регистраций, целые проценты; нет регистраций — null. */
export function stepShare(counts: FunnelCounts, step: FunnelStep): number | null {
  if (counts.registered === 0) return null;
  return Math.round((counts[step] / counts.registered) * 100);
}

export function buildFunnel(orgs: readonly FunnelOrg[], now: Date, weeks = FUNNEL_WEEKS): Funnel {
  const from = funnelWindowStart(now, weeks).getTime();
  const to = now.getTime();
  const inWindow = orgs.filter((org) => org.createdAt.getTime() >= from && org.createdAt.getTime() <= to);

  const byWeek = new Map(funnelWeekKeys(now, weeks).map((key) => [key, emptyCounts()]));
  const byChannel = new Map<SignupChannel, FunnelCounts>();
  const total = emptyCounts();
  for (const org of inWindow) {
    const week = byWeek.get(moscowWeekStart(org.createdAt));
    if (week) addOrg(week, org);
    const channel = byChannel.get(org.channel) ?? emptyCounts();
    addOrg(channel, org);
    byChannel.set(org.channel, channel);
    addOrg(total, org);
  }

  return {
    weeks: [...byWeek].map(([key, counts]) => ({ key, label: weekLabel(key), counts })),
    channels: SIGNUP_CHANNELS.filter((channel) => byChannel.has(channel))
      .map((channel) => ({ key: channel, label: SIGNUP_CHANNEL_LABELS[channel], counts: byChannel.get(channel)! }))
      .sort((a, b) => b.counts.registered - a.counts.registered),
    total: { key: "total", label: `Всего за ${weeks} нед.`, counts: total },
  };
}
