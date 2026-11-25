import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Prisma } from "@prisma/client";

import { buildImagePrompt, moscowDateKey } from "@/lib/channel-autopost/topics";
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
import { db } from "@/lib/db";
import { loadAudienceUsers, planRecipients } from "@/lib/mailing/audience.server";
import { clientSegment } from "@/lib/mailing/bases";
import { createDraft, launchCampaign, previewMailing, updateDraft, type MailingActor } from "@/lib/mailing/campaigns.server";
import { defaultMessagePayload, type MessagePayload } from "@/lib/mailing/kinds/message-shared";
import { MAX_POST_IMAGE_DIR } from "@/lib/max/channel-post";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { applyAllFixes } from "@/lib/smm/quality";
import { BRAND, newShortCode, qualityFor, saveTemplateImage } from "@/lib/smm/service.server";
import { uploadsDir } from "@/lib/uploads-path";

import { SITE_URL, WEEKLY_BUTTON, buildWeeklyInput, buildWeeklyInstructions, emailBodyFromPost, headlineOf, parseWeeklyPost, type WeeklyFacts } from "./facts";
import { collectWeeklyFacts } from "./facts.server";
import { autoBuildWeekKey, issueIsOut, upcomingWednesday, weekTitle, weeklyPublishAt } from "./schedule";

/**
 * Еженедельный выпуск (ROOT → «Каналы Telegram и MAX» → «Еженедельный выпуск»).
 *
 * Крон канала (`/api/cron/max-channel`, раз в минуту) зовёт `runWeeklyTick`:
 *   1. с понедельника 08:00 МСК заводит выпуск на ближайшую среду (один на
 *      неделю — `WeeklyIssue.weekKey` уникален); кнопка «Собрать выпуск на
 *      среду» делает то же в любой день и пересобирает невышедший;
 *   2. сбор фактов → текст в шлюзе ProjectsFlow → applyAllFixes → картинка
 *      → фирменный шаблон → analyzePost;
 *   3. посты во все каналы на среду 09:00 (source «weekly») — видны и
 *      правятся в «Плане публикаций»; verdict «block» — пост ждёт
 *      согласования (статус «review»), root получает уведомление;
 *   4. черновик рассылки «Сообщение» руководителям клиентов (только
 *      подписанным — отписка и стоп-лист общие с рассылками); запускается,
 *      когда пост вышел в канал, с текущим текстом поста.
 */

const SETTINGS_KEY = "channels.weekly";
const MAX_ATTEMPTS = 3;
const IMAGE_SIZE = { width: 1280, height: 960 };
const IMAGE_DEADLINE_MS = 30 * 60_000;
/** Пост так и не вышел за это время после 09:00 — письмо не отправляем. */
const EMAIL_GRACE_MS = 2 * 86_400_000;
export const WEEKLY_RUBRIC = "news";
export const WEEKLY_SOURCE = "weekly";
const AUDIENCE_SEGMENT = "clients:managers";

export interface WeeklySettings {
  enabled: boolean;
}

export async function readWeeklySettings(): Promise<WeeklySettings> {
  const row = await db.platformSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return { enabled: true };
  try {
    const value = JSON.parse(row.value) as Partial<WeeklySettings>;
    return { enabled: typeof value.enabled === "boolean" ? value.enabled : true };
  } catch {
    return { enabled: true };
  }
}

export async function saveWeeklySettings(patch: Partial<WeeklySettings>): Promise<WeeklySettings> {
  const next = { ...(await readWeeklySettings()), ...patch };
  await db.platformSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}

type Row = Awaited<ReturnType<typeof db.weeklyIssue.findUniqueOrThrow>>;

