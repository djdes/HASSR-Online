import type { Locale } from "@/i18n/locales";

/**
 * Виды помещения (`Room.kind`) — один список для API, окна помещения и
 * карточек точек. Раньше перечень жил в четырёх местах и расходился.
 *
 * `production` — «Основное производство» (раздел 4.3 плана, 2026-10-17):
 * у производств и пищеблоков главный цех не «кухня», и руководитель
 * просил его отдельным видом.
 */
export const ROOM_KINDS = [
  "production",
  "kitchen",
  "wash",
  "storage",
  "bar",
  "guest",
  "other",
] as const;

export type RoomKind = (typeof ROOM_KINDS)[number];

const LABELS: Record<Locale, Record<RoomKind, string>> = {
  ru: {
    production: "Основное производство",
    kitchen: "Кухня / горячий цех",
    wash: "Мойка",
    storage: "Склад",
    bar: "Бар",
    guest: "Гостевая зона",
    other: "Другое",
  },
  en: {
    production: "Main production",
    kitchen: "Kitchen / hot shop",
    wash: "Washing area",
    storage: "Storage",
    bar: "Bar",
    guest: "Guest area",
    other: "Other",
  },
  uz: {
    production: "Asosiy ishlab chiqarish",
    kitchen: "Oshxona / issiq sex",
    wash: "Yuvish joyi",
    storage: "Ombor",
    bar: "Bar",
    guest: "Mehmonlar zali",
    other: "Boshqa",
  },
  tg: {
    production: "Истеҳсолоти асосӣ",
    kitchen: "Ошхона / сехи гарм",
    wash: "Ҷои шустушӯй",
    storage: "Анбор",
    bar: "Бар",
    guest: "Толори меҳмонон",
    other: "Дигар",
  },
  hy: {
    production: "Հիմնական արտադրություն",
    kitchen: "Խոհանոց / տաք արտադրամաս",
    wash: "Լվացման տարածք",
    storage: "Պահեստ",
    bar: "Բար",
    guest: "Հյուրերի սրահ",
    other: "Այլ",
  },
  ky: {
    production: "Негизги өндүрүш",
    kitchen: "Ашкана / ысык цех",
    wash: "Жуучу жай",
    storage: "Кампа",
    bar: "Бар",
    guest: "Коноктор залы",
    other: "Башка",
  },
  de: {
    production: "Hauptproduktion",
    kitchen: "Küche / Warmküche",
    wash: "Spülbereich",
    storage: "Lager",
    bar: "Bar",
    guest: "Gastbereich",
    other: "Sonstiges",
  },
  fr: {
    production: "Production principale",
    kitchen: "Cuisine / poste chaud",
    wash: "Plonge",
    storage: "Stockage",
    bar: "Bar",
    guest: "Salle clients",
    other: "Autre",
  },
};

export function isRoomKind(value: unknown): value is RoomKind {
  return typeof value === "string" && (ROOM_KINDS as readonly string[]).includes(value);
}

/** Подпись вида; неизвестный (старый, введённый иначе) — как есть. */
export function roomKindLabel(kind: string, locale: Locale = "ru"): string {
  return isRoomKind(kind) ? LABELS[locale][kind] : kind;
}

/** Варианты для выпадающего списка, в порядке `ROOM_KINDS`. */
export function roomKindOptions(locale: Locale = "ru"): Array<{ value: RoomKind; label: string }> {
  return ROOM_KINDS.map((value) => ({ value, label: LABELS[locale][value] }));
}
