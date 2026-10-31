/**
 * Сообщения админу в Telegram о «горячих» событиях: человек заполнил анкету
 * с телефоном (можно звонить сразу, пока он в кабинете) и поставил низкую
 * оценку (пора разбираться, пока не ушёл). Чистые функции: текст в HTML
 * Telegram, всё пользовательское экранирует `escape`.
 */

import type { NpsScale } from "@/lib/nps";

/** Низкая оценка: 1–3 по шкале 1–5, 0–6 по старой 0–10 (критики в NPS). */
export function isLowNpsScore(score: number, scale: NpsScale): boolean {
  return scale === 5 ? score <= 3 : score <= 6;
}

export function composeProfileCompletedAlert(args: {
  organizationName: string;
  sphereLabel: string;
  locationsCount: number;
  name: string;
  phone: string;
  email: string;
  escape: (value: string) => string;
}): string {
  const points = Math.max(1, Math.floor(args.locationsCount || 1));
  return [
    "📋 Анкета заполнена — можно звонить",
    `Организация: ${args.escape(args.organizationName)}`,
    `Сфера: ${args.escape(args.sphereLabel)}, точек: ${points}`,
    `Контакт: ${args.escape(args.name)}, ${args.escape(args.phone)}`,
    `Почта: ${args.escape(args.email)}`,
  ].join("\n");
}

export function composeLowNpsAlert(args: {
  organizationName: string;
  userName: string;
  score: number;
  scale: NpsScale;
  comment: string | null;
  /** Комментарий дописан позже к уже поставленной низкой оценке. */
  followUp?: boolean;
  escape: (value: string) => string;
}): string {
  const max = args.scale === 5 ? 5 : 10;
  const comment = args.comment?.trim();
  return [
    args.followUp ? "💬 Комментарий к низкой оценке" : "⚠️ Низкая оценка WeSetup",
    `Оценка: ${args.score} из ${max}`,
    `Организация: ${args.escape(args.organizationName)}`,
    `Кто: ${args.escape(args.userName)}`,
    comment ? `Комментарий: ${args.escape(comment)}` : "Комментария нет — стоит позвонить и спросить",
  ].join("\n");
}
