import type { ExchangeKind } from "@/lib/directory-exchange/kinds";
import { REQUEST_TTL_DAYS, exchangeKindsLabel, type RequestMode } from "@/lib/directory-exchange/requests";
import type { ExchangeCounters } from "@/lib/directory-exchange/summary";
import { escapeHtml } from "@/lib/html-escape";

/**
 * Письма по запросу на обмен справочниками с чужим аккаунтом — чистая
 * сборка текста: владельцу аккаунта кабинета (кто просит и что, кнопка
 * «Открыть запрос») и заявителю (решение). Отправка — в `requests.server.ts`.
 *
 * Названия организаций и кабинета, ИНН вводят люди из ДРУГОГО аккаунта:
 * каждая такая строка экранируется, прежде чем попасть в HTML, а в теме
 * письма теряет переводы строк.
 */

export type RequestLetter = {
  /** Тема — простой текст. */
  subject: string;
  /** Заголовок письма — уже безопасный HTML. */
  title: string;
  /** Тело письма — HTML. */
  body: string;
};

const P = 'style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46"';
const MUTED = 'style="margin:0;font-size:13px;line-height:1.6;color:#a1a1aa"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';

/** Правило Р5 — одной строкой для обеих сторон. */
export const STAFF_LETTER_NOTE = "У сотрудников передаются только ФИО и должность — без телефонов и выходных.";

/** Тема письма: без переводов строк и управляющих символов из чужих названий. */
export function letterSubject(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function letterDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", year: "numeric" });
}

/** «добавлено записей — 5, обновлено — 1, …» — только то, что не ноль (кроме первого). */
export function countersLine(counters: ExchangeCounters): string {
  const parts = [`добавлено записей — ${counters.created}`];
  if (counters.updated > 0) parts.push(`обновлено — ${counters.updated}`);
  if (counters.skippedLimit > 0) parts.push(`не добавлено из-за тарифа — ${counters.skippedLimit}`);
  if (counters.skippedConflict > 0) parts.push(`пропущено из-за совпадения названий — ${counters.skippedConflict}`);
  return parts.join(", ");
}

const quoted = (value: string) => `«${escapeHtml(value)}»`;
const staffNote = (kinds: readonly ExchangeKind[]) => (kinds.includes("staff") ? ` ${STAFF_LETTER_NOTE}` : "");
/** Меню и сырьё просят только к связи. */
const withPool = (args: { mode: RequestMode; withPool?: boolean }) => args.mode === "link" && args.withPool === true;

/** Строка о меню и сырье кабинета в письме и уведомлении владельцу (серия C1, Р7.1). */
export const POOL_REQUEST_NOTE =
  "Компания также просит подключить её к меню и сырью мастер-кабинета. Это вы решите отдельной галочкой: без неё связь будет только списками.";

/** Письмо владельцу аккаунта кабинета о новом запросе (Р3). `url` — ссылка `/exchange-request/<токен>`. */
export function ownerRequestLetter(args: {
  url: string;
  mode: RequestMode;
  kinds: readonly ExchangeKind[];
  cabinetName: string;
  requesterName: string;
  requesterInn: string | null;
  expiresAt: Date;
  /** Связь: просит и меню и сырьё кабинета. */
  withPool?: boolean;
}): RequestLetter {
  const inn = args.requesterInn?.trim() ? `ИНН ${escapeHtml(args.requesterInn.trim())}` : "ИНН не указан";
  const cabinet = quoted(args.cabinetName);
  const what =
    args.mode === "link"
      ? `просит установить обмен справочниками через ваш мастер-кабинет ${cabinet}: выбранные списки будут обмениваться в обе стороны со всеми участниками обмена этого кабинета`
      : `просит разово перенести к себе данные из вашей организации (мастер-кабинет ${cabinet}). Связь после переноса не сохраняется`;
  const body =
    `<p ${P}>Организация <strong>${quoted(args.requesterName)}</strong> (${inn}) ${what}.</p>` +
    `<p ${P}>Списки: <strong>${escapeHtml(exchangeKindsLabel(args.kinds))}</strong>.${staffNote(args.kinds)}</p>` +
    (withPool(args) ? `<p ${P}>${POOL_REQUEST_NOTE}</p>` : "") +
    `<p style="margin:0 0 24px"><a href="${escapeHtml(args.url)}" ${BUTTON}>Открыть запрос</a></p>` +
    `<p ${P}>Ссылка действует ${REQUEST_TTL_DAYS} дней — до ${escapeHtml(letterDate(args.expiresAt))}. Запрос откроется только под вашей учётной записью владельца аккаунта: вы сами отметите, какие списки разрешить, и сможете отклонить запрос.</p>` +
    `<p ${MUTED}>Если вы не знаете эту организацию — отклоните запрос или просто не отвечайте: без вашего подтверждения ничего не передаётся.</p>`;
  return {
    subject: letterSubject(`Запрос на обмен справочниками от «${args.requesterName}»`),
    title: "Запрос на обмен справочниками",
    body,
  };
}

/**
 * Колокольчик и Telegram владельцу аккаунта кабинета о новом запросе (Р4
 * серии A). `label` и `hint` — простой текст (колокольчик экранирует сам),
 * `telegramText` — HTML Telegram: чужие названия экранированы.
 */
