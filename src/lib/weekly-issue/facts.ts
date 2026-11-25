import { POST_TEXT_LIMIT } from "@/lib/channel-autopost/topics";

import type { UpcomingOccasion } from "./occasions";

/**
 * Еженедельный выпуск — факты для ИИ и разбор ответа, без БД и сети.
 *
 * Факты собирает `facts.server.ts`: что изменилось на сайте за неделю
 * (коммиты master из GitHub и датированные записи «Что нового»), новые
 * статьи блога, действующие и будущие акции, посты СММ-планировщика на две
 * недели вперёд и ближайшие праздники и отраслевые даты. ИИ отбирает из
 * них то, что интересно клиентам, и пишет короткое напоминание о сервисе.
 */

export interface WeeklyFacts {
  /** Среда выхода, YYYY-MM-DD. */
  weekKey: string;
  periodFrom: string;
  periodTo: string;
  /** Изменения сайта за неделю — первые строки коммитов без технички. */
  changes: string[];
  /** Откуда изменения: GitHub API или их не удалось получить. */
  changesSource: "github" | "unavailable";
  /** Датированные записи публичной истории изменений за неделю. */
  changelog: string[];
  articles: Array<{ title: string; url: string }>;
  promotions: Array<{ title: string; percent: number; from: string; until: string }>;
  upcomingPosts: Array<{ date: string; title: string }>;
  occasions: UpcomingOccasion[];
}

export const SITE_URL = "https://wesetup.ru";
export const WEEKLY_BUTTON = { text: "Перейти на сайт", url: `${SITE_URL}/` } as const;

/** Префиксы внутренних разделов — клиенту не интересны (ROOT, CRM, СММ…). */
const INTERNAL_PREFIX =
  /^(смм|smm|crm|срм|root|рут|типы|доказательства|evidence|рассылк\p{L}*|админ\p{L}*|ии-сводк\p{L}*|сводка администратор\p{L}*|seo|сео|презентаци\p{L}*|брендбук|визитк\p{L}*|ci|deploy|деплой|dispatcher|диспетчер)(?![\p{L}\p{N}])/iu;
/** Техничка в любом месте строки (целые слова). */
const TECHNICAL =
  /(?<![\p{L}\p{N}])(merge|revert|chore|refactor|рефакторинг|тест|тесты|тестов|tests?|lint|eslint|tsc|typecheck|ci|github actions|зависимости|deps?|bump|prisma|миграция|миграции|скрипт|скрипты|script|worktree|wip)(?![\p{L}\p{N}])/iu;
const CONVENTIONAL = /^(feat|fix|chore|ci|test|tests|build|deps|refactor|docs|style|perf|wip)(\([^)]*\))?!?:\s*/i;

/**
 * Первые строки коммитов → изменения для ИИ: без слияний, откатов,
 * технических и внутренних (ROOT, CRM, СММ), без номера PR, без повторов.
 */
