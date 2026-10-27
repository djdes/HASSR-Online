import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { recordAuditLog } from "@/lib/audit-log";
import { LOGO_MAX_BYTES } from "@/lib/partners/validation";
import { prepareOrgLogo } from "@/lib/org-logo-file";
import { removeOrgQrIcon, setOrgQrIcon } from "@/lib/org-qr-icon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Значок организации для центра QR-кодов.
 * POST multipart/form-data: file=<png|svg> → { qrIconUrl }.
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
    return NextResponse.json({ error: "Значок больше 500 КБ" }, { status: 413 });
  }
  const prepared = prepareOrgLogo(new Uint8Array(await file.arrayBuffer()), file.type);
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 415 });

  const organizationId = getActiveOrgId(auth.session);
  const qrIconUrl = await setOrgQrIcon(organizationId, prepared);
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "organization.qrIcon.upload",
    entity: "Organization",
    entityId: organizationId,
    details: { mime: prepared.mime, sizeBytes: prepared.bytes.byteLength },
  });
  return NextResponse.json({ qrIconUrl });
}

export async function DELETE(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasCapability(auth.session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(auth.session);
  await removeOrgQrIcon(organizationId);
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "organization.qrIcon.remove",
    entity: "Organization",
    entityId: organizationId,
  });
  return NextResponse.json({ ok: true });
}
