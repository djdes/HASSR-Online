/**
 * Города для поля «Город» (регистрация, настройки организации) и пояс по
 * городу (спека tg-client-location-2026-11). Город задаёт
 * `Organization.timezone` — по нему журналы ставят время, а не по Москве.
 *
 * Каталог — крупные города рынка (Россия и СНГ) с IANA-поясом. Город не из
 * каталога тоже принимается: пояс тогда берётся из браузера, по IP или по
 * стране. Чистый модуль — работает и на клиенте, и на сервере.
 */

import { normalizeTimeZone } from "@/lib/ip-geo";

export type GeoPlace = { city: string; countryCode: string; timeZone: string };

const RU: Array<[string, string]> = [
  ["Москва", "Europe/Moscow"],
  ["Санкт-Петербург", "Europe/Moscow"],
  ["Новосибирск", "Asia/Novosibirsk"],
  ["Екатеринбург", "Asia/Yekaterinburg"],
  ["Казань", "Europe/Moscow"],
  ["Нижний Новгород", "Europe/Moscow"],
  ["Красноярск", "Asia/Krasnoyarsk"],
  ["Челябинск", "Asia/Yekaterinburg"],
  ["Самара", "Europe/Samara"],
  ["Уфа", "Asia/Yekaterinburg"],
  ["Ростов-на-Дону", "Europe/Moscow"],
  ["Краснодар", "Europe/Moscow"],
  ["Омск", "Asia/Omsk"],
  ["Воронеж", "Europe/Moscow"],
  ["Пермь", "Asia/Yekaterinburg"],
  ["Волгоград", "Europe/Volgograd"],
  ["Саратов", "Europe/Saratov"],
  ["Тюмень", "Asia/Yekaterinburg"],
  ["Тольятти", "Europe/Samara"],
  ["Барнаул", "Asia/Barnaul"],
  ["Махачкала", "Europe/Moscow"],
  ["Ижевск", "Europe/Samara"],
  ["Хабаровск", "Asia/Vladivostok"],
  ["Ульяновск", "Europe/Ulyanovsk"],
  ["Иркутск", "Asia/Irkutsk"],
  ["Владивосток", "Asia/Vladivostok"],
  ["Ярославль", "Europe/Moscow"],
  ["Севастополь", "Europe/Simferopol"],
  ["Симферополь", "Europe/Simferopol"],
  ["Ставрополь", "Europe/Moscow"],
  ["Томск", "Asia/Tomsk"],
  ["Кемерово", "Asia/Novokuznetsk"],
  ["Новокузнецк", "Asia/Novokuznetsk"],
  ["Набережные Челны", "Europe/Moscow"],
  ["Оренбург", "Asia/Yekaterinburg"],
  ["Рязань", "Europe/Moscow"],
  ["Балашиха", "Europe/Moscow"],
  ["Пенза", "Europe/Moscow"],
  ["Чебоксары", "Europe/Moscow"],
  ["Липецк", "Europe/Moscow"],
  ["Калининград", "Europe/Kaliningrad"],
  ["Астрахань", "Europe/Astrakhan"],
  ["Тула", "Europe/Moscow"],
  ["Киров", "Europe/Kirov"],
  ["Сочи", "Europe/Moscow"],
  ["Курск", "Europe/Moscow"],
  ["Улан-Удэ", "Asia/Irkutsk"],
  ["Тверь", "Europe/Moscow"],
  ["Магнитогорск", "Asia/Yekaterinburg"],
  ["Брянск", "Europe/Moscow"],
  ["Иваново", "Europe/Moscow"],
  ["Белгород", "Europe/Moscow"],
  ["Сургут", "Asia/Yekaterinburg"],
  ["Владимир", "Europe/Moscow"],
  ["Чита", "Asia/Chita"],
  ["Архангельск", "Europe/Moscow"],
  ["Нижний Тагил", "Asia/Yekaterinburg"],
  ["Калуга", "Europe/Moscow"],
  ["Смоленск", "Europe/Moscow"],
  ["Курган", "Asia/Yekaterinburg"],
  ["Череповец", "Europe/Moscow"],
  ["Вологда", "Europe/Moscow"],
  ["Орёл", "Europe/Moscow"],
  ["Владикавказ", "Europe/Moscow"],
  ["Грозный", "Europe/Moscow"],
  ["Мурманск", "Europe/Moscow"],
  ["Якутск", "Asia/Yakutsk"],
  ["Тамбов", "Europe/Moscow"],
  ["Кострома", "Europe/Moscow"],
  ["Петрозаводск", "Europe/Moscow"],
  ["Новороссийск", "Europe/Moscow"],
  ["Йошкар-Ола", "Europe/Moscow"],
  ["Нальчик", "Europe/Moscow"],
  ["Сыктывкар", "Europe/Moscow"],
  ["Нижневартовск", "Asia/Yekaterinburg"],
  ["Таганрог", "Europe/Moscow"],
  ["Комсомольск-на-Амуре", "Asia/Vladivostok"],
  ["Братск", "Asia/Irkutsk"],
  ["Благовещенск", "Asia/Yakutsk"],
  ["Великий Новгород", "Europe/Moscow"],
  ["Псков", "Europe/Moscow"],
  ["Бийск", "Asia/Barnaul"],
  ["Горно-Алтайск", "Asia/Barnaul"],
  ["Абакан", "Asia/Krasnoyarsk"],
  ["Кызыл", "Asia/Krasnoyarsk"],
  ["Норильск", "Asia/Krasnoyarsk"],
  ["Саранск", "Europe/Moscow"],
  ["Пятигорск", "Europe/Moscow"],
  ["Майкоп", "Europe/Moscow"],
  ["Черкесск", "Europe/Moscow"],
  ["Элиста", "Europe/Moscow"],
  ["Анапа", "Europe/Moscow"],
  ["Геленджик", "Europe/Moscow"],
  ["Ханты-Мансийск", "Asia/Yekaterinburg"],
  ["Салехард", "Asia/Yekaterinburg"],
  ["Новый Уренгой", "Asia/Yekaterinburg"],
  ["Южно-Сахалинск", "Asia/Sakhalin"],
  ["Магадан", "Asia/Magadan"],
  ["Петропавловск-Камчатский", "Asia/Kamchatka"],
  ["Анадырь", "Asia/Anadyr"],
  ["Находка", "Asia/Vladivostok"],
  ["Подольск", "Europe/Moscow"],
  ["Химки", "Europe/Moscow"],
  ["Мытищи", "Europe/Moscow"],
  ["Королёв", "Europe/Moscow"],
  ["Люберцы", "Europe/Moscow"],
  ["Красногорск", "Europe/Moscow"],
  ["Одинцово", "Europe/Moscow"],
  ["Дзержинск", "Europe/Moscow"],
  ["Стерлитамак", "Asia/Yekaterinburg"],
  ["Энгельс", "Europe/Saratov"],
  ["Волжский", "Europe/Volgograd"],
  ["Старый Оскол", "Europe/Moscow"],
  ["Армавир", "Europe/Moscow"],
  ["Ангарск", "Asia/Irkutsk"],
  ["Златоуст", "Asia/Yekaterinburg"],
  ["Каменск-Уральский", "Asia/Yekaterinburg"],
  ["Тобольск", "Asia/Yekaterinburg"],
  ["Ноябрьск", "Asia/Yekaterinburg"],
  ["Нефтеюганск", "Asia/Yekaterinburg"],
  ["Березники", "Asia/Yekaterinburg"],
  ["Миасс", "Asia/Yekaterinburg"],
  ["Евпатория", "Europe/Simferopol"],
  ["Ялта", "Europe/Simferopol"],
  ["Керчь", "Europe/Simferopol"],
];

