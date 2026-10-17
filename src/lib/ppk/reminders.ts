import { escapeHtml } from "../html-escape";
import type { LabPlanItem, PestPlanItem } from "./records";
import { labNextDate } from "./sanitation";

export type PpkReminderItem = { block: "lab" | "pest"; title: string; nextDate: string; daysLeft: number };

const DAY_MS = 24 * 60 * 60 * 1000;

const LAB_OBJECT_RU: Record<LabPlanItem["object"], string> = {
  product: "Продукция",
  swabs: "Смывы",
  water: "Вода",
  air: "Воздух",
  other: "Другое",
};

const PEST_KIND_RU: Record<PestPlanItem["kind"], string> = {
  disinsection: "Дезинсекция",
  deratization: "Дератизация",
  disinfection: "Дезинфекция",
};

/** Когда напоминать: за 7, 3, 1 день, в день срока и при просрочке — на 1-й день и дальше каждые 7 дней. */
export function isReminderDay(daysLeft: number): boolean {
  if (daysLeft === 7 || daysLeft === 3 || daysLeft === 1 || daysLeft === 0) return true;
  if (daysLeft < 0) {
    const overdue = -daysLeft;
    return overdue === 1 || overdue % 7 === 0;
  }
  return false;
}

function utcDay(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Целые дни от одной даты до другой (даты YYYY-MM-DD, UTC); раньше — отрицательное число. */
export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((utcDay(toYmd) - utcDay(fromYmd)) / DAY_MS);
}

/** Пункты планов, отобранные правилом `accept(daysLeft)`: просроченные сверху, затем по дате. */
function collectByRule(
  input: { lab: LabPlanItem[]; pest: PestPlanItem[]; today: string },
  accept: (daysLeft: number) => boolean,
): PpkReminderItem[] {
  const out: PpkReminderItem[] = [];
  const push = (block: "lab" | "pest", title: string, nextDate: string | null) => {
    if (!nextDate) return;
    const daysLeft = daysBetween(input.today, nextDate);
    if (!accept(daysLeft)) return;
    out.push({ block, title, nextDate, daysLeft });
  };
  for (const item of input.lab) {
    const base = `${LAB_OBJECT_RU[item.object]}: ${item.subject}`;
    push("lab", item.indicator ? `${base} — ${item.indicator}` : base, labNextDate(item));
  }
  for (const item of input.pest) {
    push("pest", `${PEST_KIND_RU[item.kind]}: ${item.object}`, item.nextDate);
  }
  return out.sort((a, b) => {
    const aOver = a.daysLeft < 0 ? 0 : 1;
    const bOver = b.daysLeft < 0 ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    return a.nextDate.localeCompare(b.nextDate);
  });
}

/** Пункты планов, о которых сегодня нужно напомнить: просроченные сверху, затем по дате. */
export function collectPpkReminders(input: {
  lab: LabPlanItem[];
  pest: PestPlanItem[];
  today: string;
}): PpkReminderItem[] {
  return collectByRule(input, isReminderDay);
}

/** Для плашки на главной: всё просроченное и всё, что наступит в пределах `horizonDays`. */
export function ppkDueSoon(
  input: { lab: LabPlanItem[]; pest: PestPlanItem[]; today: string },
  horizonDays = 7,
): PpkReminderItem[] {
  return collectByRule(input, (daysLeft) => daysLeft <= horizonDays);
}

function shortDate(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}

function statusText(item: PpkReminderItem): string {
  const date = shortDate(item.nextDate);
  if (item.daysLeft < 0) return `просрочено на ${-item.daysLeft} дн. (${date})`;
  if (item.daysLeft === 0) return `сегодня (${date})`;
  if (item.daysLeft === 1) return `завтра (${date})`;
  return `через ${item.daysLeft} дн. (${date})`;
}

/** Сообщение руководству в Telegram (HTML): секции только с непустыми пунктами. */
export function ppkReminderMessage(items: PpkReminderItem[]): string {
  const section = (block: "lab" | "pest", heading: string): string[] => {
    const rows = items.filter((i) => i.block === block);
    if (rows.length === 0) return [];
    return ["", heading, ...rows.map((i) => `• ${escapeHtml(i.title)} — ${statusText(i)}`)];
  };
  return [
    "🔔 <b>Производственный контроль: сроки</b>",
    ...section("lab", "🧪 <b>Лабораторные исследования</b>"),
    ...section("pest", "🪲 <b>Дезинсекция и дератизация</b>"),
    "",
    "Отметьте выполнение в плане — следующая дата посчитается сама.",
  ].join("\n");
}
