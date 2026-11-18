import assert from "node:assert/strict";
import test from "node:test";

import { appendAdminClientLines } from "@/lib/admin-client-context";
import { signupChannel, signupSourceShort, type SignupSourceSnapshot } from "@/lib/signup-channel";
import { requestSignupSource, visitSourceFromCookieHeader } from "@/lib/visit-source.server";

/** Источник визита: каналы, коротко для Telegram, cookie первого касания (спека visit-source-2026-11). */

function snap(patch: Partial<SignupSourceSnapshot>): SignupSourceSnapshot {
  return { place: "", landing: "/", referrer: "", utmSource: "", utmMedium: "", utmCampaign: "", ...patch };
}

test("каналы: поисковики, ИИ, соцсети, метки клика рекламы", () => {
  assert.equal(signupChannel(snap({ referrer: "https://www.bing.com/" })), "search_bing");
  assert.equal(signupChannel(snap({ referrer: "https://go.mail.ru/search" })), "search_mail");
  assert.equal(signupChannel(snap({ referrer: "https://duckduckgo.com/" })), "search_other");
  assert.equal(signupChannel(snap({ referrer: "https://chatgpt.com/" })), "ai");
  assert.equal(signupChannel(snap({ referrer: "https://gemini.google.com/app" })), "ai");
  assert.equal(signupChannel(snap({ utmSource: "chatgpt.com" })), "ai");
  assert.equal(signupChannel(snap({ referrer: "https://dzen.ru/a/x" })), "social");
  assert.equal(signupChannel(snap({ referrer: "https://www.youtube.com/" })), "social");
  assert.equal(signupChannel(snap({ click: "yclid", referrer: "https://yandex.ru/" })), "yandex_direct");
  assert.equal(signupChannel(snap({ click: "gclid" })), "google_ads");
  assert.equal(signupChannel(snap({ utmSource: "google", utmMedium: "cpc" })), "google_ads");
  // Старые каналы не поменялись.
  assert.equal(signupChannel(snap({ referrer: "https://www.google.com/" })), "search_google");
  assert.equal(signupChannel(snap({ referrer: "https://yandex.ru/" })), "search_yandex");
});

test("коротко для Telegram: канал и кампания или сайт, без посадочной", () => {
  assert.equal(signupSourceShort(snap({ referrer: "https://yandex.ru/", landing: "/journals-info/x" })), "Поиск Яндекса");
  assert.equal(signupSourceShort(snap({ utmSource: "yandex", utmMedium: "cpc", utmCampaign: "kafe_spb" })), "Яндекс Директ · kafe_spb");
  assert.equal(signupSourceShort(snap({ click: "yclid" })), "Яндекс Директ");
  assert.equal(signupSourceShort(snap({ referrer: "https://chatgpt.com/c/1" })), "ИИ-ассистент · chatgpt.com");
  assert.equal(signupSourceShort(snap({ referrer: "https://restoclub.ru/a" })), "Другие сайты · restoclub.ru");
  assert.equal(signupSourceShort(snap({ utmSource: "partner-blog" })), "Другая реклама (utm) · partner-blog");
  assert.equal(signupSourceShort(snap({ landing: "/" })), "Прямой заход");
  assert.equal(signupSourceShort(null), null);
  assert.equal(signupSourceShort(snap({ referrer: "https://yandex.ru/" }), { partner: true }), "Партнёр");
});

test("cookie первого касания: разбор, мусор, пустое", () => {
  const value = encodeURIComponent(JSON.stringify({ landing: "/dlya-kafe", referrer: "https://yandex.ru/", utmSource: "", utmMedium: "", utmCampaign: "", click: "bogus" }));
  const parsed = visitSourceFromCookieHeader(`a=1; wesetup_src=${value}; b=2`, "hero");
  assert.deepEqual(parsed, { place: "hero", landing: "/dlya-kafe", referrer: "https://yandex.ru/", utmSource: "", utmMedium: "", utmCampaign: "" });
  assert.equal(visitSourceFromCookieHeader("wesetup_src=%7Bbad"), null);
  assert.equal(visitSourceFromCookieHeader(`wesetup_src=${encodeURIComponent("{}")}`), null);
  assert.equal(visitSourceFromCookieHeader(null), null);
});

test("источник запроса: содержательная форма, иначе cookie с местом формы", () => {
  const cookie = `wesetup_src=${encodeURIComponent(JSON.stringify({ landing: "/blog/x", referrer: "https://www.google.com/" }))}`;
  const request = new Request("https://wesetup.ru/api/x", { headers: { cookie } });
  const bare = snap({ place: "hero", landing: "/", referrer: "https://wesetup.ru/" });
  assert.equal(requestSignupSource(request, bare)?.referrer, "https://www.google.com/");
  assert.equal(requestSignupSource(request, bare)?.place, "hero");
  const fromAds = snap({ place: "hero", utmSource: "yandex", utmMedium: "cpc" });
  assert.equal(requestSignupSource(request, fromAds), fromAds);
  assert.equal(requestSignupSource(new Request("https://wesetup.ru/"), null), null);
});

test("уведомление: строка «Источник:» перед местом, без дубля", () => {
  const info = { source: "Поиск Яндекса", location: "🇷🇺 Россия · 09:29", adminUrl: null };
  assert.equal(appendAdminClientLines("📥 Скачивание", info), "📥 Скачивание\nИсточник: Поиск Яндекса\n🇷🇺 Россия · 09:29");
  assert.equal(appendAdminClientLines("Заявка\nИсточник: Директ", info), "Заявка\nИсточник: Директ\n🇷🇺 Россия · 09:29");
});
