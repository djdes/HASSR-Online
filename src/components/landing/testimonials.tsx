import { Star } from "lucide-react";

import { LANDING_SECTION_CLASS, LandingSectionHeader } from "@/components/landing/landing-section";
import type { PublicReview } from "@/lib/balance/review-view";

/** Сколько отзывов показываем на главной: одна строка на десктопе. */
const SHOWN = 3;

/**
 * «Что говорят заведения» — настоящие отзывы: клиент пишет его в
 * кабинете, ROOT одобряет, за это начисляются баллы. Нет одобренных
 * отзывов — секции нет вовсе, выдуманные реплики не нужны.
 *
 * Раньше это была карусель во всю ширину экрана: соседние карточки
 * обрезались краем, и на телефоне блок выпадал из общей колонки.
 * Теперь — до трёх последних отзывов сеткой в той же колонке, что и
 * остальные секции (спека landing-pack-2026-09). Звёзды для выдачи
 * (AggregateRating) по-прежнему считаются по всем одобренным отзывам.
 */
export function Testimonials({ reviews }: { reviews: PublicReview[] }) {
  if (reviews.length === 0) return null;
  const shown = reviews.slice(0, SHOWN);

  return (
    <section className={LANDING_SECTION_CLASS}>
      <LandingSectionHeader title="Что говорят заведения" />
      {/* Колонок столько, сколько отзывов: два отзыва в сетке на три
          оставляли пустую треть ряда. */}
      <ul
        className={
          "grid gap-3 sm:gap-4 " +
          (shown.length >= 3 ? "lg:grid-cols-3" : shown.length === 2 ? "md:grid-cols-2" : "max-w-[720px]")
        }
      >
        {shown.map((review) => (
          <li key={review.id}>
            <TestimonialCard review={review} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TestimonialCard({ review }: { review: PublicReview }) {
  const initials = review.author
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <figure className="flex h-full flex-col rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
      {review.rating ? (
        <div className="flex gap-1 text-[#5566f6]" aria-label={`Оценка ${review.rating} из 5`}>
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              aria-hidden="true"
              className={i < (review.rating ?? 0) ? "size-[18px] fill-current" : "size-[18px] text-[#dcdfed]"}
            />
          ))}
        </div>
      ) : null}

      {/* Вложение до цитаты: фото кухни или короткое видео убеждает
          сильнее текста, ради него и платим больше. */}
      {review.mediaUrl && review.mediaKind === "photo" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={review.mediaUrl}
          alt=""
          loading="lazy"
          className="mt-4 max-h-[220px] w-full rounded-2xl object-cover"
        />
      ) : null}
      {review.mediaUrl && review.mediaKind === "video" ? (
        <video
          controls
          preload="metadata"
          src={review.mediaUrl}
          className="mt-4 max-h-[240px] w-full rounded-2xl bg-black"
        />
      ) : null}

      <blockquote className="mt-4 flex-1 text-[17px] leading-[1.55] text-[#0b1024]">
        {review.quote}
      </blockquote>

      <figcaption className="mt-5 flex items-center gap-3">
        {/* Монограмма — украшение: имя стоит рядом текстом. */}
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[14px] font-semibold text-[#3848c7] ring-1 ring-[#5566f6]/15"
        >
          {initials}
        </span>
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold text-[#0b1024]">{review.author}</span>
          <span className="block text-[16px] text-[#6f7282] sm:text-[14px]">{review.place}</span>
        </span>
      </figcaption>
    </figure>
  );
}
