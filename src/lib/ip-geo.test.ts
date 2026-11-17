import assert from "node:assert/strict";
import test from "node:test";

import {
  clientLocationLine,
  countryFlag,
  countryName,
  geoFromHeaders,
  isPublicIp,
  localTimeLabel,
  lookupIpGeo,
  normalizeTimeZone,
  parseIpGeoResponse,
  utcOffsetLabel,
} from "@/lib/ip-geo";

/** Страна по IP и местное время клиента (спека blank-download-extras-2026-11). */

const AT = new Date("2026-11-17T11:32:00Z");

test("флаг и название страны", () => {
  assert.equal(countryFlag("RU"), "🇷🇺");
  assert.equal(countryFlag("uz"), "🇺🇿");
  assert.equal(countryFlag("KAZ"), "🌐");
  assert.equal(countryFlag(null), "🌐");
  assert.equal(countryName("RU"), "Россия");
  assert.equal(countryName("KZ", "en"), "Kazakhstan");
  assert.equal(countryName("??"), null);
});

test("часовой пояс браузера: только действующий IANA", () => {
  assert.equal(normalizeTimeZone("Europe/Moscow"), "Europe/Moscow");
  assert.equal(normalizeTimeZone(" Asia/Tashkent "), "Asia/Tashkent");
  for (const bad of ["Mars/Olympus", "", "Europe/Moscow; drop", 5, null, "x".repeat(80)]) {
    assert.equal(normalizeTimeZone(bad), null, String(bad));
  }
});

test("местное время и смещение", () => {
  assert.equal(localTimeLabel("Europe/Moscow", AT), "14:32");
  assert.equal(utcOffsetLabel("Europe/Moscow", AT), "UTC+3");
  assert.equal(utcOffsetLabel("Asia/Kolkata", AT), "UTC+5:30");
  assert.equal(utcOffsetLabel("UTC", AT), "UTC");
});

test("строка для Telegram: страна, город, местное время; пояс браузера важнее гео", () => {
  assert.equal(
    clientLocationLine({ geo: { countryCode: "RU", city: "Казань", timeZone: "Europe/Moscow" }, at: AT }),
    "🇷🇺 Россия, Казань · местное время 14:32 (UTC+3)",
  );
  assert.equal(
    clientLocationLine({ geo: { countryCode: "RU", city: null, timeZone: "Europe/Moscow" }, timeZone: "Asia/Novosibirsk", at: AT }),
    "🇷🇺 Россия · местное время 18:32 (UTC+7)",
  );
  assert.equal(clientLocationLine({ geo: null, timeZone: "Asia/Tashkent", at: AT }), "🕒 местное время 16:32 (UTC+5)");
  assert.equal(clientLocationLine({ geo: { countryCode: "KZ", city: null, timeZone: null }, at: AT }), "🇰🇿 Казахстан");
  assert.equal(clientLocationLine({ geo: null, timeZone: "bogus" }), null);
});

test("частные и служебные адреса не спрашиваем", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.1.1", "100.64.0.1", "::1", "fd00::1", "203.0.113.7", "2001:db8::5", "unknown", "", null]) {
    assert.equal(isPublicIp(ip), false, String(ip));
  }
  for (const ip of ["95.31.18.119", "::ffff:8.8.8.8", "2a02:6b8::1"]) assert.equal(isPublicIp(ip), true, ip);
});

test("заголовки прокси и разбор ответа сервиса", () => {
  assert.deepEqual(geoFromHeaders(new Headers({ "cf-ipcountry": "by" })), { countryCode: "BY", city: null, timeZone: null });
  assert.equal(geoFromHeaders(new Headers({ "cf-ipcountry": "XX" })), null);
  assert.deepEqual(
    parseIpGeoResponse({ success: true, country_code: "RU", city: "Москва", timezone: { id: "Europe/Moscow" } }),
    { countryCode: "RU", city: "Москва", timeZone: "Europe/Moscow" },
  );
  assert.equal(parseIpGeoResponse({ success: false, message: "Reserved range" }), null);
  assert.equal(parseIpGeoResponse("nope"), null);
});

test("поиск: внешний запрос с кешем, сбой и приватный адрес — без исключений", async () => {
  let calls = 0;
  const fetchImpl = (async (url: string) => {
    calls += 1;
    assert.match(String(url), /\/95\.31\.18\.119\?lang=ru$/);
    return new Response(JSON.stringify({ success: true, country_code: "RU", city: "Москва", timezone: { id: "Europe/Moscow" } }));
  }) as unknown as typeof fetch;
  const first = await lookupIpGeo("95.31.18.119", { fetchImpl });
  const second = await lookupIpGeo("95.31.18.119", { fetchImpl });
  assert.deepEqual(first, { countryCode: "RU", city: "Москва", timeZone: "Europe/Moscow" });
  assert.deepEqual(second, first);
  assert.equal(calls, 1, "второй раз — из кеша");

  const failing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assert.equal(await lookupIpGeo("8.8.4.4", { fetchImpl: failing }), null);
  assert.deepEqual(
    await lookupIpGeo("192.168.1.1", { fetchImpl: failing, headers: new Headers({ "x-geoip-country": "UZ" }) }),
    { countryCode: "UZ", city: null, timeZone: null },
  );
});