export function selectCommitSubjects(messages: readonly string[], limit = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const raw = (message.split("\n")[0] ?? "").trim();
    if (!raw) continue;
    const conventional = raw.match(CONVENTIONAL)?.[1]?.toLowerCase();
    if (conventional && conventional !== "feat" && conventional !== "fix" && conventional !== "perf") continue;
    const subject = raw.replace(CONVENTIONAL, "").replace(/\s*\(#\d+\)\s*$/, "").replace(/\s+/g, " ").trim();
    if (subject.length < 8) continue;
    if (INTERNAL_PREFIX.test(subject) || TECHNICAL.test(subject)) continue;
    // Клиентам пишем по-русски: коммиты без кириллицы и про файлы стилей — техничка.
    if (!/[а-яё]/i.test(subject) || /\.(css|tsx?|json|md)(?![a-z])/i.test(subject)) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(subject.slice(0, 220));
    if (out.length >= limit) break;
  }
  return out;
}

function ruDate(dateKey: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${dateKey}T12:00:00Z`));
}

/** Факты одним текстом — вход задачи ИИ. Пустые разделы так и помечены. */
export function buildWeeklyInput(facts: WeeklyFacts): string {
  const section = (title: string, lines: string[], empty: string) =>
    `${title}:\n${lines.length ? lines.map((line) => `- ${line}`).join("\n") : `- ${empty}`}`;
  return [
    `Выпуск выходит в среду, ${ruDate(facts.weekKey)}, в 09:00 по Москве. Неделя фактов: ${ruDate(facts.periodFrom)} — ${ruDate(facts.periodTo)}.`,
    section(
      "Изменения сайта и кабинета за неделю (из истории изменений кода; отбери только то, что заметит и оценит клиент)",
      facts.changes,
      facts.changesSource === "github" ? "заметных изменений не было" : "историю изменений получить не удалось — про обновления не пиши",
    ),
    section("Новые возможности из публичной истории изменений", facts.changelog, "нет"),
    section("Новые статьи в блоге", facts.articles.map((a) => a.title), "нет"),
    section(
      "Акции на подписку (действуют или скоро начнутся)",
      facts.promotions.map((p) => `${p.title}: скидка ${p.percent}% с ${ruDate(p.from)} по ${ruDate(p.until)}`),
      "акций нет — скидки не упоминай",
    ),
    section("Что запланировано в канале на две недели", facts.upcomingPosts.map((p) => `${ruDate(p.date)}: ${p.title}`), "ничего особенного"),
    section(
      "Ближайшие праздники и отраслевые поводы (и чем сервис полезен в этот повод)",
      facts.occasions.map((o) => `${o.daysAway === 0 ? "уже идёт" : ruDate(o.dateKey)} — ${o.title}: ${o.hint}`),
      "нет",
    ),
  ].join("\n\n");
}

/** Задание модели: короткое еженедельное напоминание о сервисе одним JSON. */
export function buildWeeklyInstructions(): string {
  return [
    "Ты ведёшь Telegram- и MAX-канал сервиса WeSetup — электронные журналы СанПиН и ХАССП для кафе, ресторанов, столовых и пищевых производств. Этот же текст уйдёт письмом подписчикам.",
    "Напиши еженедельный пост-напоминание (выходит по средам): ненавязчиво напомни о сервисе и приведи читателя на сайт. Тон — коллега-эксперт для владельца, управляющей и технолога, без рекламной воды и запугивания штрафами.",
    "Как отбирать факты:",
    "- из изменений сайта возьми 1–3 самых полезных для клиента и перескажи простыми словами, что стало удобнее; без технических слов, названий файлов, внутренних разделов администратора, CRM, рассылок и СММ;",
    "- если подходящих изменений нет — не выдумывай их, напиши о ближайшем поводе и о том, чем сервис помогает каждый день;",
    "- обыграй ближайший праздник или отраслевой повод, если он есть, и как WeSetup пригодится в эти дни;",
    "- акцию упоминай, только если она есть в фактах, — с точным процентом и сроком;",
    "- ничего не выдумывай: цифр, сроков, норм, скидок и функций, которых нет в фактах.",
    "Правила текста:",
    "- русский язык, на «вы»; длина вместе с хэштегами — до 750 символов;",
    "- первая строка — короткий заголовок в **двойных звёздочках**, перед ним один уместный эмодзи;",
    "- дальше 2–3 коротких абзаца; можно список из 2–4 пунктов, каждый с «•»;",
    "- в конце — мягкий призыв заглянуть на сайт (ссылку даст кнопка «Перейти на сайт» под постом), без давления;",
    "- последняя строка — 2–3 хэштега, например #WeSetup #ХАССП #общепит;",
    "- никаких ссылок и адресов в тексте; не пиши «разрабатываем» и «в разработке» — говори о том, что уже работает.",
    "Ещё придумай тему письма (до 70 символов, без эмодзи и кавычек-ёлочек по краям) и запрос для фото на английском: реалистичная фотография по теме выпуска (профессиональная кухня, кафе, банкетный зал, склад — что подходит), без людей крупным планом, без текста, надписей, логотипов и водяных знаков.",
    "Food-safety rules for the photo: no potted plants or flowers in food areas, clean work surfaces, staff in clean uniforms with covered hair.",
    'Ответ — только JSON без пояснений: {"subject": "тема письма", "text": "текст поста", "imagePrompt": "photo prompt in English"}',
  ].join("\n");
}

export interface GeneratedWeekly {
  subject: string;
  text: string;
  imagePrompt: string;
}

/** Разбор ответа модели: JSON, возможно в ```json-заборе. */
export function parseWeeklyPost(raw: string): GeneratedWeekly | null {
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
  const value = data as { subject?: unknown; text?: unknown; imagePrompt?: unknown };
  const text = typeof value.text === "string" ? value.text.replace(/\r\n/g, "\n").trim() : "";
  if (text.length < 120 || text.length > POST_TEXT_LIMIT) return null;
  if (/https?:\/\/|www\.|t\.me\//i.test(text)) return null;
  const subjectRaw = typeof value.subject === "string" ? value.subject.replace(/\s+/g, " ").trim() : "";
  const subject = subjectRaw.replace(/^[«"]+|[»"]+$/g, "").slice(0, 120) || headlineOf(text) || "Новости WeSetup";
  const imagePrompt =
    typeof value.imagePrompt === "string" && value.imagePrompt.trim()
      ? value.imagePrompt.trim()
      : "Realistic photo of a clean professional restaurant kitchen, no people, no text";
  return { subject, text, imagePrompt };
}

/** Заголовок поста без разметки и эмодзи. */
export function headlineOf(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.replace(/\*\*|__|`/g, "").replace(/\p{Extended_Pictographic}️?/gu, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Текст письма из поста: без заголовка (он — тема и шапка письма) и без
 * строк из одних хэштегов; разметка **жирный** и «•» остаются.
 */
export function emailBodyFromPost(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && /^\s*\S*\s*\*\*.+\*\*\s*$/u.test(lines[first])) lines.splice(first, 1);
  return lines
    .filter((l) => !/^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