export function ownerRequestNotice(args: {
  mode: RequestMode;
  kinds: readonly ExchangeKind[];
  cabinetName: string;
  requesterName: string;
  expiresAt: Date;
  withPool?: boolean;
}): { title: string; label: string; hint: string; telegramText: string } {
  const what = args.mode === "link" ? "просит связать справочники" : "просит разово перенести данные";
  const lists = exchangeKindsLabel(args.kinds);
  const pool = withPool(args);
  const until = letterDate(args.expiresAt);
  const title = "Запрос на обмен справочниками";
  return {
    title,
    label: `«${letterSubject(args.requesterName)}» ${what} — мастер-кабинет «${letterSubject(args.cabinetName)}»`,
    hint: `${lists}${pool ? "; меню и сырьё кабинета" : ""}; ответить до ${until}`,
    telegramText:
      `<b>${title}</b>\n\n` +
      `Организация ${quoted(args.requesterName)} ${what} через ваш мастер-кабинет ${quoted(args.cabinetName)}.\n` +
      `Списки: ${escapeHtml(lists)}.\n` +
      (pool ? `${POOL_REQUEST_NOTE}\n` : "") +
      `\n` +
      `Ответить можно до ${escapeHtml(until)}. Без вашего подтверждения ничего не передаётся.`,
  };
}

/** Заголовок решения — он же тема письма и заголовок уведомления. */
export function decisionTitle(status: "approved" | "declined"): string {
  return status === "approved" ? "Запрос на обмен справочниками подтверждён" : "Запрос на обмен справочниками отклонён";
}

/** Строка уведомления в колокольчике заявителя — простой текст. */
export function decisionNotificationLabel(args: { status: "approved" | "declined"; mode: RequestMode; cabinetName: string }): string {
  const cabinet = `Мастер-кабинет «${args.cabinetName}»`;
  if (args.status === "declined") {
    return `${cabinet}: ${args.mode === "link" ? "обмен справочниками" : "перенос данных"} отклонён`;
  }
  return args.mode === "link" ? `${cabinet}: обмен справочниками установлен` : `${cabinet}: данные перенесены`;
}

/**
 * Чем кончилась просьба о меню и сырье кабинета (серия C1): подключены, не
 * разрешены владельцем или подключить не удалось. Причину отказа заявителю не
 * называем — она может говорить о кабинете (например, о его лимите объектов).
 */
export type PoolDecision = "connected" | "not_allowed" | "refused";

/** Строка о меню и сырье для заявителя — простой текст; не просили — null. */
export function poolDecisionLine(pool: PoolDecision | null | undefined): string | null {
  if (pool === "connected") return "Меню и сырьё мастер-кабинета подключены — они появятся в журналах организации.";
  if (pool === "not_allowed") return "Меню и сырьё мастер-кабинета владелец не подключил: связь установлена только списками.";
  if (pool === "refused") return "Меню и сырьё мастер-кабинета подключить не удалось: связь установлена только списками.";
  return null;
}

/** Письмо заявителю о решении владельца кабинета (Р6). `counters` — что получила его организация. */
export function requesterDecisionLetter(args: {
  url: string;
  status: "approved" | "declined";
  mode: RequestMode;
  cabinetName: string;
  requesterName: string;
  allowedKinds: readonly ExchangeKind[];
  counters: ExchangeCounters | null;
  /** Связь, где просили меню и сырьё кабинета: чем это кончилось. */
  pool?: PoolDecision | null;
}): RequestLetter {
  const cabinet = quoted(args.cabinetName);
  const organization = quoted(args.requesterName);
  const lists = escapeHtml(exchangeKindsLabel(args.allowedKinds));
  const done = args.counters ? escapeHtml(countersLine(args.counters)) : null;
  let body: string;
  if (args.status === "declined") {
    body =
      `<p ${P}>Владелец мастер-кабинета ${cabinet} отклонил запрос организации ${organization} на ` +
      `${args.mode === "link" ? "обмен справочниками" : "разовый перенос данных"}. Данные не передавались.</p>`;
  } else if (args.mode === "link") {
    body =
      `<p ${P}>Владелец мастер-кабинета ${cabinet} подтвердил обмен справочниками с организацией ${organization}.</p>` +
      `<p ${P}>Разрешённые списки: <strong>${lists}</strong>.${staffNote(args.allowedKinds)}</p>` +
      (poolDecisionLine(args.pool) ? `<p ${P}>${poolDecisionLine(args.pool)}</p>` : "") +
      `<p ${P}>${done ? `Первый обмен выполнен: ${done}. ` : ""}Дальше списки обмениваются автоматически раз в сутки. Выйти из обмена можно в «Настройки → Мастер-кабинет».</p>`;
  } else {
    body =
      `<p ${P}>Владелец мастер-кабинета ${cabinet} разрешил разовый перенос данных в организацию ${organization}.</p>` +
      `<p ${P}>Списки: <strong>${lists}</strong>.${staffNote(args.allowedKinds)}</p>` +
      `<p ${P}>${done ? `Перенос выполнен: ${done}. ` : ""}Связь между организациями не сохранена.</p>`;
  }
  body += `<p style="margin:0"><a href="${escapeHtml(args.url)}" ${BUTTON}>Открыть кабинет</a></p>`;
  const title = decisionTitle(args.status);
  return { subject: title, title, body };
}
