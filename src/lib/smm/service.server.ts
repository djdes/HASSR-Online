import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { db } from "@/lib/db";
import { MAX_POST_IMAGE_DIR } from "@/lib/max/channel-post";
import { uploadsDir } from "@/lib/uploads-path";

import { WESETUP_BRAND } from "./brand-profile";
import { analyzePlan, analyzePost, type PlanReport, type PostImageMeta, type PostInput, type PostReport } from "./quality";
import { renderTemplate } from "./render.server";
import type { TemplateData, TemplateKey } from "./templates";

/**
 * СММ-сервис WeSetup: контекст для проверок качества (прошлые и будущие
 * посты), шлюз публикации (B02) и картинки по шаблонам бренда (A23).
 */

export const BRAND = WESETUP_BRAND;

/** Картинки по шаблону бренда сохраняются с этим префиксом (B29). */
export const TEMPLATE_PREFIX = "tpl-";

export function isBrandedImage(path: string): boolean {
  return path.split("/").pop()?.startsWith(TEMPLATE_PREFIX) ?? false;
}

async function imageMeta(path: string): Promise<PostImageMeta> {
  const branded = isBrandedImage(path);
  try {
    const bytes = await readFile(join(uploadsDir(), ...path.split("/")));
    const { loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(bytes);
    return { width: image.width, height: image.height, bytes: bytes.length, branded };
  } catch {
    return { branded };
  }
}

export interface DraftForQuality {
  text: string;
  images: string[];
  buttonText?: string | null;
  buttonUrl?: string | null;
  campaign?: string | null;
  rubric?: string | null;
  scheduledAt?: string | Date | null;
  channelIds: string[];
  /** Пост, который правим, — не сравнивать с самим собой. */
  excludeIds?: string[];
}

export async function qualityFor(draft: DraftForQuality, now: Date = new Date()): Promise<PostReport> {
  const [channels, recent, images] = await Promise.all([
    db.maxChannel.findMany({ where: { id: { in: draft.channelIds } }, select: { platform: true } }),
    db.maxChannelPost.findMany({
      where: {
        id: { notIn: draft.excludeIds ?? [] },
        status: { in: ["sent", "scheduled", "sending"] },
        OR: [
          { sentAt: { gte: new Date(now.getTime() - 60 * 86_400_000) } },
          { scheduledAt: { gte: new Date(now.getTime() - 60 * 86_400_000) } },
        ],
      },
      select: { text: true, sentAt: true, scheduledAt: true, rubric: true, channelId: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    Promise.all(draft.images.map(imageMeta)),
  ]);
  const input: PostInput = {
    text: draft.text,
    images,
    buttonText: draft.buttonText,
    buttonUrl: draft.buttonUrl,
    campaign: draft.campaign,
    rubric: draft.rubric,
    scheduledAt: draft.scheduledAt ?? null,
    platforms: [...new Set(channels.map((c) => (c.platform === "telegram" ? "telegram" : "max")))] as PostInput["platforms"],
  };
  // Кросспост — одна запись на канал: одинаковые тексты не считаем дублем.
  const seen = new Set<string>();
  const recentPosts = recent
    .filter((p) => {
      const key = `${p.text}|${(p.sentAt ?? p.scheduledAt)?.toISOString().slice(0, 16)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({ text: p.text, at: (p.sentAt ?? p.scheduledAt) as Date, rubric: p.rubric, channelIds: [p.channelId] }));
  return analyzePost(input, BRAND, { now, recent: recentPosts, channelIds: draft.channelIds });
}

export async function planReport(now: Date = new Date()): Promise<PlanReport> {
  const posts = await db.maxChannelPost.findMany({
    where: {
      status: { in: ["sent", "scheduled", "sending"] },
      OR: [{ sentAt: { gte: new Date(now.getTime() - 8 * 86_400_000) } }, { scheduledAt: { gte: new Date(now.getTime() - 8 * 86_400_000) } }],
    },
    select: { id: true, text: true, sentAt: true, scheduledAt: true, rubric: true, channelId: true, status: true },
    take: 400,
  });
  // Один пост в несколько каналов — для плана это одна публикация.
  const unique = new Map<string, (typeof posts)[number]>();
  for (const p of posts) unique.set(`${p.text}|${(p.sentAt ?? p.scheduledAt)?.toISOString().slice(0, 16)}`, p);
  return analyzePlan(
    [...unique.values()].map((p) => ({ id: p.id, at: (p.sentAt ?? p.scheduledAt) as Date, text: p.text, rubric: p.rubric, status: p.status })),
    BRAND,
    { now, days: 14 },
  );
}

export class QualityGateError extends Error {
  constructor(public report: PostReport) {
    super(
      `Пост не прошёл проверку качества (${report.score}/100): ${report.items
        .filter((i) => i.status === "fail")
        .slice(0, 3)
        .map((i) => i.label)
        .join("; ")}. Исправьте или подтвердите публикацию.`,
    );
  }
}

/** Шлюз публикации (B02): «block» уходит только с явным подтверждением. */
export function assertQualityGate(report: PostReport, force: boolean): void {
  if (report.verdict === "block" && !force) throw new QualityGateError(report);
}

/** Картинка по шаблону бренда в каталог загрузок постов (A23). */
export async function saveTemplateImage(input: { template: TemplateKey; data: TemplateData; photoPath?: string | null }): Promise<string> {
  let photo: Uint8Array | null = null;
  if (input.photoPath) {
    if (!/^max-channel\/[A-Za-z0-9_-]{8,80}\.(jpg|png|webp|gif)$/.test(input.photoPath)) throw new Error("Неизвестное фото");
    photo = new Uint8Array(await readFile(join(uploadsDir(), ...input.photoPath.split("/"))));
  }
  const png = await renderTemplate({ template: input.template, data: input.data, photo, profile: BRAND });
  const name = `${TEMPLATE_PREFIX}${randomBytes(10).toString("base64url")}.png`;
  const dir = join(uploadsDir(), MAX_POST_IMAGE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), png);
  return `${MAX_POST_IMAGE_DIR}/${name}`;
}

/** Код короткой ссылки кнопки (A16). */
export function newShortCode(): string {
  return randomBytes(5).toString("base64url").replace(/[-_]/g, "x");
}