function describe(error: unknown): string {
  if (error instanceof CodexGatewayError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "Шлюз ProjectsFlow не ответил вовремя";
  return (error as Error)?.message?.slice(0, 200) || "Неизвестная ошибка";
}

/** Кто «запускает» рассылку выпуска: первый root (для аудита и автора черновика). */
async function systemActor(): Promise<MailingActor> {
  const root = await db.user.findFirst({ where: { isRoot: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true } });
  return { session: { user: { id: root?.id ?? "system", name: "Еженедельный выпуск", email: root?.email ?? null } } };
}

/** Руководители клиентов — та же база «Все клиенты», что в простом режиме рассылки. */
async function audienceSelection(now: Date): Promise<{ userIds: string[]; contactIds: string[] }> {
  const segment = clientSegment(AUDIENCE_SEGMENT);
  const users = await loadAudienceUsers(now);
  return { userIds: users.filter((row) => segment?.match(row, now)).map((row) => row.id), contactIds: [] };
}

const EMAIL_CHANNELS = { email: true, inApp: false, push: false, telegram: false, max: false };

function absoluteUpload(path: string | null | undefined): string | undefined {
  return path ? `${SITE_URL}/uploads/${path}` : undefined;
}

export function weeklyEmailPayload(input: { subject: string; text: string; imagePath?: string | null; buttonText?: string | null; buttonUrl?: string | null }): MessagePayload {
  const imageUrl = absoluteUpload(input.imagePath);
  return {
    ...defaultMessagePayload(),
    subject: input.subject.slice(0, 150),
    body: emailBodyFromPost(input.text),
    buttonText: input.buttonText || WEEKLY_BUTTON.text,
    buttonUrl: input.buttonUrl || WEEKLY_BUTTON.url,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

/** Текущий контент выпуска: из поста в планировщике (его могли поправить), иначе — из выпуска. */
async function currentContent(row: Row): Promise<{ text: string; imagePath: string | null; buttonText: string | null; buttonUrl: string | null }> {
  const posts = row.postIds.length
    ? await db.maxChannelPost.findMany({ where: { id: { in: row.postIds }, status: { not: "deleted" } }, orderBy: { createdAt: "asc" } })
    : [];
  const post = posts.find((p) => p.status === "sent") ?? posts[0];
  if (post) return { text: post.text, imagePath: post.images[0] ?? null, buttonText: post.buttonText, buttonUrl: post.buttonUrl };
  return { text: row.text ?? "", imagePath: row.imagePath, buttonText: row.buttonText, buttonUrl: row.buttonUrl };
}

async function fail(row: Row, message: string, retry: boolean): Promise<void> {
  const attempts = row.attempts + 1;
  if (retry && attempts < MAX_ATTEMPTS) {
    await db.weeklyIssue.update({ where: { id: row.id }, data: { status: "queued", textJobId: null, imageJobId: null, attempts, error: `${message} — повторим` } });
    return;
  }
  await db.weeklyIssue.update({ where: { id: row.id }, data: { status: "failed", attempts, error: message } });
  await notifyPlatformAdmin(
    `⚠️ Еженедельный выпуск на ${weekTitle(row.weekKey)} не собран: ${message}. Нажмите «Собрать выпуск на среду» на /root/max-channel.`,
    { kind: "system", dedupeKey: `weekly-failed:${row.id}:${attempts}` },
  ).catch(() => {});
}

// ─────────────────────────────── шаги сборки ───────────────────────────────

async function stepQueued(row: Row, now: Date): Promise<void> {
  const claimed = await db.weeklyIssue.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "text" } });
  if (!claimed.count) return;
  try {
    const facts = await collectWeeklyFacts(row.weekKey, now);
    const jobId = await startTextJob(buildWeeklyInput(facts), buildWeeklyInstructions());
    await db.weeklyIssue.update({
      where: { id: row.id },
      data: { textJobId: jobId, facts: facts as unknown as Prisma.InputJsonValue, error: null },
    });
  } catch (error) {
    await db.weeklyIssue.update({ where: { id: row.id }, data: { status: "queued", error: describe(error) } });
  }
}

