/**
 * Оплата тарифа из балансов организаций аккаунта (серия E, Р9–Р10) — чистые
 * правила. Client-safe: план сбора, ключи повтора и строка напоминания.
 *
 * Тариф и точки — на аккаунт, деньги — на балансах организаций. Если на
 * балансе активной организации не хватает на выбранную оплату, а по аккаунту
 * хватает, недостающее переводится в неё существующим переводом между своими
 * организациями (сначала с самых больших балансов), а потом проходит обычная
 * оплата с баланса. Сервер — `account-pay.server.ts`.
 */

export type AccountPaySource = { id: string; name: string; balanceRub: number };

/** Один перевод сбора: откуда и сколько (куда — всегда в активную организацию). */
export type AccountPayTransfer = { orgId: string; name: string; amountRub: number };

export type AccountCollectionPlan =
  | { ok: true; missingRub: number; transfers: AccountPayTransfer[] }
  | { ok: false; missingRub: number; availableRub: number; shortRub: number };

/** Целые рубли не больше остатка; копейки, минус и не-числа — ноль. */
function wholeRub(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * План сбора недостающего: с самых больших балансов, при равных — по id
 * (порядок не зависит от порядка строк из базы). С каждой организации — не
 * больше её остатка; сумма переводов ровно равна недостающему. Не хватает и
 * со всех — `ok: false` и сколько не хватает.
 */
export function planAccountCollection(input: {
  missingRub: number;
  sources: readonly AccountPaySource[];
}): AccountCollectionPlan {
  const missingRub = Number.isFinite(input.missingRub) && input.missingRub > 0 ? Math.ceil(input.missingRub) : 0;
  const seen = new Set<string>();
  const sources = input.sources
    .filter((source) => {
      if (seen.has(source.id)) return false;
      seen.add(source.id);
      return wholeRub(source.balanceRub) > 0;
    })
    .map((source) => ({ ...source, balanceRub: wholeRub(source.balanceRub) }))
    .sort((a, b) => b.balanceRub - a.balanceRub || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const availableRub = sources.reduce((sum, source) => sum + source.balanceRub, 0);
  if (availableRub < missingRub) {
    return { ok: false, missingRub, availableRub, shortRub: missingRub - availableRub };
  }
  const transfers: AccountPayTransfer[] = [];
  let left = missingRub;
  for (const source of sources) {
    if (left <= 0) break;
    const amountRub = Math.min(source.balanceRub, left);
    transfers.push({ orgId: source.id, name: source.name, amountRub });
    left -= amountRub;
  }
  return { ok: true, missingRub, transfers };
}

/** Что показать перед оплатой: цена, баланс активной, недостающее и откуда возьмём. */
export type AccountPayPreview = {
  priceRub: number;
  activeOrganizationId: string;
  activeName: string;
  activeBalanceRub: number;
  /** Сколько не хватает на активной; 0 — хватает, переводов не будет. */
  missingRub: number;
  /** Сумма балансов организаций аккаунта (без демо, кабинетов и удаляемых). */
  accountTotalRub: number;
  sources: AccountPayTransfer[];
  /** Хватает: на активной или вместе с переводами. */
  canPay: boolean;
};

/**
 * Ключ повтора оплаты от браузера: UUID или запасной вариант того же
 * алфавита. Без подчёркивания и не длиннее 48 — производные ключи переводов
 * укладываются в правило ключа перевода (`[A-Za-z0-9_-]{8,100}`).
 */
const ACCOUNT_PAY_KEY_RE = /^[A-Za-z0-9-]{8,48}$/;

export function isAccountPayKey(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_PAY_KEY_RE.test(value);
}

/** Ключ строки «Оплата тарифа» (`BalanceTransaction.dedupeKey`): одна оплата на ключ. */
export function accountPayChargeKey(accountId: string, idempotencyKey: string): string {
  return `account_pay:${accountId}:${idempotencyKey}`;
}

/** FNV-1a, 32 бита, hex — короткий отпечаток id организации. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Ключ повтора перевода сбора — от ключа оплаты и организации-источника:
 * повтор той же оплаты не переводит с неё второй раз. Читаемая часть id и
 * отпечаток всего id (на случай необычных символов); длина ≤ 96.
 */
export function accountPayTransferKey(idempotencyKey: string, sourceOrgId: string): string {
  const readable = sourceOrgId.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  return `acpay-${idempotencyKey}-${readable}-${fnv1a(sourceOrgId)}`;
}

/** Комментарий переводов сбора в детализации обеих организаций. */
export const ACCOUNT_PAY_TRANSFER_COMMENT = "сбор на оплату тарифа";

/**
 * Строка напоминания о конце своих 14 дней организации (Р9): по аккаунту
 * хватает на точку — сказать, что оплатить можно с баланса в один шаг.
 * Не хватает или цены нет — null (текст напоминания как раньше).
 */
export function accountPayReminderLine(input: { priceRub: number | null; accountTotalRub: number }): string | null {
  if (input.priceRub === null || !Number.isFinite(input.priceRub) || input.priceRub <= 0) return null;
  if (!Number.isFinite(input.accountTotalRub) || input.accountTotalRub < input.priceRub) return null;
  return "На балансах организаций аккаунта хватает денег — точку можно оплатить с баланса в один шаг.";
}

/**
 * Показать ли кнопку «Собрать с организаций аккаунта и оплатить» у выбранной
 * оплаты: на активной не хватает, а по аккаунту хватает. Цена — как на
 * кнопке оплаты (с акцией, без промокода и скидки навсегда: с ними дешевле,
 * точную сумму покажет подтверждение).
 */
export function showAccountCollect(input: { payRub: number; activeBalanceRub: number; accountTotalRub: number }): boolean {
  return input.payRub > 0 && input.payRub > input.activeBalanceRub && input.payRub <= input.accountTotalRub;
}
