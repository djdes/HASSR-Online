/**
 * Служебный код базы блюд организации — чистая часть (без БД).
 *
 * Организации, указавшие один и тот же код («Привязать журнал, служебный
 * код»), видят общий список блюд: блюдо, внесённое в одной, появляется в
 * выпадающих списках других. Код — 10 символов из алфавита без похожих
 * букв и цифр (без 0/O, 1/I/L): его диктуют по телефону и вводят руками.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Новый код вида «ABCDE-FGH23». `random` — для тестов. */
export function generateServiceCode(random: () => number = Math.random): string {
  let raw = "";
  for (let i = 0; i < 10; i += 1) raw += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * Код из ввода человека: регистр, пробелы и дефисы не важны, русские буквы,
 * похожие на латинские, заменяем. Не похоже на код — null.
 */
export function normalizeServiceCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const map: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", Р: "P", С: "C", Т: "T", Х: "X", У: "Y" };
  const raw = input
    .toUpperCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 10) return null;
  if ([...raw].some((ch) => !ALPHABET.includes(ch))) return null;
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}
