const NBSP = String.fromCharCode(0xa0);

/**
 * Российский номер для документов: «+74951096543» → «+7 (495) 109-65-43»
 * (неразрывно). Не российский или неполный — как есть.
 */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const ru = digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")) ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (!ru) return value.trim();
  return `+7${NBSP}(${ru.slice(0, 3)})${NBSP}${ru.slice(3, 6)}-${ru.slice(6, 8)}-${ru.slice(8, 10)}`;
}
