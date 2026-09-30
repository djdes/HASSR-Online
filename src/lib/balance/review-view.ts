import type { ReviewKind } from "./constants";
import { publicReviewSignature } from "./review-rules";

/**
 * Client-safe часть отзывов: типы и чистые функции.
 *
 * Отдельный файл, потому что `reviews.ts` тянет prisma (и через него —
 * `pg` с node-модулями), а карточка модерации и карусель на лендинге —
 * клиентские компоненты. Импорт значения оттуда роняет сборку на
 * `Can't resolve 'tls'`.
 */
export type ReviewStatus = "pending" | "approved" | "rejected";

export type ReviewView = {
  id: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  authorName: string;
  place: string;
  text: string;
  kind: ReviewKind;
  mediaUrl: string | null;
  mediaMime: string | null;
  rating: number | null;
  consentPublic: boolean;
  /** Анонимный: на сайте без имени и заведения, начисление на 20 % меньше. */
  anonymous: boolean;
  /** Сфера организации для подписи анонимного отзыва; null — неизвестна. */
  organizationSphere: string | null;
  status: ReviewStatus;
  rewardRub: number;
  /** Сколько начислим, если одобрить как есть (с учётом анонимности). */
  suggestedRewardRub: number;
  rejectReason: string | null;
  showOnLanding: boolean;
  createdAt: string;
  moderatedAt: string | null;
};

export type PublicReview = {
  id: string;
  quote: string;
  author: string;
  place: string;
  rating: number | null;
  mediaUrl: string | null;
  mediaKind: "photo" | "video" | null;
  /** Анонимный — без имени и заведения, в разметке для поиска не участвует. */
  anonymous?: boolean;
};

/** Текст для соцсетей — кнопка «Скопировать» в модерации. */
export function reviewSocialText(review: ReviewView): string {
  const signature = publicReviewSignature({
    anonymous: review.anonymous,
    authorName: review.authorName,
    place: review.place,
    sphere: review.organizationSphere,
  });
  const lines = [
    `«${review.text}»`,
    "",
    `— ${[signature.author, signature.place].filter(Boolean).join(", ")}`,
  ];
  if (review.mediaUrl) lines.push("", review.mediaUrl);
  lines.push("", "wesetup.ru — электронные журналы СанПиН и ХАССП");
  return lines.join("\n");
}
