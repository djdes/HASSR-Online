/**
 * Первое предложение длинного пояснения и остальное — для «Подробнее»
 * (`components/ui/more-text.tsx`). Граница — точка, «!» или «?» перед
 * пробелом и заглавной буквой: сокращения вроде «ст. 6.6», «п. 44»,
 * «№ 1–5» предложение не рвут (после них цифра).
 */
export function splitFirstSentence(text: string): { first: string; rest: string } {
  const value = String(text ?? "");
  const match = /[.!?…](?=\s+["«(]?[A-ZА-ЯЁ])/u.exec(value);
  if (!match) return { first: value, rest: "" };
  const cut = match.index + match[0].length;
  return { first: value.slice(0, cut), rest: value.slice(cut).trim() };
}
