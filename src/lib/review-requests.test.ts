import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { REVIEW_REWARD_RUB, reviewRewardFor } from "@/lib/balance/constants";
import {
  REVIEW_REQUEST_LIMIT,
  composeReviewRequestEmail,
  pickReviewCandidates,
  type ReviewCandidateInput,
} from "@/lib/review-requests";
import { hasReviewStats, monthsWithWeSetup, roundRecords } from "@/lib/review-stats";

/**
 * Отзывы с цифрами (`.agent/tasks/growth-stage4-2026-11/spec.md`, AC3):
 * кого попросить, письмо, цифры по согласию автора.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const now = new Date("2026-11-07T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const nbsp = (value: string) => value.replace(/[  ]/g, " ");

function org(id: string, overrides: Partial<ReviewCandidateInput> = {}): ReviewCandidateInput {
  return {
    organizationId: id,
    name: `Кафе ${id}`,
    createdAt: daysAgo(60),
    records30: 120,
    lastNps: null,
    hasActiveReview: false,
    lastRequestedAt: null,
    manager: { name: "Анна", email: `${id}@example.test` },
    ...overrides,
  };
}

describe("кого попросить об отзыве", () => {
  it("отбор: старше 21 дня, от 30 записей за 30 дней, без отзыва, не просили 30 дней, есть почта", () => {
    const picked = pickReviewCandidates(
      [
        org("young", { createdAt: daysAgo(10) }),
        org("quiet", { records30: 29 }),
        org("reviewed", { hasActiveReview: true }),
        org("asked", { lastRequestedAt: daysAgo(10) }),
        org("asked-long-ago", { lastRequestedAt: daysAgo(40) }),
        org("no-manager", { manager: null }),
        org("no-email", { manager: { name: "Иван", email: " " } }),
        org("ok"),
      ],
      now,
    );
    assert.deepEqual(picked.map((row) => row.organizationId).sort(), ["asked-long-ago", "ok"]);
  });

  it("порядок: сначала 4–5 в опросе (и 9–10 по старой шкале), затем по числу записей; не больше 20", () => {
    const picked = pickReviewCandidates(
      [
        org("busy", { records30: 900 }),
        org("happy", { records30: 60, lastNps: { score: 5, scale: 5 } }),
        org("old-scale", { records30: 50, lastNps: { score: 9, scale: 10 } }),
        org("neutral", { records30: 400, lastNps: { score: 3, scale: 5 } }),
      ],
      now,
    );
    assert.deepEqual(picked.map((row) => row.organizationId), ["happy", "old-scale", "busy", "neutral"]);
    assert.equal(picked[0].promoter, true);
    assert.equal(picked[3].promoter, false);
    const many = pickReviewCandidates(Array.from({ length: 30 }, (_, index) => org(`o${index}`)), now);
    assert.equal(many.length, REVIEW_REQUEST_LIMIT);
  });

  it("письмо: ссылка на форму, суммы из правил начисления, без имени — меньше, всё экранировано", () => {
    const mail = composeReviewRequestEmail({ managerName: "Анна <b>", organizationName: "Кафе «Ромашка» & Co", records30: 1234, appUrl: "https://wesetup.ru" });
    const html = nbsp(mail.html);
    assert.equal(mail.subject, "Расскажете коллегам о WeSetup?");
    assert.match(html, /href="https:\/\/wesetup\.ru\/settings\/balance#review"/);
    // Якорь формы на странице «Баланс и бонусы».
    assert.match(read("src/components/balance/balance-client.tsx"), /<div id="review" className="scroll-mt-24">/);
    assert.match(html, /Здравствуйте, Анна &lt;b&gt;!/);
    assert.match(html, /«Кафе «Ромашка» &amp; Co» сделано 1 234 записей/);
    for (const kind of ["text", "photo", "video"] as const) {
      const full = new Intl.NumberFormat("ru-RU").format(REVIEW_REWARD_RUB[kind]).replace(/[  ]/g, " ");
      const anonymous = new Intl.NumberFormat("ru-RU").format(reviewRewardFor(kind, true)).replace(/[  ]/g, " ");
      assert.ok(html.includes(`${full} ₽`), `${kind}: ${full}`);
      assert.ok(html.includes(`${anonymous} ₽`), `${kind} анонимно: ${anonymous}`);
    }
  });

  it("сервер: письмо не тем, кто отписался; отметка в журнале платформы только после отправки; ROOT-маршрут", () => {
    const server = read("src/lib/review-requests.server.ts");
    assert.match(server, /db\.emailSuppression\.findUnique\(\{ where: \{ email \}/);
    assert.ok(server.indexOf("await sendRawEmail(") < server.indexOf("await db.auditLog.create("));
    assert.match(server, /if \(!sent\) throw new ReviewRequestError/);
    assert.match(server, /organizationId: platformOrgId\(\),[\s\S]*action: REVIEW_REQUEST_ACTION,[\s\S]*entity: "Organization"/);
    const route = read("src/app/api/root/reviews/request/route.ts");
    assert.match(route, /const session = await requireRoot\(\);/);
    assert.match(read("src/lib/platform-access.ts"), /\{ pattern: "\/api\/root\/reviews", gate: "support" \}/);
    assert.match(read("src/app/root/reviews/page.tsx"), /<ReviewRequestCandidates candidates=\{candidates\} \/>/);
  });
});

describe("цифры рядом с отзывом", () => {
  it("записи без ложной точности; месяцы в WeSetup; без записей — не показываем", () => {
    assert.deepEqual(roundRecords(87), { value: 87, plus: false });
    assert.deepEqual(roundRecords(437), { value: 430, plus: true });
    assert.deepEqual(roundRecords(4312), { value: 4300, plus: true });
    assert.deepEqual(roundRecords(4300), { value: 4300, plus: false });
    assert.equal(monthsWithWeSetup("2026-03-15T00:00:00Z", now), 7);
    assert.equal(monthsWithWeSetup("2026-11-01T00:00:00Z", now), 0);
    assert.equal(monthsWithWeSetup("2027-01-01T00:00:00Z", now), 0);
    assert.equal(hasReviewStats({ journals: 0, records: 0, since: "2026-01-01T00:00:00Z" }), false);
    assert.equal(hasReviewStats({ journals: 3, records: 10, since: "2026-01-01T00:00:00Z" }), true);
  });

  it("только по согласию автора: колонка по умолчанию false, обе формы и оба API, витрина и /pricing", () => {
    assert.match(read("prisma/schema.prisma"), /showStats\s+Boolean\s+@default\(false\)/);
    assert.match(read("src/app/api/balance/reviews/route.ts"), /showStats: parsed\.showStats === true,/);
    assert.match(read("src/lib/nps-review.ts"), /showStats: body\.showStats === true,/);
    assert.match(read("src/lib/balance/reviews.ts"), /showStats: input\.showStats === true,/);
    assert.match(read("src/lib/balance/reviews.ts"), /stats: row\.showStats && hasReviewStats\(/);
    const form = read("src/components/balance/balance-client.tsx");
    assert.match(form, /const \[showStats, setShowStats\] = useState\(false\);/);
    assert.match(form, /data-testid="review-show-stats"/);
    assert.match(read("src/components/layout/nps-banner.tsx"), /\{ responseId: id, text, consent, showStats \}/);
    const card = read("src/components/landing/testimonials.tsx");
    assert.match(card, /\{review\.stats \? <ReviewStatsLine stats=\{review\.stats\} locale=\{locale\} \/> : null\}/);
    assert.match(read("src/app/pricing/page.tsx"), /<Testimonials reviews=\{publicReviews\} locale="ru" sectionClassName="" \/>/);
    // Пустые автосозданные строки журналов — не записи.
    assert.match(read("src/lib/review-stats.server.ts"), /\.\.\.NOT_AUTO_SEEDED/);
  });
});
