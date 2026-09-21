/**
 * Единицы измерения партий и потерь.
 *
 * В базе они лежат латиницей («kg», «l», «pcs») — так их записали формы
 * создания. На экране это читалось как «12 kg», хотя в самой форме выбор
 * подписан по-русски. Здесь только ПОКАЗ: значения в базе не трогаем,
 * незнакомый код выводим как есть.
 */
const UNIT_LABELS: Record<string, string> = {
  kg: "кг",
  g: "г",
  l: "л",
  ml: "мл",
  pcs: "шт",
  pc: "шт",
  bottle: "фл",
  pack: "уп",
};

export function formatMeasureUnit(unit: string | null | undefined): string {
  const key = (unit ?? "").trim();
  if (key === "") return "";
  return UNIT_LABELS[key.toLowerCase()] ?? key;
}