async function stepText(row: Row): Promise<void> {
  if (!row.textJobId) return;
  const job = await readTextJob(row.textJobId);
  if (job.status === "queued" || job.status === "running") return;
  if (job.status !== "succeeded" || !job.text) {
    await fail(row, `Текст не написан: ${job.error ?? job.status}`, true);
    return;
  }
  const parsed = parseWeeklyPost(job.text);
  if (!parsed) {
    await fail(row, "ИИ вернул текст не по правилам (длина, ссылки или формат)", true);
    return;
  }
  // Детерминированные исправления по фирменному стилю (quality.ts).
  const text = applyAllFixes(
    { text: parsed.text, rubric: WEEKLY_RUBRIC, buttonText: WEEKLY_BUTTON.text, buttonUrl: WEEKLY_BUTTON.url, images: [{}] },
    BRAND,
  );
  await db.weeklyIssue.update({
    where: { id: row.id },
    data: {
      status: "image",
      subject: parsed.subject,
      text,
      imagePrompt: parsed.imagePrompt,
      buttonText: WEEKLY_BUTTON.text,
      buttonUrl: WEEKLY_BUTTON.url,
      error: null,
    },
  });
}

async function stepImage(row: Row, now: Date): Promise<void> {
  const late = row.publishAt.getTime() - now.getTime() < IMAGE_DEADLINE_MS;
  if (!row.imageJobId) {
    if (late) {
      await finalize({ ...row, error: "Картинка не успела — выпуск без фото" }, null, now);
      return;
    }
    const quota = await imageQuota();
    if (quota.remaining <= 0 || quota.active >= 2) {
      if (row.error !== "Ждём лимит картинок шлюза") await db.weeklyIssue.update({ where: { id: row.id }, data: { error: "Ждём лимит картинок шлюза" } });
      return;
    }
    const claimed = await db.weeklyIssue.updateMany({ where: { id: row.id, status: "image", imageJobId: null }, data: { imageJobId: "pending" } });
    if (!claimed.count) return;
    try {
      const jobId = await startImageJob(buildImagePrompt({ title: row.subject ?? "Еженедельный выпуск WeSetup" }, row.imagePrompt ?? ""), IMAGE_SIZE);
      await db.weeklyIssue.update({ where: { id: row.id }, data: { imageJobId: jobId, error: null } });
    } catch (error) {
      await db.weeklyIssue.update({ where: { id: row.id }, data: { imageJobId: null, error: describe(error) } });
    }
    return;
  }
  if (row.imageJobId === "pending") return;
  const job = await readImageJob(row.imageJobId);
  if (job.status === "queued" || job.status === "running") {
    if (late) await finalize({ ...row, error: "Картинка не успела — выпуск без фото" }, null, now);
    return;
  }
  if (job.status !== "succeeded") {
    const attempts = row.attempts + 1;
    if (attempts < MAX_ATTEMPTS && !late) {
      await db.weeklyIssue.update({ where: { id: row.id }, data: { imageJobId: null, attempts, error: `Картинка не вышла: ${job.error ?? job.status} — повторим` } });
      return;
    }
    await finalize({ ...row, attempts, error: `Картинка не вышла (${job.error ?? job.status}) — выпуск без фото` }, null, now);
    return;
  }
  const bytes = await downloadImage(row.imageJobId);
  const name = `weekly-${row.weekKey}-${randomBytes(6).toString("base64url")}.png`;
  const dir = join(uploadsDir(), MAX_POST_IMAGE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), bytes);
  const photoPath = `${MAX_POST_IMAGE_DIR}/${name}`;
  // ИИ-фото — в фирменный шаблон (плашка, заголовок, логотип).
  const branded = await saveTemplateImage({
    template: "photo-band",
    photoPath,
    data: { title: headlineOf(row.text ?? "") || row.subject || "Еженедельный выпуск", rubric: "Выпуск недели" },
  }).catch((error) => {
    console.warn("[weekly] template failed, raw photo used", (error as Error)?.message?.slice(0, 120));
    return photoPath;
  });
  await finalize(row, branded, now);
}

