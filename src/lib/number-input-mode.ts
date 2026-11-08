/**
 * Какую клавиатуру телефона звать для поля `type="number"` (атрибут
 * `inputMode`).
 *
 * На iPhone поле `type="number"` без `inputMode` открывает обычную
 * клавиатуру на странице цифр; `inputMode="decimal"` — цифровую с
 * разделителем, `numeric` — только цифры. Но у цифровых клавиатур iOS НЕТ
 * минуса: поле, где допустимо отрицательное (температура морозильника),
 * должно остаться без `inputMode`.
 *
 *  - нет `min` или `min < 0` → `undefined` (минус нужен — не трогаем);
 *  - шаг — положительное целое (`step={1}`, `step={50}`) → `numeric`;
 *  - иначе → `decimal`: без явного целого шага значение может быть дробным
 *    («0,5 кг»), а цифровая клавиатура без разделителя его не наберёт.
 */
export function numberInputMode({
  min,
  step,
}: {
  min?: number | string | null;
  step?: number | string | null;
}): "numeric" | "decimal" | undefined {
  if (min === undefined || min === null || min === "") return undefined;
  const minValue = Number(min);
  if (!Number.isFinite(minValue) || minValue < 0) return undefined;
  if (step === undefined || step === null || step === "" || step === "any") return "decimal";
  const stepValue = Number(step);
  return Number.isInteger(stepValue) && stepValue > 0 && Number.isInteger(minValue) ? "numeric" : "decimal";
}
