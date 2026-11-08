/**
 * Ключи склейки контактов CRM и правила отсева по адресу. Чистые функции.
 */

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** Почта в нижнем регистре или null, если это не адрес. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase().replace(/^mailto:/, "");
  return EMAIL_RE.test(value) && value.length <= 254 ? value : null;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/**
 * Ключ телефона — последние 10 цифр: «+7 (912) 345-67-89», «8 912 345 67 89»
 * и «9123456789» дают одно и то же. Меньше 10 цифр — не телефон.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Ссылка WhatsApp: российский номер из 10 цифр получает код 7. */
export function whatsappHref(raw: string | null | undefined): string | null {
  const key = phoneKey(raw);
  if (!key) return null;
  const digits = (raw ?? "").replace(/\D/g, "");
  const full = digits.length > 10 && !digits.startsWith("8") ? digits : `7${key}`;
  return `https://wa.me/${full}`;
}

export type SenderRule = { pattern: string; action: string };

/**
 * Правило из ввода человека: адрес → как есть, `site.ru` / `@site.ru` → `@site.ru`.
 * null — не адрес и не домен.
 */
export function normalizeRulePattern(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("@") && !value.startsWith("@")) return normalizeEmail(value);
  const domain = value.replace(/^@/, "");
  return /^[a-z0-9а-яё-]+(\.[a-z0-9а-яё-]+)+$/i.test(domain) ? `@${domain}` : null;
}

/**
 * Решение правил для отправителя: точный адрес важнее домена, домен
 * покрывает и поддомены (`@site.ru` → `a@mail.site.ru`). На одном уровне
 * allow бьёт block — пропустить нужное письмо дороже, чем увидеть лишнее.
 */
export function matchSenderRule(email: string | null, rules: readonly SenderRule[]): "allow" | "block" | null {
  if (!email) return null;
  const address = email.toLowerCase();
  const domain = emailDomain(address);
  const pick = (matches: SenderRule[]) =>
    matches.some((rule) => rule.action === "allow") ? "allow" : matches.some((rule) => rule.action === "block") ? "block" : null;
  const exact = pick(rules.filter((rule) => rule.pattern === address));
  if (exact) return exact;
  return pick(
    rules.filter((rule) => {
      if (!rule.pattern.startsWith("@")) return false;
      const ruleDomain = rule.pattern.slice(1);
      return domain === ruleDomain || domain.endsWith(`.${ruleDomain}`);
    }),
  );
}

export function isOurDomain(email: string | null, ourDomains: readonly string[]): boolean {
  if (!email) return false;
  const domain = emailDomain(email.toLowerCase());
  return ourDomains.some((ours) => domain === ours || domain.endsWith(`.${ours}`));
}
