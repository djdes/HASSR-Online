import assert from "node:assert/strict";
import test from "node:test";

import { reviewRewardFor } from "@/lib/balance/constants";
import {
  ANONYMOUS_REVIEW_AUTHOR,
  buildReviewSubmission,
  publicReviewSignature,
  reviewPrefill,
  reviewSphereLabel,
  sameName,
} from "@/lib/balance/review-rules";

/**
 * Форма отзыва: предзаполнение без дублей (правка владельца: «тут 2 поля
 * одинаковых» — оба поля были «Алексей Партнёрская программа») и
 * анонимный отзыв, сумму которого считает только сервер.
 */

test("организация названа как человек — заведение не предзаполняем (кейс со скрина)", () => {
  assert.deepEqual(
    reviewPrefill({
      userName: "Алексей Партнёрская программа",
      organizationName: "Алексей Партнёрская программа",
      city: null,
    }),
    { authorName: "Алексей Партнёрская программа", place: "" },
  );
});

test("организация названа как человек, город известен — в поле заведения только город", () => {
  assert.deepEqual(
    reviewPrefill({
      userName: "Алексей Партнёрская программа",
      organizationName: "Алексей Партнёрская программа",
      city: "Казань",
    }),
    { authorName: "Алексей Партнёрская программа", place: "Казань" },
  );
});

test("обычный случай: имя человека и «заведение, город»", () => {
  assert.deepEqual(
    reviewPrefill({ userName: "Анна Петрова", organizationName: "Кафе «Ромашка»", city: "Казань" }),
    { authorName: "Анна Петрова", place: "Кафе «Ромашка», Казань" },
  );
  assert.deepEqual(
    reviewPrefill({ userName: "Анна Петрова", organizationName: "Кафе «Ромашка»", city: null }),
    { authorName: "Анна Петрова", place: "Кафе «Ромашка»" },
  );
});

test("после мгновенной регистрации имя — почта, организация — «Моя организация»: не подставляем", () => {
  assert.deepEqual(
    reviewPrefill({ userName: "owner@example.com", organizationName: "Моя организация", city: null }),
    { authorName: "", place: "" },
  );
  assert.deepEqual(
    reviewPrefill({ userName: "owner@example.com", organizationName: "Организация owner@example.com", city: "Москва" }),
    { authorName: "", place: "Москва" },
  );
});

test("совпадение не зависит от регистра, кавычек, пробелов, «ё» и ООО/ИП", () => {
  assert.equal(sameName("алексей  петров", "«Алексей Петров»"), true);
  assert.equal(sameName("Иван Петров", "ИП Иван Петров"), true);
  assert.equal(sameName("Ромашка", "ООО «Ромашка»"), true);
  assert.equal(sameName("Пётр Сидоров", "Петр Сидоров"), true);
  assert.equal(sameName("Иван Петров", "Кафе «Иван»"), false);
  assert.equal(sameName("", ""), false);
  assert.deepEqual(
    reviewPrefill({ userName: "Иван Петров", organizationName: "ИП Иван Петров", city: "Тверь" }),
    { authorName: "Иван Петров", place: "Тверь" },
  );
});

test("город уже есть в названии заведения — второй раз не дописываем", () => {
  assert.deepEqual(
    reviewPrefill({ userName: "Анна", organizationName: "Столовая Казань", city: "Казань" }),
    { authorName: "Анна", place: "Столовая Казань" },
  );
});

test("анонимный отзыв на сайте — без имени и заведения, со сферой, если она известна", () => {
  assert.deepEqual(
    publicReviewSignature({ anonymous: true, authorName: "", place: "", sphere: "Кафе / Кофейня" }),
    { author: ANONYMOUS_REVIEW_AUTHOR, place: "Кафе / Кофейня" },
  );
  assert.deepEqual(
    publicReviewSignature({ anonymous: true, authorName: "Утечка", place: "Кафе Утечка", sphere: null }),
    { author: "Анонимный отзыв", place: "" },
  );
  assert.deepEqual(
    publicReviewSignature({ anonymous: false, authorName: "Анна", place: "Кафе, Казань", sphere: "Кафе / Кофейня" }),
    { author: "Анна", place: "Кафе, Казань" },
  );
});

