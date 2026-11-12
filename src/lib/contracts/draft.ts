import { BUYER_INPUT_KEYS, type ContractBuyerInput } from "./buyer-form";

/**
 * Черновик формы договора (12.11.2026: «вводили реквизиты, после перезагрузки
 * они не сохранились»). Форма карточки ROOT автосохраняется в
 * `Organization.contractDraftJson` и подставляется при следующем открытии
 * (и после выпуска: следующий договор клиенту — с теми же реквизитами). Сохраняем как есть (незаполненная форма —
 * тоже черновик), а при чтении берём только знакомые поля нужного типа:
 * старый или битый черновик не ломает карточку.
 */

export type ContractDraftForm = {
  city: string;
  signerName: string | null;
  signerPost: string | null;
  signerBasis: string | null;
  buyerEmail: string | null;
  useFacsimile: boolean;
  buyer: ContractBuyerInput;
  pricing: { tier: "standard" | "premium" | "vip"; cycle: "month" | "year"; points: number; discountPercent: number };
};

export type ContractDraftText = Array<{ title: string; text: string }>;

/** Не больше — черновик не принимаем (защита от мусора в БД). */
export const CONTRACT_DRAFT_MAX_BYTES = 200_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const textOrNull = (value: unknown, max: number): string | null | undefined =>
  value === null ? null : typeof value === "string" ? value.slice(0, max) : undefined;

/** Значения формы по умолчанию + сохранённый черновик (только валидные поля). */
export function mergeContractDraft<T extends ContractDraftForm>(defaults: T, raw: unknown): { form: T; text: ContractDraftText | null; saved: boolean } {
  if (!isRecord(raw) || !isRecord(raw.form)) return { form: defaults, text: null, saved: false };
  const draft = raw.form;
  const form: T = { ...defaults, buyer: { ...defaults.buyer }, pricing: { ...defaults.pricing } };
  if (typeof draft.city === "string") form.city = draft.city.slice(0, 80);
  for (const key of ["signerName", "signerPost", "signerBasis", "buyerEmail"] as const) {
    const value = textOrNull(draft[key], 254);
    if (value !== undefined) form[key] = value;
  }
  if (typeof draft.useFacsimile === "boolean") form.useFacsimile = draft.useFacsimile;
  if (isRecord(draft.buyer)) {
    for (const key of BUYER_INPUT_KEYS) {
      const value = textOrNull(draft.buyer[key], 500);
      if (value !== undefined) form.buyer[key] = value;
    }
  }
  if (isRecord(draft.pricing)) {
    const p = draft.pricing;
    if (p.tier === "standard" || p.tier === "premium" || p.tier === "vip") form.pricing.tier = p.tier;
    if (p.cycle === "month" || p.cycle === "year") form.pricing.cycle = p.cycle;
    const points = Number(p.points);
    if (Number.isInteger(points) && points >= 1 && points <= 500) form.pricing.points = points;
    const discount = Number(p.discountPercent);
    if (Number.isFinite(discount) && discount >= 0 && discount <= 100) form.pricing.discountPercent = discount;
  }
  const text = Array.isArray(raw.text)
    ? raw.text
        .filter((section): section is { title: string; text: string } => isRecord(section) && typeof section.title === "string" && typeof section.text === "string")
        .slice(0, 40)
        .map((section) => ({ title: section.title.slice(0, 200), text: section.text.slice(0, 40_000) }))
    : null;
  return { form, text: text && text.length ? text : null, saved: true };
}
