import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import {
  GglOrderError,
  materializePlanSlots,
  prepareUpcomingPlannedSlots,
  resolveGglActorFromSession,
  serializePlannedSlot,
  serializeSchedulePlan,
  upsertSchedulePlan,
} from "@/lib/seo/gogetlinks-orders.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const upsertPlanSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(2, "Укажите название плана закупок").max(160),
  campaignId: z.string().trim().min(1, "Выберите кампанию wesetup.ru").max(100),
  kind: z.enum(["one_time", "monthly"]),
  budgetRub: z.number().int().positive("Бюджет должен быть больше 0 ₽").max(10_000_000),
  maxPricePerLinkRub: z
    .number()
    .int()
    .positive("Потолок цены за ссылку должен быть больше 0 ₽")
    .max(1_000_000),
  startsAt: z.string().trim().min(4).max(64).optional(),
  scheduleDaysOfWeek: z.array(z.number().int().min(0).max(7)).max(7).optional(),
  minTfCf: z.number().int().min(0).max(100).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  minDailyTraffic: z.number().int().min(0).max(100_000_000).optional(),
  allowedFormats: z.array(z.enum(["article", "note"])).min(1).max(2).optional(),
  anchorMixBrandPct: z.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(request: Request) {
  await requireRoot();

  const url = new URL(request.url);
  const includeOtherProjects = url.searchParams.get("includeOtherProjects") === "true";

  const [plansRaw, slotsRaw] = await Promise.all([
    db.gglSchedulePlan.findMany({
      where: includeOtherProjects ? undefined : { campaign: { isWesetup: true } },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    }),
    db.gglPlannedSlot.findMany({
      where: includeOtherProjects ? undefined : { plan: { campaign: { isWesetup: true } } },
      include: {
        plan: {
          select: {
            id: true,
            name: true,
            kind: true,
            campaignId: true,
          },
        },
        article: {
          select: {
            id: true,
            gglArticleId: true,
            title: true,
            announcement: true,
            bodyHtml: true,
            anchor: true,
            anchorKind: true,
            status: true,
          },
        },
      },
      orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return NextResponse.json({
    plans: plansRaw.map((plan) => serializeSchedulePlan(plan)),
    slots: slotsRaw.map((slot) => serializePlannedSlot(slot)),
  });
}

export async function POST(request: Request) {
  const session = await requireRoot();

  const rawBody = await request.json().catch(() => null);
  const parsed = upsertPlanSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные параметры плана закупок" },
      { status: 400 },
    );
  }

  try {
    const actor = await resolveGglActorFromSession(session);
    const plan = await upsertSchedulePlan(parsed.data, actor);
    const materialized = plan.isActive
      ? await materializePlanSlots().catch(() => ({ created: 0 }))
      : { created: 0 };
    if (plan.isActive) {
      void prepareUpcomingPlannedSlots({ windowDays: 35 }).catch((err) => {
        console.warn("[ggl-plans] background slot preparation error:", err);
      });
    }

    return NextResponse.json({
      plan: serializeSchedulePlan(plan),
      materializedSlots: materialized.created,
    });
  } catch (err) {
    if (err instanceof GglOrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof GglIsolationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof GglAuthError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof GglCallError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[ggl-plans] unexpected error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Не удалось сохранить план закупок GoGetLinks",
      },
      { status: 500 },
    );
  }
}
