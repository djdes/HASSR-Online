/**
 * Контроль качества СММ-поста перед публикацией — чистая логика без БД,
 * сети и зависимостей. Файл переносимый: одинаковый в WeSetup, Magday,
 * OrdersFlow и Yesbeat; всё, что отличает проекты, — в `BrandProfile`.
 *
 * Что проверяем (номера — из общего списка фич, docs/smm-features.md):
 *  B01 итоговый балл, B02 шлюз публикации, B03 профиль бренда как правила,
 *  B04 стоп-слова, B05 словарь замен, B06 эмодзи, B07 длина, B08 читаемость,
 *  B09 канцелярит, B11 «вы/ты», B12 обязательные элементы, B13 контакты,
 *  B14 UTM, B16 упоминание бренда, B17 капс и «!!!», B18 спам-слова,
 *  B19 повторы, B20 дубль прошлых постов, B21 частота и тихие часы,
 *  B22 баланс рубрик (план), B23 призыв, B25 конкретика в цифрах,
 *  B26 даты и дедлайны, B27 соцдоказательство, B28 первая строка,
 *  B29 картинки, B30 автоисправления.
 */

// ───────────────────────────── типы ─────────────────────────────

export type SmmPlatform = "telegram" | "max";
export type RubricKind = "useful" | "selling" | "news" | "entertaining";

export interface BrandRubric {
  key: string;
  label: string;
  kind: RubricKind;
  /** Хэштег рубрики — подставляется автоисправлением. */
  hashtag?: string;
  /** Коридор длины текста для рубрики (без разметки). */
  length?: { min: number; max: number };
  /** Что обязательно в посте этой рубрики. */
  require?: Partial<Record<RequiredElement, boolean>>;
}

export type RequiredElement = "image" | "button" | "link" | "phone" | "site" | "brand" | "hashtag" | "cta";

export interface BrandProfile {
  /** Имя бренда в правильном написании. */
  name: string;
  /** Тоже правильные упоминания (русское имя, короткое). */
  nameVariants: string[];
  /** Неправильные написания → как надо. */
  replacements: Array<{ wrong: string; right: string }>;
  /** Домены своего сайта (без www). */
  siteHosts: string[];
  /** Эталонные телефоны, как их пишем. */
  phones: string[];
  /** Подпись с контактами — добавляется автоисправлением. */
  signature: string;
  /** Хэштеги бренда: хотя бы один должен быть в посте. */
  hashtags: string[];
  hashtagsRange: { min: number; max: number };
  /** Запрещённые слова и обороты бренда (по началу слова, без учёта регистра). */
  stopWords: Array<{ word: string; reason: string }>;
  /** Как обращаемся к читателю. */
  address: "вы" | "ты";
  emojiRange: { min: number; max: number };
  /** Коридор длины по умолчанию (без разметки). */
  length: { min: number; max: number };
  /** Первая строка — заголовок жирным. */
  boldHeadline: boolean;
  rubrics: BrandRubric[];
  /** Окно публикаций по Москве, HH:MM. */
  postingWindow: { from: string; to: string };
  maxPostsPerDay: number;
  /** Минимальный интервал между постами в один канал, минут. */
  minGapMinutes: number;
  /** Доля продающих постов за неделю, не больше. */
  maxSellingShare: number;
  /** Ниже — публиковать только с подтверждением. */
  minScoreToPublish: number;
  colors: { primary: string; accent: string; dark: string; light: string };
  /** Описание тона для ИИ-рецензии. */
  toneOfVoice: string;
}

export interface PostImageMeta {
  width?: number;
  height?: number;
  bytes?: number;
  /** Сделана по шаблону бренда (B29). */
  branded?: boolean;
}

export interface PostInput {
  text: string;
  images?: PostImageMeta[];
  buttonText?: string | null;
  buttonUrl?: string | null;
  scheduledAt?: Date | string | null;
  rubric?: string | null;
  platforms?: SmmPlatform[];
  campaign?: string | null;
}

export interface RecentPost {
  text: string;
  at: Date | string;
  rubric?: string | null;
  /** Каналы поста — для частоты по каналу. */
  channelIds?: string[];
}

export interface AnalyzeContext {
  now?: Date;
  /** Посты за последние недели — для дублей, частоты и баланса рубрик. */
  recent?: RecentPost[];
  channelIds?: string[];
}

export type CheckStatus = "ok" | "warn" | "fail";
export type CheckGroup = "brand" | "checklist" | "spam" | "sales" | "readability" | "platform" | "schedule";

export type FixId =
  | "replace-spelling"
  | "add-signature"
  | "add-hashtags"
  | "trim-hashtags"
  | "fix-caps"
  | "fix-exclamations"
  | "trim-emoji"
  | "bold-headline"
  | "add-cta"
  | "remove-stop-words"
  | "collapse-blank-lines";

export interface CheckItem {
  id: string;
  /** Номер фичи из списка (B04 и т. п.). */
  feature: string;
  group: CheckGroup;
  label: string;
  status: CheckStatus;
  /** Что не так и как исправить. */
  hint?: string;
  /** Блокирующая ошибка: публикация только с явным подтверждением. */
  blocking?: boolean;
  fix?: FixId;
  /** Фрагменты текста для подсветки. */
  marks?: string[];
}

export interface PostReport {
  score: number;
  verdict: "ready" | "improve" | "block";
  groups: Record<CheckGroup, number>;
  spamIndex: number;
  salesIndex: number;
  items: CheckItem[];
  stats: {
    chars: number;
    words: number;
    sentences: number;
    emoji: number;
    hashtags: string[];
    links: string[];
    capsShare: number;
    firstLine: string;
    readingSeconds: number;
  };
  fixes: FixId[];
}

