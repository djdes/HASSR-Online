import { ENTITY_KIND, isExchangeEntity, normalizeExchangeKinds } from "@/lib/directory-exchange/kinds";
import { escapeHtml } from "@/lib/html-escape";

/**
 * Еженедельная сводка обмена справочниками (серия E, Р7) — чистая сборка:
 * по своим организациям аккаунта, участвующим в обмене кабинета, — сколько
 * записей пришло за 7 дней (создано / изменено, без отменённых), сколько
 * пропусков ждёт разбора, и ошибки обмена кабинета за 7 дней. Пусто — не
 * шлём. Отправка и отметка «уже слали на этой неделе» — в
 * `weekly-digest.server.ts`.
 *
 * Названия организаций вводят люди — в письме и в Telegram они экранируются.
 */

export const EXCHANGE_DIGEST_DAYS = 7;
export const EXCHANGE_DIGEST_HREF = "/settings/master-cabinet";
/** Отметка в журнале действий: сводку аккаунту за эту неделю уже отправили. */
export const EXCHANGE_DIGEST_ACTION = "directory_exchange.weekly_digest";
export const EXCHANGE_DIGEST_KIND = "directory_exchange.weekly_digest";
/** Больше строк в письме и сообщении не показываем — остальное в карточке. */
export const EXCHANGE_DIGEST_MAX_ROWS = 20;

const MSK_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** Начало недели (понедельник 00:00 по Москве) — граница «уже слали на этой неделе». */
export function exchangeDigestWeekStart(now: Date): Date {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS);
  const sinceMonday = (msk.getUTCDay() + 6) % 7;
  const mondayMsk = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()) - sinceMonday * DAY_MS;
  return new Date(mondayMsk - MSK_OFFSET_MS);
}

