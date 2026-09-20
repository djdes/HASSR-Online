import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { isPublicHttpsUrl } from "@/lib/url-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * K10 — Управление списком webhook URL.
 *
 * GET — получить текущий список (без значений токенов).
 * PUT { urls: string[] } — заменить полностью.
 *
 * Webhook URL'ы дёргаются сервером по сети — без allowlist'а
 * менеджер может настроить SSRF-зонд (AWS-metadata, internal services).
 * Поэтому каждый URL валидируется через isPublicHttpsUrl.
 */

const Schema = z.object({
  urls: z
    .array(
      z.string().url().refine(
        isPublicHttpsUrl,
        "URL должен быть публичным http(s) — internal/localhost адреса запрещены"
      )
    )
    .max(10),
});

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { webhookUrls: true },
  });
  return NextResponse.json({ urls: org?.webhookUrls ?? [] });
}

export async function PUT(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  const orgId = getActiveOrgId(auth.session);
  await db.organization.update({
    where: { id: orgId },
    data: { webhookUrls: body.urls },
  });

  return NextResponse.json({ ok: true, count: body.urls.length });
}
