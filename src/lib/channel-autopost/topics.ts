import { FEATURES_INFO, FEATURES_ORDER } from "@/content/features";
import { GLOSSARY } from "@/content/glossary";
import { JOURNAL_INFO } from "@/content/journal-info";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";

/**
 * Автопосты в каналы Telegram и MAX — темы и запрос к ИИ, без БД и сети.
 *
 * Каждый день — одна тема из материалов сайта: журнал из каталога
 * (/journals-info/<code>), возможность сервиса (/features/<slug>) или
 * термин глоссария (/glossary/<slug>). Формат — как у отраслевых каналов
 * о качестве и безопасности пищи: фото, жирный заголовок, два-три коротких
 * абзаца с практической пользой, хэштеги и кнопка на нашу страницу.
 */

export type TopicKind = "journal" | "feature" | "term";

export interface AutopostTopic {
  key: string;
  kind: TopicKind;
  title: string;
  url: string;
  buttonText: string;
  /** Факты для модели — только из наших материалов. */
  material: string;
}

const SITE = "https://wesetup.ru";

/** Чередование видов тем по дням: журналов больше всего. */
export const KIND_ROTATION: readonly TopicKind[] = ["journal", "term", "journal", "feature", "journal", "term", "feature"];

function journalTopics(): AutopostTopic[] {
  const out: AutopostTopic[] = [];
  for (const item of ACTIVE_JOURNAL_CATALOG) {
    const info = JOURNAL_INFO[item.code];
    if (!info) continue;
    const lines = [
      `Журнал: ${item.name}.`,
      `Коротко: ${info.tagline}`,
      `Зачем: ${info.why}`,
      `Что записывают: ${info.whatToFill.join("; ")}.`,
      info.normative.length ? `Норматив: ${info.normative.map((n) => [n.title, n.pointer].filter(Boolean).join(" ")).join("; ")}.` : "",
      info.tips.length ? `Советы: ${info.tips.join(" ")}` : "",
    ];
    out.push({
      key: `journal:${item.code}`,
      kind: "journal",
      title: item.name,
      url: `${SITE}/journals-info/${item.code}`,
      buttonText: "Как вести журнал",
      material: lines.filter(Boolean).join("\n"),
    });
  }
  return out;
}

function featureTopics(): AutopostTopic[] {
  return FEATURES_ORDER.map((slug) => FEATURES_INFO[slug])
    .filter(Boolean)
    .map((feature) => {
      const body = feature.body
        .map((block) => {
          const b = block as { text?: string; items?: string[] };
          return b.text ?? (b.items ? b.items.join("; ") : "");
        })
        .filter(Boolean)
        .join("\n")
        .slice(0, 2500);
      return {
        key: `feature:${feature.slug}`,
        kind: "feature" as const,
        title: feature.title,
        url: `${SITE}/features/${feature.slug}`,
        buttonText: "Как это работает",
        material: `Возможность WeSetup: ${feature.title}.\n${feature.tagline}\n${body}`,
      };
    });
}

function termTopics(): AutopostTopic[] {
  return GLOSSARY.map((term) => ({
    key: `term:${term.slug}`,
    kind: "term" as const,
    title: term.term,
    url: `${SITE}/glossary/${term.slug}`,
    buttonText: "Подробнее",
    material: `Термин: ${term.term}.\n${term.short}\n${term.body}`,
  }));
}

export function allTopics(): AutopostTopic[] {
  return [...journalTopics(), ...featureTopics(), ...termTopics()];
}

/** День года по дате YYYY-MM-DD — для чередования видов тем. */
function dayIndex(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000);
}

/**
 * Тема на день. Вид — по чередованию; внутри вида — первая ещё не
 * использованная, а когда всё было, — та, что была давнее всех
 * (`used` — ключи тем от новых к старым).
 */
