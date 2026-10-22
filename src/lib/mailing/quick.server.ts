import { db } from "@/lib/db";

import { loadAudienceUsers, planRecipients, type AudienceSelection, type PlanStats } from "./audience.server";
import { clientBases, clientSegment, contactBaseId, contactBaseSource, type MailingBase } from "./bases";
import { createDraft, MailingError, updateDraft, type MailingActor } from "./campaigns.server";
import { getMailingPreset, type MailingPreset } from "./presets";

/**
 * Простой режим ROOT → «Рассылка»: база адресов + готовое письмо
 * (`presets.ts`). Базы разворачиваются в получателей здесь, на сервере;
 * дальше — обычный черновик `MailingCampaign` и обычный запуск
 * (`/campaigns/[id]/test`, `/launch`): очередь, стоп-лист и отписка общие.
 */

const CONTACT_BASES_MAX = 200;

async function contactBases(): Promise<MailingBase[]> {
  const rows = await db.marketingContact.groupBy({
    by: ["source"],
    where: { status: "active" },
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: CONTACT_BASES_MAX,
  });
  if (rows.length === 0) return [];
  const suppressedRows = await db.$queryRaw<Array<{ source: string; n: bigint }>>`
    SELECT c."source", COUNT(*)::bigint AS n
    FROM "MarketingContact" c
    JOIN "EmailSuppression" s ON s."email" = c."email"
    WHERE c."status" = 'active'
    GROUP BY c."source"`;
  const suppressed = new Map(suppressedRows.map((r) => [r.source, Number(r.n)]));
  return rows.map((row) => {
    const loaded = row._max.createdAt;
    return {
      id: contactBaseId(row.source),
      kind: "contacts" as const,
      title: row.source,
      description: loaded
        ? `Загружена ${loaded.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}`
        : "Загруженная база",
      total: row._count._all,
      emailable: Math.max(0, row._count._all - (suppressed.get(row.source) ?? 0)),
    };
  });
}

/** Все базы с числами: сегменты клиентов, потом загруженные (свежие сверху). */
export async function listMailingBases(now: Date = new Date()): Promise<MailingBase[]> {
  const [users, contacts] = await Promise.all([loadAudienceUsers(now), contactBases()]);
  return [...clientBases(users, now), ...contacts];
}

/** id баз → выбор получателей (пользователи и контакты), без повторов. */
async function resolveBases(baseIds: string[], now: Date): Promise<AudienceSelection> {
  const segments = baseIds.map((id) => clientSegment(id)).filter((s) => s !== null);
  const sources = baseIds.map((id) => contactBaseSource(id)).filter((s): s is string => s !== null);
  const [users, contacts] = await Promise.all([
    segments.length ? loadAudienceUsers(now) : Promise.resolve([]),
    sources.length
      ? db.marketingContact.findMany({
          where: { status: "active", source: { in: sources } },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const userIds = users.filter((row) => segments.some((s) => s.match(row, now))).map((row) => row.id);
  return { userIds, contactIds: contacts.map((c) => c.id) };
}

export type QuickInput = { presetId: string; baseIds: string[] };

export type QuickPlan = {
  preset: MailingPreset;
  selection: AudienceSelection;
  stats: PlanStats;
  /** Сколько человек получат хоть что-то хотя бы по одному каналу шаблона. */
  deliverable: number;
};

export async function planQuickMailing(input: QuickInput, now: Date = new Date()): Promise<QuickPlan> {
  const preset = getMailingPreset(input.presetId);
  if (!preset) throw new MailingError("Шаблон не найден — обновите страницу");
  if (input.baseIds.length === 0) throw new MailingError("Выберите хотя бы одну базу адресов");
  const selection = await resolveBases(input.baseIds, now);
  const { stats, drafts } = await planRecipients(selection, preset.channels);
  const deliverable = drafts.filter((d) => d.status !== "skipped").length;
  return { preset, selection, stats, deliverable };
}

function baseTitle(id: string): string {
  return clientSegment(id)?.title ?? contactBaseSource(id) ?? id;
}

function draftTitle(preset: MailingPreset, baseIds: string[]): string {
  const baseTitles = baseIds.map(baseTitle);
  const bases = baseTitles.length > 2 ? `${baseTitles.slice(0, 2).join(", ")} и ещё ${baseTitles.length - 2}` : baseTitles.join(", ");
  return `${preset.title} → ${bases}`.slice(0, 120);
}

/**
 * Черновик для теста и запуска. `campaignId` — черновик, созданный этим же
 * экраном раньше: обновляем его, а не плодим новые при каждом тесте.
 */
export async function saveQuickDraft(
  input: QuickInput & { campaignId: string | null },
  actor: MailingActor,
  now: Date = new Date()
): Promise<QuickPlan & { campaignId: string }> {
  const plan = await planQuickMailing(input, now);
  const draft = {
    title: draftTitle(plan.preset, input.baseIds),
    kind: plan.preset.kind,
    channels: plan.preset.channels,
    payload: plan.preset.payload,
    audience: {
      ...plan.selection,
      filters: { quick: { presetId: plan.preset.id, baseIds: input.baseIds } },
    },
  };
  let campaignId: string | null = null;
  if (input.campaignId) {
    const existing = await db.mailingCampaign.findUnique({
      where: { id: input.campaignId },
      select: { status: true },
    });
    if (existing?.status === "draft") {
      campaignId = (await updateDraft(input.campaignId, draft, actor)).id;
    }
  }
  if (!campaignId) campaignId = (await createDraft(draft, actor)).id;
  return { ...plan, campaignId };
}
