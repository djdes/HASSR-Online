import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { recordAuditLog } from "@/lib/audit-log";
import { LOGO_MAX_BYTES } from "@/lib/partners/validation";
import { prepareOrgLogo } from "@/lib/org-logo-file";
import { removeOrgLogo, setOrgLogo } from "@/lib/org-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Логотип организации для сайдбара кабинета.
 * POST multipart/form-data: file=<png|svg> → { logoUrl }.
 * DELETE → убрать загруженный файл.
 * Права — как у страницы «Реквизиты» (`admin.full`).
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasCapability(auth.session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }
  if (file.size > LOGO_MAX_BYTES) {
    return NextResponse.json({ error: "Логотип больше 500 КБ" }, { status: 413 });
  }
  const prepared = prepareOrgLogo(new Uint8Array(await file.arrayBuffer()), file.type);
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 415 });

  const organizationId = getActiveOrgId(auth.session);
  const logoUrl = await setOrgLogo(organizationId, prepared);
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "organization.logo.upload",
    entity: "Organization",
    entityId: organizationId,
    details: { mime: prepared.mime, sizeBytes: prepared.bytes.byteLength },
  });
  return NextResponse.json({ logoUrl });
}

export async function DELETE(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasCapability(auth.session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(auth.session);
  await removeOrgLogo(organizationId);
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "organization.logo.remove",
    entity: "Organization",
    entityId: organizationId,
  });
  return NextResponse.json({ ok: true });
}
