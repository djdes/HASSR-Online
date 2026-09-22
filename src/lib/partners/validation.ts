/**
 * Валидация партнёрского брендинга и идентификаторов — чистые функции.
 * Используются и на сервере (API), и в клиентских формах для live-подсказок.
 */

export const BRAND_NAME_MAX = 40;
export const PDF_SIGNATURE_MAX = 120;
export const LOGIN_GREETING_MAX = 200;
export const LOGO_MAX_BYTES = 500 * 1024;
/** Целевая коробка логотипа в CSS-пикселях. */
export const LOGO_BOX = { width: 240, height: 64 } as const;
/** Допустимые размеры PNG после нормализации в браузере (2x под retina). */
export const LOGO_PNG_MAX = { width: 480, height: 128 } as const;
export const DEFAULT_ACCENT = "#5566f6";
/** Обязательная подпись у клиентов партнёра — не отключается (TZ 3.2). */
export const PLATFORM_BADGE_TEXT = "Работает на платформе WeSetup";

/** Страница с текстом партнёрского договора (публичная). */
export const PARTNER_AGREEMENT_URL = "/partner-agreement";
/** Редакция договора партнёра — пишется в `Partner.agreementVersion` при заявке. */
export const PARTNER_AGREEMENT_VERSION = "2026-09-22";

export const INVITE_STATUS_LABELS: Record<string, string> = {
  sent: "Отправлено",
  registered: "Зарегистрировался",
  declined: "Отказался",
};
export const DARK_TEXT = "#0b1024";
export const SLUG_MIN = 3;
export const SLUG_MAX = 32;
export const PARTNER_CODE_LENGTH = 6;

/**
 * Служебные пути, которые не могут стать slug'ом: ссылка `/p/<slug>`
 * живёт рядом с ними, а в будущем slug станет субдоменом.
 *
 * Единственный список на весь проект. Раньше их было два — здесь и в
 * `service.ts` — и они разошлись: `app`, `help` и `blog` отвергались
 * только при подаче заявки, а `mail` и `p` — только этой функцией.
 */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "blog",
  "dashboard",
  "help",
  "login",
  "mail",
  "mini",
  "p",
  "partner",
  "partners",
  "register",
  "root",
  "settings",
  "static",
  "support",
  "wesetup",
  "www",
]);

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Латиница, цифры, дефис; без дефисов по краям и двойных дефисов. */
export function validateSlug(raw: string): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = normalizeSlug(raw);
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return { ok: false, error: `Ссылка: от ${SLUG_MIN} до ${SLUG_MAX} символов` };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return {
      ok: false,
      error: "Ссылка: только латинские буквы, цифры и дефис между словами",
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: "Эта ссылка зарезервирована системой" };
  }
  return { ok: true, slug };
}

/** Кандидат slug'а из названия компании (транслит) — предзаполнение формы. */
export function suggestSlug(companyName: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y",
    ь: "", э: "e", ю: "yu", я: "ya",
  };
  const translit = companyName
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("");
  const slug = translit
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slug.length >= SLUG_MIN ? slug : "";
}

/** Алфавит кода без похожих символов (0/O, 1/I/L). */
export const PARTNER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizePartnerCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function isValidPartnerCode(raw: string): boolean {
  const code = normalizePartnerCode(raw);
  if (code.length !== PARTNER_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!PARTNER_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** Генерация кода из случайных байт (crypto передаётся снаружи — тестируемо). */
export function partnerCodeFromBytes(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < PARTNER_CODE_LENGTH; i += 1) {
    out += PARTNER_CODE_ALPHABET[bytes[i] % PARTNER_CODE_ALPHABET.length];
  }
  return out;
}

export function normalizeHex(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^[0-9a-f]{6}$/.test(value)) return `#${value}`;
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return null;
}

