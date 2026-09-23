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
import { INSPECTOR_QR_TTL_DAYS, type InspectorQrTtl } from "@/lib/inspector-qr";
import { createInspectorQrToken, loadCabinetInspectorData } from "@/lib/inspector-qr-service";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inspector tokens management API.
 *
 *   GET  → list tokens for current org (без raw values; у QR — адрес и SVG,
 *          он выводится из id и показывается повторно) + последние визиты
 *   POST → create new token; raw value возвращается ОДИН раз
 *   POST { mode: "qr", ttl, label } → постоянный «QR для проверяющих»
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

const qrSchema = z.object({
  mode: z.literal("qr"),
  label: z.string().trim().max(120).optional(),
  ttl: z.enum(Object.keys(INSPECTOR_QR_TTL_DAYS) as [InspectorQrTtl, ...InspectorQrTtl[]]),
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

  const data = await loadCabinetInspectorData(orgId);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (body && typeof body === "object" && (body as { mode?: unknown }).mode === "qr") {
    const qr = qrSchema.safeParse(body);
    if (!qr.success) {
      return NextResponse.json({ error: "Выберите срок действия QR" }, { status: 400 });
    }
    const orgId = getActiveOrgId(session);
    const created = await createInspectorQrToken({
      organizationId: orgId,
      createdById: session.user.id,
      ttl: qr.data.ttl,
      label: qr.data.label || null,
    });
    await recordAuditLog({
      request,
      session,
      organizationId: orgId,
      action: "settings.inspector_qr.create",
      entity: "InspectorToken",
      entityId: created.id,
      details: { ttl: qr.data.ttl, label: qr.data.label ?? null },
    });
    const data = await loadCabinetInspectorData(orgId);
    return NextResponse.json({ ...data, createdId: created.id });
  }

  let parsed;
  try {
    parsed = createSchema.parse(body);
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
  await recordAuditLog({
    request,
    session,
    organizationId: orgId,
    action: "settings.inspector_token.revoke",
    entity: "InspectorToken",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}
