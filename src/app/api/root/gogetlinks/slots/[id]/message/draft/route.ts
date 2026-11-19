import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueuePfJob, readPfJob } from "@/lib/ai-assistant/pf-client";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isWesetupDomain } from "@/lib/seo/gogetlinks-codec";
import { buildDefaultCandidateSitePages, resolvePublicSeoTargetPath, toCanonicalWesetupUrl } from "@/lib/seo/gogetlinks-planner";
import { readDonorSiteFit } from "@/lib/seo/gogetlinks-site-fit";
import { assessGglDonorSite } from "@/lib/seo/gogetlinks-site-fit.server";
import { buildWebmasterDraftPrompt, parseWebmasterDraft, WEBMASTER_DRAFT_TTL_MS } from "@/lib/seo/gogetlinks-webmaster-draft";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };
const siteIdSchema = z.number().int().positive();
const ticketSchema = z.string().regex(/^[a-z0-9_-]{1,160}$/i);
const savedSchema = z.object({
  ticket: ticketSchema, siteId: siteIdSchema, targetUrl: z.string(), queuedAt: z.number(),
});
const changed = () => NextResponse.json({ status: "changed" }, { status: 409 });
const failed = () => NextResponse.json({ status: "error" }, { status: 502 });

function keyFor(userId: string, slotId: string): string {
  return `ggl:webmaster-draft:${userId}:${slotId}`;
}

async function draftSlot(id: string, siteId: number) {
  const slot = await db.gglPlannedSlot.findUnique({
    where: { id },
    select: {
      status: true, donorSiteId: true, donorDomain: true, donorMetricsJson: true,
      targetUrl: true, targetKeyword: true, placementFormat: true,
      article: { select: { title: true } },
      plan: { select: { campaign: { select: { domain: true, isWesetup: true } } } },
    },
  });
  const campaign = slot?.plan.campaign;
  const path = resolvePublicSeoTargetPath(slot?.targetUrl);
  if (slot?.status !== "pending_approval" || slot.donorSiteId !== siteId || !slot.donorDomain ||
      !campaign?.isWesetup || !isWesetupDomain(campaign.domain) || !path) return null;
  return { ...slot, donorDomain: slot.donorDomain, path, targetUrl: toCanonicalWesetupUrl(path) };
}

export async function POST(request: Request, context: Params) {
  const session = await requireRoot();
  const parsed = z.object({ siteId: siteIdSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ status: "invalid" }, { status: 400 });
  const { id } = await context.params;
  const { siteId } = parsed.data;
  const slot = await draftSlot(id, siteId);
  if (!slot) return changed();

  const landing = buildDefaultCandidateSitePages().find(page => page.url === slot.path);
  const siteFit = await assessGglDonorSite(slot.donorDomain, slot.path, slot.targetKeyword ?? "")
    .catch(() => null) ?? readDonorSiteFit(slot.donorMetricsJson, slot.path);
  const prompt = buildWebmasterDraftPrompt({
    domain: slot.donorDomain, targetUrl: slot.targetUrl,
    targetTitle: landing?.title ?? slot.targetKeyword ?? slot.path,
    targetKeyword: slot.targetKeyword, targetFacts: landing?.facts ?? [],
    placementFormat: slot.placementFormat, articleTitle: slot.article?.title ?? null, siteFit,
  });
  try {
    const submitted = await enqueuePfJob(prompt);
    if (!submitted.ok) return failed();
    const key = keyFor(session.user.id, id);
    const value = JSON.stringify({ ticket: submitted.jobId, siteId, targetUrl: slot.targetUrl, queuedAt: Date.now() });
    await db.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return NextResponse.json({ status: "waiting", ticket: submitted.jobId }, { status: 202 });
  } catch (error) {
    console.warn("[ggl-webmaster-draft] submission failed", error instanceof Error ? error.name : "UnknownError");
    return failed();
  }
}

export async function GET(request: Request, context: Params) {
  const session = await requireRoot();
  const query = new URL(request.url).searchParams;
  const siteId = siteIdSchema.safeParse(Number(query.get("siteId")));
  const ticket = ticketSchema.safeParse(query.get("ticket"));
  if (!siteId.success || !ticket.success) return NextResponse.json({ status: "invalid" }, { status: 400 });
  const { id } = await context.params;
  const slot = await draftSlot(id, siteId.data);
  if (!slot) return changed();
  const key = keyFor(session.user.id, id);
  const row = await db.platformSetting.findUnique({ where: { key } });
  if (!row) return changed();
  const saved = savedSchema.safeParse(JSON.parse(row.value));
  if (!saved.success || saved.data.ticket !== ticket.data || saved.data.siteId !== siteId.data ||
      saved.data.targetUrl !== slot.targetUrl) return changed();
  if (Date.now() - saved.data.queuedAt > WEBMASTER_DRAFT_TTL_MS) return failed();

  const job = await readPfJob(ticket.data).catch(() => ({ status: "waiting" as const }));
  if (job.status === "waiting") return NextResponse.json({ status: "waiting" }, { status: 202 });
  const body = job.status === "succeeded" ? parseWebmasterDraft(job.text, slot.targetUrl) : null;
  return body ? NextResponse.json({ status: "ready", body }) : failed();
}
