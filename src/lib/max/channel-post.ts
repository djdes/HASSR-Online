import { z } from "zod";

/**
 * Пост в канал MAX — чистая логика без БД и сети: проверка черновика,
 * UTM-метки на ссылки сайта и тело запроса `POST /messages`.
 *
 * Ограничения MAX (dev.max.ru, POST /messages): текст до 4000 символов,
 * не больше 12 вложений, текст кнопки-ссылки 1–128 символов, адрес до
 * 2048. Разметка — markdown MAX: **жирный**, *курсив*, [текст](ссылка).
 */

export const MAX_POST_TEXT_LIMIT = 4000;
export const MAX_POST_IMAGES_LIMIT = 10;
export const MAX_POST_BUTTON_TEXT_LIMIT = 64;

/** Где лежат картинки постов внутри каталога загрузок. */
export const MAX_POST_IMAGE_DIR = "max-channel";
const IMAGE_PATH = /^max-channel\/[A-Za-z0-9_-]{8,64}\.(jpg|png|webp|gif)$/;

const SITE_HOSTS = new Set(["wesetup.ru", "www.wesetup.ru"]);

export const maxPostDraftSchema = z
  .object({
    channelId: z.string().min(1, "Выберите канал"),
    text: z
      .string()
      .trim()
      .min(1, "Напишите текст поста")
      .max(MAX_POST_TEXT_LIMIT, `Текст длиннее ${MAX_POST_TEXT_LIMIT} символов — MAX его не примет`),
    images: z
      .array(z.string().regex(IMAGE_PATH, "Неизвестная картинка"))
      .max(MAX_POST_IMAGES_LIMIT, `Не больше ${MAX_POST_IMAGES_LIMIT} картинок в одном посте`)
      .default([]),
    buttonText: z.string().trim().max(MAX_POST_BUTTON_TEXT_LIMIT, "Слишком длинная надпись на кнопке").optional().nullable(),
    buttonUrl: z.string().trim().max(1500, "Слишком длинная ссылка").optional().nullable(),
    campaign: z
      .string()
      .trim()
      .max(60)
      .regex(/^[a-z0-9_-]*$/i, "Метка кампании — латиница, цифры, «-» и «_»")
      .optional()
      .nullable(),
    scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const text = value.buttonText?.trim() ?? "";
    const url = value.buttonUrl?.trim() ?? "";
    if (text && !url) ctx.addIssue({ code: "custom", path: ["buttonUrl"], message: "Укажите, куда ведёт кнопка" });
    if (url && !text) ctx.addIssue({ code: "custom", path: ["buttonText"], message: "Напишите надпись на кнопке" });
    if (url && !isHttpUrl(url)) ctx.addIssue({ code: "custom", path: ["buttonUrl"], message: "Ссылка должна начинаться с https://" });
  });

export type MaxPostDraft = z.infer<typeof maxPostDraftSchema>;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Латинская метка кампании из заголовка: «Новый журнал!» → `post-2026-11-05`. */
export function defaultCampaign(now: Date = new Date()): string {
  return `post-${now.toISOString().slice(0, 10)}`;
}

/**
 * Ставит UTM на ссылку сайта WeSetup, чтобы переходы из канала было видно
 * в Метрике. Чужие ссылки и уже размеченные не трогаем.
 */
export type UtmSource = "max" | "telegram";

export function withUtm(rawUrl: string, campaign: string | null | undefined, source: UtmSource = "max"): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (!SITE_HOSTS.has(url.hostname)) return rawUrl;
  if (url.searchParams.has("utm_source")) return rawUrl;
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", "social");
  if (campaign) url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

/** UTM на все ссылки сайта в тексте: и голые, и в разметке [текст](ссылка). */
export function tagSiteLinks(text: string, campaign: string | null | undefined, source: UtmSource = "max"): string {
  return text.replace(/https?:\/\/(?:www\.)?wesetup\.ru[^\s)\]]*/g, (match) => {
    // Точку/запятую в конце предложения ссылкой не считаем.
    const tail = /[.,!?;:]+$/.exec(match)?.[0] ?? "";
    const core = tail ? match.slice(0, -tail.length) : match;
    return withUtm(core, campaign, source) + tail;
  });
}

