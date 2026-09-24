import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  ORDER_SCAN_ERRORS,
  ORDER_SCAN_MAX_BYTES,
  ORDER_SCAN_MAX_FILES,
  defaultOrderScanTitle,
  normalizeOrderScanTitle,
  supportsOrderScans,
} from "@/lib/journal-order-scans";
import { canManageOrderScans, canViewOrderScans, listOrderScans, writeOrderScanAudit } from "@/lib/journal-order-scans-db";
import { validateOrderScanFile } from "@/lib/journal-order-scans-pdf";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Сканы приказов к журналу организации (гигиена, бракераж готовой
 * продукции). GET ?code= — список (без файлов), POST multipart
 * (file, code, title?) — загрузка. Файл хранится в БД и отдаётся только
 * через `/api/journal-order-scans/<id>/file` с проверкой организации.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!supportsOrderScans(code)) return NextResponse.json({ error: "Журнал не поддерживает приказы" }, { status: 400 });
  if (!(await canViewOrderScans(session.user, code))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }
  const scans = await listOrderScans(getActiveOrgId(session), code);
  return NextResponse.json({ scans, canManage: canManageOrderScans(session.user) });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!canManageOrderScans(session.user)) {
    return NextResponse.json({ error: "Загружать приказы может руководство" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать файл — попробуйте ещё раз" }, { status: 400 });
  }
  const code = String(form.get("code") ?? "");
  if (!supportsOrderScans(code)) return NextResponse.json({ error: "Журнал не поддерживает приказы" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
  if (file.size > ORDER_SCAN_MAX_BYTES) return NextResponse.json({ error: ORDER_SCAN_ERRORS.tooBig }, { status: 413 });

  const existing = await db.journalOrderScan.count({ where: { organizationId, journalCode: code } });
  if (existing >= ORDER_SCAN_MAX_FILES) return NextResponse.json({ error: ORDER_SCAN_ERRORS.tooMany }, { status: 409 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = await validateOrderScanFile({ bytes, fileName: file.name, declaredMime: file.type });
  if (!checked.ok) {
    console.warn("[order-scans] upload rejected", { organizationId, code, fileName: file.name, size: file.size, reason: checked.error });
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const fileName = (file.name || "scan").slice(0, 255);
  const title = normalizeOrderScanTitle(form.get("title")) ?? defaultOrderScanTitle(fileName);

  const scan = await db.journalOrderScan.create({
    data: {
      organizationId,
      journalCode: code,
      title,
      fileName,
      mimeType: checked.mime,
      sizeBytes: bytes.length,
      content: bytes,
      uploadedById: session.user.id,
      uploadedByName: session.user.name ?? null,
    },
    select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedByName: true },
  });

  await writeOrderScanAudit({
    organizationId,
    userId: session.user.id,
    userName: session.user.name ?? null,
    action: "journal_order_scan.upload",
    scanId: scan.id,
    details: { journalCode: code, title, fileName, mimeType: checked.mime, sizeBytes: bytes.length, pages: checked.pages },
  });
  console.info("[order-scans] uploaded", { organizationId, code, id: scan.id, mime: checked.mime, size: bytes.length, pages: checked.pages });

  return NextResponse.json({ scan: { ...scan, createdAt: scan.createdAt.toISOString() } }, { status: 201 });
}
