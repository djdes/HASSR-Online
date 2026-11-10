import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { db } from "@/lib/db";
import {
  CodexGatewayError,
  codexGatewayConfigured,
  downloadImage,
  imageQuota,
  readImageJob,
  readTextJob,
  startImageJob,
  startTextJob,
} from "@/lib/codex-gateway";
import { MAX_POST_IMAGE_DIR } from "@/lib/max/channel-post";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { uploadsDir } from "@/lib/uploads-path";

import {
  addDays,
  buildImagePrompt,
  buildTextInput,
  buildTextInstructions,
  findTopic,
  moscowDateKey,
  parseGeneratedPost,
  pickTopic,
  publishAtFor,
} from "./topics";

/**
 * Автопосты дня (ROOT → «Каналы Telegram и MAX» → «Автопосты»).
 *
 * Крон канала (`/api/cron/max-channel`, раз в минуту) зовёт `runAutopostTick`:
 * заводит автопосты на ближайшие дни и двигает каждый на шаг — задача текста
 * в шлюзе ProjectsFlow → разбор → задача картинки → скачивание → одинаковые
 * посты во все подключённые каналы на 10:00 МСК. Дальше их публикует тот же
 * крон, как любой запланированный пост; до публикации их видно, можно
 * поправить или удалить в «Плане публикаций».
 */

const SETTINGS_KEY = "channels.autopost";
const MAX_ATTEMPTS = 3;
const IMAGE_SIZE = { width: 1280, height: 960 };
/** Не успели подготовить за столько до публикации — ставим без картинки. */
const IMAGE_DEADLINE_MS = 20 * 60_000;

export interface AutopostSettings {
  enabled: boolean;
  /** Время публикации по Москве, HH:MM. */
  time: string;
  /** На сколько дней вперёд готовить посты (видно в админке заранее). */
  daysAhead: number;
}

const DEFAULT_SETTINGS: AutopostSettings = { enabled: true, time: "10:00", daysAhead: 3 };

export async function readAutopostSettings(): Promise<AutopostSettings> {
  const row = await db.platformSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    const value = JSON.parse(row.value) as Partial<AutopostSettings>;
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled,
      time: typeof value.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? value.time : DEFAULT_SETTINGS.time,
      daysAhead: Number.isInteger(value.daysAhead) ? Math.min(Math.max(value.daysAhead as number, 1), 7) : DEFAULT_SETTINGS.daysAhead,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveAutopostSettings(patch: Partial<AutopostSettings>): Promise<AutopostSettings> {
  const next = { ...(await readAutopostSettings()), ...patch };
  await db.platformSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}

function describe(error: unknown): string {
  if (error instanceof CodexGatewayError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "Шлюз ProjectsFlow не ответил вовремя";
  return (error as Error)?.message?.slice(0, 200) || "Неизвестная ошибка";
}

/** Заводит автопосты на сегодня (если 10:00 ещё впереди) и ближайшие дни. */
async function ensureUpcoming(settings: AutopostSettings, now: Date): Promise<void> {
  const today = moscowDateKey(now);
  const recent = await db.channelAutopost.findMany({
    where: { status: { not: "cancelled" } },
    orderBy: { dateKey: "desc" },
    take: 200,
    select: { topicKey: true },
  });
  const used = recent.map((row) => row.topicKey);
  for (let i = 0; i <= settings.daysAhead; i += 1) {
    const dateKey = addDays(today, i);
    const publishAt = publishAtFor(dateKey, settings.time);
    // Сегодняшний — только если до публикации есть хотя бы час на подготовку.
    if (publishAt.getTime() - now.getTime() < 60 * 60_000) continue;
    const exists = await db.channelAutopost.findUnique({ where: { dateKey }, select: { id: true } });
    if (exists) continue;
    const topic = pickTopic(dateKey, used);
    used.unshift(topic.key);
    await db.channelAutopost
      .create({ data: { dateKey, publishAt, topicKey: topic.key, topicTitle: topic.title, buttonText: topic.buttonText, buttonUrl: topic.url } })
      .catch((error) => {
        // Параллельный тик уже завёл этот день — не страшно.
        if ((error as { code?: string })?.code !== "P2002") throw error;
      });
  }
}

type Row = Awaited<ReturnType<typeof db.channelAutopost.findUniqueOrThrow>>;

async function fail(row: Row, message: string, retry: boolean): Promise<void> {
  const attempts = row.attempts + 1;
  if (retry && attempts < MAX_ATTEMPTS) {
    await db.channelAutopost.update({
      where: { id: row.id },
      data: { status: "queued", textJobId: null, imageJobId: null, attempts, error: `${message} — повторим` },
    });
    return;
  }
  await db.channelAutopost.update({ where: { id: row.id }, data: { status: "failed", attempts, error: message } });
  await notifyPlatformAdmin(
    `⚠️ Автопост на ${row.dateKey} («${row.topicTitle}») не подготовлен: ${message}. Пересоздайте его на /root/max-channel или опубликуйте пост вручную.`,
    { kind: "system", dedupeKey: `autopost-failed:${row.id}:${attempts}` },
  ).catch(() => {});
}

/** Посты во все подключённые каналы на время автопоста. */
async function schedulePosts(row: Row, imagePath: string | null): Promise<void> {
  const channels = await db.maxChannel.findMany({ where: { removed: false, botIsAdmin: true } });
  if (channels.length === 0) {
    await fail(row, "Нет подключённых каналов, где бот — администратор", false);
    return;
  }
  const ids: string[] = [];
  for (const channel of channels) {
    const post = await db.maxChannelPost.create({
      data: {
        channelId: channel.id,
        text: row.text ?? "",
        images: imagePath ? [imagePath] : [],
        buttonText: row.buttonText,
        buttonUrl: row.buttonUrl,
        campaign: `auto-${row.dateKey}`,
        status: "scheduled",
        scheduledAt: row.publishAt,
        source: "auto",
      },
    });
    ids.push(post.id);
  }
  await db.channelAutopost.update({
    where: { id: row.id },
    data: { status: "scheduled", imagePath, postIds: ids, error: imagePath ? null : row.error },
  });
  console.info(`[autopost] ${row.dateKey} scheduled to ${ids.length} channels, image=${imagePath ? "yes" : "no"}`);
}

async function stepQueued(row: Row): Promise<void> {
  const topic = findTopic(row.topicKey);
  if (!topic) {
    await fail(row, `Тема ${row.topicKey} больше не существует`, false);
    return;
  }
  // Захват: второй тик не поставит вторую задачу.
  const claimed = await db.channelAutopost.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "text" } });
  if (!claimed.count) return;
  try {
    const jobId = await startTextJob(buildTextInput(topic), buildTextInstructions());
    await db.channelAutopost.update({ where: { id: row.id }, data: { textJobId: jobId, error: null } });
  } catch (error) {
    await db.channelAutopost.update({ where: { id: row.id }, data: { status: "queued", error: describe(error) } });
  }
}