// ───────────────────────────── утилиты ─────────────────────────────

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /(^|\s)#([\p{L}\p{N}_]{2,64})/gu;
const URL_RE = /https?:\/\/[^\s)\]>]+/gi;
const PHONE_RE = /(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g;

/** Текст без разметки markdown MAX/Telegram: **ж**, *к*, __п__, `к`, [т](u). */
export function plainText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/<\/?(?:b|strong|i|em|u|s|code|pre|a)[^>]*>/gi, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, "$1$2");
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? ([] as string[])).filter((w) => w.length > 0);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}]/u.test(s));
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Слово или оборот с любым окончанием: «разрабатыва» найдёт «разрабатываем». */
function stemRe(word: string): RegExp {
  const parts = word.trim().split(/\s+/).map(escapeRe);
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join("\\s+")}[\\p{L}]*`, "giu");
}

function digitsOnly(value: string): string {
  const d = value.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("8") ? `7${d.slice(1)}` : d;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Минуты от полуночи по Москве (UTC+3 без перехода). */
export function moscowMinutes(date: Date): number {
  return ((date.getUTCHours() + 3) % 24) * 60 + date.getUTCMinutes();
}

export function moscowDay(date: Date): string {
  return new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Шинглы по 3 слова — для сходства постов (B20). */
function shingles(text: string): Set<string> {
  const list = words(plainText(text)).filter((w) => w.length > 2);
  const out = new Set<string>();
  for (let i = 0; i + 2 < list.length; i += 1) out.add(`${list[i]} ${list[i + 1]} ${list[i + 2]}`);
  return out;
}

export function similarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  for (const s of sa) if (sb.has(s)) common += 1;
  return common / Math.min(sa.size, sb.size);
}

// ───────────────────────────── словари ─────────────────────────────

/** Рекламные триггеры спам-фильтров и раздражители аудитории (B18). */
export const SPAM_PHRASES: Array<{ phrase: string; weight: number }> = [
  { phrase: "только сегодня", weight: 2 },
  { phrase: "успей", weight: 2 },
  { phrase: "спеши", weight: 2 },
  { phrase: "срочно", weight: 2 },
  { phrase: "халяв", weight: 3 },
  { phrase: "гарантия 100", weight: 3 },
  { phrase: "100% гарант", weight: 3 },
  { phrase: "100% результат", weight: 3 },
  { phrase: "без вложений", weight: 3 },
  { phrase: "заработ", weight: 2 },
  { phrase: "шок", weight: 2 },
  { phrase: "сенсац", weight: 2 },
  { phrase: "жми", weight: 2 },
  { phrase: "кликай", weight: 2 },
  { phrase: "переходи по ссылке", weight: 1 },
  { phrase: "лучший в мире", weight: 2 },
  { phrase: "лучшая цена", weight: 1 },
  { phrase: "самый лучший", weight: 2 },
  { phrase: "уникальное предложение", weight: 2 },
  { phrase: "не упусти", weight: 2 },
  { phrase: "последний шанс", weight: 2 },
  { phrase: "акция века", weight: 3 },
  { phrase: "бешеные скидки", weight: 3 },
  { phrase: "розыгрыш", weight: 1 },
  { phrase: "подпишись", weight: 1 },
  { phrase: "ставь лайк", weight: 2 },
  { phrase: "репост", weight: 1 },
];

/** Канцелярит и рекламные штампы (B09). */
export const CLICHES: string[] = [
  "в целях",
  "является",
  "осуществля",
  "данный",
  "данная",
  "данное",
  "в рамках",
  "на сегодняшний день",
  "в настоящее время",
  "индивидуальный подход",
  "лидер рынка",
  "команда профессионалов",
  "высокое качество",
  "широкий ассортимент",
  "динамично развивающ",
  "доступные цены",
  "оптимальное решение",
  "в кратчайшие сроки",
  "не имеющ аналогов",
  "производит",
  "имеет место",
];

/** Глаголы и обороты призыва (B23). */
export const CTA_WORDS: string[] = [
  "закаж",
  "заказать",
  "попробу",
  "подключ",
  "запиш",
  "оставь",
  "напиш",
  "позвон",
  "скача",
  "узна",
  "получи",
  "переход",
  "выбер",
  "забронир",
  "купи",
  "оформ",
  "приход",
  "загляни",
  "жд",
  "регистрир",
  "зарегистрир",
  "ответ",
  "сохран",
  "посмотр",
  "читай",
  "читайте",
  "слушай",
  "включ",
];

const BENEFIT_WORDS = ["выгод", "эконом", "скидк", "бесплатн", "подар", "бонус", "без ", "быстре", "проще", "меньше", "экономи", "сбереж", "вернём", "минут", "за 1", "за один"];
const PROOF_WORDS = ["клиент", "отзыв", "рейтинг", "★", "⭐", "уже ", "довер", "кейс", "партн", "ресторан", "заведени", "точек", "заказов", "пользовател", "слушател"];
const URGENCY_WORDS = ["до ", "успейте", "остал", "ограничен", "только до", "последн", "сегодня", "завтра", "до конца"];
const GREETINGS = ["привет", "здравствуй", "добрый день", "доброе утро", "добрый вечер", "друзья", "дорогие"];
const TY_FORMS = /(?<![\p{L}])(ты|тебя|тебе|тобой|твой|твоя|твоё|твое|твои|твоих|твоим)(?![\p{L}])/giu;
const VY_FORMS = /(?<![\p{L}])(вы|вас|вам|вами|ваш|ваша|ваше|ваши|ваших|вашим|вашего|вашей)(?![\p{L}])/giu;
const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];

// ───────────────────────────── анализ поста ─────────────────────────────

const WEIGHTS: Record<CheckGroup, number> = {
  brand: 0.22,
  checklist: 0.22,
  spam: 0.18,
  sales: 0.18,
  readability: 0.1,
  platform: 0.05,
  schedule: 0.05,
};

export const GROUP_LABELS: Record<CheckGroup, string> = {
  brand: "Фирменный стиль",
  checklist: "Чек-лист",
  spam: "Заспамленность",
  sales: "Сила продажи",
  readability: "Читаемость",
  platform: "Лимиты площадок",
  schedule: "Время и частота",
};

export function rubricOf(profile: BrandProfile, key: string | null | undefined): BrandRubric | null {
  if (!key) return null;
  return profile.rubrics.find((r) => r.key === key) ?? null;
}

export function analyzePost(post: PostInput, profile: BrandProfile, context: AnalyzeContext = {}): PostReport {
  const now = context.now ?? new Date();
  const raw = (post.text ?? "").replace(/\r\n/g, "\n");
  const plain = plainText(raw);
  const lower = plain.toLowerCase();
  const items: CheckItem[] = [];
  const add = (item: CheckItem) => items.push(item);
  const rubric = rubricOf(profile, post.rubric);
  const images = post.images ?? [];
  const platforms = post.platforms?.length ? post.platforms : (["telegram", "max"] as SmmPlatform[]);

  const wordList = words(plain);
  const sentenceList = sentences(plain);
  const emojiCount = (plain.match(EMOJI_RE) ?? []).length;
  const hashtags = [...plain.matchAll(HASHTAG_RE)].map((m) => `#${m[2]}`);
  const links = raw.match(URL_RE) ?? [];
  const allLinks = [...links, ...(post.buttonUrl ? [post.buttonUrl] : [])];
  const letters = plain.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "");
  const capsShare = letters.length ? upper.length / letters.length : 0;
  const firstLineRaw = raw.split("\n").find((line) => line.trim()) ?? "";
  const firstLine = plainText(firstLineRaw).trim();
  const textChars = plain.trim().length;

  // ── Фирменный стиль ──
  for (const { wrong, right } of profile.replacements) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(wrong)}(?![\\p{L}\\p{N}])`, "gu");
    const found = plain.match(re);
    if (found?.length) {
      add({
        id: `spelling:${wrong}`,
        feature: "B05",
        group: "brand",
        label: `Пишем «${right}», а не «${wrong}»`,
        status: "fail",
        hint: `Найдено ${found.length} раз(а). Исправится одной кнопкой.`,
        fix: "replace-spelling",
        marks: [wrong],
      });
    }
  }

  const stopHits: string[] = [];
  for (const stop of profile.stopWords) {
    const found = plain.match(stemRe(stop.word));
    if (found?.length) {
      stopHits.push(...found);
      add({
        id: `stop:${stop.word}`,
        feature: "B04",
        group: "brand",
        label: `Стоп-слово «${found[0]}»`,
        status: "fail",
        hint: stop.reason,
        blocking: true,
        fix: "remove-stop-words",
        marks: found,
      });
    }
  }
  if (stopHits.length === 0 && profile.stopWords.length) {
    add({ id: "stop", feature: "B04", group: "brand", label: "Нет стоп-слов бренда", status: "ok" });
  }

  const cliches = CLICHES.filter((c) => stemRe(c).test(plain));
  add({
    id: "cliches",
    feature: "B09",
    group: "brand",
    label: cliches.length ? `Канцелярит и штампы: ${cliches.length}` : "Без канцелярита",
    status: cliches.length === 0 ? "ok" : cliches.length <= 1 ? "warn" : "fail",
    hint: cliches.length ? `Перепишите проще: ${cliches.slice(0, 5).map((c) => `«${c}…»`).join(", ")}.` : undefined,
    marks: cliches,
  });

  const ty = (plain.match(TY_FORMS) ?? []).length;
  const vy = (plain.match(VY_FORMS) ?? []).length;
  const wrongAddress = profile.address === "вы" ? ty : vy;
  const rightAddress = profile.address === "вы" ? vy : ty;
  add({
    id: "address",
    feature: "B11",
    group: "brand",
    label: wrongAddress
      ? rightAddress
        ? `Смешаны «вы» и «ты»`
        : `Обращение на «${profile.address === "вы" ? "ты" : "вы"}» — у бренда «${profile.address}»`
      : `Обращение на «${profile.address}»`,
    status: wrongAddress ? "fail" : "ok",
    hint: wrongAddress ? `В фирменном стиле к читателю обращаемся на «${profile.address}».` : undefined,
  });

  const emojiStatus: CheckStatus =
    emojiCount > profile.emojiRange.max * 2 ? "fail" : emojiCount > profile.emojiRange.max || emojiCount < profile.emojiRange.min ? "warn" : "ok";
  const emojiRun = /(\p{Extended_Pictographic}️?\s*){3,}/u.test(plain);
  add({
    id: "emoji",
    feature: "B06",
    group: "brand",
    label: `Эмодзи: ${emojiCount} (норма ${profile.emojiRange.min}–${profile.emojiRange.max})`,
    status: emojiRun && emojiStatus === "ok" ? "warn" : emojiStatus,
    hint:
      emojiCount > profile.emojiRange.max
        ? "Перебор эмодзи выглядит как спам — оставьте по одному на смысловой блок."
        : emojiCount < profile.emojiRange.min
          ? "Один эмодзи перед заголовком помогает зацепить взгляд в ленте."
          : emojiRun
            ? "Три эмодзи подряд — признак спама."
            : undefined,
    fix: emojiCount > profile.emojiRange.max || emojiRun ? "trim-emoji" : undefined,
  });

  if (profile.boldHeadline) {
    const bold = /^\s*(?:\p{Extended_Pictographic}️?\s*)?(\*\*|<b>|<strong>)/u.test(firstLineRaw);
    add({
      id: "headline",
      feature: "B03",
      group: "brand",
      label: bold ? "Заголовок выделен жирным" : "Первая строка — не жирный заголовок",
      status: bold ? "ok" : "warn",
      hint: bold ? undefined : "По фирменному стилю пост начинается с короткого жирного заголовка.",
      fix: bold ? undefined : "bold-headline",
    });
  }

  const brandRe = [profile.name, ...profile.nameVariants].map((n) => escapeRe(n)).join("|");
  const brandMentions = brandRe ? plain.match(new RegExp(`(?<![\\p{L}])(${brandRe})`, "giu"))?.length ?? 0 : 0;
  const siteMentioned = allLinks.some((l) => profile.siteHosts.includes(hostOf(l) ?? "")) ||
    profile.siteHosts.some((h) => lower.includes(h));
  add({
    id: "brand-mention",
    feature: "B16",
    group: "brand",
    label: brandMentions ? `Бренд упомянут ${brandMentions} раз(а)` : "Бренд не упомянут",
    status: brandMentions ? (brandMentions > 4 ? "warn" : "ok") : siteMentioned ? "warn" : "fail",
    hint: brandMentions > 4
      ? "Больше четырёх упоминаний бренда читается как реклама в лоб."
      : brandMentions
        ? undefined
        : `Назовите «${profile.name}» хотя бы раз — иначе пост не связывается с брендом при пересылке.`,
    fix: brandMentions ? undefined : "add-signature",
  });

  // ── Чек-лист ──
  const require = { image: true, button: false, link: true, phone: false, site: true, brand: true, hashtag: true, cta: true, ...(rubric?.require ?? {}) };

  add({
    id: "image",
    feature: "B12",
    group: "checklist",
    label: images.length ? `Фото: ${images.length}` : "Нет фото",
    status: images.length ? "ok" : require.image ? "fail" : "warn",
    hint: images.length ? undefined : "Посты с картинкой собирают заметно больше просмотров — добавьте фото или соберите по шаблону бренда.",
  });

  const hasButton = Boolean(post.buttonText?.trim() && post.buttonUrl?.trim());
  add({
    id: "button",
    feature: "B12",
    group: "checklist",
    label: hasButton ? "Кнопка-ссылка есть" : "Нет кнопки-ссылки",
    status: hasButton ? "ok" : require.button ? "fail" : allLinks.length ? "ok" : "warn",
    hint: hasButton ? undefined : "Кнопка под постом кликается лучше ссылки в тексте.",
  });

  const ownLinks = allLinks.filter((l) => profile.siteHosts.includes(hostOf(l) ?? ""));
  add({
    id: "site",
    feature: "B12",
    group: "checklist",
    label: ownLinks.length || siteMentioned ? "Ссылка на сайт есть" : "Нет ссылки на сайт",
    status: ownLinks.length || siteMentioned ? "ok" : require.site ? "fail" : "warn",
    hint: ownLinks.length || siteMentioned ? undefined : `Дайте путь к покупке: ссылка на ${profile.siteHosts[0] ?? "сайт"} кнопкой или в подписи.`,
    fix: ownLinks.length || siteMentioned ? undefined : "add-signature",
  });

  const phonesInText = plain.match(PHONE_RE) ?? [];
  const knownPhones = new Set(profile.phones.map(digitsOnly));
  // Эталона нет (у бренда не задан телефон) — сверять не с чем, номер не блокируем.
  const foreignPhones = knownPhones.size ? phonesInText.filter((p) => !knownPhones.has(digitsOnly(p))) : [];
  add({
    id: "phone",
    feature: "B13",
    group: "checklist",
    label: foreignPhones.length
      ? `Чужой или опечатанный телефон: ${foreignPhones[0]}`
      : phonesInText.length
        ? "Телефон указан верно"
        : "Нет телефона",
    status: foreignPhones.length ? "fail" : phonesInText.length ? "ok" : require.phone ? "fail" : "warn",
    blocking: foreignPhones.length > 0,
    hint: foreignPhones.length
      ? `Эталонные номера: ${profile.phones.join(", ")}.`
      : phonesInText.length
        ? undefined
        : "Телефон в подписи даёт тем, кто не любит формы, позвонить сразу.",
    fix: phonesInText.length ? undefined : "add-signature",
    marks: foreignPhones,
  });

  const foreignHosts = [...new Set(allLinks.map(hostOf).filter((h): h is string => Boolean(h) && !profile.siteHosts.includes(h as string)))];
  const untagged = ownLinks.filter((l) => !/[?&]utm_source=/.test(l));
  add({
    id: "utm",
    feature: "B14",
    group: "checklist",
    label: ownLinks.length
      ? untagged.length
        ? "UTM-метки поставятся при публикации"
        : "UTM-метки на месте"
      : "Нет своих ссылок для UTM",
    status: ownLinks.length ? "ok" : "warn",
    hint: post.campaign?.trim() ? undefined : ownLinks.length ? "Задайте метку кампании, чтобы отличать пост в Метрике." : undefined,
  });
  if (foreignHosts.length) {
    add({
      id: "foreign-links",
      feature: "B14",
      group: "checklist",
      label: `Ссылки на чужие сайты: ${foreignHosts.join(", ")}`,
      status: "warn",
      hint: "Трафик уйдёт не к вам — проверьте, что так и задумано.",
    });
  }

  const hashtagStatus: CheckStatus =
    hashtags.length < profile.hashtagsRange.min ? (require.hashtag ? "warn" : "ok") : hashtags.length > profile.hashtagsRange.max ? "warn" : "ok";
  const brandTag = hashtags.some((h) => profile.hashtags.map((t) => t.toLowerCase()).includes(h.toLowerCase()));
  add({
    id: "hashtags",
    feature: "B12",
    group: "checklist",
    label: `Хэштеги: ${hashtags.length} (норма ${profile.hashtagsRange.min}–${profile.hashtagsRange.max})${hashtags.length && !brandTag ? ", нет фирменного" : ""}`,
    status: hashtagStatus === "ok" && hashtags.length && !brandTag ? "warn" : hashtagStatus,
    hint: hashtags.length > profile.hashtagsRange.max
      ? "Много хэштегов — признак спама."
      : hashtags.length < profile.hashtagsRange.min || !brandTag
        ? `Фирменные: ${profile.hashtags.join(" ")}${rubric?.hashtag ? `, рубрики: ${rubric.hashtag}` : ""}.`
        : undefined,
    fix: hashtags.length > profile.hashtagsRange.max ? "trim-hashtags" : hashtags.length < profile.hashtagsRange.min || !brandTag ? "add-hashtags" : undefined,
  });

  // ── Заспамленность ──
  let spamPoints = 0;
  const capsWords = (plain.match(/(?<![\p{L}])\p{Lu}{4,}(?![\p{L}])/gu) ?? []).filter(
    (w) => !profile.nameVariants.concat(profile.name).some((n) => n.toUpperCase() === w) && !/^(ХАССП|СанПиН|САНПИН|ГОСТ|ИНН|ООО|ИП|МСК|HACCP|UTM|QR|DJ|MP3|API|CRM|POS|ТЦ|РФ|МАУ)$/u.test(w),
  );
  const capsStatus: CheckStatus = capsShare > 0.3 || capsWords.length >= 3 ? "fail" : capsWords.length >= 1 ? "warn" : "ok";
  spamPoints += capsStatus === "fail" ? 3 : capsStatus === "warn" ? 1 : 0;
  add({
    id: "caps",
    feature: "B17",
    group: "spam",
    label: capsWords.length ? `Слова капсом: ${capsWords.slice(0, 3).join(", ")}` : "Без капса",
    status: capsStatus,
    hint: capsWords.length ? "Капс читается как крик — оставьте акцент жирным." : undefined,
    fix: capsWords.length ? "fix-caps" : undefined,
    marks: capsWords,
  });

  const exclamations = (plain.match(/!/g) ?? []).length;
  const multiPunct = plain.match(/[!?]{2,}/g) ?? [];
  const exclStatus: CheckStatus = multiPunct.length || exclamations > 3 ? "fail" : exclamations > 1 ? "warn" : "ok";
  spamPoints += exclStatus === "fail" ? 2 : exclStatus === "warn" ? 1 : 0;
  add({
    id: "exclamations",
    feature: "B17",
    group: "spam",
    label: multiPunct.length ? `«${multiPunct[0]}» в тексте` : `Восклицаний: ${exclamations}`,
    status: exclStatus,
    hint: exclStatus === "ok" ? undefined : "Хватит одного «!» на пост; «!!!» и «?!» — приметы спама.",
    fix: exclStatus === "ok" ? undefined : "fix-exclamations",
  });

  const spamFound = SPAM_PHRASES.filter((s) => lower.includes(s.phrase));
  const spamWeight = spamFound.reduce((sum, s) => sum + s.weight, 0);
  spamPoints += spamWeight;
  add({
    id: "spam-words",
    feature: "B18",
    group: "spam",
    label: spamFound.length ? `Спам-слова: ${spamFound.map((s) => `«${s.phrase}»`).slice(0, 4).join(", ")}` : "Нет спам-слов",
    status: spamWeight >= 4 ? "fail" : spamWeight >= 1 ? "warn" : "ok",
    hint: spamFound.length ? "Такие слова снижают доверие и охват — скажите о выгоде конкретно." : undefined,
    marks: spamFound.map((s) => s.phrase),
  });

  const counts = new Map<string, number>();
  const brandStems = new Set([profile.name, ...profile.nameVariants].map((n) => n.toLowerCase().slice(0, 6)));
  const bodyWords = words(plain.replace(URL_RE, " ").replace(HASHTAG_RE, " "));
  for (const w of bodyWords) {
    const stem = w.slice(0, 6);
    if (w.length >= 5 && !brandStems.has(stem)) counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }
  const repeatLimit = Math.max(4, Math.ceil(bodyWords.length / 25));
  const repeated = [...counts.entries()].filter(([, n]) => n >= repeatLimit).map(([w]) => w);
  const dupSentences = sentenceList.filter((s, i) => sentenceList.findIndex((o) => o.toLowerCase() === s.toLowerCase()) !== i);
  spamPoints += repeated.length + dupSentences.length * 2;
  add({
    id: "repeats",
    feature: "B19",
    group: "spam",
    label: dupSentences.length ? "Повторяется целое предложение" : repeated.length ? `Частые повторы: ${repeated.slice(0, 3).map((w) => `«${w}…»`).join(", ")}` : "Без повторов",
    status: dupSentences.length ? "fail" : repeated.length ? "warn" : "ok",
    hint: repeated.length || dupSentences.length ? "Замените повторы синонимами или уберите." : undefined,
  });

  const recent = (context.recent ?? []).filter((r) => {
    const at = toDate(r.at);
    return at && now.getTime() - at.getTime() < 60 * 86_400_000 && r.text.trim() !== raw.trim();
  });
  let maxSim = 0;
  let simText = "";
  for (const r of recent) {
    const s = similarity(raw, r.text);
    if (s > maxSim) {
      maxSim = s;
      simText = plainText(r.text).split("\n").find((l) => l.trim())?.slice(0, 60) ?? "";
    }
  }
  spamPoints += maxSim >= 0.6 ? 4 : maxSim >= 0.35 ? 1 : 0;
  add({
    id: "duplicate",
    feature: "B20",
    group: "spam",
    label: maxSim >= 0.35 ? `Похож на прошлый пост на ${Math.round(maxSim * 100)}%` : "Не повторяет прошлые посты",
    status: maxSim >= 0.6 ? "fail" : maxSim >= 0.35 ? "warn" : "ok",
    hint: maxSim >= 0.35 ? `Похожий пост: «${simText}». Подписчики заметят повтор.` : undefined,
  });

  // ── Сила продажи ──
  let salesPoints = 0;
  const ctaFound = CTA_WORDS.filter((c) => new RegExp(`(?<![\\p{L}])${escapeRe(c)}`, "iu").test(lower));
  const hasCta = ctaFound.length > 0 || hasButton;
  salesPoints += hasCta ? 25 : 0;
  add({
    id: "cta",
    feature: "B23",
    group: "sales",
    label: hasCta ? "Есть призыв к действию" : "Нет призыва к действию",
    status: hasCta ? "ok" : require.cta ? "fail" : "warn",
    hint: hasCta ? undefined : "Скажите, что сделать: «Закажите», «Попробуйте», «Позвоните».",
    fix: hasCta ? undefined : "add-cta",
  });

  const numbers = plain.match(/\d[\d\s]*(?:[.,]\d+)?\s*(?:%|₽|руб|р\.|минут|мин|час|дн|шт|раз|км|кг|л\b)/giu) ?? [];
  const vague = ["выгодно", "недорого", "быстро", "качественно", "дёшево", "дешево", "лучшие цены"].filter((v) => lower.includes(v));
  salesPoints += numbers.length ? 20 : 0;
  add({
    id: "numbers",
    feature: "B25",
    group: "sales",
    label: numbers.length ? `Конкретика в цифрах: ${numbers.slice(0, 3).map((n) => n.trim()).join(", ")}` : "Нет цифр — цены, срока, выгоды",
    status: numbers.length ? (vague.length ? "warn" : "ok") : vague.length ? "fail" : "warn",
    hint: numbers.length && !vague.length ? undefined : vague.length ? `Расплывчато: ${vague.map((v) => `«${v}»`).join(", ")} — замените цифрой.` : "Цифра убеждает сильнее прилагательного: «за 2 минуты», «−15%».",
  });

  const benefit = BENEFIT_WORDS.some((b) => lower.includes(b)) || numbers.some((n) => /%|₽|руб/.test(n));
  salesPoints += benefit ? 20 : 0;
  add({
    id: "benefit",
    feature: "B24",
    group: "sales",
    label: benefit ? "Названа выгода для клиента" : "Не видно выгоды для клиента",
    status: benefit ? "ok" : "warn",
    hint: benefit ? undefined : "Ответьте на «что я получу»: экономия времени, денег, меньше штрафов.",
  });

  const proof = PROOF_WORDS.some((p) => lower.includes(p)) || /«[^»]{10,}»/.test(plain);
  salesPoints += proof ? 15 : 0;
  add({
    id: "proof",
    feature: "B27",
    group: "sales",
    label: proof ? "Есть социальное доказательство" : "Нет социального доказательства",
    status: proof ? "ok" : "warn",
    hint: proof ? undefined : "Число клиентов, отзыв или кейс добавляют доверия.",
  });

  const isSelling = rubric?.kind === "selling";
  const urgency = URGENCY_WORDS.some((u) => lower.includes(u));
  salesPoints += urgency ? 10 : 0;
  if (isSelling) {
    add({
      id: "urgency",
      feature: "B26",
      group: "sales",
      label: urgency ? "Есть срок предложения" : "У продающего поста нет срока",
      status: urgency ? "ok" : "warn",
      hint: urgency ? undefined : "Срок («до 30 ноября») подталкивает решиться.",
    });
  }

  const greeting = GREETINGS.some((g) => firstLine.toLowerCase().startsWith(g));
  const hook = /\?|\d/.test(firstLine) || /^(как|почему|зачем|что|сколько|где|когда)\b/i.test(firstLine);
  salesPoints += !greeting && firstLine.length >= 15 && firstLine.length <= 90 ? 10 : 0;
  add({
    id: "first-line",
    feature: "B28",
    group: "sales",
    label: greeting
      ? "Пост начинается с приветствия"
      : firstLine.length > 90
        ? "Первая строка длинная — обрежется в уведомлении"
        : firstLine.length < 15
          ? "Первая строка слишком короткая"
          : hook
            ? "Сильная первая строка"
            : "Первая строка без крючка",
    status: greeting || firstLine.length > 120 || firstLine.length < 8 ? "fail" : firstLine.length > 90 || firstLine.length < 15 || !hook ? "warn" : "ok",
    hint: greeting
      ? "Приветствие съедает превью уведомления — начните с сути."
      : firstLine.length > 90
        ? "В уведомлении видно ~90 символов — уложите суть в них."
        : !hook
          ? "Вопрос или цифра в первой строке цепляют сильнее."
          : undefined,
  });

  // Даты в тексте: срок акции не в прошлом (B26).
  const pubAt = toDate(post.scheduledAt) ?? now;
  const dateRe = new RegExp(`(\\d{1,2})\\s+(${MONTHS.join("|")})[\\p{L}]*`, "giu");
  for (const m of plain.matchAll(dateRe)) {
    const day = Number(m[1]);
    const month = MONTHS.findIndex((mm) => m[2].toLowerCase().startsWith(mm));
    if (month < 0 || day < 1 || day > 31) continue;
    const year = pubAt.getUTCFullYear();
    let date = Date.UTC(year, month, day, 20, 59);
    if (date < pubAt.getTime() - 200 * 86_400_000) date = Date.UTC(year + 1, month, day, 20, 59);
    if (date < pubAt.getTime()) {
      add({
        id: `date:${m[0]}`,
        feature: "B26",
        group: "sales",
        label: `Дата «${m[0]}» уже прошла к моменту публикации`,
        status: "fail",
        blocking: true,
        hint: "Проверьте срок акции или время публикации.",
        marks: [m[0]],
      });
    }
  }
  if (/\[(дата|выгода|цена|имя|ссылка)\]|ПРОМОКОД|XXX|TODO/iu.test(raw)) {
    add({
      id: "placeholders",
      feature: "B12",
      group: "checklist",
      label: "В тексте остались заглушки шаблона",
      status: "fail",
      blocking: true,
      hint: "Замените [дата], [выгода], ПРОМОКОД на настоящие значения.",
    });
  }

  // ── Читаемость ──
  const avgSentence = sentenceList.length ? wordList.length / sentenceList.length : wordList.length;
  const paragraphs = plain.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const longestParagraph = Math.max(0, ...paragraphs.map((p) => p.length));
  const longWords = wordList.filter((w) => w.length >= 13).length;
  add({
    id: "sentences",
    feature: "B08",
    group: "readability",
    label: `Средняя длина предложения: ${avgSentence.toFixed(0)} слов`,
    status: avgSentence > 25 ? "fail" : avgSentence > 17 ? "warn" : "ok",
    hint: avgSentence > 17 ? "С телефона легче читаются предложения до 15 слов." : undefined,
  });
  add({
    id: "paragraphs",
    feature: "B08",
    group: "readability",
    label: longestParagraph > 450 ? "Стена текста без абзацев" : `Абзацев: ${paragraphs.length}`,
    status: longestParagraph > 450 ? "fail" : longestParagraph > 300 ? "warn" : "ok",
    hint: longestParagraph > 300 ? "Разбейте на абзацы по 2–3 предложения." : undefined,
  });
  if (wordList.length > 20 && longWords / wordList.length > 0.12) {
    add({ id: "long-words", feature: "B08", group: "readability", label: "Много длинных слов", status: "warn", hint: "Длинные слова — признак канцелярита, ищите короче." });
  }
  if (/\n{3,}/.test(raw)) {
    add({ id: "blank-lines", feature: "B08", group: "readability", label: "Лишние пустые строки", status: "warn", fix: "collapse-blank-lines" });
  }

  // ── Длина и лимиты площадок ──
  const corridor = rubric?.length ?? profile.length;
  add({
    id: "length",
    feature: "B07",
    group: "brand",
    label: `Длина: ${textChars} знаков (коридор ${corridor.min}–${corridor.max})`,
    status: textChars < corridor.min * 0.6 || textChars > corridor.max * 1.4 ? "fail" : textChars < corridor.min || textChars > corridor.max ? "warn" : "ok",
    hint: textChars > corridor.max ? "Сократите — длинные посты дочитывают реже." : textChars < corridor.min ? "Мало текста — добавьте пользу или детали." : undefined,
  });
  if (platforms.includes("telegram") && images.length > 0 && raw.length > 1024) {
    add({
      id: "tg-caption",
      feature: "A12",
      group: "platform",
      label: "Telegram: подпись к фото длиннее 1024 знаков",
      status: "warn",
      hint: "Фото уйдёт отдельным сообщением, текст — следом. Сократите, чтобы пост был цельным.",
    });
  }
  if (raw.length > 4000) {
    add({ id: "max-limit", feature: "A12", group: "platform", label: "Длиннее 4000 знаков — площадки не примут", status: "fail", blocking: true });
  }
  if (images.length > 10) {
    add({ id: "album-limit", feature: "A12", group: "platform", label: "Больше 10 фото в альбоме", status: "fail", blocking: true });
  }
  images.forEach((img, i) => {
    const n = i + 1;
    if (img.bytes && img.bytes > 10 * 1024 * 1024) {
      add({ id: `img-size-${n}`, feature: "B29", group: "platform", label: `Фото ${n}: больше 10 МБ`, status: "fail", blocking: true });
    }
    if (img.width && img.height) {
      const ratio = img.width / img.height;
      if (Math.min(img.width, img.height) < 600) {
        add({ id: `img-small-${n}`, feature: "B29", group: "platform", label: `Фото ${n}: мелкое (${img.width}×${img.height})`, status: "warn", hint: "Меньше 600 px по короткой стороне — будет мыльным." });
      }
      if (ratio > 2.5 || ratio < 0.4) {
        add({ id: `img-ratio-${n}`, feature: "B29", group: "platform", label: `Фото ${n}: неудобные пропорции`, status: "warn", hint: "Лента обрежет: лучше 4:3, 1:1 или 4:5." });
      }
    }
  });
  if (images.length && images.every((img) => img.branded === false)) {
    add({ id: "img-branded", feature: "B29", group: "brand", label: "Фото без фирменного шаблона", status: "warn", hint: "Соберите картинку по шаблону бренда — она узнаваема в ленте." });
  }

  // ── Время и частота ──
  const at = toDate(post.scheduledAt);
  if (at) {
    const minutes = moscowMinutes(at);
    const from = minutesOfDay(profile.postingWindow.from);
    const to = minutesOfDay(profile.postingWindow.to);
    const inWindow = minutes >= from && minutes <= to;
    add({
      id: "window",
      feature: "B21",
      group: "schedule",
      label: inWindow ? "Время в окне публикаций" : `Публикация в тихие часы (${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} МСК)`,
      status: inWindow ? "ok" : "warn",
      hint: inWindow ? undefined : `Окно бренда: ${profile.postingWindow.from}–${profile.postingWindow.to} МСК. Ночью пост разбудит подписчиков или утонет в ленте.`,
    });
    if (at.getTime() < now.getTime() - 60_000) {
      add({ id: "past", feature: "A05", group: "schedule", label: "Время публикации уже прошло", status: "fail", blocking: true });
    }
    const channelSet = new Set(context.channelIds ?? []);
    const sameChannel = (r: RecentPost) => !channelSet.size || !r.channelIds?.length || r.channelIds.some((c) => channelSet.has(c));
    const others = (context.recent ?? []).filter(sameChannel).map((r) => ({ ...r, date: toDate(r.at) })).filter((r) => r.date) as Array<RecentPost & { date: Date }>;
    const sameDay = others.filter((r) => moscowDay(r.date) === moscowDay(at)).length;
    const close = others.filter((r) => Math.abs(r.date.getTime() - at.getTime()) < profile.minGapMinutes * 60_000);
    add({
      id: "frequency",
      feature: "B21",
      group: "schedule",
      label: close.length
        ? `Рядом другой пост (ближе ${profile.minGapMinutes} мин)`
        : sameDay >= profile.maxPostsPerDay
          ? `В этот день уже ${sameDay} пост(а) — лимит ${profile.maxPostsPerDay}`
          : `В этот день постов: ${sameDay + 1}`,
      status: close.length || sameDay >= profile.maxPostsPerDay ? "warn" : "ok",
      hint: close.length || sameDay >= profile.maxPostsPerDay ? "Частые посты подряд — главная причина отписок. Разнесите по дням." : undefined,
    });
  }

  // ── Итог ──
  const groups = {} as Record<CheckGroup, number>;
  for (const group of Object.keys(WEIGHTS) as CheckGroup[]) {
    const list = items.filter((i) => i.group === group);
    if (!list.length) {
      groups[group] = 100;
      continue;
    }
    const value = list.reduce((sum, i) => sum + (i.status === "ok" ? 1 : i.status === "warn" ? 0.55 : 0), 0) / list.length;
    groups[group] = Math.round(value * 100);
  }
  let score = 0;
  for (const group of Object.keys(WEIGHTS) as CheckGroup[]) score += groups[group] * WEIGHTS[group];
  const blocking = items.some((i) => i.blocking && i.status === "fail");
  score = Math.round(Math.max(0, Math.min(100, blocking ? Math.min(score, 49) : score)));
  const spamIndex = Math.min(100, Math.round(spamPoints * 9));
  const salesIndex = Math.min(100, salesPoints);
  const verdict: PostReport["verdict"] =
    blocking || spamIndex >= 70 || score < profile.minScoreToPublish ? "block" : score < 80 || spamIndex >= 40 ? "improve" : "ready";
  const fixes = [...new Set(items.filter((i) => i.fix && i.status !== "ok").map((i) => i.fix as FixId))];

  const order: Record<CheckStatus, number> = { fail: 0, warn: 1, ok: 2 };
  items.sort((a, b) => order[a.status] - order[b.status]);

  return {
    score,
    verdict,
    groups,
    spamIndex,
    salesIndex,
    items,
    fixes,
    stats: {
      chars: textChars,
      words: wordList.length,
      sentences: sentenceList.length,
      emoji: emojiCount,
      hashtags,
      links: allLinks,
      capsShare: Math.round(capsShare * 100) / 100,
      firstLine,
      readingSeconds: Math.max(1, Math.round((wordList.length / 180) * 60)),
    },
  };
}

// ───────────────────────────── автоисправления (B30) ─────────────────────────────

export const FIX_LABELS: Record<FixId, string> = {
  "replace-spelling": "Исправить написание бренда",
  "add-signature": "Добавить подпись с контактами",
  "add-hashtags": "Добавить фирменные хэштеги",
  "trim-hashtags": "Убрать лишние хэштеги",
  "fix-caps": "Убрать капс",
  "fix-exclamations": "Убрать лишние «!»",
  "trim-emoji": "Убрать лишние эмодзи",
  "bold-headline": "Сделать заголовок жирным",
  "add-cta": "Добавить призыв",
  "remove-stop-words": "Убрать стоп-слова",
  "collapse-blank-lines": "Убрать пустые строки",
};

function splitTail(text: string): { body: string; tags: string[] } {
  const lines = text.replace(/\s+$/, "").split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (/^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(last)) {
    return { body: lines.slice(0, -1).join("\n").replace(/\s+$/, ""), tags: last.trim().split(/\s+/) };
  }
  return { body: text.replace(/\s+$/, ""), tags: [] };
}

function capitalizeWord(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

export function applyFix(post: PostInput, fix: FixId, profile: BrandProfile): string {
  let text = (post.text ?? "").replace(/\r\n/g, "\n");
  const rubric = rubricOf(profile, post.rubric);
  switch (fix) {
    case "replace-spelling":
      for (const { wrong, right } of profile.replacements) {
        text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(wrong)}(?![\\p{L}\\p{N}])`, "gu"), right);
      }
      return text;
    case "remove-stop-words": {
      for (const stop of profile.stopWords) text = text.replace(stemRe(stop.word), "");
      return text.replace(/[ \t]{2,}/g, " ").replace(/ ([,.!?])/g, "$1");
    }
    case "add-signature": {
      const { body, tags } = splitTail(text);
      if (body.includes(profile.signature.trim())) return text;
      return [body, "", profile.signature.trim(), ...(tags.length ? ["", tags.join(" ")] : [])].join("\n");
    }
    case "add-hashtags": {
      const { body, tags } = splitTail(text);
      const want = [...tags];
      const lowerHas = (t: string) => want.some((w) => w.toLowerCase() === t.toLowerCase());
      if (rubric?.hashtag && !lowerHas(rubric.hashtag)) want.push(rubric.hashtag);
      for (const tag of profile.hashtags) {
        if (want.length >= Math.max(profile.hashtagsRange.min, 2)) break;
        if (!lowerHas(tag)) want.push(tag);
      }
      if (!want.some((w) => profile.hashtags.map((t) => t.toLowerCase()).includes(w.toLowerCase())) && profile.hashtags[0]) want.push(profile.hashtags[0]);
      return `${body}\n\n${want.slice(0, profile.hashtagsRange.max).join(" ")}`;
    }
    case "trim-hashtags": {
      let kept = 0;
      return text
        .replace(HASHTAG_RE, (match) => {
          kept += 1;
          return kept <= profile.hashtagsRange.max ? match : "";
        })
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\s+$/, "");
    }
    case "fix-caps":
      return text.replace(/(?<![\p{L}])\p{Lu}{4,}(?![\p{L}])/gu, (w) =>
        profile.nameVariants.concat(profile.name).some((n) => n.toUpperCase() === w) ||
        /^(ХАССП|СанПиН|САНПИН|ГОСТ|ИНН|ООО|ИП|МСК|HACCP|UTM|QR|DJ|MP3|API|CRM|POS|ТЦ|РФ|МАУ)$/u.test(w)
          ? w
          : capitalizeWord(w),
      );
    case "fix-exclamations": {
      let seen = 0;
      return text
        .replace(/\?!|!\?/g, "?")
        .replace(/!{2,}/g, "!")
        .replace(/!/g, () => {
          seen += 1;
          return seen === 1 ? "!" : ".";
        })
        .replace(/\?{2,}/g, "?");
    }
    case "trim-emoji": {
      let seen = 0;
      return text
        .replace(/(\p{Extended_Pictographic}️?)(\s*\p{Extended_Pictographic}️?)+/gu, "$1")
        .replace(/\p{Extended_Pictographic}️?/gu, (e) => {
          seen += 1;
          return seen <= profile.emojiRange.max ? e : "";
        })
        .replace(/[ \t]{2,}/g, " ");
    }
    case "bold-headline": {
      const lines = text.split("\n");
      const idx = lines.findIndex((l) => l.trim());
      if (idx < 0) return text;
      const line = lines[idx].trim();
      const m = /^(\p{Extended_Pictographic}️?\s*)?(.*)$/u.exec(line);
      const emoji = m?.[1] ?? "";
      const rest = (m?.[2] ?? line).replace(/\*\*/g, "");
      lines[idx] = `${emoji}**${rest}**`;
      return lines.join("\n");
    }
    case "add-cta": {
      const { body, tags } = splitTail(text);
      const cta = rubric?.kind === "selling" ? "Оформите заказ — ссылка под постом." : "Подробности — по кнопке под постом.";
      return [body, "", cta, ...(tags.length ? ["", tags.join(" ")] : [])].join("\n");
    }
    case "collapse-blank-lines":
      return text.replace(/\n{3,}/g, "\n\n");
    default:
      return text;
  }
}

