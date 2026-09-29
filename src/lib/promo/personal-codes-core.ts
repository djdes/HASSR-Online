import { personalCodeCandidate } from "./personal-link";
import { isValidPromoCodeFormat, normalizePromoCode, validatePromo, type PromoRule } from "./rules";

/**
 * Массовое создание персональных кодов (рассылка, генератор КП) и данные
 * кода для текста предложения — ядро без `db`; обёртка с базой и
 * публичные сигнатуры — lib/promo/personal-codes.ts.
 */

export type PersonalCodeRequest = {
  key: string;
  email: string | null;
  organizationId?: string | null;
  companyName?: string | null;
};

export type PersonalCodeOptions = {
  kind: "percent" | "fixed";
  value: number;
  lifetime: boolean;
  endsAt: Date | null;
  note?: string | null;
  campaignId?: string | null;
};

/** Строка PromoCode, которую создаёт массовая выдача. */
export type PersonalCodeRow = {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  active: true;
  startsAt: null;
  endsAt: Date | null;
  /** Один адресат — одна оплата по коду (скидка навсегда после неё работает сама). */
  maxUses: 1;
  newClientsOnly: false;
  lifetime: boolean;
  personalEmail: string | null;
  organizationId: string | null;
  campaignId: string | null;
  note: string | null;
};

/** Код уже занят (гонка с другим создателем) — повторить с новыми вариантами. */
export class PromoCodeConflictError extends Error {
  constructor(message = "promo code already exists") {
    super(message);
    this.name = "PromoCodeConflictError";
  }
}