const OTHER: Array<[string, string, string]> = [
  ["Алматы", "KZ", "Asia/Almaty"],
  ["Астана", "KZ", "Asia/Almaty"],
  ["Шымкент", "KZ", "Asia/Almaty"],
  ["Караганда", "KZ", "Asia/Almaty"],
  ["Актобе", "KZ", "Asia/Aqtobe"],
  ["Тараз", "KZ", "Asia/Almaty"],
  ["Павлодар", "KZ", "Asia/Almaty"],
  ["Усть-Каменогорск", "KZ", "Asia/Almaty"],
  ["Семей", "KZ", "Asia/Almaty"],
  ["Атырау", "KZ", "Asia/Atyrau"],
  ["Костанай", "KZ", "Asia/Qostanay"],
  ["Кызылорда", "KZ", "Asia/Qyzylorda"],
  ["Уральск", "KZ", "Asia/Oral"],
  ["Петропавловск", "KZ", "Asia/Almaty"],
  ["Актау", "KZ", "Asia/Aqtau"],
  ["Ташкент", "UZ", "Asia/Tashkent"],
  ["Самарканд", "UZ", "Asia/Samarkand"],
  ["Бухара", "UZ", "Asia/Samarkand"],
  ["Наманган", "UZ", "Asia/Tashkent"],
  ["Андижан", "UZ", "Asia/Tashkent"],
  ["Фергана", "UZ", "Asia/Tashkent"],
  ["Нукус", "UZ", "Asia/Samarkand"],
  ["Карши", "UZ", "Asia/Samarkand"],
  ["Ургенч", "UZ", "Asia/Samarkand"],
  ["Бишкек", "KG", "Asia/Bishkek"],
  ["Ош", "KG", "Asia/Bishkek"],
  ["Душанбе", "TJ", "Asia/Dushanbe"],
  ["Худжанд", "TJ", "Asia/Dushanbe"],
  ["Ашхабад", "TM", "Asia/Ashgabat"],
  ["Минск", "BY", "Europe/Minsk"],
  ["Гомель", "BY", "Europe/Minsk"],
  ["Могилёв", "BY", "Europe/Minsk"],
  ["Витебск", "BY", "Europe/Minsk"],
  ["Гродно", "BY", "Europe/Minsk"],
  ["Брест", "BY", "Europe/Minsk"],
  ["Ереван", "AM", "Asia/Yerevan"],
  ["Тбилиси", "GE", "Asia/Tbilisi"],
  ["Батуми", "GE", "Asia/Tbilisi"],
  ["Баку", "AZ", "Asia/Baku"],
  ["Кишинёв", "MD", "Europe/Chisinau"],
  ["Дубай", "AE", "Asia/Dubai"],
  ["Стамбул", "TR", "Europe/Istanbul"],
  ["Анталья", "TR", "Europe/Istanbul"],
];

