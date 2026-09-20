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
