import { Star } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { listReviewsForModeration } from "@/lib/balance/reviews";
import { reviewIdsFromNps } from "@/lib/nps-review";
import { ReviewsClient } from "./reviews-client";

export const dynamic = "force-dynamic";

/**
 * ROOT → «Отзывы»: модерация отзывов, за которые начисляются баллы.
 *
 * Три вкладки — на проверке, одобренные, отклонённые. Начисление
 * происходит в момент одобрения, поэтому именно здесь платформа решает,
 * сколько заплатить, и может понизить тариф. Отзывы, оставленные из
 * опроса «Посоветуете WeSetup коллегам?», помечены «из опроса».
 */
export default async function RootReviewsPage() {
  await requireRoot();

  const [pending, approved, rejected] = await Promise.all([
    listReviewsForModeration("pending"),
    listReviewsForModeration("approved"),
    listReviewsForModeration("rejected"),
  ]);
  const organizationIds = Array.from(
    new Set([...pending, ...approved, ...rejected].map((review) => review.organizationId)),
  );
  const fromSurvey = await reviewIdsFromNps(organizationIds).catch(() => new Set<string>());

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Star className="size-5" />
        </span>
        <div>
          <h1 className="text-[clamp(1.625rem,1.5vw+1.2rem,2rem)] font-semibold tracking-[-0.02em] text-[#0b1024]">
            Отзывы
          </h1>
          <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
            Одобрение начисляет баллы на баланс организации: текст — 300 ₽,
            фото — 750 ₽, видео — 1990 ₽; анонимный отзыв — на 20 % меньше
            (240, 600, 1592 ₽). Тариф можно понизить, если вложение
            формальное. Отклонение уходит автору с причиной.
          </p>
        </div>
      </div>

      <ReviewsClient
        pending={pending}
        approved={approved}
        rejected={rejected}
        fromSurveyIds={Array.from(fromSurvey)}
      />
    </div>
  );
}