export type PersonalCodeStore = {
  /** Какие из этих кодов уже есть в базе. */
  existingCodes(codes: string[]): Promise<Set<string>>;
  /** Все строки одной транзакцией; занятый код → PromoCodeConflictError. */
  createAll(rows: PersonalCodeRow[]): Promise<Array<{ id: string; code: string }>>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NOTE_MAX = 200;
const CAMPAIGN_MAX = 100;
const MAX_VARIANTS = 40;
const MAX_CONFLICT_RETRIES = 3;

function fail(message: string): never {
  throw new Error(`createPersonalPromoCodes: ${message}`);
}

/** Проверка входа: ошибка вызывающего — сразу исключение, ничего не создаём. */
export function normalizePersonalCodeInput(
  requests: PersonalCodeRequest[],
  options: PersonalCodeOptions,
  now: Date
): { requests: Array<PersonalCodeRequest & { email: string | null; organizationId: string | null }>; options: PersonalCodeOptions } {
  if (options.kind !== "percent" && options.kind !== "fixed") fail(`bad kind «${String(options.kind)}»`);
  if (!Number.isInteger(options.value) || options.value < 1) fail("value must be a positive integer");
  if (options.kind === "percent" && options.value > 100) fail("percent value must be ≤ 100");
  if (options.kind === "fixed" && options.value > 1_000_000) fail("fixed value must be ≤ 1 000 000");
  if (options.endsAt !== null) {
    if (!(options.endsAt instanceof Date) || Number.isNaN(options.endsAt.getTime())) fail("endsAt must be a Date or null");
    if (options.endsAt.getTime() <= now.getTime()) fail("endsAt is in the past");
  }
  const campaignId = options.campaignId?.trim() || null;
  if (campaignId && campaignId.length > CAMPAIGN_MAX) fail(`campaignId longer than ${CAMPAIGN_MAX}`);

  const keys = new Set<string>();
  const normalized = requests.map((request) => {
    if (!request.key) fail("empty request key");
    if (keys.has(request.key)) fail(`duplicate request key «${request.key}»`);
    keys.add(request.key);
    const email = request.email?.trim().toLowerCase() || null;
    if (email && (!EMAIL_RE.test(email) || email.length > 200)) fail(`bad email for key «${request.key}»`);
    const organizationId = request.organizationId?.trim() || null;
    if (!email && !organizationId) fail(`request «${request.key}» has neither email nor organizationId`);
    return { ...request, email, organizationId };
  });
  return { requests: normalized, options: { ...options, campaignId } };
}

/** «КП октябрь · Кафе «Ромашка»» — чтобы в ROOT было видно, кому код. */
function composeNote(note: string | null | undefined, companyName: string | null | undefined): string | null {
  const text = [note?.trim(), companyName?.trim()].filter(Boolean).join(" · ");
  return text ? text.slice(0, NOTE_MAX) : null;
}

/**
 * Один новый активный персональный код на запрос. Коллизии (в базе и
 * внутри пачки) — суффикс «-2», «-3»…; всё создаётся одной транзакцией,
 * гонка с другим создателем — повтор с новыми вариантами.
 */
export async function createPersonalPromoCodesWith(
  store: PersonalCodeStore,
  requests: PersonalCodeRequest[],
  options: PersonalCodeOptions,
  env: { now?: Date; random?: () => number } = {}
): Promise<Map<string, { id: string; code: string }>> {
  const now = env.now ?? new Date();
  const random = env.random ?? Math.random;
  const input = normalizePersonalCodeInput(requests, options, now);
  const result = new Map<string, { id: string; code: string }>();
  if (input.requests.length === 0) return result;

  for (let retry = 0; ; retry += 1) {
    const chosen = new Map<string, string>();
    const inBatch = new Set<string>();
    let pending = input.requests;
    for (let attempt = 0; attempt < MAX_VARIANTS && pending.length > 0; attempt += 1) {
      // На повторе после гонки начинаем сразу с дальних вариантов.
      const proposals = pending.map((request) =>
        normalizePromoCode(personalCodeCandidate(request.companyName, input.options.value, attempt + retry * 3, random))
      );
      const taken = await store.existingCodes([...new Set(proposals)]);
      const next: typeof pending = [];
      pending.forEach((request, index) => {
        const code = proposals[index];
        if (isValidPromoCodeFormat(code) && !taken.has(code) && !inBatch.has(code)) {
          chosen.set(request.key, code);
          inBatch.add(code);
        } else {
          next.push(request);
        }
      });
      pending = next;
    }
    if (pending.length > 0) fail(`no free code for ${pending.map((r) => r.key).join(", ")}`);

    const rows: PersonalCodeRow[] = input.requests.map((request) => ({
      code: chosen.get(request.key)!,
      kind: input.options.kind,
      value: input.options.value,
      active: true,
      startsAt: null,
      endsAt: input.options.endsAt,
      maxUses: 1,
      newClientsOnly: false,
      lifetime: input.options.lifetime,
      personalEmail: request.email,
      organizationId: request.organizationId,
      campaignId: input.options.campaignId ?? null,
      note: composeNote(input.options.note, request.companyName),
    }));
    try {
      const created = await store.createAll(rows);
      const byCode = new Map(created.map((row) => [row.code, row]));
      for (const request of input.requests) {
        const row = byCode.get(chosen.get(request.key)!);
        if (row) result.set(request.key, { id: row.id, code: row.code });
      }
      console.info(
        `[promo] personal codes created: ${created.length} (${input.options.kind} ${input.options.value}` +
          `${input.options.lifetime ? ", lifetime" : ""}${input.options.campaignId ? `, campaign ${input.options.campaignId}` : ""})`
      );
      return result;
    } catch (error) {
      if (error instanceof PromoCodeConflictError && retry < MAX_CONFLICT_RETRIES) {
        console.warn(`[promo] personal codes: code conflict, retry ${retry + 1}`);
        continue;
      }
      throw error;
    }
  }
}

export type PromoForOffer = {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  lifetime: boolean;
  endsAt: Date | null;
};

export type PromoLookupDeps = {
  findCode(code: string): Promise<(PromoRule & { lifetime: boolean }) | null>;
  countCodeUses(code: string): Promise<number>;
};

export type PromoLinkStatus =
  | { ok: true; promo: PromoForOffer }
  | {
      ok: false;
      reason: "not-found" | "inactive" | "not-started" | "expired" | "exhausted";
      /** Код есть и он «навсегда» — для подсказки на странице «не действует». */
      lifetime: boolean;
    };

/**
 * Действует ли код сам по себе (выключен / не начался / истёк / исчерпан) —
 * для ссылки /promo/CODE и текста предложения. Кому он выдан и «только
 * новым» здесь не проверяются: плательщик ещё неизвестен, это решит оплата.
 */
export async function promoLinkStatusWith(
  deps: PromoLookupDeps,
  code: string,
  now: Date = new Date()
): Promise<PromoLinkStatus> {
  const normalized = normalizePromoCode(code);
  if (!isValidPromoCodeFormat(normalized)) return { ok: false, reason: "not-found", lifetime: false };
  const row = await deps.findCode(normalized);
  if (!row) return { ok: false, reason: "not-found", lifetime: false };
  const paidUses = await deps.countCodeUses(row.code);
  const verdict = validatePromo(row, { now, paidUses, organizationHasPaidOrders: false });
  if (!verdict.ok) {
    const reason = verdict.reason === "not-found" || verdict.reason === "inactive" || verdict.reason === "not-started" || verdict.reason === "expired"
      ? verdict.reason
      : "exhausted";
    return { ok: false, reason, lifetime: row.lifetime };
  }
  return {
    ok: true,
    promo: { code: row.code, kind: row.kind, value: row.value, lifetime: row.lifetime, endsAt: row.endsAt },
  };
}

/**
 * Данные кода для текста предложения; null — кода нет или он не действует
 * (выключен, не начался, истёк, исчерпан). Кому он выдан, здесь не
 * проверяется — это решит оплата.
 */
export async function readPromoForOfferWith(
  deps: PromoLookupDeps,
  code: string,
  now: Date = new Date()
): Promise<PromoForOffer | null> {
  const status = await promoLinkStatusWith(deps, code, now);
  return status.ok ? status.promo : null;
}