export type MaxImageAttachment = { type: "image"; payload: { token: string } };

/** Тело `POST /messages` / `PUT /messages` для поста. */
export function buildMaxPostBody(
  post: { text: string; buttonText?: string | null; buttonUrl?: string | null; campaign?: string | null },
  imageTokens: string[] = [],
) {
  const attachments: Array<MaxImageAttachment | { type: "inline_keyboard"; payload: { buttons: unknown[][] } }> =
    imageTokens.map((token) => ({ type: "image", payload: { token } }));
  if (post.buttonText?.trim() && post.buttonUrl?.trim()) {
    attachments.push({
      type: "inline_keyboard",
      payload: {
        buttons: [[{ type: "link", text: post.buttonText.trim(), url: withUtm(post.buttonUrl.trim(), post.campaign) }]],
      },
    });
  }
  return {
    text: tagSiteLinks(post.text, post.campaign).slice(0, MAX_POST_TEXT_LIMIT),
    format: "markdown" as const,
    notify: true,
    attachments,
  };
}

export type MaxPostStatus = "draft" | "scheduled" | "sending" | "sent" | "failed" | "deleted";

export const MAX_POST_STATUS_LABELS: Record<MaxPostStatus, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  sending: "Отправляется",
  sent: "Опубликован",
  failed: "Ошибка",
  deleted: "Удалён из канала",
};

export type ChannelPlatform = "max" | "telegram";

export const CHANNEL_PLATFORM_LABELS: Record<ChannelPlatform, string> = {
  max: "MAX",
  telegram: "Telegram",
};

/**
 * Разбор события вебхука/опроса про канал: бот добавлен или удалён.
 * Остальные события — не про каналы, возвращаем null.
 */
export function parseChannelMembershipUpdate(
  input: unknown,
): { kind: "added" | "removed"; chatId: string } | null {
  if (!input || typeof input !== "object") return null;
  const update = input as { update_type?: unknown; chat_id?: unknown; is_channel?: unknown };
  if (update.update_type !== "bot_added" && update.update_type !== "bot_removed") return null;
  if (update.is_channel === false) return null;
  const raw = update.chat_id;
  const chatId = typeof raw === "number" ? String(Math.trunc(raw)) : typeof raw === "string" ? raw.trim() : "";
  if (!/^-?\d{1,20}$/.test(chatId)) return null;
  return { kind: update.update_type === "bot_added" ? "added" : "removed", chatId };
}

/** Шаблоны постов для быстрого старта — правятся перед публикацией. */
export const MAX_POST_TEMPLATES: Array<{ key: string; title: string; text: string; buttonText: string; buttonUrl: string; campaign: string }> = [
  {
    key: "intro",
    title: "Знакомство с сервисом",
    text: [
      "**Электронные журналы СанПиН и ХАССП — без бумаги и штрафов**",
      "",
      "WeSetup ведёт журналы за вас: напоминает сотрудникам, проверяет заполнение и собирает всё к приезду Роспотребнадзора.",
      "",
      "✅ Все обязательные журналы в одном месте",
      "✅ Заполнение с телефона за минуту",
      "✅ Готовые документы для проверки",
    ].join("\n"),
    buttonText: "Попробовать бесплатно",
    buttonUrl: "https://wesetup.ru/register",
    campaign: "intro",
  },
  {
    key: "inspection",
    title: "Пришла проверка",
    text: [
      "**Проверка Роспотребнадзора завтра — журналы готовы?**",
      "",
      "Инспектор смотрит журналы первым делом. Пустые графы и записи «задним числом» — прямой повод для штрафа.",
      "",
      "В WeSetup журналы заполняются каждый день, а не за ночь до проверки. Распечатать всё можно в один клик.",
    ].join("\n"),
    buttonText: "Как это работает",
    buttonUrl: "https://wesetup.ru/",
    campaign: "inspection",
  },
  {
    key: "promo",
    title: "Акция",
    text: [
      "**Скидка для новых клиентов**",
      "",
      "Подключите WeSetup до [дата] и получите [выгода].",
      "",
      "Промокод: `ПРОМОКОД`",
    ].join("\n"),
    buttonText: "Подключить",
    buttonUrl: "https://wesetup.ru/register",
    campaign: "promo",
  },
];
