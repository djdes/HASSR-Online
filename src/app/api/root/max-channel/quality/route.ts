import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { maxChannelFailure } from "@/lib/max/channel-api.server";
import { planReport, qualityFor } from "@/lib/smm/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string().max(8000).default(""),
  images: z.array(z.string().max(120)).max(12).default([]),
  buttonText: z.string().max(200).nullable().optional(),
  buttonUrl: z.string().max(2000).nullable().optional(),
  campaign: z.string().max(80).nullable().optional(),
  rubric: z.string().max(40).nullable().optional(),
  scheduledAt: z.string().max(40).nullable().optional(),
  channelIds: z.array(z.string()).max(10).default([]),
  excludeIds: z.array(z.string()).max(10).optional(),
  plan: z.boolean().optional(),
});

/**
 * POST /api/root/max-channel/quality — отчёт о качестве черновика (B01–B29)
 * с учётом прошлых постов и, по запросу, разбор плана (B21, B22, A07).
 */
export async function POST(request: Request) {
  await requireRoot();
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const images = body.images.filter((path) => /^max-channel\/[A-Za-z0-9_-]{8,80}\.(jpg|png|webp|gif)$/.test(path));
    const [quality, plan] = await Promise.all([
      qualityFor({ ...body, images, scheduledAt: body.scheduledAt || null }),
      body.plan ? planReport() : Promise.resolve(null),
    ]);
    return NextResponse.json({ quality, plan });
  } catch (error) {
    return maxChannelFailure(error);
  }
}