async function stepText(row: Row): Promise<void> {
  if (!row.textJobId) return; // задачу ещё ставят
  const job = await readTextJob(row.textJobId);
  if (job.status === "queued" || job.status === "running") return;
  if (job.status !== "succeeded" || !job.text) {
    await fail(row, `Текст не написан: ${job.error ?? job.status}`, true);
    return;
  }
  const parsed = parseGeneratedPost(job.text);
  if (!parsed) {
    await fail(row, "ИИ вернул текст не по правилам (длина, ссылки или формат)", true);
    return;
  }
  await db.channelAutopost.update({
    where: { id: row.id },
    data: { status: "image", text: parsed.text, imagePrompt: parsed.imagePrompt, error: null },
  });
}

async function stepImage(row: Row, now: Date): Promise<void> {
  const late = row.publishAt.getTime() - now.getTime() < IMAGE_DEADLINE_MS;
  if (!row.imageJobId) {
    if (late) {
      await schedulePosts({ ...row, error: "Картинка не успела — пост без фото" }, null);
      return;
    }
    const topic = findTopic(row.topicKey);
    const quota = await imageQuota();
    if (quota.remaining <= 0 || quota.active >= 2) {
      if (row.error !== "Ждём лимит картинок шлюза") {
        await db.channelAutopost.update({ where: { id: row.id }, data: { error: "Ждём лимит картинок шлюза" } });
      }
      return;
    }
    const claimed = await db.channelAutopost.updateMany({
      where: { id: row.id, status: "image", imageJobId: null },
      data: { imageJobId: "pending" },
    });
    if (!claimed.count) return;
    try {
      const prompt = topic ? buildImagePrompt(topic, row.imagePrompt ?? "") : row.imagePrompt ?? "";
      const jobId = await startImageJob(prompt, IMAGE_SIZE);
      await db.channelAutopost.update({ where: { id: row.id }, data: { imageJobId: jobId, error: null } });
    } catch (error) {
      await db.channelAutopost.update({ where: { id: row.id }, data: { imageJobId: null, error: describe(error) } });
    }
    return;
  }
  if (row.imageJobId === "pending") return;
  const job = await readImageJob(row.imageJobId);
  if (job.status === "queued" || job.status === "running") {
    if (late) await schedulePosts({ ...row, error: "Картинка не успела — пост без фото" }, null);
    return;
  }
  if (job.status !== "succeeded") {
    const attempts = row.attempts + 1;
    if (attempts < MAX_ATTEMPTS && !late) {
      await db.channelAutopost.update({
        where: { id: row.id },
        data: { imageJobId: null, attempts, error: `Картинка не вышла: ${job.error ?? job.status} — повторим` },
      });
      return;
    }
    await schedulePosts({ ...row, attempts, error: `Картинка не вышла (${job.error ?? job.status}) — пост без фото` }, null);
    return;
  }
  const bytes = await downloadImage(row.imageJobId);
  const name = `auto-${row.dateKey}-${randomBytes(6).toString("base64url")}.png`;
  const dir = join(uploadsDir(), MAX_POST_IMAGE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), bytes);
  await schedulePosts(row, `${MAX_POST_IMAGE_DIR}/${name}`);
}

