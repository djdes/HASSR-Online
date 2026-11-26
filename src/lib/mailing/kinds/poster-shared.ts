import { COMPANY_PHONE } from "@/lib/company-contacts";
import { TRIAL_DAYS } from "@/lib/tariff-plans";

import { isSafeLinkUrl } from "../text-format";

/**
 * «Постер» — письмо, которое начинается с рекламного постера 1080×1350 в
 * стиле флаера (тёмный фон, плашка, гигантское слово, телефон с экраном
 * журнала поверх букв, карточка-факт, внизу «Подключите за день» и
 * телефон). Фон без текста генерирует шлюз ProjectsFlow, надписи и
 * телефон рисует сервер (`src/lib/mailing/poster-image.server.ts`). Под
 * постером — живой HTML: заголовок, текст, кнопка, контакты, отписка.
 *
 * Чистый модуль: его читают и поля формы в браузере
 * (`src/components/mailing/fields/poster.tsx`), и серверный шаблон
 * (`poster.ts`), и сборка картинки.
 */

/** Экран телефона на постере — настоящие снимки кабинета (`public/landing/screens`). */
export type PosterScreen = "grid" | "dashboard" | "monitoring" | "inspection" | "qr";
/** Что изображает сгенерированный фон. */
export type PosterScene = "restaurant" | "canteen" | "production";

export const POSTER_SCREENS: { key: PosterScreen; title: string }[] = [
  { key: "grid", title: "Журнал температур" },
  { key: "dashboard", title: "Журналы на сегодня" },
  { key: "monitoring", title: "Заполнено сегодня, %" },
  { key: "inspection", title: "Пришла проверка" },
  { key: "qr", title: "QR-коды журналов" },
];

export const POSTER_SCENES: { key: PosterScene; title: string }[] = [
  { key: "restaurant", title: "Кухня ресторана" },
  { key: "canteen", title: "Столовая" },
  { key: "production", title: "Пищевое производство" },
];

/** Надписи постера — то, что ROOT правит в редакторе. */
export type PosterTexts = {
  /** Плашка над словом: «Электронные журналы». */
  kicker: string;
  /** Гигантское слово: «ХАССП». */
  word: string;
  /** Подпись карточки: «Бесплатно». */
  cardTitle: string;
  /** Крупно в карточке: «14 дней», «1 990 ₽». */
  cardValue: string;
  /** Призыв над телефоном: «Подключите за день». */
  cta: string;
};

export type PosterArt = PosterTexts & {
  scene: PosterScene;
  screen: PosterScreen;
  /** Имя файла сгенерированного фона без текста (`bg-<job>.jpg`); пусто — фона нет. */
  background: string;
  /** Имя файла собранного постера (`poster-<hash>.jpg`); пусто — не собран. */
  image: string;
  /** Для каких надписей собран `image` (`posterTextsKey`) — чтобы не отправить устаревший постер. */
  imageKey: string;
};

export type PosterMailPayload = {
  subject: string;
  headline: string;
  /** Текст под постером: та же простая разметка и переменные, что у «Сообщения». */
  body: string;
  /** Короткий текст для Telegram и MAX; пусто — уходит полный. */
  shortBody: string;
  buttonText: string;
  buttonUrl: string;
  poster: PosterArt;
  fallbacks: { name: string; company: string; sphere: string };
};

/** Данные для полей формы — `posterTemplate.formData()`. */
export type PosterFormData = {
  /** Цена «Стандарта» помесячно из `/root/tariffs`; null — не прочиталась. */
  standardMonthRub: number | null;
};