function channel(hex: string, offset: number): number {
  const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Относительная яркость по WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const normalized = normalizeHex(hex);
  if (!normalized) return 0;
  return (
    0.2126 * channel(normalized, 1) +
    0.7152 * channel(normalized, 3) +
    0.0722 * channel(normalized, 5)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

export const CONTRAST_MIN_ON_WHITE = 4.5;
export const CONTRAST_MIN_ON_DARK = 3;

export type AccentCheck = {
  hex: string | null;
  onWhite: number;
  onDark: number;
  ok: boolean;
  /** Что применится на практике: сам цвет или дефолтный индиго. */
  effective: string;
  warning: string | null;
};

/**
 * WCAG AA: белый текст на кнопке с этим цветом (≥ 4.5:1) и сам цвет как
 * крупный текст/индикатор на тёмном (≥ 3:1). Не проходит — предупреждаем
 * и оставляем стандартный акцент, но сохраняем введённое значение.
 */
export function checkAccent(raw: string): AccentCheck {
  const hex = normalizeHex(raw);
  if (!hex) {
    return {
      hex: null,
      onWhite: 0,
      onDark: 0,
      ok: false,
      effective: DEFAULT_ACCENT,
      warning: "Введите цвет в формате #RRGGBB",
    };
  }
  const onWhite = contrastRatio(hex, "#ffffff");
  const onDark = contrastRatio(hex, DARK_TEXT);
  const ok = onWhite >= CONTRAST_MIN_ON_WHITE && onDark >= CONTRAST_MIN_ON_DARK;
  return {
    hex,
    onWhite,
    onDark,
    ok,
    effective: ok ? hex : DEFAULT_ACCENT,
    warning: ok
      ? null
      : `Контраст ${onWhite}:1 к белому и ${onDark}:1 к тёмному ниже WCAG AA (нужно ≥ ${CONTRAST_MIN_ON_WHITE} и ≥ ${CONTRAST_MIN_ON_DARK}). Будет использован стандартный цвет.`,
  };
}

/** Цвет hover — тот же тон на 8 % темнее; для CSS-переменной кабинета. */
export function darkenHex(hex: string, amount = 0.08): string {
  const normalized = normalizeHex(hex) ?? DEFAULT_ACCENT;
  const parts = [1, 3, 5].map((offset) => {
    const v = parseInt(normalized.slice(offset, offset + 2), 16);
    return Math.max(0, Math.round(v * (1 - amount)));
  });
  return `#${parts.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Размеры PNG из IHDR — без графических библиотек. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  // 8 байт сигнатуры, 4 — длина чанка, 4 — тип "IHDR"
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export type LogoCheck =
  | { ok: true; mime: "image/png" | "image/svg+xml"; width: number | null; height: number | null }
  | { ok: false; error: string };

/**
 * Проверка загруженного логотипа: вес, формат, размеры PNG. SVG после
 * этой проверки дополнительно проходит sanitizeSvg().
 */
export function checkLogoBytes(bytes: Uint8Array, declaredMime: string): LogoCheck {
  if (bytes.length === 0) return { ok: false, error: "Пустой файл" };
  if (bytes.length > LOGO_MAX_BYTES) {
    return { ok: false, error: "Логотип больше 500 КБ" };
  }
  const png = readPngSize(bytes);
  if (png) {
    if (png.width > LOGO_PNG_MAX.width || png.height > LOGO_PNG_MAX.height) {
      return {
        ok: false,
        error: `PNG должен быть не больше ${LOGO_PNG_MAX.width}×${LOGO_PNG_MAX.height} px (в форме он подгоняется автоматически)`,
      };
    }
    return { ok: true, mime: "image/png", width: png.width, height: png.height };
  }
  if (declaredMime === "image/svg+xml" || looksLikeSvg(bytes)) {
    return { ok: true, mime: "image/svg+xml", width: null, height: null };
  }
  return { ok: false, error: "Поддерживаются только PNG и SVG" };
}

export function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 512))
    .replace(/^﻿/, "")
    .trimStart();
  return /^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head);
}

export function validateBrandName(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "Укажите название бренда" };
  if (value.length > BRAND_NAME_MAX) {
    return { ok: false, error: `Название бренда — не длиннее ${BRAND_NAME_MAX} символов` };
  }
  return { ok: true, value };
}

export function clampText(raw: string | null | undefined, max: number): string {
  return (raw ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

export const INN_PATTERN = /^\d{10}(\d{2})?$/;

export function isValidInn(raw: string): boolean {
  return INN_PATTERN.test(raw.trim());
}

/**
 * Резерв под субдомен `<slug>.wesetup.ru`: middleware не вызывает, но
 * когда домен включат — сюда приходит `Host`, отсюда уходит slug.
 */
export function resolvePartnerSlugFromHost(
  host: string | null | undefined,
  baseDomain = "wesetup.ru",
): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname.endsWith(`.${baseDomain}`)) return null;
  const sub = hostname.slice(0, -(baseDomain.length + 1));
  if (!sub || sub.includes(".")) return null;
  const check = validateSlug(sub);
  return check.ok ? check.slug : null;
}

/**
 * Что ввёл клиент в поле «Ссылка или код партнёра»: полный URL
 * `https://wesetup.ru/p/<slug>`, голый slug или 6-символьный код.
 * Код проверяем первым — «ABC234» подходит и под правила slug'а.
 */
export function parseAttachInput(raw: string): { slug: string } | { code: string } | null {
  const value = raw.trim();
  if (!value) return null;
  if (isValidPartnerCode(value)) return { code: normalizePartnerCode(value) };
  const fromUrl = value.match(/\/p\/([^/?#\s]+)/i);
  const candidate = fromUrl ? decodeURIComponent(fromUrl[1]) : value;
  const check = validateSlug(candidate);
  return check.ok ? { slug: check.slug } : null;
}
