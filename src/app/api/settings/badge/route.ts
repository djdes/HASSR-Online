import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { describeBadge } from "@/lib/badge/describe";
import { generateBadgeCode } from "@/lib/badge/render";
import { getBadgeStatusForOrganization } from "@/lib/badge/status";
import { getBadgePoints, invalidateBadgeToday } from "@/lib/badge/today-data";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORG_SELECT = {
  badgeEnabled: true,
  badgeCode: true,
  badgeTodayEnabled: true,
  type: true,
  perLocationJournals: true,
} as const;

async function guard() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return { session, orgId: "", denied: NextResponse.json({ error: "Доступно руководителям" }, { status: 403 }) };
  }
  return { session, orgId: getActiveOrgId(session), denied: null };
}

/**
 * Процент для бейджа и для живого примера на странице настроек — считаем и
 * у выключенного бейджа (кеш 15 минут): пример показывает то, что увидят
 * гости после включения. Сбой расчёта — «нет данных», не ошибка.
 */
async function percentFor(orgId: string): Promise<number | null> {
  const status = await getBadgeStatusForOrganization(orgId).catch((error) => {
    console.error(`[badge] status failed org=${orgId}`, error);
    return null;
  });
  return status?.percent ?? null;
}

async function respond(orgId: string, org: { badgeEnabled: boolean; badgeCode: string | null; badgeTodayEnabled: boolean; type: string; perLocationJournals: boolean }) {
  const points = await getBadgePoints({ id: orgId, perLocationJournals: org.perLocationJournals });
  return NextResponse.json(describeBadge(org, await percentFor(orgId), points));
}

/** GET — состояние бейджа и ссылки для вставки. */
export async function GET() {
  const { orgId, denied } = await guard();
  if (denied) return denied;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: ORG_SELECT });
  if (!org) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  return respond(orgId, org);
}

/**
 * PATCH { enabled?, todayEnabled? } — включить бейдж (код создаётся при
 * первом включении) или выключить; отдельно — блок «Сегодня» на странице.
 */
export async function PATCH(request: Request) {
  const { session, orgId, denied } = await guard();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown; todayEnabled?: unknown };
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  const todayEnabled = typeof body.todayEnabled === "boolean" ? body.todayEnabled : undefined;
  if (enabled === undefined && todayEnabled === undefined) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const current = await db.organization.findUnique({ where: { id: orgId }, select: { badgeCode: true } });
  const org = await db.organization.update({
    where: { id: orgId },
    data: {
      ...(enabled !== undefined ? { badgeEnabled: enabled } : {}),
      ...(enabled && !current?.badgeCode ? { badgeCode: generateBadgeCode() } : {}),
      ...(todayEnabled !== undefined ? { badgeTodayEnabled: todayEnabled } : {}),
    },
    select: ORG_SELECT,
  });
  if (enabled !== undefined) {
    await recordAuditLog({
      organizationId: orgId,
      session,
      request,
      action: enabled ? "badge.enable" : "badge.disable",
      entity: "Organization",
      entityId: orgId,
    });
    console.info(`[badge] ${enabled ? "enabled" : "disabled"} org=${orgId} by=${session.user.id} code=${org.badgeCode ?? "-"}`);
  }
  if (todayEnabled !== undefined) {
    invalidateBadgeToday(orgId);
    await recordAuditLog({
      organizationId: orgId,
      session,
      request,
      action: todayEnabled ? "badge.today.enable" : "badge.today.disable",
      entity: "Organization",
      entityId: orgId,
    });
    console.info(`[badge] today ${todayEnabled ? "enabled" : "disabled"} org=${orgId} by=${session.user.id}`);
  }
  return respond(orgId, org);
}

/** POST — перевыпустить код: старые ссылки и вставки перестают работать. */
export async function POST(request: Request) {
  const { session, orgId, denied } = await guard();
  if (denied) return denied;
  const org = await db.organization.update({
    where: { id: orgId },
    data: { badgeCode: generateBadgeCode() },
    select: ORG_SELECT,
  });
  await recordAuditLog({ organizationId: orgId, session, request, action: "badge.rotate", entity: "Organization", entityId: orgId });
  console.info(`[badge] code rotated org=${orgId} by=${session.user.id}`);
  return respond(orgId, org);
}
