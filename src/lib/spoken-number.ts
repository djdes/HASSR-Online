/**
 * Голосовой ввод чисел (температура, влажность): общее для Web Speech в
 * браузере и системного распознавания в приложении WeSetup.
 */

import { parseRussianNumber } from "@/lib/russian-number-parser";

/** Первый вариант распознавания, в котором нашлось число. */
export function pickSpokenNumber(
  alternatives: readonly string[] | null | undefined
): { transcript: string; number: number } | null {
  for (const transcript of alternatives ?? []) {
    const number = parseRussianNumber(transcript);
    if (number !== null) return { transcript, number };
  }
  return null;
}

/**
 * Понятная человеку ошибка по коду Web Speech (`not-allowed`, `no-speech`…)
 * или по тексту ошибки системного распознавания в приложении.
 */
export function speechErrorMessage(codeOrMessage: string | null | undefined): string {
  const code = (codeOrMessage ?? "").toLowerCase();
  if (/not-allowed|permission|denied|access/.test(code)) {
    return "Нужно разрешение на микрофон. Разрешите его в настройках телефона.";
  }
  if (/no-speech|no match|didn.t understand/.test(code)) return "Не слышно. Попробуйте ещё раз.";
  if (/audio-capture/.test(code)) return "Микрофон недоступен. Введите число вручную.";
  if (/network/.test(code)) return "Нет связи: распознавание недоступно. Введите число вручную.";
  return "Не удалось распознать. Попробуйте ещё раз или введите число вручную.";
}
