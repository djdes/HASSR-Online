/**
 * Перевод денег между своими организациями аккаунта — чистые правила
 * (серия B, Р10.2). Client-safe: форму и сервер проверяет одна функция.
 *
 * Деньги организации — её баланс (`Organization.balanceRub`); владелец
 * аккаунта переводит их между своими организациями целыми рублями, не
 * больше остатка (остаток проверяет леджер условным списанием). Ключ
 * повтора приходит от клиента: повторная отправка той же формы (обрыв
 * сети, двойной клик) не списывает дважды.
 */

/** Верхняя граница одного перевода — от опечатки в лишний ноль. */
export const ACCOUNT_TRANSFER_MAX_RUB = 10_000_000;
export const ACCOUNT_TRANSFER_COMMENT_MAX = 200;
/** Ключ повтора: UUID из браузера или любая строка того же алфавита. */
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const ORG_ID_MAX = 64;

export type AccountTransferInput = {
  fromId: string;
  toId: string;
  amountRub: number;
  comment: string;
  idempotencyKey: string;
};

export type AccountTransferRefusal =
  | "organizations"
  | "same_org"
  | "amount_required"
  | "amount_numeric"
  | "amount_whole"
  | "amount_minimum"
  | "amount_maximum"
  | "key";

export type AccountTransferCheck =
  | { ok: true; value: AccountTransferInput }
  | { ok: false; code: AccountTransferRefusal; error: string };

export type TransferAmountCheck =
  | { ok: true; amountRub: number }
  | { ok: false; code: Extract<AccountTransferRefusal, `amount_${string}`>; error: string };

/**
 * Сумма перевода: целые рубли от 1 до `ACCOUNT_TRANSFER_MAX_RUB`. Число
 * или строка из поля ввода («5 000», «5000 ₽»); копейки, ноль, минус и всё
 * нечисловое — отказ.
 */
export function parseTransferAmount(value: unknown): TransferAmountCheck {
  let amount: number;
  if (typeof value === "number") {
    amount = value;
  } else if (typeof value === "string") {
    const compact = value.replace(/[\s  ]/g, "").replace(",", ".").replace(/₽$/, "");
    if (!compact) return { ok: false, code: "amount_required", error: "Укажите сумму перевода" };
    if (!/^-?\d+(\.\d+)?$/.test(compact)) {
      return { ok: false, code: "amount_numeric", error: "Сумма — числом, в рублях" };
    }
    amount = Number(compact);
  } else {
    return { ok: false, code: "amount_required", error: "Укажите сумму перевода" };
  }
  if (!Number.isFinite(amount)) return { ok: false, code: "amount_numeric", error: "Сумма — числом, в рублях" };
  if (!Number.isInteger(amount)) {
    return { ok: false, code: "amount_whole", error: "Сумма — целыми рублями, без копеек" };
  }
  if (amount < 1) return { ok: false, code: "amount_minimum", error: "Минимальная сумма перевода — 1 ₽" };
  if (amount > ACCOUNT_TRANSFER_MAX_RUB) {
    return { ok: false, code: "amount_maximum", error: "Сумма перевода слишком большая" };
  }
  return { ok: true, amountRub: amount };
}

function orgId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= ORG_ID_MAX ? trimmed : null;
}

/** Комментарий одной строкой: без управляющих символов, не длиннее лимита. */
export function normalizeTransferComment(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ACCOUNT_TRANSFER_COMMENT_MAX);
}

export function isTransferIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_RE.test(value);
}

/** Тело `POST /api/balance/transfer` → проверенный перевод или отказ с понятной фразой. */
export function parseAccountTransfer(body: unknown): AccountTransferCheck {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fromId = orgId(raw.fromId);
  const toId = orgId(raw.toId);
  if (!fromId || !toId) {
    return { ok: false, code: "organizations", error: "Выберите, откуда и куда перевести" };
  }
  if (fromId === toId) {
    return { ok: false, code: "same_org", error: "Выберите две разные организации" };
  }
  const amount = parseTransferAmount(raw.amountRub);
  if (!amount.ok) return amount;
  if (!isTransferIdempotencyKey(raw.idempotencyKey)) {
    return { ok: false, code: "key", error: "Обновите страницу и повторите перевод" };
  }
  return {
    ok: true,
    value: {
      fromId,
      toId,
      amountRub: amount.amountRub,
      comment: normalizeTransferComment(raw.comment),
      idempotencyKey: raw.idempotencyKey,
    },
  };
}

/**
 * Ключи строк леджера (`BalanceTransaction.dedupeKey`, уникален на всю
 * базу). В ключе — аккаунт: чужой аккаунт с тем же ключом от клиента не
 * наткнётся на наш перевод и не увидит его.
 */
export function transferDedupeKeys(accountId: string, idempotencyKey: string): { out: string; in: string } {
  return {
    out: `transfer_out:${accountId}:${idempotencyKey}`,
    in: `transfer_in:${accountId}:${idempotencyKey}`,
  };
}

/** Строки детализации баланса у обеих организаций. */
export function transferDescriptions(input: {
  fromName: string;
  toName: string;
  comment: string;
}): { out: string; in: string } {
  const tail = input.comment ? ` — ${input.comment}` : "";
  return {
    out: `Перевод в «${input.toName}»${tail}`,
    in: `Перевод из «${input.fromName}»${tail}`,
  };
}

export type AccountBalanceOrganization = {
  id: string;
  name: string;
  balanceRub: number;
  /** Активная организация сессии — «откуда» по умолчанию. */
  active: boolean;
};

/** Сводка «Баланс по аккаунту» (`GET /api/balance/account`). */
export type AccountBalances = {
  accountId: string;
  activeOrganizationId: string;
  organizations: AccountBalanceOrganization[];
  totalRub: number;
};

/** Итог по аккаунту: сумма балансов организаций. */
export function accountBalanceTotal(organizations: ReadonlyArray<{ balanceRub: number }>): number {
  return organizations.reduce((sum, org) => sum + (Number.isFinite(org.balanceRub) ? org.balanceRub : 0), 0);
}
