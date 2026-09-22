import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { deliverableEmail } from "@/lib/core-journal-keepers";
import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import {
  activePersonalLogin,
  issuePersonalLoginToken,
  personalLoginQrSvg,
  personalLoginUrl,
  revokePersonalLoginTokens,
} from "@/lib/personal-login";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { notifyEmployee } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Личный QR-вход сотрудника (2026-09-22) — управляет руководитель.
 *
 * GET    → { active, createdAt, lastUsedAt, hasPin, canTelegram, email }
 * POST   → { send?: "telegram" | "email" } — выпустить новый QR (старый
 *          перестаёт работать) и вернуть { url, svg }; при `send` — сразу
 *          отправить сотруднику.
 * DELETE → отключить вход по QR.
 */
async function load(id: string) {
  const auth = await requireApiAuth();
  if (!auth.ok) return { error: auth.response } as const;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return { error: NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 }) } as const;
  }
  const organizationId = getActiveOrgId(auth.session);
  const user = await db.user.findFirst({
    where: { id, organizationId, isActive: true, archivedAt: null },
    select: { id: true, name: true, email: true, contactEmail: true, qrPinHash: true, telegramChatId: true },
  });
  if (!user) return { error: NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 }) } as const;
  return { auth, organizationId, user } as const;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await load((await params).id);
  if ("error" in ctx) return ctx.error;
  const active = await activePersonalLogin(ctx.user.id);
  return NextResponse.json({
    active: Boolean(active),
    createdAt: active?.createdAt ?? null,
    lastUsedAt: active?.lastUsedAt ?? null,
    hasPin: Boolean(ctx.user.qrPinHash),
    canTelegram: Boolean(ctx.user.telegramChatId),
    email: deliverableEmail(ctx.user),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await load((await params).id);
  if ("error" in ctx) return ctx.error;
  const body = (await request.json().catch(() => null)) as { send?: unknown } | null;
  const raw = await issuePersonalLoginToken({ userId: ctx.user.id, organizationId: ctx.organizationId, createdById: ctx.auth.session.user.id });
  const url = personalLoginUrl(raw);
  const svg = await personalLoginQrSvg(url);
  let sent: "telegram" | "email" | null = null;
  if (body?.send === "telegram" && ctx.user.telegramChatId) {
    await notifyEmployee(
      ctx.user.id,
      `🔑 Ваш личный вход в WeSetup.\nОткройте ссылку и введите свой PIN:\n${url}\n\nНикому не пересылайте — ссылка вместе с PIN даёт вход в кабинет.`
    ).catch(() => null);
    sent = "telegram";
  }
  const email = deliverableEmail(ctx.user);
  if (body?.send === "email" && email) {
    await sendRawEmail(
      email,
      "Ваш личный QR-вход в WeSetup",
      renderEmailLayout(
        "Личный вход",
        `<p>Здравствуйте, ${escapeHtml(ctx.user.name)}!</p><p>Откройте ссылку на телефоне и введите свой PIN — попадёте в кабинет:</p><p><a href="${url}">${url}</a></p><p style="color:#71717a">Никому не пересылайте: ссылка вместе с PIN даёт вход. Потеряли — попросите руководителя выпустить новую, старая перестанет работать.</p>`
      )
    ).catch(() => false);
    sent = "email";
  }
  await recordAuditLog({
    request,
    session: ctx.auth.session,
    organizationId: ctx.organizationId,
    action: "staff.personal_qr_issue",
    entity: "user",
    entityId: ctx.user.id,
    details: { sent },
  }).catch(() => null);
  return NextResponse.json({ ok: true, url, svg, sent, hasPin: Boolean(ctx.user.qrPinHash) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await load((await params).id);
  if ("error" in ctx) return ctx.error;
  const revoked = await revokePersonalLoginTokens(ctx.user.id);
  await recordAuditLog({
    request,
    session: ctx.auth.session,
    organizationId: ctx.organizationId,
    action: "staff.personal_qr_revoke",
    entity: "user",
    entityId: ctx.user.id,
    details: { revoked },
  }).catch(() => null);
  return NextResponse.json({ ok: true, revoked });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
