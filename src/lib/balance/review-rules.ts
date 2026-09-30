import { DEFAULT_ORG_NAME, normalizeSphere, sphereLabel } from "@/lib/org-profile";

import {
  REVIEW_TEXT_MAX_LENGTH,
  REVIEW_TEXT_MIN_LENGTH,
  reviewKindFromMime,
  type ReviewKind,
} from "./constants";

/**
 * Правила формы отзыва и его публикации — чистые функции без БД.
 * Client-safe: их импортируют и сервер (сборщик раздела, лендинг), и
 * форма в кабинете.
 */

/** Подпись анонимного отзыва на сайте, в соцсетях и у ROOT. */
export const ANONYMOUS_REVIEW_AUTHOR = "Анонимный отзыв";

const QUOTES = /[«»"'“”„`]/g;
/** Организационно-правовые формы в начале названия — «ИП Иван Петров» и «Иван Петров» одно и то же. */
const LEGAL_FORM = /^(?:ооо|оао|зао|пао|ао|ип|нко|ано|чоу)\s+/;

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function comparable(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(QUOTES, "")
    .replace(/[.,;:!?()[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEGAL_FORM, "")
    .trim();
}

/** Имя и название совпадают с точностью до регистра, кавычек, пробелов и «ООО/ИП». */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = comparable(a ?? "");
  const right = comparable(b ?? "");
  return left.length > 0 && left === right;
}

/**
 * Имя, которое можно поставить подписью. После мгновенной регистрации
 * имя пользователя — его почта: подписывать отзыв почтой нельзя.
 */
function signatureName(value: string | null | undefined): string {
  const text = cleanText(value);
  if (!text || text.includes("@")) return "";
  return text.slice(0, 120);
}

/**
 * Название заведения, если оно настоящее. «Моя организация» (мгновенная
 * регистрация) и «Организация <почта>» (оплата без регистрации) —
 * технические заглушки, их не предзаполняем.
 */
function venueName(value: string | null | undefined): string {
  const text = cleanText(value);
  if (!text || text.includes("@")) return "";
  if (comparable(text) === comparable(DEFAULT_ORG_NAME)) return "";
  return text;
}

/**
 * Предзаполнение формы отзыва без дублей.
 *
 * «Как вас подписать» — имя пользователя. «Заведение и город» — название
 * организации и город, если они есть. Если организация названа так же,
 * как человек (частый случай: заведение заводили «на себя»), заведение не
 * подставляем — иначе два поля показывают одно и то же.
 */
export function reviewPrefill(input: {
  userName: string | null | undefined;
  organizationName: string | null | undefined;
  city: string | null | undefined;
}): { authorName: string; place: string } {
  const authorName = signatureName(input.userName);
  const organization = venueName(input.organizationName);
  const venue = organization && !sameName(organization, authorName) ? organization : "";
  const city = cleanText(input.city);
  const cityAlreadyInVenue =
    venue.length > 0 && city.length > 0 && comparable(venue).includes(comparable(city));
  const place = [venue, cityAlreadyInVenue ? "" : city].filter(Boolean).join(", ").slice(0, 160);
  return { authorName, place };
}

/** Сфера организации для подписи анонимного отзыва; «Другое» ничего не говорит — не показываем. */
export function reviewSphereLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return normalizeSphere(type) === "other" ? null : sphereLabel(type);
}

export type ReviewSubmissionInput = {
  text: string;
  authorName?: string | null;
  place?: string | null;
  anonymous?: boolean | null;
  consentPublic: boolean;
  rating?: number | null;
  /** MIME подписанного вложения; null — отзыв без вложения. */
  attachmentMime: string | null;
};

export type ReviewSubmission = {
  text: string;
  authorName: string;
  place: string;
  anonymous: boolean;
  kind: ReviewKind;
  rating: number | null;
  consentPublic: true;
};

/**
 * Что сохраняем из формы отзыва. Суммы здесь нет и быть не может: её
 * считает одобрение по виду вложения и флагу `anonymous` из БД. Вид
 * тоже не берём у клиента — только по MIME подписанного вложения.
 * У анонимного отзыва имя и заведение не сохраняются, даже если их
 * прислали: человек выбрал анонимность.
 */
export function buildReviewSubmission(
  input: ReviewSubmissionInput,
): { ok: true; value: ReviewSubmission } | { ok: false; error: string } {
  const text = (input.text ?? "").trim();
  if (text.length < REVIEW_TEXT_MIN_LENGTH) {
    return { ok: false, error: `Напишите хотя бы пару предложений — от ${REVIEW_TEXT_MIN_LENGTH} символов` };
  }
  if (text.length > REVIEW_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Не больше ${REVIEW_TEXT_MAX_LENGTH} символов` };
  }
  if (input.consentPublic !== true) {
    return { ok: false, error: "Без согласия на публикацию отзыв опубликовать нельзя" };
  }
  const anonymous = input.anonymous === true;
  const authorName = anonymous ? "" : cleanText(input.authorName).slice(0, 120);
  const place = anonymous ? "" : cleanText(input.place).slice(0, 160);
  if (!anonymous && authorName.length < 2) return { ok: false, error: "Укажите, как вас подписать" };
  if (!anonymous && place.length < 2) return { ok: false, error: "Укажите заведение и город" };

  const kind = reviewKindFromMime(input.attachmentMime);
  if (!kind) {
    return {
      ok: false,
      error: "Такой файл не подойдёт. Фото — JPG, PNG, WEBP или GIF, видео — MP4 или MOV",
    };
  }
  const rating =
    typeof input.rating === "number" && Number.isFinite(input.rating) && input.rating >= 1 && input.rating <= 5
      ? Math.round(input.rating)
      : null;
  return {
    ok: true,
    value: { text, authorName, place, anonymous, kind, rating, consentPublic: true },
  };
}

/** Как подписан отзыв на сайте: анонимный — без имени и заведения, только сфера. */
export function publicReviewSignature(review: {
  anonymous: boolean;
  authorName: string;
  place: string;
  sphere: string | null;
}): { author: string; place: string } {
  if (review.anonymous) {
    return { author: ANONYMOUS_REVIEW_AUTHOR, place: review.sphere ?? "" };
  }
  return { author: review.authorName, place: review.place };
}
