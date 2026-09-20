import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  buildInspectorUrl,
  generateInspectorToken,
  hashInspectorToken,
  inspectorTokenExpiresAt,
} from "@/lib/inspector-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inspector tokens management API.
 *
 *   GET  → list tokens for current org (без raw values)
 *   POST → create new token; raw value возвращается ОДИН раз
 *   DELETE ?id=… → revoke (set revokedAt)
 *
 * Read-only resolve happens on /inspector/<rawToken> page directly;
 * this API is admin-only.
 */
const createSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  periodFrom: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  periodTo: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  ttlHours: z.number().int().min(1).max(24 * 14).optional(),
});

function toUtcMidnight(value: string): Date {
  const d = value.length === 10 ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return d;
}

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);

  const tokens = await db.inspectorToken.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      periodFrom: true,
      periodTo: true,
      expiresAt: true,
      lastAccessedAt: true,
      accessCount: true,
      revokedAt: true,
      createdAt: true,
      createdById: true,
    },
  });
  return NextResponse.json({ tokens });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  let parsed;
  try {
    parsed = createSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad request" },
        { status: 400 }
      );
    }
    throw err;
  }

  const periodFrom = toUtcMidnight(parsed.periodFrom);
  const periodTo = toUtcMidnight(parsed.periodTo);
  if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime())) {
    return NextResponse.json({ error: "Bad period" }, { status: 400 });
  }
  if (periodTo < periodFrom) {
    return NextResponse.json(
      { error: "periodTo раньше periodFrom" },
      { status: 400 }
    );
  }

  const raw = generateInspectorToken();
  const tokenHash = hashInspectorToken(raw);
  const expiresAt = inspectorTokenExpiresAt(parsed.ttlHours);

  const token = await db.inspectorToken.create({
    data: {
      organizationId: getActiveOrgId(session),
      tokenHash,
      label: parsed.label ?? null,
      periodFrom,
      periodTo,
      expiresAt,
      createdById: session.user.id,
    },
    select: {
      id: true,
      label: true,
      periodFrom: true,
      periodTo: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  // Raw token returned ONCE on create — admin must copy it now.
  return NextResponse.json({
    token,
    rawToken: raw,
    inspectorUrl: buildInspectorUrl(raw),
  });
}

export async function DELETE(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const orgId = getActiveOrgId(session);
  const found = await db.inspectorToken.findUnique({
    where: { id },
    select: { organizationId: true },
  });
  if (!found || found.organizationId !== orgId) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  await db.inspectorToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
