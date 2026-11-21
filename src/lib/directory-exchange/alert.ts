import { escapeHtml } from "@/lib/html-escape";
import { pluralRu } from "@/lib/plural-ru";

/**
 * Тревога о сбоях обмена справочниками (серия E, Р1) — чистая часть: кого
 * назвать, слать ли сегодня и текст сообщения владельцу платформы. После
 * планового обмена (`runAllDirectoryExchanges`) `alert.server.ts` собирает
 * кабинеты с проблемой — последний обмен с ошибкой или нет успешного обмена
 * за сутки (`cabinetProblem`, как на странице ROOT «Обмен справочниками») и
 * кабинеты, обмен которых упал в этом прогоне, — и шлёт одно сообщение.
 *
 * Не чаще раза в сутки: сутки — календарные по Москве, отметка об отправке —
 * строка журнала действий (`AuditLog`, `EXCHANGE_ALERT_ACTION`) у
 * организации платформы. Плановый обмен идёт раз в день; повторный вызов
 * задачи в тот же день сообщение не повторяет.
 */

export const EXCHANGE_ALERT_ACTION = "directory_exchange.alert";
/** Сколько кабинетов назвать в сообщении; остальные — «и ещё N». */
export const EXCHANGE_ALERT_MAX_NAMES = 10;
export const EXCHANGE_ALERT_PATH = "/root/directory-exchange";
/** Москва — UTC+3 круглый год. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export type AlertProblem = "error" | "no_success";

export type AlertCabinet = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerEmail: string | null;
  problem: AlertProblem;
  /** Текст последней ошибки (если есть). */
  error: string | null;
  /** Последний успешный обмен; null — не было ни разу. */
  lastOkAt: Date | null;
};

export type AlertDecision =
  | { send: false; reason: "healthy" | "already_sent" }
  | { send: true; cabinets: AlertCabinet[] };

/** Начало московских суток, в которые попадает `now`. */
export function alertDayStart(now: Date): Date {
  const shifted = now.getTime() + MSK_OFFSET_MS;
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - MSK_OFFSET_MS);
}

/**
 * Кабинеты для тревоги: проблемные по журналу обменов плюс упавшие в этом
 * прогоне (`failed` — их подписи; кабинет в обоих списках — один раз, как
 * ошибка). Порядок: ошибки, потом дольше всех без успешного обмена, потом
 * по названию.
 */
export function alertCabinets(problems: readonly AlertCabinet[], failed: readonly AlertCabinet[] = []): AlertCabinet[] {
  const byId = new Map<string, AlertCabinet>();
  for (const cabinet of problems) if (!byId.has(cabinet.id)) byId.set(cabinet.id, cabinet);
  for (const cabinet of failed) {
    const known = byId.get(cabinet.id);
    if (!known) byId.set(cabinet.id, { ...cabinet, problem: "error" });
    else if (known.problem !== "error") byId.set(cabinet.id, { ...known, problem: "error", error: known.error ?? cabinet.error });
  }
  return [...byId.values()].sort(
    (a, b) =>
      Number(b.problem === "error") - Number(a.problem === "error") ||
      (a.lastOkAt?.getTime() ?? 0) - (b.lastOkAt?.getTime() ?? 0) ||
      a.name.localeCompare(b.name, "ru") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Слать ли тревогу: проблемных кабинетов нет — нет; сегодня (по Москве)
 * уже отправляли — нет; иначе — да, со списком.
 */
export function decideExchangeAlert(input: {
  cabinets: readonly AlertCabinet[];
  /** Когда тревога ушла в последний раз; null — не уходила. */
  lastSentAt: Date | null;
  now: Date;
}): AlertDecision {
  if (input.cabinets.length === 0) return { send: false, reason: "healthy" };
  if (input.lastSentAt && input.lastSentAt.getTime() >= alertDayStart(input.now).getTime()) {
    return { send: false, reason: "already_sent" };
  }
  return { send: true, cabinets: [...input.cabinets] };
}

/** «19.11 04:00» по Москве. */
function mskStamp(date: Date): string {
  const shifted = new Date(date.getTime() + MSK_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(shifted.getUTCDate())}.${pad(shifted.getUTCMonth() + 1)} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

const ERROR_PREVIEW = 160;

function cabinetLine(cabinet: AlertCabinet): string {
  const owner = [cabinet.ownerName, cabinet.ownerEmail].filter(Boolean).join(" · ");
  const who = owner ? `${escapeHtml(cabinet.name)} — ${escapeHtml(owner)}` : escapeHtml(cabinet.name);
  const since = cabinet.lastOkAt ? `последний успешный — ${mskStamp(cabinet.lastOkAt)} МСК` : "успешного обмена не было";
  if (cabinet.problem === "error") {
    const error = cabinet.error ? cabinet.error.slice(0, ERROR_PREVIEW) : null;
    return `• ${who}: ошибка${error ? ` «${escapeHtml(error)}»` : ""}; ${since}`;
  }
  return `• ${who}: нет успешного обмена больше суток; ${since}`;
}

/**
 * Текст тревоги (Telegram HTML, первая строка — тема письма): число
 * кабинетов, до 10 строк «название — владелец: что не так», ссылка на
 * страницу ROOT «Обмен справочниками».
 */
export function composeExchangeAlert(cabinets: readonly AlertCabinet[], appUrl: string): string {
  const count = cabinets.length;
  const shown = cabinets.slice(0, EXCHANGE_ALERT_MAX_NAMES);
  const rest = count - shown.length;
  const base = appUrl.replace(/\/+$/, "");
  return [
    `<b>Обмен справочниками: ${count} ${pluralRu(count, "кабинет", "кабинета", "кабинетов")} с проблемой</b>`,
    "",
    "Последний обмен с ошибкой или нет успешного обмена больше суток.",
    "",
    ...shown.map(cabinetLine),
    ...(rest > 0 ? [`… и ещё ${rest}`] : []),
    "",
    `<a href="${escapeHtml(`${base}${EXCHANGE_ALERT_PATH}`)}">Открыть «Обмен справочниками»</a>`,
  ].join("\n");
}
