import assert from "node:assert/strict";
import test from "node:test";

import {
  ANONYMOUS_REVIEW_FACTOR,
  REFERRAL_COOKIE,
  TOPUP_MAX_RUB,
  TOPUP_MIN_RUB,
  TOPUP_PRESETS_RUB,
  anonymousRewardRub,
  formatPoints,
  parseTopupAmount,
  pointsToSpend,
  readCookie,
  referralRewardFor,
  reviewKindFromMime,
  reviewRewardFor,
  transactionKindLabel,
} from "@/lib/balance/constants";

test("списание баллов ограничено ценой тарифа, а не суммой заказа", () => {
  // Заказ «подписка 1990 + железо 12000», на балансе 5000: списать можно
  // только подписочную часть — железо это физический товар.
  assert.equal(
    pointsToSpend({ balanceRub: 5000, subscriptionRub: 1990, usePoints: true }),
    1990,
  );
});

test("списание баллов ограничено балансом", () => {
  assert.equal(
    pointsToSpend({ balanceRub: 500, subscriptionRub: 1990, usePoints: true }),
    500,
  );
});

test("тумблер выключен — баллы не списываются", () => {
  assert.equal(
    pointsToSpend({ balanceRub: 5000, subscriptionRub: 1990, usePoints: false }),
    0,
  );
});

test("отрицательный баланс не превращается в начисление", () => {
  assert.equal(
    pointsToSpend({ balanceRub: -100, subscriptionRub: 1990, usePoints: true }),
    0,
  );
});

test("реферальная награда — 30 % с округлением до рубля", () => {
  assert.equal(referralRewardFor(1990), 597);
  assert.equal(referralRewardFor(0), 0);
  assert.equal(referralRewardFor(-100), 0);
  assert.equal(referralRewardFor(1495), 449); // 448.5 → 449
});

test("вид отзыва определяется по MIME вложения", () => {
  assert.equal(reviewKindFromMime(null), "text");
  assert.equal(reviewKindFromMime("image/jpeg"), "photo");
  assert.equal(reviewKindFromMime("image/png"), "photo");
  assert.equal(reviewKindFromMime("video/mp4"), "video");
  assert.equal(reviewKindFromMime("video/quicktime"), "video");
  // HEIC браузеры на лендинге не рисуют — отклоняем на входе.
  assert.equal(reviewKindFromMime("image/heic"), null);
  assert.equal(reviewKindFromMime("application/pdf"), null);
});

test("MIME с параметрами и в верхнем регистре распознаётся", () => {
  assert.equal(reviewKindFromMime("IMAGE/JPEG; charset=binary"), "photo");
});

test("тарифы отзывов", () => {
  assert.equal(reviewRewardFor("text"), 300);
  assert.equal(reviewRewardFor("photo"), 750);
  assert.equal(reviewRewardFor("video"), 1990);
});

test("анонимный отзыв — на 20 % меньше по всем трём видам: 300 → 240, 750 → 600, 1990 → 1592", () => {
  assert.equal(ANONYMOUS_REVIEW_FACTOR, 0.8);
  assert.equal(reviewRewardFor("text", true), 240);
  assert.equal(reviewRewardFor("photo", true), 600);
  assert.equal(reviewRewardFor("video", true), 1592);
  // Флаг «не анонимно» ничего не меняет.
  assert.equal(reviewRewardFor("video", false), 1990);
});

test("анонимное начисление округляется вниз до рубля и не ломается на плавающей точке", () => {
  assert.equal(anonymousRewardRub(999), 799); // 799,2
  assert.equal(anonymousRewardRub(1999), 1599); // 1599,2
  assert.equal(anonymousRewardRub(5), 4);
  assert.equal(anonymousRewardRub(1), 0); // 0,8
  assert.equal(anonymousRewardRub(0), 0);
  assert.equal(anonymousRewardRub(-300), 0);
  // 1990 × 0,8 в плавающей точке — 1592.0000000000002; целочисленный счёт даёт ровно 1592.
  assert.equal(Number.isInteger(anonymousRewardRub(1990)), true);
});

test("сумма пополнения: границы от 500 до 300 000 ₽ целыми рублями", () => {
  assert.equal(TOPUP_MIN_RUB, 500);
  assert.equal(TOPUP_MAX_RUB, 300_000);
  assert.deepEqual(parseTopupAmount(500), { ok: true, amountRub: 500 });
  assert.deepEqual(parseTopupAmount(300_000), { ok: true, amountRub: 300_000 });
  assert.equal(parseTopupAmount(499).ok, false);
  assert.equal(parseTopupAmount(300_001).ok, false);
  assert.equal(parseTopupAmount(0).ok, false);
  assert.equal(parseTopupAmount(-500).ok, false);
  const min = parseTopupAmount(499);
  assert.equal(!min.ok && min.error.replace(/[  ]/g, " "), "Минимальная сумма — 500 ₽");
  const max = parseTopupAmount(300_001);
  assert.equal(!max.ok && max.error.replace(/[  ]/g, " "), "Максимальная сумма — 300 000 ₽");
});

test("сумма пополнения: копейки, дроби и нечисловое — отказ", () => {
  const cents = parseTopupAmount(1990.5);
  assert.equal(!cents.ok && cents.error, "Сумма — целыми рублями, без копеек");
  assert.equal(parseTopupAmount("1990,50").ok, false);
  assert.equal(parseTopupAmount(Number.NaN).ok, false);
  assert.equal(parseTopupAmount(Number.POSITIVE_INFINITY).ok, false);
  assert.equal(parseTopupAmount("пять тысяч").ok, false);
  assert.equal(parseTopupAmount("").ok, false);
  assert.equal(parseTopupAmount(null).ok, false);
  assert.equal(parseTopupAmount(undefined).ok, false);
  assert.equal(parseTopupAmount({ amountRub: 5000 }).ok, false);
});

test("сумма пополнения из поля ввода: «5 000», «1 990 ₽» — принимаются", () => {
  assert.deepEqual(parseTopupAmount("5 000"), { ok: true, amountRub: 5000 });
  assert.deepEqual(parseTopupAmount(" 1 990 ₽ "), { ok: true, amountRub: 1990 });
  assert.deepEqual(parseTopupAmount("10000"), { ok: true, amountRub: 10000 });
});

test("быстрые суммы пополнения укладываются в границы", () => {
  assert.deepEqual([...TOPUP_PRESETS_RUB], [1990, 5000, 10000]);
  for (const preset of TOPUP_PRESETS_RUB) assert.equal(parseTopupAmount(preset).ok, true);
});

test("пополнение в истории баланса подписано «Пополнение»", () => {
  assert.equal(transactionKindLabel("topup"), "Пополнение");
});

test("формат суммы баллов — как в остальном кабинете", () => {
  assert.equal(formatPoints(1490).replace(/ /g, " "), "1 490 ₽");
});

test("readCookie достаёт реферальную метку из заголовка", () => {
  const request = new Request("https://wesetup.ru/order", {
    headers: { cookie: `theme=dark; ${REFERRAL_COOKIE}=ABCD2345; other=1` },
  });
  assert.equal(readCookie(request, REFERRAL_COOKIE), "ABCD2345");
  assert.equal(readCookie(request, "missing"), null);
});

test("readCookie на запросе без cookie возвращает null", () => {
  const request = new Request("https://wesetup.ru/order");
  assert.equal(readCookie(request, REFERRAL_COOKIE), null);
});