/** Все детерминированные исправления подряд — «починить всё». */
export function applyAllFixes(post: PostInput, profile: BrandProfile): string {
  let text = post.text;
  const order: FixId[] = [
    "replace-spelling",
    "remove-stop-words",
    "fix-caps",
    "fix-exclamations",
    "trim-emoji",
    "bold-headline",
    "collapse-blank-lines",
  ];
  const report = analyzePost(post, profile);
  for (const fix of order) if (report.fixes.includes(fix)) text = applyFix({ ...post, text }, fix, profile);
  const again = analyzePost({ ...post, text }, profile);
  for (const fix of ["add-cta", "add-signature", "trim-hashtags", "add-hashtags"] as FixId[]) {
    if (again.fixes.includes(fix)) text = applyFix({ ...post, text }, fix, profile);
  }
  return text;
}

// ───────────────────────────── анализ плана (B21, B22, A07, A29) ─────────────────────────────

export interface PlanPost {
  id: string;
  at: Date | string;
  text: string;
  rubric?: string | null;
  channelIds?: string[];
  status?: string;
}

export interface PlanIssue {
  feature: string;
  level: "warn" | "fail";
  day?: string;
  text: string;
}

export interface PlanReport {
  days: Array<{ day: string; count: number; rubrics: string[] }>;
  rubricShare: Record<RubricKind, number>;
  issues: PlanIssue[];
  /** Ближайшие свободные слоты (A07). */
  freeSlots: Date[];
}