/** Один проход крона. Повторный и параллельный запуск безопасны. */
export async function runAutopostTick(now: Date = new Date()): Promise<{ active: number }> {
  const settings = await readAutopostSettings();
  if (!settings.enabled || !codexGatewayConfigured()) return { active: 0 };
  await ensureUpcoming(settings, now);
  const rows = await db.channelAutopost.findMany({
    where: { status: { in: ["queued", "text", "image"] } },
    orderBy: { dateKey: "asc" },
    take: 5,
  });
  for (const row of rows) {
    // Время прошло, а пост не готов — второй раз не ставим.
    if (row.publishAt.getTime() < now.getTime()) {
      await fail(row, "Не успели подготовить к времени публикации", false);
      continue;
    }
    try {
      if (row.status === "queued") await stepQueued(row);
      else if (row.status === "text") await stepText(row);
      else await stepImage(row, now);
    } catch (error) {
      // Сетевой сбой шлюза — следующий тик повторит этот же шаг.
      console.error(`[autopost] ${row.dateKey} step ${row.status} failed:`, describe(error));
      await db.channelAutopost.update({ where: { id: row.id }, data: { error: describe(error) } }).catch(() => {});
    }
  }
  return { active: rows.length };
}

/** Убирает ещё не опубликованные посты автопоста. */
async function dropScheduledPosts(postIds: string[]): Promise<void> {
  if (postIds.length === 0) return;
  await db.maxChannelPost.deleteMany({ where: { id: { in: postIds }, status: { in: ["draft", "scheduled", "failed"] } } });
}

/** «Пересоздать»: та же дата, новая тема (или та же) — текст и фото заново. */
export async function regenerateAutopost(id: string, opts: { newTopic: boolean }): Promise<void> {
  const row = await db.channelAutopost.findUniqueOrThrow({ where: { id } });
  if (row.publishAt.getTime() < Date.now() + 30 * 60_000) throw new Error("До публикации меньше 30 минут — пересоздать уже не успеем.");
  const sent = await db.maxChannelPost.count({ where: { id: { in: row.postIds }, status: { in: ["sending", "sent"] } } });
  if (sent > 0) throw new Error("Пост уже опубликован.");
  await dropScheduledPosts(row.postIds);
  let topic = findTopic(row.topicKey);
  if (opts.newTopic || !topic) {
    const used = (await db.channelAutopost.findMany({ orderBy: { dateKey: "desc" }, take: 200, select: { topicKey: true } })).map((r) => r.topicKey);
    topic = pickTopic(row.dateKey, used);
  }
  await db.channelAutopost.update({
    where: { id },
    data: {
      status: "queued",
      topicKey: topic.key,
      topicTitle: topic.title,
      buttonText: topic.buttonText,
      buttonUrl: topic.url,
      textJobId: null,
      imageJobId: null,
      text: null,
      imagePrompt: null,
      imagePath: null,
      postIds: [],
      error: null,
      attempts: 0,
    },
  });
}

/** «Отменить»: посты дня не выйдут, новый на эту дату не заведётся. */
export async function cancelAutopost(id: string): Promise<void> {
  const row = await db.channelAutopost.findUniqueOrThrow({ where: { id } });
  await dropScheduledPosts(row.postIds);
  await db.channelAutopost.update({ where: { id }, data: { status: "cancelled", postIds: [] } });
}

export type AutopostView = {
  id: string;
  dateKey: string;
  publishAt: string;
  topicTitle: string;
  status: string;
  text: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  error: string | null;
  posts: Array<{ id: string; status: string; url: string | null; platform: string }>;
};

export async function loadAutopostViews(now: Date = new Date()): Promise<AutopostView[]> {
  const rows = await db.channelAutopost.findMany({
    where: { dateKey: { gte: addDays(moscowDateKey(now), -7) } },
    orderBy: { dateKey: "desc" },
    take: 20,
  });
  const postIds = rows.flatMap((row) => row.postIds);
  const posts = postIds.length
    ? await db.maxChannelPost.findMany({
        where: { id: { in: postIds } },
        select: { id: true, status: true, url: true, channel: { select: { platform: true } } },
      })
    : [];
  const byId = new Map(posts.map((post) => [post.id, post]));
  return rows.map((row) => ({
    id: row.id,
    dateKey: row.dateKey,
    publishAt: row.publishAt.toISOString(),
    topicTitle: row.topicTitle,
    status: row.status,
    text: row.text,
    imageUrl: row.imagePath ? `/uploads/${row.imagePath}` : null,
    buttonText: row.buttonText,
    buttonUrl: row.buttonUrl,
    error: row.error,
    posts: row.postIds
      .map((postId) => byId.get(postId))
      .filter((post): post is NonNullable<typeof post> => Boolean(post))
      .map((post) => ({ id: post.id, status: post.status, url: post.url, platform: post.channel.platform })),
  }));
}
