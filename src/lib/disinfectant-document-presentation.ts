import {
  formatQuantityWithUnit,
  sumDisinfectantQuantities,
  MEASURE_UNIT_LABELS,
  type MeasureUnit,
} from "@/lib/disinfectant-document";

/** The caller supplies only the three labels from its current message provider. */
export type DisinfectantUnitLabels = Readonly<Record<MeasureUnit, string>>;

/** Keep the business formatter's precision and zero rules; replace only its unit. */
export function disinfectantQuantity(quantity: number, unit: MeasureUnit, labels: DisinfectantUnitLabels): string {
  const original = formatQuantityWithUnit(quantity, unit);
  return original ? original.slice(0, -MEASURE_UNIT_LABELS[unit].length) + labels[unit] : original;
}

/** The original business aggregate still owns per-unit order, filtering and arithmetic. */
export function disinfectantQuantityTotal(rows: Array<{ quantity: number; unit: MeasureUnit }>, labels: DisinfectantUnitLabels): string {
  return sumDisinfectantQuantities(rows).replace(/ (кг\.|л\.|фл\.)(?= · |$)/g,
    (_, unit: string) => " " + labels[unit === MEASURE_UNIT_LABELS.kg ? "kg" : unit === MEASURE_UNIT_LABELS.l ? "l" : "bottle"]);
}

export type DisinfectantDisplayTitle = {
  raw: string;
  standardFallback: boolean;
};

/**
 * Call at the original template-interpolation point, before awaiting transport.
 * The explicit fallback flag comes from the original truthy branch, never from
 * comparing user text with a Russian title. Template coercion preserves the
 * original hint, thrown values and Symbol failure behavior.
 */
export function captureDisinfectantTitle(value: unknown, standardFallback: boolean): DisinfectantDisplayTitle {
  return { raw: `${value}`, standardFallback };
}
