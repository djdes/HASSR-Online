import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import { GglAuthError, GglCallError } from "@/lib/seo/gogetlinks-client.server";
import { analyzeGglWebmasters, getGglApplicationsView, GglApplicationsError, loadGglApplicationCards } from "@/lib/seo/gogetlinks-applications.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh"), campaignId: z.number().int().positive().optional() }).strict(),
  z.object({ action: z.literal("cards"), campaignId: z.number().int().positive(), snapshotId: z.string().regex(/^[a-f0-9]{64}$/), siteIds: z.array(z.number().int().positive()).min(1).max(20).optional() }).strict(),
  z.object({ action: z.literal("analyze"), campaignId: z.number().int().positive(), snapshotId: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

function failure(error: unknown) {
  if (error instanceof GglApplicationsError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof GglAuthError) return NextResponse.json({ error: error.message }, { status: 422 });
  if (error instanceof GglCallError) return NextResponse.json({ error: error.message }, { status: error.gglClass === "rate" ? 429 : 502 });
  console.error("[ggl-applications]", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Не удалось получить заявки вебмастеров. Повторите позже" }, { status: 502 });
}

export async function GET(request: Request) {
  await requireRoot();
  const raw = new URL(request.url).searchParams.get("campaignId");
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  if (raw !== null && !parsed.success) return NextResponse.json({ error: "Некорректная кампания" }, { status: 400 });
  try { return NextResponse.json(await getGglApplicationsView(raw === null ? undefined : parsed.data), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}

/** All actions only retrieve/cache data or ask the dispatcher for an advisory report. */
export async function POST(request: Request) {
  await requireRoot();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректные параметры анализа заявок" }, { status: 400 });
  const data = parsed.data;
  try {
    if (data.action === "refresh") return NextResponse.json(await getGglApplicationsView(data.campaignId, true));
    if (data.action === "cards") return NextResponse.json({ cards: await loadGglApplicationCards(data.campaignId, data.snapshotId, data.siteIds) });
    return NextResponse.json({ analysis: await analyzeGglWebmasters(data.campaignId, data.snapshotId) });
  } catch (error) { return failure(error); }
}
