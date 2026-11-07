import { REVIEW_REWARD_RUB, reviewRewardFor } from "@/lib/balance/constants";
import { escapeHtml } from "@/lib/html-escape";
import { npsCategory, normalizeNpsScale } from "@/lib/nps";

/**
 * «Кого попросить об отзыве» в ROOT → «Отзывы» (2026-11-07). Отзывов на
 * сайте нет, пока их не оставят настоящие клиенты; эта выборка подсказывает,
 * кого спросить первым, а кнопка шлёт руководителю письмо со ссылкой на
 * форму отзыва («Баланс и бонусы»). Чистая часть — отбор, порядок и текст
 * письма; база и отправка — `review-requests.server.ts`.
 */

export const REVIEW_REQUEST_ACTION = "review.requested";
/** В WeSetup не меньше трёх недель — есть о чём рассказать. */
export const REVIEW_REQUEST_MIN_AGE_DAYS = 21;
/** Записей за последние 30 дней — журналы реально ведут. */
export const REVIEW_REQUEST_MIN_RECORDS = 30;
/** Повторно просить не раньше чем через 30 дней. */
export const REVIEW_REQUEST_COOLDOWN_DAYS = 30;
export const REVIEW_REQUEST_LIMIT = 20;

const DAY_MS = 86_400_000;

export type ReviewCandidateInput = {
  organizationId: string;
  name: string;
  createdAt: Date;
  /** Записей за последние 30 дней. */
  records30: number;
  /** Последний ответ на опрос «Посоветуете WeSetup коллегам?». */
  lastNps: { score: number; scale: number } | null;
  /** Есть отзыв на проверке или одобренный. */
  hasActiveReview: boolean;
  lastRequestedAt: Date | null;
  manager: { name: string; email: string } | null;
};

export type ReviewCandidate = {
  organizationId: string;
  name: string;
  createdAt: string;
  records30: number;
  lastNps: { score: number; scale: number } | null;
  promoter: boolean;
  manager: { name: string; email: string };
};

/**
 * Кого показать: старше 21 дня, от 30 записей за 30 дней, без отзыва на
 * проверке или одобренного, не просили 30 дней, есть руководитель с почтой.
 * Порядок: сначала поставившие 4–5 в опросе, затем по числу записей.
 */
export function pickReviewCandidates(rows: readonly ReviewCandidateInput[], now: Date): ReviewCandidate[] {
  const minCreatedAt = now.getTime() - REVIEW_REQUEST_MIN_AGE_DAYS * DAY_MS;
  const cooldownFrom = now.getTime() - REVIEW_REQUEST_COOLDOWN_DAYS * DAY_MS;
  return rows
    .filter(
      (row) =>
        row.createdAt.getTime() <= minCreatedAt &&
        row.records30 >= REVIEW_REQUEST_MIN_RECORDS &&
        !row.hasActiveReview &&
        (!row.lastRequestedAt || row.lastRequestedAt.getTime() < cooldownFrom) &&
        row.manager !== null &&
        row.manager.email.trim() !== "",
    )
    .map((row) => ({
      organizationId: row.organizationId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      records30: row.records30,
      lastNps: row.lastNps,
      promoter: isHappy(row.lastNps),
      manager: row.manager!,
    }))
    .sort((a, b) => Number(b.promoter) - Number(a.promoter) || b.records30 - a.records30)
    .slice(0, REVIEW_REQUEST_LIMIT);
}

/** Оценка 4–5 по шкале 1–5 (или 9–10 по старой 0–10) — довольный клиент. */
function isHappy(nps: { score: number; scale: number } | null): boolean {
  if (!nps) return false;
  const scale = normalizeNpsScale(nps.scale);
  return scale === 5 ? nps.score >= 4 : npsCategory(nps.score, scale) === "promoter";
}

function rub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

/**
 * Письмо руководителю: спасибо, просьба рассказать коллегам, суммы баллов
 * из тех же констант, что начисляет одобрение, ссылка на форму. Без давления
 * и без обещаний, которых нет в правилах.
 */
export function composeReviewRequestEmail(input: {
  managerName: string;
  organizationName: string;
  records30: number;
  appUrl: string;
}): { subject: string; title: string; html: string } {
  const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
  const NOTE = 'style="margin:16px 0 0;color:#6f7282;line-height:1.6;font-size:13px"';
  const BUTTON =
    'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';
  const name = input.managerName.trim();
  const greeting = name ? `Здравствуйте, ${escapeHtml(name)}!` : "Здравствуйте!";
  // Форма отзыва — «Баланс и бонусы» (/settings/balance); /bonuses — премии сотрудникам.
  const reviewUrl = `${input.appUrl}/settings/balance#review`;
  return {
    subject: "Расскажете коллегам о WeSetup?",
    title: "Расскажете коллегам о WeSetup?",
    html:
      `<p ${P}>${greeting} За последние 30 дней в «${escapeHtml(input.organizationName)}» сделано ${new Intl.NumberFormat("ru-RU").format(input.records30)} записей в журналах WeSetup — спасибо, что работаете с нами.</p>` +
      `<p ${P}>Если сервис вам помогает, расскажите об этом коллегам: пара предложений о том, что стало проще. Отзыв появится на wesetup.ru после проверки, а мы начислим на баланс ${rub(REVIEW_REWARD_RUB.text)} за текст, ${rub(REVIEW_REWARD_RUB.photo)} — с фото, ${rub(REVIEW_REWARD_RUB.video)} — с видео. Баланс идёт в оплату подписки.</p>` +
      `<a href="${reviewUrl}" ${BUTTON}>Оставить отзыв</a>` +
      `<p ${NOTE}>Можно без имени и названия заведения — тогда начислим ${rub(reviewRewardFor("text", true))}, ${rub(reviewRewardFor("photo", true))} и ${rub(reviewRewardFor("video", true))}. Что-то мешает работать — просто ответьте на это письмо, разберёмся.</p>`,
  };
}
