import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit-helper";
import { requireRoot, requireSuperRoot } from "@/lib/auth-helpers";
import {
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import {
  decimalToNumber,
  ensureWesetupCampaign,
  GglSyncError,
  getGglAccountView,
  saveGglAccount,
} from "@/lib/seo/gogetlinks-sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const platformOrgId = () => process.env.PLATFORM_ORG_ID?.trim() || "platform";

const saveAccountSchema = z.object({
  email: z.string().trim().email("Укажите корректный email аккаунта GoGetLinks").max(200).optional(),
  password: z.string().min(1, "Укажите пароль от аккаунта GoGetLinks").max(300).optional(),
  defaultCampaignId: z.number().int().positive().nullable().optional(),
  allowSeoApproveWithinPlan: z.boolean().optional(),
});

const ensureCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  maxPriceContextRub: z.number().int().positive().max(100_000).optional(),
  maxPriceNoteRub: z.number().int().positive().max(100_000).optional(),
  maxPriceArticleRub: z.number().int().positive().max(100_000).optional(),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
});

function gglErrorResponse(err: unknown, fallbackMessage: string): NextResponse {
  if (err instanceof GglSyncError) {
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
  console.error("[ggl-account] unexpected error:", err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : fallbackMessage },
    { status: 500 },
  );
}

export async function GET() {
  await requireRoot();
  try {
    const account = await getGglAccountView();
    return NextResponse.json({ account });
  } catch (err) {
    return gglErrorResponse(err, "Не удалось получить состояние кабинета GoGetLinks");
  }
}

export async function PUT(request: Request) {
  const session = await requireSuperRoot();
  const body = await request.json().catch(() => null);
  const parsed = saveAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные данные аккаунта GoGetLinks" },
      { status: 400 },
    );
  }

  try {
    const { account, accountId } = await saveGglAccount(parsed.data, session.user.id ?? null);
    await audit({
      orgId: platformOrgId(),
      action: "ggl.account.save",
      entity: "GglAccount",
      entityId: accountId,
      actor: {
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? "root",
      },
      details: {
        emailMasked: account.email,
        credentialsUpdated: Boolean(parsed.data.email || parsed.data.password),
        defaultCampaignId: account.defaultCampaignId,
        allowSeoApproveWithinPlan: account.allowSeoApproveWithinPlan,
      },
    });
    return NextResponse.json({ account });
  } catch (err) {
    return gglErrorResponse(err, "Не удалось сохранить настройки кабинета GoGetLinks");
  }
}

export async function POST(request: Request) {
  const session = await requireSuperRoot();
  const rawBody = await request.json().catch(() => ({}));
  const parsed = ensureCampaignSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные параметры кампании" },
      { status: 400 },
    );
  }

  try {
    const campaign = await ensureWesetupCampaign({
      ...parsed.data,
      idempotencyKey: parsed.data.idempotencyKey || "ensure-wesetup-campaign",
    });

    await audit({
      orgId: platformOrgId(),
      action: "ggl.campaign.ensure",
      entity: "GglCampaign",
      entityId: campaign.id,
      actor: {
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? "root",
      },
      details: {
        gglCampaignId: campaign.gglCampaignId,
        name: campaign.name,
        domain: campaign.domain,
      },
    });

    const account = await getGglAccountView();
    return NextResponse.json({
      campaign: {
        ...campaign,
        spentRub: decimalToNumber(campaign.spentRub),
        syncedAt: campaign.syncedAt.toISOString(),
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      },
      account,
    });
  } catch (err) {
    return gglErrorResponse(err, "Не удалось создать или привязать кампанию wesetup.ru в GoGetLinks");
  }
}