/** Проверка качества → посты во все каналы → черновик письма. */
async function finalize(row: Row, imagePath: string | null, now: Date): Promise<void> {
  const channels = await db.maxChannel.findMany({ where: { removed: false, botIsAdmin: true } });
  if (channels.length === 0) {
    await fail(row, "Нет подключённых каналов, где бот — администратор", false);
    return;
  }
  const text = row.text ?? "";
  const report = await qualityFor(
    {
      text,
      images: imagePath ? [imagePath] : [],
      buttonText: row.buttonText,
      buttonUrl: row.buttonUrl,
      rubric: WEEKLY_RUBRIC,
      campaign: `weekly-${row.weekKey}`,
      scheduledAt: row.publishAt,
      channelIds: channels.map((c) => c.id),
      // Автопост дня в 10:00 — свой слот: частота не блокирует выпуск.
      ignoreSources: ["auto"],
    },
    now,
  );
  const blocked = report.verdict === "block";
  const ids: string[] = [];
  for (const channel of channels) {
    const post = await db.maxChannelPost.create({
      data: {
        channelId: channel.id,
        rubric: WEEKLY_RUBRIC,
        shortCode: row.buttonUrl ? newShortCode() : null,
        qualityScore: report.score,
        qualityVerdict: report.verdict,
        text,
        images: imagePath ? [imagePath] : [],
        buttonText: row.buttonText,
        buttonUrl: row.buttonUrl,
        campaign: `weekly-${row.weekKey}`,
        // «block» — сам не уйдёт: ждёт согласования в «Плане публикаций».
        status: blocked ? "review" : "scheduled",
        approval: blocked ? "pending" : "none",
        scheduledAt: row.publishAt,
        source: WEEKLY_SOURCE,
      },
    });
    ids.push(post.id);
  }
  let campaignId: string | null = null;
  let recipients: number | null = null;
  let emailError: string | null = null;
  try {
    const selection = await audienceSelection(now);
    const plan = await planRecipients(selection, EMAIL_CHANNELS);
    recipients = plan.stats.channels.email.queued;
    const draft = await createDraft(
      {
        title: `Еженедельный выпуск — ${weekTitle(row.weekKey)}`,
        kind: "message",
        channels: EMAIL_CHANNELS,
        payload: weeklyEmailPayload({ subject: row.subject ?? headlineOf(text), text, imagePath, buttonText: row.buttonText, buttonUrl: row.buttonUrl }),
        audience: { ...selection, filters: { weekly: { weekKey: row.weekKey, segment: AUDIENCE_SEGMENT } } },
      },
      await systemActor(),
    );
    campaignId = draft.id;
  } catch (error) {
    emailError = `Черновик письма не создан: ${describe(error)}`;
    console.error("[weekly] email draft failed", describe(error));
  }
  await db.weeklyIssue.update({
    where: { id: row.id },
    data: {
      status: blocked ? "review" : "scheduled",
      imagePath,
      postIds: ids,
      qualityScore: report.score,
      qualityVerdict: report.verdict,
      campaignId,
      emailStatus: campaignId ? "draft" : "none",
      emailRecipients: recipients,
      error: emailError ?? (imagePath ? null : row.error),
    },
  });
  console.info(`[weekly] ${row.weekKey} built: score=${report.score} verdict=${report.verdict} channels=${ids.length} email=${recipients ?? "-"}`);
  if (blocked) {
    const reasons = report.items.filter((i) => i.status === "fail").slice(0, 3).map((i) => i.label).join("; ");
    await notifyPlatformAdmin(
      `📝 Еженедельный выпуск на ${weekTitle(row.weekKey)} ждёт согласования: проверка качества ${report.score}/100${reasons ? ` (${reasons})` : ""}. Поправьте и утвердите пост в «Плане публикаций» на /root/max-channel — иначе он не выйдет.`,
      { kind: "system", dedupeKey: `weekly-review:${row.id}` },
    ).catch(() => {});
  }
}

// ─────────────────────────────── выход и письмо ───────────────────────────────

