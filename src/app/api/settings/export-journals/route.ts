import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { buildJournalsArchive } from "@/lib/journals-archive";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { resolveExportLocale } from "@/i18n/export-locale";
import { loadMessages } from "@/i18n/messages";
import { createTranslator } from "use-intl/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const limiter = createRateLimiter({ tokensPerInterval: 5, intervalMs: 10 * 60 * 1000 });
const MAX_DAYS = 400;

function parseDay(value: string | null, fallback: Date): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** GET ?from=ГГГГ-ММ-ДД&to=ГГГГ-ММ-ДД — ZIP со всеми журналами за период (руководство). */
export async function GET(request: Request) {
  const session = await requireAuth();
  let locale = resolveExportLocale(null, session.user)!;
  const errorResponse = async (code: "forbidden" | "rateLimited" | "reversedDates" | "periodTooLong" | "invalidLocale" | "failed", status: number) => {
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "archiveExport" });
    return NextResponse.json({ code, error: code === "periodTooLong" ? t("errors.periodTooLong", { max: MAX_DAYS }) : t(`errors.${code}`) }, { status, headers: { "Content-Language": locale, "Cache-Control": "no-store" } });
  };
  if (!hasFullWorkspaceAccess(session.user)) return errorResponse("forbidden", 403);
  const orgId = getActiveOrgId(session);
  const { searchParams } = new URL(request.url);
  const organization = await db.organization.findUnique({ where: { id: orgId }, select: { locale: true } });
  const preferences = { locale: session.user.locale, organizationLocale: organization?.locale };
  locale = resolveExportLocale(null, preferences)!;
  if (!limiter.consume(`export:${orgId}`)) return errorResponse("rateLimited", 429);
  const requestedLocale = resolveExportLocale(searchParams.get("locale"), preferences);
  if (!requestedLocale) return errorResponse("invalidLocale", 400);
  locale = requestedLocale;
  const now = new Date();
  const to = parseDay(searchParams.get("to"), now);
  const from = parseDay(searchParams.get("from"), new Date(now.getTime() - 30 * 86_400_000));
  if (from > to) return errorResponse("reversedDates", 400);
  if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_DAYS) return errorResponse("periodTooLong", 400);
  const toEnd = new Date(to.getTime() + 86_400_000 - 1);

  let archive: Awaited<ReturnType<typeof buildJournalsArchive>>;
  try {
    archive = await buildJournalsArchive(orgId, from, toEnd, locale);
  } catch (error) {
    console.error("[journals-archive] Generation failed", error);
    return errorResponse("failed", 500);
  }
  await recordAuditLog({ organizationId: orgId, session, request, action: "journals.export", entity: "Organization", entityId: orgId, details: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), documents: archive.documents, fieldJournals: archive.fieldJournals } });
  const name = `wesetup-journals-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.zip`;
  return new NextResponse(new Uint8Array(archive.zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "Content-Language": locale,
      "X-Archive-Documents": String(archive.documents),
      "X-Archive-Field-Journals": String(archive.fieldJournals),
      "X-Archive-Truncated": archive.truncated ? "1" : "0",
    },
  });
}
