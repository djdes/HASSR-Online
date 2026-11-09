import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { recordAuditLog } from "@/lib/audit-log";
import { reinstallSharedDemoOrganization } from "@/lib/demo-organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/root/seed-demo-org
 *
 * Переустановить общую демо-организацию сейчас, не дожидаясь ночного cron:
 * перед показом покупателю или когда гости её испортили. Новых организаций
 * не создаёт — демо одна (`lib/demo-organization.ts`).
 */
export async function POST(request: Request) {
  const session = await requireRoot();

  const result = await reinstallSharedDemoOrganization();

  await recordAuditLog({
    request,
    session,
    // В platform-org, а не в самой демо: её журнал действий видят гости.
    organizationId: (process.env.PLATFORM_ORG_ID ?? "").trim() || result.organizationId,
    action: "org.demo.reinstalled",
    entity: "Organization",
    entityId: result.organizationId,
    details: { trigger: "root", name: result.name, ...result.seed, durationMs: result.durationMs },
  });

  return NextResponse.json({
    ok: true,
    organizationId: result.organizationId,
    name: result.name,
    ...result.seed,
    durationMs: result.durationMs,
  });
}