/** Пост вышел в канал — запускаем письмо с его текущим текстом. */
async function stepEmail(row: Row, now: Date): Promise<void> {
  if (row.emailStatus !== "draft" || !row.campaignId) return;
  const posts = row.postIds.length ? await db.maxChannelPost.findMany({ where: { id: { in: row.postIds } }, select: { status: true } }) : [];
  const out = posts.some((p) => p.status === "sent");
  if (!out) {
    if (now.getTime() > row.publishAt.getTime() + EMAIL_GRACE_MS) {
      await db.weeklyIssue.update({ where: { id: row.id }, data: { emailStatus: "skipped", error: "Пост не вышел в канал — письмо не отправлено" } });
    }
    return;
  }
  const campaign = await db.mailingCampaign.findUnique({ where: { id: row.campaignId }, select: { status: true } });
  if (!campaign) {
    await db.weeklyIssue.update({ where: { id: row.id }, data: { emailStatus: "skipped", error: "Черновик письма удалён — письмо не отправлено" } });
    return;
  }
  if (campaign.status !== "draft") {
    // Запустили вручную из «Рассылок» — второй раз не шлём.
    await db.weeklyIssue.update({ where: { id: row.id }, data: { emailStatus: "sent" } });
    return;
  }
  const actor = await systemActor();
  const content = await currentContent(row);
  const selection = await audienceSelection(now);
  await updateDraft(
    row.campaignId,
    {
      title: `Еженедельный выпуск — ${weekTitle(row.weekKey)}`,
      kind: "message",
      channels: EMAIL_CHANNELS,
      payload: weeklyEmailPayload({ subject: row.subject ?? headlineOf(content.text), ...content }),
      audience: { ...selection, filters: { weekly: { weekKey: row.weekKey, segment: AUDIENCE_SEGMENT } } },
    },
    actor,
  );
  const result = await launchCampaign(row.campaignId, { mode: "now" }, actor);
  await db.weeklyIssue.update({
    where: { id: row.id },
    data: { emailStatus: "sent", emailRecipients: result.stats.channels.email.queued },
  });
  console.info(`[weekly] ${row.weekKey} email launched to ${result.stats.channels.email.queued}`);
}

async function stepPublished(row: Row): Promise<void> {
  if (row.emailStatus === "draft") return;
  const posts = row.postIds.length ? await db.maxChannelPost.findMany({ where: { id: { in: row.postIds } }, select: { status: true } }) : [];
  if (posts.length && posts.every((p) => p.status === "sent" || p.status === "deleted")) {
    await db.weeklyIssue.update({ where: { id: row.id }, data: { status: "published" } });
  }
}

/** Заводит выпуск недели. Повторный и параллельный вызов — no-op (weekKey уникален). */
async function ensureIssue(weekKey: string, trigger: "auto" | "manual"): Promise<boolean> {
  try {
    await db.weeklyIssue.create({ data: { weekKey, publishAt: weeklyPublishAt(weekKey), trigger } });
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return false;
    throw error;
  }
}

/** Один проход крона. Повторный и параллельный запуск безопасны. */
export async function runWeeklyTick(now: Date = new Date()): Promise<{ active: number }> {
  const settings = await readWeeklySettings();
  if (settings.enabled && codexGatewayConfigured()) {
    const weekKey = autoBuildWeekKey(now);
    if (weekKey) await ensureIssue(weekKey, "auto");
  }
  const building = codexGatewayConfigured()
    ? await db.weeklyIssue.findMany({ where: { status: { in: ["queued", "text", "image"] } }, orderBy: { weekKey: "asc" }, take: 3 })
    : [];
  for (const row of building) {
    if (row.publishAt.getTime() < now.getTime()) {
      await fail(row, "Не успели собрать к времени выхода", false);
      continue;
    }
    try {
      if (row.status === "queued") await stepQueued(row, now);
      else if (row.status === "text") await stepText(row);
      else await stepImage(row, now);
    } catch (error) {
      console.error(`[weekly] ${row.weekKey} step ${row.status} failed:`, describe(error));
      await db.weeklyIssue.update({ where: { id: row.id }, data: { error: describe(error) } }).catch(() => {});
    }
  }
  const out = await db.weeklyIssue.findMany({
    // Окно с запасом на «письмо после выхода поста»: старые зависшие не мешают новым.
    where: { status: { in: ["scheduled", "review"] }, publishAt: { lte: now, gte: new Date(now.getTime() - EMAIL_GRACE_MS - 86_400_000) } },
    orderBy: { weekKey: "asc" },
    take: 3,
  });
  for (const row of out) {
    try {
      await stepEmail(row, now);
      await stepPublished(await db.weeklyIssue.findUniqueOrThrow({ where: { id: row.id } }));
    } catch (error) {
      console.error(`[weekly] ${row.weekKey} email failed:`, describe(error));
      await db.weeklyIssue.update({ where: { id: row.id }, data: { error: `Письмо: ${describe(error)}` } }).catch(() => {});
    }
  }
  return { active: building.length + out.length };
}

