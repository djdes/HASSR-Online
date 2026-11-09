import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import {
  purgeLegacyDemoOrganizations,
  reinstallSharedDemoOrganization,
} from "@/lib/demo-organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET/POST /api/cron/purge-demo-orgs
 *
 * Раз в сутки переустанавливает общую демо-организацию: прежняя удаляется
 * (cascade сносит сотрудников, документы, записи и членства гостей), новая
 * ставится под тем же id со свежими данными за последние дни.
 *
 * Заодно удаляет демо прежней схемы — свои на каждый аккаунт. За один
 * прогон — не больше BATCH штук: удаление одной занимает секунды.
 *
 * Адрес прежний (расписание живёт вне репозитория). Страховка без cron:
 * `ensureSharedDemoOrganization` ставит демо заново при первом входе после
 * срока.
 *
 * INFRA: cron 03:20 ежедневно.
 */
const BATCH = 20;

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  // AuditLog требует organizationId — пишем в platform-org, чтобы запись
  // была видна ROOT'у на /root/audit. Если platform-org нет — пропускаем.
  const platformOrgId = (process.env.PLATFORM_ORG_ID ?? "").trim();

  const legacy = await purgeLegacyDemoOrganizations({ take: BATCH });
  if (platformOrgId) {
    for (const org of legacy.deleted) {
      await db.auditLog
        .create({
          data: {
            organizationId: platformOrgId,
            action: "org.demo.expired",
            entity: "organization",
            entityId: org.id,
            details: {
              name: org.name,
              accountId: org.accountId,
              staff: org.staff,
              documents: org.documents,
              entries: org.entries,
            },
          },
        })
        .catch(() => {});
    }
  }

  let reinstalled: { organizationId: string; durationMs: number } | null = null;
  let error: string | null = null;
  try {
    const result = await reinstallSharedDemoOrganization();
    reinstalled = { organizationId: result.organizationId, durationMs: result.durationMs };
    if (platformOrgId) {
      await db.auditLog
        .create({
          data: {
            organizationId: platformOrgId,
            action: "org.demo.reinstalled",
            entity: "organization",
            entityId: result.organizationId,
            details: { trigger: "cron", name: result.name, ...result.seed, durationMs: result.durationMs },
          },
        })
        .catch(() => {});
    }
  } catch (cause) {
    console.error("[purge-demo-orgs] reinstall failed", cause);
    error = cause instanceof Error ? cause.message : "reinstall failed";
  }

  return NextResponse.json(
    {
      ok: error === null,
      reinstalled,
      legacyDeleted: legacy.deleted.length,
      legacyFailed: legacy.failed,
      ...(error ? { error } : {}),
    },
    { status: error ? 500 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