export function pickTopic(dateKey: string, used: readonly string[], topics: readonly AutopostTopic[] = allTopics()): AutopostTopic {
  const kind = KIND_ROTATION[((dayIndex(dateKey) % KIND_ROTATION.length) + KIND_ROTATION.length) % KIND_ROTATION.length];
  const pool = topics.filter((topic) => topic.kind === kind);
  const candidates = pool.length > 0 ? pool : [...topics];
  const fresh = candidates.find((topic) => !used.includes(topic.key));
  if (fresh) return fresh;
  return [...candidates].sort((a, b) => used.indexOf(b.key) - used.indexOf(a.key))[0];
}

export function findTopic(key: string, topics: readonly AutopostTopic[] = allTopics()): AutopostTopic | null {
  return topics.find((topic) => topic.key === key) ?? null;
}

export const POST_TEXT_LIMIT = 900;

/** Задание модели: пост и запрос на картинку одним JSON. */
export function buildTextInstructions(): string {
  return [
    "Ты ведёшь Telegram-канал сервиса WeSetup — электронные журналы СанПиН и ХАССП для кафе, ресторанов, столовых и пищевых производств.",
    "Напиши один пост в стиле отраслевых каналов о качестве и безопасности пищи: польза для заведующей производством и технолога, без рекламной воды.",
    "Правила текста:",
    "- русский язык, на «вы»; длина вместе с хэштегами — до 750 символов;",
    "- первая строка — короткий заголовок в **двойных звёздочках**, перед ним один уместный эмодзи;",
    "- дальше 2–3 коротких абзаца: в чём требование или проблема, как сделать правильно на практике, как это упрощает WeSetup;",
    "- можно короткий список из 2–4 пунктов, каждый с «•»;",
    "- последняя строка — 2–3 хэштега, например #СанПиН #ХАССП #общепит;",
    "- никаких ссылок и адресов в тексте — ссылку даст кнопка под постом;",
    "- факты, цифры и нормы — только из материала ниже; ничего не выдумывай (штрафов, сроков, номеров пунктов, которых нет в материале).",
    "Ещё придумай запрос для фото к посту на английском: реалистичная фотография по теме поста (профессиональная кухня, повар, склад, холодильник, лаборатория — что подходит), без людей крупным планом, без текста, надписей, логотипов и водяных знаков.",
    'Ответ — только JSON без пояснений: {"text": "текст поста", "imagePrompt": "photo prompt in English"}',
  ].join("\n");
}

export function buildTextInput(topic: AutopostTopic): string {
  return `Тема поста: ${topic.title}\n\nМатериал:\n${topic.material}`;
}

export interface GeneratedPost {
  text: string;
  imagePrompt: string;
}

/** Разбор ответа модели: JSON, возможно в ```json-заборе. */
export function parseGeneratedPost(raw: string): GeneratedPost | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const value = data as { text?: unknown; imagePrompt?: unknown };
  const text = typeof value.text === "string" ? value.text.replace(/\r\n/g, "\n").trim() : "";
  const imagePrompt = typeof value.imagePrompt === "string" ? value.imagePrompt.trim() : "";
  if (text.length < 80 || text.length > POST_TEXT_LIMIT) return null;
  // Ссылки — только кнопкой: адрес в тексте Telegram превратит в превью.
  if (/https?:\/\/|www\.|t\.me\//i.test(text)) return null;
  return { text, imagePrompt: imagePrompt || "Realistic photo of a clean professional restaurant kitchen, no people, no text" };
}

/** Стиль картинки поверх запроса модели — единый для всех постов. */
export function buildImagePrompt(topic: AutopostTopic, modelPrompt: string): string {
  return [
    modelPrompt,
    `Topic: ${topic.title} (food safety, HACCP, Russian catering).`,
    "Style: high-quality realistic photography, natural light, clean and bright, soft indigo (#5566f6) accents where natural.",
    "Strictly no text, letters, numbers, labels, logos or watermarks anywhere in the image.",
  ].join(" ");
}

/** 10:00 по Москве в этот день (Москва — UTC+3 без перехода). */
export function publishAtFor(dateKey: string, time = "10:00"): Date {
  const [h, m] = time.split(":").map((part) => Number(part));
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + ((h - 3) * 60 + m) * 60_000);
}

export function moscowDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