test("сфера для подписи: «Другое» и пусто не показываем, старые значения переводим", () => {
  assert.equal(reviewSphereLabel("cafe"), "Кафе / Кофейня");
  assert.equal(reviewSphereLabel("school"), "Школа / Детсад / Лагерь");
  assert.equal(reviewSphereLabel("other"), null);
  assert.equal(reviewSphereLabel("что-то непонятное"), null);
  assert.equal(reviewSphereLabel(null), null);
});

const TEXT = "Перешли на электронные журналы — проверка прошла за полчаса, всё нашли сразу.";

test("анонимный отзыв: имя и заведение не нужны и не сохраняются, даже если прислали", () => {
  const result = buildReviewSubmission({
    text: TEXT,
    authorName: "Анна Петрова",
    place: "Кафе «Ромашка», Казань",
    anonymous: true,
    consentPublic: true,
    rating: 5,
    attachmentMime: null,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.anonymous, true);
  assert.equal(result.value.authorName, "");
  assert.equal(result.value.place, "");
  assert.equal(result.value.kind, "text");
});

test("сервер игнорирует присланную сумму и вид: считает по вложению и флагу", () => {
  const body = {
    text: TEXT,
    anonymous: true,
    consentPublic: true,
    rating: 5,
    attachmentMime: "image/jpeg",
    // Подделка клиента: такие поля в отзыв не попадают.
    rewardRub: 1990,
    kind: "video",
  } as Parameters<typeof buildReviewSubmission>[0];
  const result = buildReviewSubmission(body);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.kind, "photo");
  assert.equal("rewardRub" in result.value, false);
  // Начисление при одобрении — из вида и флага в БД.
  assert.equal(reviewRewardFor(result.value.kind, result.value.anonymous), 600);
});

test("обычный отзыв без имени или заведения не принимается", () => {
  const noName = buildReviewSubmission({
    text: TEXT,
    authorName: " ",
    place: "Кафе, Казань",
    anonymous: false,
    consentPublic: true,
    rating: null,
    attachmentMime: null,
  });
  assert.deepEqual(noName, { ok: false, error: "Укажите, как вас подписать" });
  const noPlace = buildReviewSubmission({
    text: TEXT,
    authorName: "Анна",
    place: "",
    anonymous: false,
    consentPublic: true,
    rating: null,
    attachmentMime: null,
  });
  assert.deepEqual(noPlace, { ok: false, error: "Укажите заведение и город" });
});

test("без согласия на публикацию и с коротким текстом — отказ; неизвестный файл — отказ", () => {
  const base = {
    text: TEXT,
    authorName: "Анна",
    place: "Кафе",
    anonymous: false,
    rating: null,
    attachmentMime: null,
  };
  assert.equal(buildReviewSubmission({ ...base, consentPublic: false }).ok, false);
  assert.equal(buildReviewSubmission({ ...base, consentPublic: true, text: "коротко" }).ok, false);
  assert.equal(
    buildReviewSubmission({ ...base, consentPublic: true, attachmentMime: "application/pdf" }).ok,
    false,
  );
});

test("оценка вне 1–5 не сохраняется, дробная округляется", () => {
  const base = {
    text: TEXT,
    authorName: "Анна",
    place: "Кафе",
    anonymous: false,
    consentPublic: true,
    attachmentMime: null,
  };
  const outOfRange = buildReviewSubmission({ ...base, rating: 9 });
  assert.equal(outOfRange.ok && outOfRange.value.rating, null);
  const fractional = buildReviewSubmission({ ...base, rating: 4.6 });
  assert.equal(fractional.ok && fractional.value.rating, 5);
});
