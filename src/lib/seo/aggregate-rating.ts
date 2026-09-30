/**
 * AggregateRating и Review для JSON-LD из одобренных отзывов клиентов.
 * Google показывает звёзды только при честных данных: считаем лишь отзывы с
 * оценкой и не раньше, чем их наберётся три.
 */
export const MIN_RATED_REVIEWS = 3;

export type RatedReview = {
  author: string;
  place?: string | null;
  quote: string;
  rating: number | null;
  /** Анонимный: оценка идёт в среднее, но в «Review» не попадает — у разметки автор-человек. */
  anonymous?: boolean;
};

export function buildAggregateRating(reviews: RatedReview[]): {
  aggregateRating: { "@type": "AggregateRating"; ratingValue: string; reviewCount: number; bestRating: number; worstRating: number };
  review: Array<{ "@type": "Review"; author: { "@type": "Person"; name: string }; reviewRating: { "@type": "Rating"; ratingValue: number; bestRating: number }; reviewBody: string }>;
} | null {
  const rated = reviews.filter((r): r is RatedReview & { rating: number } => typeof r.rating === "number" && r.rating >= 1 && r.rating <= 5);
  if (rated.length < MIN_RATED_REVIEWS) return null;
  const avg = rated.reduce((sum, r) => sum + r.rating, 0) / rated.length;
  return {
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: (Math.round(avg * 10) / 10).toFixed(1),
      reviewCount: rated.length,
      bestRating: 5,
      worstRating: 1,
    },
    review: rated
      .filter((r) => r.anonymous !== true)
      .slice(0, 5)
      .map((r) => ({
        "@type": "Review",
        author: { "@type": "Person", name: r.author },
        reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
        reviewBody: r.quote.length > 300 ? `${r.quote.slice(0, 297)}…` : r.quote,
      })),
  };
}
