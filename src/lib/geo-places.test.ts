import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTimeZone } from "@/lib/ip-geo";
import {
  GEO_PLACES,
  findGeoPlace,
  guessPlaceByTimeZone,
  resolveOrganizationPlace,
  suggestGeoPlaces,
} from "@/lib/geo-places";

/** Город организации задаёт её пояс (спека tg-client-location-2026-11, AC6). */

test("каталог: у каждого города действующий IANA-пояс, без дублей", () => {
  const seen = new Set<string>();
  for (const place of GEO_PLACES) {
    assert.equal(normalizeTimeZone(place.timeZone), place.timeZone, place.city);
    const key = `${place.countryCode}:${place.city}`;
    assert.ok(!seen.has(key), key);
    seen.add(key);
  }
});

test("подсказки: с начала слова, без учёта регистра и «ё»", () => {
  assert.equal(suggestGeoPlaces("барн")[0]?.city, "Барнаул");
  assert.equal(suggestGeoPlaces("ОРЕЛ")[0]?.city, "Орёл");
  assert.ok(suggestGeoPlaces("ново").length > 1);
  assert.deepEqual(suggestGeoPlaces("  "), []);
});

test("город по названию и пояс по поясу браузера", () => {
  assert.equal(findGeoPlace("г. Барнаул")?.timeZone, "Asia/Barnaul");
  assert.equal(findGeoPlace("Брест", "BY")?.countryCode, "BY");
  assert.equal(findGeoPlace("Нигде"), null);
  assert.equal(guessPlaceByTimeZone("Europe/Moscow")?.city, "Москва");
  assert.equal(guessPlaceByTimeZone("Asia/Barnaul")?.city, "Барнаул");
  assert.equal(guessPlaceByTimeZone("bogus"), null);
});

test("итоговый пояс организации: город из каталога важнее браузера", () => {
  assert.deepEqual(resolveOrganizationPlace({ city: "барнаул", browserTimeZone: "Europe/Moscow" }), {
    city: "Барнаул",
    countryCode: "RU",
    timeZone: "Asia/Barnaul",
  });
  // Город вне каталога — пояс браузера, страна по IP.
  assert.deepEqual(
    resolveOrganizationPlace({ city: "Рубцовск", browserTimeZone: "Asia/Barnaul", geo: { countryCode: "RU", city: null, timeZone: null } }),
    { city: "Рубцовск", countryCode: "RU", timeZone: "Asia/Barnaul" },
  );
  // Без города — пояс браузера; город по IP, если пояса совпадают.
  assert.deepEqual(
    resolveOrganizationPlace({ browserTimeZone: "Asia/Barnaul", geo: { countryCode: "RU", city: "Барнаул", timeZone: "Asia/Barnaul" } }),
    { city: "Барнаул", countryCode: "RU", timeZone: "Asia/Barnaul" },
  );
  assert.equal(resolveOrganizationPlace({}), null);
  assert.equal(resolveOrganizationPlace({ city: "<script>" })?.city, "script");
});