export const GEO_PLACES: readonly GeoPlace[] = [
  ...RU.map(([city, timeZone]) => ({ city, countryCode: "RU", timeZone })),
  ...OTHER.map(([city, countryCode, timeZone]) => ({ city, countryCode, timeZone })),
];

/** Пояс по умолчанию для страны, если город не из каталога и пояса нет. */
const COUNTRY_TIME_ZONE: Record<string, string> = {
  RU: "Europe/Moscow",
  KZ: "Asia/Almaty",
  UZ: "Asia/Tashkent",
  KG: "Asia/Bishkek",
  TJ: "Asia/Dushanbe",
  TM: "Asia/Ashgabat",
  BY: "Europe/Minsk",
  AM: "Asia/Yerevan",
  GE: "Asia/Tbilisi",
  AZ: "Asia/Baku",
  MD: "Europe/Chisinau",
  AE: "Asia/Dubai",
  TR: "Europe/Istanbul",
};

/** Ключ сравнения: регистр, «ё», дефисы и лишние пробелы не важны. */
export function placeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[‐-―-]+/g, " ")
    .replace(/^(г\.|город)\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Город из каталога по названию (и стране, если известна). */
export function findGeoPlace(city: string | null | undefined, countryCode?: string | null): GeoPlace | null {
  const key = placeKey(city ?? "");
  if (!key) return null;
  const code = (countryCode ?? "").toUpperCase();
  const matches = GEO_PLACES.filter((place) => placeKey(place.city) === key);
  return matches.find((place) => !code || place.countryCode === code) ?? matches[0] ?? null;
}

/** Подсказки для поля: сначала начинающиеся с введённого, потом содержащие. */
export function suggestGeoPlaces(query: string, limit = 8): GeoPlace[] {
  const key = placeKey(query);
  if (!key) return [];
  const starts: GeoPlace[] = [];
  const contains: GeoPlace[] = [];
  for (const place of GEO_PLACES) {
    const name = placeKey(place.city);
    if (name.startsWith(key)) starts.push(place);
    else if (name.includes(key)) contains.push(place);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Город для подстановки по поясу браузера: первый в каталоге с этим поясом
 * (каталог упорядочен по величине города). `Europe/Moscow` → Москва.
 */
export function guessPlaceByTimeZone(timeZone: string | null | undefined): GeoPlace | null {
  const zone = normalizeTimeZone(timeZone);
  if (!zone) return null;
  return GEO_PLACES.find((place) => place.timeZone === zone) ?? null;
}

export function countryDefaultTimeZone(countryCode: string | null | undefined): string | null {
  return COUNTRY_TIME_ZONE[(countryCode ?? "").toUpperCase()] ?? null;
}

/** Город, введённый человеком: обрезка, без управляющих символов, до 80 знаков. */
export function normalizeCityInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return value || null;
}

export function normalizeCountryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

/**
 * Итоговые город, страна и пояс организации. Город из каталога задаёт пояс
 * точно; город вне каталога — пояс браузера, по IP или страны; без города —
 * пояс браузера или по IP (страна — по IP). Ничего не известно — `null`.
 */
export function resolveOrganizationPlace(input: {
  city?: unknown;
  countryCode?: unknown;
  browserTimeZone?: unknown;
  geo?: { countryCode: string; city: string | null; timeZone: string | null } | null;
}): { city: string | null; countryCode: string | null; timeZone: string } | null {
  const city = normalizeCityInput(input.city);
  const countryCode = normalizeCountryCode(input.countryCode);
  const browserZone = normalizeTimeZone(input.browserTimeZone);
  const geoZone = normalizeTimeZone(input.geo?.timeZone);
  if (city) {
    const known = findGeoPlace(city, countryCode);
    if (known) return { city: known.city, countryCode: known.countryCode, timeZone: known.timeZone };
    const country = countryCode ?? input.geo?.countryCode ?? null;
    const timeZone = browserZone ?? geoZone ?? countryDefaultTimeZone(country);
    return timeZone ? { city, countryCode: country, timeZone } : { city, countryCode: country, timeZone: "Europe/Moscow" };
  }
  const geoCity = input.geo?.city ? findGeoPlace(input.geo.city, input.geo.countryCode) : null;
  const timeZone = browserZone ?? geoZone ?? geoCity?.timeZone ?? null;
  if (!timeZone) return null;
  return {
    city: geoCity && geoCity.timeZone === timeZone ? geoCity.city : null,
    countryCode: input.geo?.countryCode ?? countryCode ?? null,
    timeZone,
  };
}

/** Пояс браузера (на сервере — `null`). */
export function browserTimeZone(): string | null {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}