/** «2990» → «2 990 ₽» (обычный пробел — так его рисует шрифт постера). */
export function posterRub(value: number): string {
  return `${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
}

/** Готовые варианты карточки: только правда из кода и тарифов. */
export function posterCardPresets(data: PosterFormData | null): { title: string; value: string }[] {
  const presets = [
    { title: "Бесплатно", value: `${TRIAL_DAYS} дней` },
    { title: "Проверка", value: "без бумаг" },
  ];
  if (data?.standardMonthRub) presets.push({ title: "«Стандарт» в месяц", value: posterRub(data.standardMonthRub) });
  return presets;
}

export const POSTER_SIZE = { width: 1080, height: 1350 } as const;
export const POSTER_LIMITS = { kicker: 32, word: 10, cardTitle: 28, cardValue: 12, cta: 28 } as const;
export const POSTER_SUBJECT_MAX = 150;
export const POSTER_HEADLINE_MAX = 150;
export const POSTER_BODY_MAX = 5000;
export const POSTER_SHORT_BODY_MAX = 1000;
export const POSTER_BUTTON_TEXT_MAX = 40;

/** Каталог в загрузках (`uploadsDir()`): деплой его не стирает, отдаёт маршрут `/uploads/**`. */
export const POSTER_DIR = "mailing-poster";
export const POSTER_PUBLIC_PATH = `/uploads/${POSTER_DIR}/`;
const BACKGROUND_FILE = /^bg-[0-9a-f-]{36}\.jpg$/;
const POSTER_FILE = /^poster-[0-9a-f]{24}\.jpg$/;

export const isPosterBackgroundFile = (name: string) => BACKGROUND_FILE.test(name);
export const isPosterImageFile = (name: string) => POSTER_FILE.test(name);

/** Сайт и телефон на постере и в письме — из `company-contacts`, не выдумываются. */
export const POSTER_SITE = "wesetup.ru";
export const POSTER_PHONE = COMPANY_PHONE;

export function defaultPosterTexts(): PosterTexts {
  return {
    kicker: "Электронные журналы",
    word: "ХАССП",
    cardTitle: "Бесплатно",
    cardValue: `${TRIAL_DAYS} дней`,
    cta: "Подключите за день",
  };
}

export function defaultPosterArt(): PosterArt {
  return { ...defaultPosterTexts(), scene: "restaurant", screen: "grid", background: "", image: "", imageKey: "" };
}

export function defaultPosterPayload(): PosterMailPayload {
  return {
    subject: "Журналы ХАССП в телефоне — проверка без бумаг",
    headline: "Журналы ХАССП — в телефоне, а не в папке",
    body:
      "Здравствуйте, {имя}!\n\n" +
      "Сотрудники отмечают температуру, уборку и гигиену с телефона — по QR-коду на стене, без бумажных журналов. " +
      "Вы видите, что заполнено сегодня, а на проверке показываете всё с экрана или печатаете в один клик.\n\n" +
      `Первые ${TRIAL_DAYS} дней — бесплатно и без ограничений. Поможем всё настроить.`,
    shortBody: "",
    buttonText: "Попробовать бесплатно",
    buttonUrl: "https://wesetup.ru/register",
    poster: defaultPosterArt(),
    fallbacks: { name: "коллеги", company: "ваше заведение", sphere: "общепит" },
  };
}

/**
 * Ключ надписей: постер, собранный для одних надписей, не уходит с
 * другими. Входят фон и экран телефона — они тоже меняют картинку.
 */
export function posterTextsKey(art: Pick<PosterArt, keyof PosterTexts | "screen" | "background">): string {
  return JSON.stringify([art.background, art.screen, art.kicker, art.word, art.cardTitle, art.cardValue, art.cta]);
}

/** Слово на постере — заглавными, без пробелов. */
export function posterWord(value: string): string {
  return value.trim().toLocaleUpperCase("ru-RU");
}

/** alt постера: пересказ всех надписей, чтобы письмо читалось и без картинок. */
export function posterAlt(art: PosterTexts): string {
  const word = posterWord(art.word);
  const parts = [
    `${word}${art.kicker ? ` — ${art.kicker.toLocaleLowerCase("ru-RU")}` : ""}.`,
    art.cardTitle || art.cardValue ? `${[art.cardTitle, art.cardValue].filter(Boolean).join(": ")}.` : "",
    `${art.cta || "Звоните"}: ${POSTER_PHONE.display}, ${POSTER_SITE}.`,
  ];
  return parts.filter(Boolean).join(" ");
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function pick<T extends string>(value: unknown, options: { key: T }[], fallback: T): T {
  return options.some((o) => o.key === value) ? (value as T) : fallback;
}

/** Данные из черновика (что угодно) → форма с нужными полями. */
export function coercePosterPayload(raw: unknown): PosterMailPayload {
  const base = defaultPosterPayload();
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const p = r.poster && typeof r.poster === "object" ? (r.poster as Record<string, unknown>) : {};
  const f = r.fallbacks && typeof r.fallbacks === "object" ? (r.fallbacks as Record<string, unknown>) : {};
  const text = (key: keyof PosterTexts) => (typeof p[key] === "string" ? str(p[key], 200) : base.poster[key]);
  return {
    subject: typeof r.subject === "string" ? str(r.subject, 1000) : base.subject,
    headline: typeof r.headline === "string" ? str(r.headline, 1000) : base.headline,
    body: typeof r.body === "string" ? str(r.body, 20000) : base.body,
    shortBody: str(r.shortBody, 4000),
    buttonText: typeof r.buttonText === "string" ? str(r.buttonText, 200) : base.buttonText,
    buttonUrl: typeof r.buttonUrl === "string" ? str(r.buttonUrl, 2000) : base.buttonUrl,
    poster: {
      kicker: text("kicker"),
      word: text("word"),
      cardTitle: text("cardTitle"),
      cardValue: text("cardValue"),
      cta: text("cta"),
      scene: pick(p.scene, POSTER_SCENES, "restaurant"),
      screen: pick(p.screen, POSTER_SCREENS, "grid"),
      background: str(p.background, 200),
      image: str(p.image, 200),
      imageKey: str(p.imageKey, 2000),
    },
    fallbacks: {
      name: typeof f.name === "string" ? f.name.slice(0, 60) : base.fallbacks.name,
      company: typeof f.company === "string" ? f.company.slice(0, 60) : base.fallbacks.company,
      sphere: typeof f.sphere === "string" ? f.sphere.slice(0, 60) : base.fallbacks.sphere,
    },
  };
}

const POSTER_TEXT_LABELS: Record<keyof PosterTexts, string> = {
  kicker: "Плашка над словом",
  word: "Слово на постере",
  cardTitle: "Подпись карточки",
  cardValue: "Крупно в карточке",
  cta: "Призыв над телефоном",
};

/** Проверка надписей постера (и для сборки картинки на сервере). */
export function checkPosterTexts(raw: Partial<Record<keyof PosterTexts, unknown>>): { ok: true; texts: PosterTexts } | { ok: false; error: string } {
  const texts = {} as PosterTexts;
  for (const key of Object.keys(POSTER_TEXT_LABELS) as (keyof PosterTexts)[]) {
    const value = typeof raw[key] === "string" ? (raw[key] as string).replace(/\s+/g, " ").trim() : "";
    if (value.length > POSTER_LIMITS[key]) return { ok: false, error: `${POSTER_TEXT_LABELS[key]} — не длиннее ${POSTER_LIMITS[key]} знаков` };
    if (/[\u0000-\u001f<>{}]/.test(value)) return { ok: false, error: `${POSTER_TEXT_LABELS[key]}: недопустимые символы` };
    texts[key] = value;
  }
  if (!texts.word) return { ok: false, error: "Напишите слово для постера — например, «ХАССП»" };
  if (/\s/.test(texts.word)) return { ok: false, error: "Слово на постере — одно слово, без пробелов" };
  return { ok: true, texts };
}

export function validatePosterPayload(raw: unknown): { ok: true; payload: PosterMailPayload } | { ok: false; error: string } {
  const c = coercePosterPayload(raw);
  const checked = checkPosterTexts(c.poster);
  if (!checked.ok) return checked;
  const payload: PosterMailPayload = {
    subject: c.subject.replace(/\s+/g, " ").trim(),
    headline: c.headline.replace(/\s+/g, " ").trim(),
    body: c.body.replace(/\r\n?/g, "\n").trim(),
    shortBody: c.shortBody.replace(/\r\n?/g, "\n").trim(),
    buttonText: c.buttonText.trim(),
    buttonUrl: c.buttonUrl.trim(),
    poster: { ...c.poster, ...checked.texts },
    fallbacks: { name: c.fallbacks.name.trim(), company: c.fallbacks.company.trim(), sphere: c.fallbacks.sphere.trim() },
  };
  if (!payload.subject) return { ok: false, error: "Напишите тему письма" };
  if (payload.subject.length > POSTER_SUBJECT_MAX) return { ok: false, error: `Тема — не длиннее ${POSTER_SUBJECT_MAX} знаков` };
  if (!payload.headline) return { ok: false, error: "Напишите заголовок под постером" };
  if (payload.headline.length > POSTER_HEADLINE_MAX) return { ok: false, error: `Заголовок — не длиннее ${POSTER_HEADLINE_MAX} знаков` };
  if (!payload.body) return { ok: false, error: "Напишите текст под постером" };
  if (payload.body.length > POSTER_BODY_MAX) return { ok: false, error: `Текст — не длиннее ${POSTER_BODY_MAX} знаков` };
  if (payload.shortBody.length > POSTER_SHORT_BODY_MAX) {
    return { ok: false, error: `Короткий текст для Telegram и MAX — не длиннее ${POSTER_SHORT_BODY_MAX} знаков` };
  }
  if (payload.buttonText || payload.buttonUrl) {
    if (!payload.buttonText) return { ok: false, error: "У кнопки нет текста — напишите его или уберите ссылку" };
    if (payload.buttonText.length > POSTER_BUTTON_TEXT_MAX) return { ok: false, error: `Текст кнопки — не длиннее ${POSTER_BUTTON_TEXT_MAX} знаков` };
    if (!payload.buttonUrl) return { ok: false, error: "У кнопки нет ссылки — вставьте её или уберите текст" };
    if (!isSafeLinkUrl(payload.buttonUrl)) return { ok: false, error: "Ссылка кнопки — адрес https://… или путь сайта вида /pricing" };
  }
  const art = payload.poster;
  if (art.background && !isPosterBackgroundFile(art.background)) return { ok: false, error: "Фон постера должен быть сгенерирован в редакторе" };
  if (art.image && !isPosterImageFile(art.image)) return { ok: false, error: "Постер должен быть собран в редакторе" };
  if (art.image && art.imageKey !== posterTextsKey(art)) {
    return { ok: false, error: "Надписи постера изменились — нажмите «Обновить надписи», чтобы собрать его заново" };
  }
  if (art.background && !art.image) return { ok: false, error: "Фон готов, но постер не собран — нажмите «Обновить надписи»" };
  return { ok: true, payload };
}
