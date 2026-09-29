import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";

import { isValidPromoCodeFormat, normalizePromoCode } from "./rules";

/**
 * Персональные коды и ссылка с промокодом — чистые функции без `db`
 * (их реэкспортирует lib/promo/personal-codes.ts для рассылки и КП).
 *
 * Контракт ссылки (на него уже ссылаются КП и рассылка — не менять):
 *   https://wesetup.ru/promo/<CODE>?s=<sphere>
 * `sphere` — значение ORG_SPHERES, необязателен.
 */

export const PROMO_LINK_BASE_URL = "https://wesetup.ru";
/** Код из ссылки живёт в cookie 30 дней: подставится на оплате и позже. */
export const PROMO_COOKIE = "wesetup.promo";
export const PROMO_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;
/** «ROMASHKA10» — до 16 знаков вместе с размером скидки. */
export const PERSONAL_CODE_MAX_LENGTH = 16;

const TRANSLIT: Record<string, string> = {
  а: "A", б: "B", в: "V", г: "G", д: "D", е: "E", ё: "E", ж: "ZH", з: "Z", и: "I",
  й: "Y", к: "K", л: "L", м: "M", н: "N", о: "O", п: "P", р: "R", с: "S", т: "T",
  у: "U", ф: "F", х: "KH", ц: "TS", ч: "CH", ш: "SH", щ: "SHCH", ъ: "", ы: "Y", ь: "",
  э: "E", ю: "YU", я: "YA",
};

/** Кириллица → латиница, в коде остаются только A–Z и 0–9. */
export function transliterateToCode(text: string): string {
  let out = "";
  for (const char of text.toLowerCase()) {
    if (char in TRANSLIT) out += TRANSLIT[char];
    else if (/[a-z0-9]/.test(char)) out += char.toUpperCase();
  }
  return out;
}

/** Организационно-правовые формы — в коде они только шум. */
const LEGAL_FORMS = new Set([
  "OOO", "OAO", "ZAO", "PAO", "AO", "NAO", "IP", "TOO", "NKO", "ANO", "MUP", "GUP", "FGUP",
  "MBOU", "MAOU", "GBOU", "MKOU", "MBDOU", "MADOU", "GBDOU", "MKDOU", "GBUZ", "GAUZ", "FGBU",
  "FGBOU", "CHOU", "CHUZ", "LLC", "INC", "LTD",
]);

/**
 * Основа кода из названия: бренд в кавычках («Ромашка» из «ООО «Ромашка»»
 * и «Кафе «Ромашка»»), иначе название без ООО/ИП/…
 */
function companyStem(companyName: string): string {
  const quoted = /[«"“„'‘]([^«»"“”„'‘’]{2,})[»"”“'’]/.exec(companyName);
  if (quoted) {
    const stem = transliterateToCode(quoted[1]);
    if (stem.length >= 2) return stem;
  }
  return companyName
    .split(/[\s,.;:()«»"“”„'‘’-]+/)
    .map(transliterateToCode)
    .filter((word) => word && !LEGAL_FORMS.has(word))
    .join("");
}

/** Без похожих символов (0/O, 1/I/L) — код диктуют по телефону. */
const RANDOM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomPersonalCode(tail: string, random: () => number): string {
  let body = "";
  for (let i = 0; i < 4; i += 1) {
    body += RANDOM_ALPHABET[Math.floor(random() * RANDOM_ALPHABET.length) % RANDOM_ALPHABET.length];
  }
  return `KP${body}${tail}`;
}

function valueTail(value: number): string {
  return String(Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}

/**
 * Вариант кода для попытки `attempt` (0 — основной). Коллизия: основа
 * укорачивается под суффикс «-2», «-3»… и код остаётся в 16 знаках; у
 * случайного кода — новый случайный. `random` — для тестов.
 */
export function personalCodeCandidate(
  companyName: string | null | undefined,
  value: number,
  attempt: number,
  random: () => number = Math.random
): string {
  const tail = valueTail(value);
  const stem = companyStem(companyName ?? "");
  if (stem.length < 2) return randomPersonalCode(tail, random);
  if (attempt <= 0) return `${stem.slice(0, Math.max(0, PERSONAL_CODE_MAX_LENGTH - tail.length))}${tail}`;
  const suffix = `-${attempt + 1}`;
  const room = PERSONAL_CODE_MAX_LENGTH - tail.length - suffix.length;
  if (room < 2) return randomPersonalCode(tail, random);
  return `${stem.slice(0, room)}${tail}${suffix}`;
}

/** «ROMASHKA10»: транслит названия A–Z0–9 + размер скидки, до 16 знаков; пусто — случайный «KP7F3Q10». */
export function suggestPersonalCode(companyName: string | null | undefined, value: number): string {
  return personalCodeCandidate(companyName, value, 0);
}

/** Сфера из ссылки: только значения ORG_SPHERES, иначе null. */
export function linkSphere(raw: string | null | undefined): OrgSphere | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  const found = ORG_SPHERES.find((sphere) => sphere.value === value);
  return found ? found.value : null;
}

/** https://wesetup.ru/promo/<CODE>?s=<sphere> — сфера только из ORG_SPHERES. */
export function promoLinkUrl(code: string, opts?: { sphere?: string | null; baseUrl?: string }): string {
  const normalized = normalizePromoCode(code);
  if (!isValidPromoCodeFormat(normalized)) {
    throw new Error(`promoLinkUrl: bad promo code format «${code}»`);
  }
  const base = (opts?.baseUrl ?? PROMO_LINK_BASE_URL).trim().replace(/\/+$/, "") || PROMO_LINK_BASE_URL;
  const sphere = linkSphere(opts?.sphere);
  return `${base}/promo/${encodeURIComponent(normalized)}${sphere ? `?s=${encodeURIComponent(sphere)}` : ""}`;
}

/** Кто открыл ссылку: руководитель, другой вошедший или гость. */
export type PromoLinkViewer = "manager" | "member" | "guest";

/**
 * Куда вести по действующей ссылке:
 *   - руководитель — тариф с подставленным кодом;
 *   - другой вошедший (сотрудник) — страница оплаты с кодом: тариф ему не открыт;
 *   - гость — регистрация со сферой, после неё — тариф с кодом.
 */
export function promoLinkRedirect(code: string, sphere: string | null, viewer: PromoLinkViewer): string {
  const promo = encodeURIComponent(normalizePromoCode(code));
  const subscription = `/settings/subscription?promo=${promo}`;
  if (viewer === "manager") return subscription;
  if (viewer === "member") return `/order?plan=monthly&promo=${promo}`;
  const params = new URLSearchParams({ promo: normalizePromoCode(code) });
  const s = linkSphere(sphere);
  if (s) params.set("s", s);
  params.set("next", subscription);
  return `/register?${params.toString()}`;
}