// ─────────────────────────────── действия ROOT ───────────────────────────────

/** Снимает невышедшие посты и черновик письма выпуска. */
async function dropArtifacts(row: Row): Promise<void> {
  if (row.postIds.length) {
    await db.maxChannelPost.deleteMany({ where: { id: { in: row.postIds }, status: { in: ["draft", "scheduled", "review", "failed"] } } });
  }
  if (row.campaignId) await db.mailingCampaign.deleteMany({ where: { id: row.campaignId, status: "draft" } });
}

async function assertNotOut(row: Row): Promise<void> {
  const posts = row.postIds.length ? await db.maxChannelPost.findMany({ where: { id: { in: row.postIds } }, select: { status: true } }) : [];
  if (issueIsOut(row, posts.map((p) => p.status))) throw new Error("Выпуск уже вышел — пересобрать или отменить нельзя.");
}

/**
 * «Собрать выпуск на среду»: ближайшая среда; есть невышедший выпуск —
 * пересобираем заново (посты и черновик письма снимаются).
 */
export async function buildWeeklyNow(now: Date = new Date()): Promise<{ weekKey: string; rebuilt: boolean }> {
  if (!codexGatewayConfigured()) throw new Error("ИИ не подключён: не задан CODEX_GATEWAY_TOKEN.");
  const weekKey = upcomingWednesday(now);
  if (await ensureIssue(weekKey, "manual")) return { weekKey, rebuilt: false };
  const row = await db.weeklyIssue.findUniqueOrThrow({ where: { weekKey } });
  await assertNotOut(row);
  await dropArtifacts(row);
  await db.weeklyIssue.update({
    where: { id: row.id },
    data: {
      status: "queued",
      trigger: "manual",
      publishAt: weeklyPublishAt(weekKey),
      facts: Prisma.DbNull,
      textJobId: null,
      imageJobId: null,
      subject: null,
      text: null,
      imagePrompt: null,
      imagePath: null,
      qualityScore: null,
      qualityVerdict: null,
      postIds: [],
      campaignId: null,
      emailStatus: "none",
      emailRecipients: null,
      error: null,
      attempts: 0,
    },
  });
  return { weekKey, rebuilt: true };
}

/** «Отменить выпуск»: посты и письмо этой недели не уйдут. */
export async function cancelWeekly(id: string): Promise<void> {
  const row = await db.weeklyIssue.findUniqueOrThrow({ where: { id } });
  await assertNotOut(row);
  await dropArtifacts(row);
  await db.weeklyIssue.update({ where: { id }, data: { status: "cancelled", postIds: [], campaignId: null, emailStatus: "none" } });
}

// ─────────────────────────────── вид для страницы ───────────────────────────────

export type WeeklyIssueView = {
  id: string;
  weekKey: string;
  weekTitle: string;
  publishAt: string;
  status: string;
  trigger: string;
  subject: string | null;
  text: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  qualityScore: number | null;
  qualityVerdict: string | null;
  error: string | null;
  facts: WeeklyFacts | null;
  posts: Array<{ id: string; status: string; url: string | null; platform: string; approval: string }>;
  email: { status: string; campaignId: string | null; campaignStatus: string | null; recipients: number | null };
};