/** ISO-неделя по Москве: «2026-W47». */
export function exchangeDigestWeekKey(now: Date): string {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS);
  const day = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()));
  // Четверг этой недели определяет год ISO-недели.
  day.setUTCDate(day.getUTCDate() + 3 - ((day.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((day.getTime() - yearStart.getTime()) / DAY_MS / 7 - 3 / 7 + ((yearStart.getUTCDay() + 6) % 7) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type ExchangeDigestRow = {
  organizationId: string;
  name: string;
  created: number;
  updated: number;
  /** Пропуски, ждущие разбора. */
  pending: number;
};

export type ExchangeDigest = {
  weekKey: string;
  rows: ExchangeDigestRow[];
  /** Обменов кабинета с ошибкой за 7 дней. */
  errorRuns: number;
};

/**
 * Строки сводки. Участвуют свои рабочие организации кабинета (организации
 * другой компании сюда не передают); закрытые после своих 14 дней не
 * считаются. Отменённые изменения не считаются; пропуск считается, только
 * если организация ещё участвует в его списке (как в «Разборе пропусков»).
 * Строки без событий не показываются.
 */
export function buildExchangeDigest(input: {
  weekKey: string;
  members: ReadonlyArray<{ organizationId: string; name: string; kinds: readonly string[] }>;
  locked: ReadonlySet<string>;
  changes: ReadonlyArray<{ organizationId: string; op: string; undone: boolean; count?: number }>;
  skips: ReadonlyArray<{ organizationId: string; entity: string; count?: number }>;
  errorRuns: number;
}): ExchangeDigest {
  const rows = new Map<string, ExchangeDigestRow & { kinds: Set<string> }>();
  for (const member of input.members) {
    if (input.locked.has(member.organizationId) || rows.has(member.organizationId)) continue;
    rows.set(member.organizationId, {
      organizationId: member.organizationId,
      name: member.name,
      created: 0,
      updated: 0,
      pending: 0,
      kinds: new Set(normalizeExchangeKinds(member.kinds)),
    });
  }
  const amount = (value: number | undefined) => (value === undefined ? 1 : Math.max(0, Math.floor(value)));
  for (const change of input.changes) {
    const row = rows.get(change.organizationId);
    if (!row || change.undone) continue;
    if (change.op === "create") row.created += amount(change.count);
    else if (change.op === "update") row.updated += amount(change.count);
  }
  for (const skip of input.skips) {
    const row = rows.get(skip.organizationId);
    if (!row || !isExchangeEntity(skip.entity) || !row.kinds.has(ENTITY_KIND[skip.entity])) continue;
    row.pending += amount(skip.count);
  }
  return {
    weekKey: input.weekKey,
    rows: [...rows.values()]
      .filter((row) => row.created + row.updated + row.pending > 0)
      .map((row) => ({ organizationId: row.organizationId, name: row.name, created: row.created, updated: row.updated, pending: row.pending })),
    errorRuns: Math.max(0, Math.floor(input.errorRuns)),
  };
}

/** Есть что сообщить: записи, пропуски или ошибки. */
export function exchangeDigestHasNews(digest: ExchangeDigest): boolean {
  return digest.rows.length > 0 || digest.errorRuns > 0;
}

export function exchangeDigestTotals(digest: ExchangeDigest): { created: number; updated: number; pending: number } {
  return digest.rows.reduce(
    (sum, row) => ({ created: sum.created + row.created, updated: sum.updated + row.updated, pending: sum.pending + row.pending }),
    { created: 0, updated: 0, pending: 0 },
  );
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const errorsText = (count: number) => `${count} ${plural(count, "обмен", "обмена", "обменов")} с ошибкой`;

/** Тема письма — простой текст. */
export function exchangeDigestSubject(digest: ExchangeDigest): string {
  const totals = exchangeDigestTotals(digest);
  const parts: string[] = [];
  if (totals.created + totals.updated > 0) parts.push(`пришло ${totals.created + totals.updated}`);
  if (totals.pending > 0) parts.push(`ждёт разбора ${totals.pending}`);
  if (digest.errorRuns > 0) parts.push(errorsText(digest.errorRuns));
  return `Обмен справочниками за неделю: ${parts.join(", ")}`;
}

const P = 'style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46"';
const TH = 'style="padding:8px 10px;border-bottom:1px solid #dcdde3;text-align:left;font-size:12px;color:#5f6170;font-weight:600"';
const THR = 'style="padding:8px 10px;border-bottom:1px solid #dcdde3;text-align:right;font-size:12px;color:#5f6170;font-weight:600"';
const TD = 'style="padding:8px 10px;border-bottom:1px solid #e7e7ec;font-size:14px;color:#111114"';
const TDR = 'style="padding:8px 10px;border-bottom:1px solid #e7e7ec;font-size:14px;color:#111114;text-align:right"';
const WARN = 'style="background:#fff4f2;border-radius:8px;padding:12px 16px;margin:0 0 16px;color:#a13a32;line-height:1.6"';
const BUTTON =
  'style="display:inline-block;background:#111114;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';

/** Письмо: заголовок и тело (HTML) — обёртку письма добавляет отправка. */
export function exchangeDigestEmail(digest: ExchangeDigest, appUrl: string): { subject: string; title: string; html: string } {
  const href = `${appUrl.replace(/\/+$/, "")}${EXCHANGE_DIGEST_HREF}`;
  const shown = digest.rows.slice(0, EXCHANGE_DIGEST_MAX_ROWS);
  const more = digest.rows.length - shown.length;
  const parts: string[] = [`<p ${P}>Что принёс обмен справочниками за последние ${EXCHANGE_DIGEST_DAYS} дней.</p>`];
  if (shown.length > 0) {
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 16px">` +
        `<tr><th ${TH}>Организация</th><th ${THR}>Создано</th><th ${THR}>Изменено</th><th ${THR}>Ждёт разбора</th></tr>` +
        shown
          .map(
            (row) =>
              `<tr><td ${TD}>${escapeHtml(row.name)}</td><td ${TDR}>${row.created}</td><td ${TDR}>${row.updated}</td><td ${TDR}>${row.pending}</td></tr>`,
          )
          .join("") +
        `</table>`,
    );
    if (more > 0) parts.push(`<p ${P}>И ещё ${more} — в карточке «Обмен справочниками».</p>`);
  }
  if (digest.errorRuns > 0) {
    parts.push(`<div ${WARN}>За неделю ${errorsText(digest.errorRuns)}. Посмотрите итог последнего обмена в карточке.</div>`);
  }
  parts.push(`<a href="${escapeHtml(href)}" ${BUTTON}>Открыть «Обмен справочниками»</a>`);
  return { subject: exchangeDigestSubject(digest), title: "Обмен справочниками за неделю", html: parts.join("") };
}

/** Сообщение в Telegram (parse_mode HTML) — коротко, по строке на организацию. */
export function exchangeDigestTelegram(digest: ExchangeDigest): string {
  const lines = ["🔄 <b>Обмен справочниками за неделю</b>", ""];
  for (const row of digest.rows.slice(0, EXCHANGE_DIGEST_MAX_ROWS)) {
    const parts = [`создано ${row.created}`, `изменено ${row.updated}`];
    if (row.pending > 0) parts.push(`ждёт разбора ${row.pending}`);
    lines.push(`• ${escapeHtml(row.name)}: ${parts.join(", ")}`);
  }
  const more = digest.rows.length - EXCHANGE_DIGEST_MAX_ROWS;
  if (more > 0) lines.push(`• … и ещё ${more}`);
  if (digest.errorRuns > 0) lines.push("", `⚠️ ${errorsText(digest.errorRuns)} за неделю.`);
  return lines.join("\n");
}