export function analyzePlan(posts: PlanPost[], profile: BrandProfile, opts: { now?: Date; days?: number; slots?: string[] } = {}): PlanReport {
  const now = opts.now ?? new Date();
  const span = opts.days ?? 14;
  const live = posts
    .filter((p) => p.status !== "deleted" && p.status !== "failed")
    .map((p) => ({ ...p, date: toDate(p.at) }))
    .filter((p): p is PlanPost & { date: Date } => Boolean(p.date));
  const days: PlanReport["days"] = [];
  const issues: PlanIssue[] = [];
  const startDay = moscowDay(now);
  for (let i = 0; i < span; i += 1) {
    const day = new Date(Date.parse(`${startDay}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const list = live.filter((p) => moscowDay(p.date) === day);
    days.push({ day, count: list.length, rubrics: list.map((p) => p.rubric ?? "") });
    if (list.length > profile.maxPostsPerDay) {
      issues.push({ feature: "B21", level: "warn", day, text: `${day}: ${list.length} поста при лимите ${profile.maxPostsPerDay}` });
    }
  }
  // Пробелы: 2+ дня подряд без постов в ближайшую неделю.
  let gap = 0;
  for (const d of days.slice(0, 7)) {
    gap = d.count ? 0 : gap + 1;
    if (gap === 2) issues.push({ feature: "A06", level: "warn", day: d.day, text: `Два дня подряд без постов (до ${d.day}) — канал «остывает»` });
  }
  // Баланс рубрик за 7 дней вперёд и 7 назад.
  const weekFrom = now.getTime() - 7 * 86_400_000;
  const weekTo = now.getTime() + 7 * 86_400_000;
  const window = live.filter((p) => p.date.getTime() >= weekFrom && p.date.getTime() <= weekTo);
  const share: Record<RubricKind, number> = { useful: 0, selling: 0, news: 0, entertaining: 0 };
  for (const p of window) {
    const kind = rubricOf(profile, p.rubric)?.kind ?? "useful";
    share[kind] += 1;
  }
  const total = window.length || 1;
  for (const key of Object.keys(share) as RubricKind[]) share[key] = Math.round((share[key] / total) * 100) / 100;
  if (window.length >= 4 && share.selling > profile.maxSellingShare) {
    issues.push({
      feature: "B22",
      level: "warn",
      text: `Продающих постов ${Math.round(share.selling * 100)}% при норме до ${Math.round(profile.maxSellingShare * 100)}% — разбавьте пользой`,
    });
  }
  // Три продающих подряд.
  const sorted = [...live].sort((a, b) => a.date.getTime() - b.date.getTime());
  let run = 0;
  for (const p of sorted) {
    run = rubricOf(profile, p.rubric)?.kind === "selling" ? run + 1 : 0;
    if (run === 3) issues.push({ feature: "B22", level: "warn", day: moscowDay(p.date), text: "Три продающих поста подряд — аудитория устанет" });
  }
  // Почти одинаковые посты в плане.
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length && j < i + 20; j += 1) {
      if (similarity(sorted[i].text, sorted[j].text) >= 0.6) {
        issues.push({ feature: "B20", level: "warn", day: moscowDay(sorted[j].date), text: `Повтор: «${plainText(sorted[j].text).split("\n")[0].slice(0, 50)}» похож на пост от ${moscowDay(sorted[i].date)}` });
      }
    }
  }
  // Ночные посты.
  const from = minutesOfDay(profile.postingWindow.from);
  const to = minutesOfDay(profile.postingWindow.to);
  for (const p of live) {
    if (p.date.getTime() < now.getTime()) continue;
    const m = moscowMinutes(p.date);
    if (m < from || m > to) issues.push({ feature: "B21", level: "warn", day: moscowDay(p.date), text: `Пост в тихие часы: ${moscowDay(p.date)} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` });
  }

  return { days, rubricShare: share, issues, freeSlots: freeSlots(live, profile, { now, slots: opts.slots, count: 5 }) };
}

/** Ближайшие свободные слоты по сетке времени (A07). */
export function freeSlots(
  posts: Array<{ at?: Date | string; date?: Date }>,
  profile: BrandProfile,
  opts: { now?: Date; slots?: string[]; count?: number } = {},
): Date[] {
  const now = opts.now ?? new Date();
  const slots = (opts.slots?.length ? opts.slots : ["10:00", "14:00", "19:00"]).slice().sort();
  const taken = posts.map((p) => (p.date ?? toDate(p.at ?? null))?.getTime()).filter((t): t is number => typeof t === "number");
  const out: Date[] = [];
  const startDay = moscowDay(now);
  for (let d = 0; d < 30 && out.length < (opts.count ?? 5); d += 1) {
    const day = new Date(Date.parse(`${startDay}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    const perDay = taken.filter((t) => moscowDay(new Date(t)) === day).length;
    if (perDay >= profile.maxPostsPerDay) continue;
    for (const slot of slots) {
      const at = new Date(Date.parse(`${day}T00:00:00Z`) + (minutesOfDay(slot) - 180) * 60_000);
      if (at.getTime() < now.getTime() + 10 * 60_000) continue;
      if (taken.some((t) => Math.abs(t - at.getTime()) < profile.minGapMinutes * 60_000)) continue;
      out.push(at);
      if (out.length >= (opts.count ?? 5)) break;
    }
  }
  return out;
}

/** Лучшее время по кликам прошлых постов (A29): час МСК → среднее кликов. */
export function bestHours(history: Array<{ at: Date | string; clicks: number }>, top = 3): Array<{ hour: number; avg: number; posts: number }> {
  const byHour = new Map<number, { sum: number; n: number }>();
  for (const h of history) {
    const date = toDate(h.at);
    if (!date) continue;
    const hour = Math.floor(moscowMinutes(date) / 60);
    const cur = byHour.get(hour) ?? { sum: 0, n: 0 };
    cur.sum += h.clicks;
    cur.n += 1;
    byHour.set(hour, cur);
  }
  return [...byHour.entries()]
    .map(([hour, v]) => ({ hour, avg: Math.round((v.sum / v.n) * 10) / 10, posts: v.n }))
    .filter((v) => v.posts >= 2)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, top);
}

/** Задание для ИИ-рецензии (B10, B24, B30-LLM): ответ — JSON. */
export function buildReviewInstructions(profile: BrandProfile): string {
  return [
    `Ты — главный редактор канала бренда «${profile.name}». Тон бренда: ${profile.toneOfVoice}`,
    `К читателю обращаемся на «${profile.address}». Стоп-слова бренда: ${profile.stopWords.map((s) => s.word).join(", ") || "нет"}.`,
    "Оцени пост: соответствие тону бренда, ясность оффера и выгоды, силу призыва, риски (обещания, которых бренд не даёт).",
    "Затем перепиши пост: сохрани факты, цифры, ссылки и хэштеги; исправь нарушения; длина не больше исходной более чем на 20%; разметка — **жирный** для заголовка.",
    'Ответ — только JSON: {"tone": 0-100, "offer": 0-100, "notes": ["что не так, коротко"], "text": "переписанный пост"}',
  ].join("\n");
}

export function parseReview(raw: string): { tone: number; offer: number; notes: string[]; text: string } | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0);
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) return null;
    return {
      tone: num(data.tone),
      offer: num(data.offer),
      notes: Array.isArray(data.notes) ? data.notes.filter((n): n is string => typeof n === "string").slice(0, 8) : [],
      text,
    };
  } catch {
    return null;
  }
}