export type WeeklyView = {
  settings: WeeklySettings;
  gatewayConfigured: boolean;
  nextWeekKey: string;
  nextWeekTitle: string;
  current: WeeklyIssueView | null;
  past: WeeklyIssueView[];
};

async function toView(row: Row, liveRecipients: boolean, now: Date): Promise<WeeklyIssueView> {
  const posts = row.postIds.length
    ? await db.maxChannelPost.findMany({
        where: { id: { in: row.postIds } },
        select: { id: true, status: true, url: true, approval: true, text: true, images: true, qualityScore: true, qualityVerdict: true, channel: { select: { platform: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const campaign = row.campaignId ? await db.mailingCampaign.findUnique({ where: { id: row.campaignId }, select: { status: true } }) : null;
  let recipients = row.emailRecipients;
  if (liveRecipients && row.emailStatus === "draft") {
    recipients = await planRecipients(await audienceSelection(now), EMAIL_CHANNELS)
      .then((plan) => plan.stats.channels.email.queued)
      .catch(() => row.emailRecipients);
  }
  // Пост могли поправить в «Плане публикаций» — показываем его текущий вид.
  const live = posts.find((p) => p.status !== "deleted");
  return {
    id: row.id,
    weekKey: row.weekKey,
    weekTitle: weekTitle(row.weekKey),
    publishAt: row.publishAt.toISOString(),
    status: row.status,
    trigger: row.trigger,
    subject: row.subject,
    text: live?.text ?? row.text,
    imageUrl: (live?.images[0] ?? row.imagePath) ? `/uploads/${live?.images[0] ?? row.imagePath}` : null,
    buttonText: row.buttonText,
    buttonUrl: row.buttonUrl,
    qualityScore: live?.qualityScore ?? row.qualityScore,
    qualityVerdict: live?.qualityVerdict ?? row.qualityVerdict,
    error: row.error,
    facts: (row.facts as unknown as WeeklyFacts | null) ?? null,
    posts: posts.map((p) => ({ id: p.id, status: p.status, url: p.url, platform: p.channel.platform, approval: p.approval })),
    email: { status: row.emailStatus, campaignId: row.campaignId, campaignStatus: campaign?.status ?? null, recipients },
  };
}

export async function loadWeeklyView(now: Date = new Date()): Promise<WeeklyView> {
  const [settings, rows] = await Promise.all([
    readWeeklySettings(),
    db.weeklyIssue.findMany({ orderBy: { weekKey: "desc" }, take: 6 }),
  ]);
  const today = moscowDateKey(now);
  const upcoming = rows.filter((r) => r.weekKey >= today && r.status !== "cancelled").sort((a, b) => a.weekKey.localeCompare(b.weekKey));
  const currentRow = upcoming[0] ?? null;
  const pastRows = rows.filter((r) => r !== currentRow).slice(0, 4);
  const nextWeekKey = upcomingWednesday(now);
  return {
    settings,
    gatewayConfigured: codexGatewayConfigured(),
    nextWeekKey,
    nextWeekTitle: weekTitle(nextWeekKey),
    current: currentRow ? await toView(currentRow, true, now) : null,
    past: await Promise.all(pastRows.map((r) => toView(r, false, now))),
  };
}

/** Превью письма выпуска — как его увидит получатель (пример имени и компании). */
export async function weeklyEmailPreview(id: string): Promise<{ subject: string; html: string } | null> {
  const row = await db.weeklyIssue.findUnique({ where: { id } });
  if (!row?.text) return null;
  const content = await currentContent(row);
  const preview = await previewMailing({
    kind: "message",
    payload: weeklyEmailPayload({ subject: row.subject ?? headlineOf(content.text), ...content }),
    recipient: null,
  });
  if (!preview.rendered.email) return null;
  return { subject: preview.rendered.email.subject, html: preview.rendered.email.html };
}
