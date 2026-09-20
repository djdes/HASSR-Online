/**
 * Ввод показаний одним касанием: кнопки быстрого ввода по норме и
 * шаговые «−»/«+» по бокам поля. Чистые функции без DOM — их делят
 * серверный HTML QR-формы, страницы помещений/оборудования и формы задач.
 */

/** Норма из подписи поля: «Холодильник №1 · норма 2…6», «норма -18…-20» (порядок приводится). */
export function normFromLabel(label: string): { min: number; max: number } | null {
  const m = /норма\s*(-?\d+(?:[.,]\d+)?)\s*[…–—-]\s*(-?\d+(?:[.,]\d+)?)/i.exec(label);
  if (!m) return null;
  const a = Number(m[1].replace(",", "."));
  const b = Number(m[2].replace(",", "."));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a <= b ? { min: a, max: b } : { min: b, max: a };
}

/**
 * Кнопки быстрого ввода под числовым полем с нормой: нижняя граница,
 * середина и верхняя граница. Ответственный обычно вводит «что-то среднее
 * по норме» — одно касание вместо набора; свою цифру всё равно можно
 * набрать. Перевёрнутая норма («-18…-20») приводится к порядку.
 */
export function quickValues(min: number | null | undefined, max: number | null | undefined): string[] {
  if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const mid = (lo + hi) / 2;
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  return Array.from(new Set([fmt(lo), fmt(mid), fmt(hi)]));
}

/**
 * Шаг «−»/«+» для числа. Пустое или нечитаемое поле первым касанием
 * «приземляется» в середину нормы (если норма есть, иначе 0) — не в −1,
 * чтобы от пустого морозильника не щёлкать двадцать раз. Дальше — ±шаг,
 * без обрезания по норме: реальное показание может быть вне неё.
 */
export function stepNumber(value: string, delta: number, min?: number | null, max?: number | null): string {
  const text = value.replace(",", ".").trim();
  const n = text === "" ? NaN : Number(text);
  if (!Number.isFinite(n)) {
    if (typeof min === "number" && typeof max === "number") return String(Math.round((Math.min(min, max) + Math.max(min, max)) / 2));
    return "0";
  }
  return String(Math.round((n + delta) * 10) / 10);
}

/** Шаг «−»/«+» для времени «ЧЧ:ММ» в минутах; пустое поле — от текущего времени. Сутки замкнуты. */
export function stepTime(value: string, deltaMinutes: number, now: Date = new Date()): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const base = m ? Number(m[1]) * 60 + Number(m[2]) : now.getHours() * 60 + now.getMinutes();
  const total = (((base + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** «20.09.2026 18:31» в часовом поясе организации — для подписи «показания за сегодня». */
export function stampFor(timezone: string, at: Date = new Date()): { date: string; time: string } {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(at)
        .map((part) => [part.type, part.value])
    );
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return { date: `${parts.day}.${parts.month}.${parts.year}`, time: `${hour}:${parts.minute}` };
  } catch {
    const iso = at.toISOString();
    return { date: `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`, time: iso.slice(11, 16) };
  }
}
