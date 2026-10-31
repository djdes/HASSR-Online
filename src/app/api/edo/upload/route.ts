import { NextResponse } from "next/server";

import { getViewedPointId } from "@/lib/active-building";
import { fileExternalId, saveSupplyDocument } from "@/lib/supply/documents.server";
import { guardSupply } from "@/lib/supply/guard.server";
import { parseUpd, UpdParseError } from "@/lib/supply/upd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** УПД больше 5 МБ не бывает — это не накладная. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/edo/upload (multipart, поле `file`) — УПД файлом из любого ЭДО.
 * Тот же файл второй раз — та же накладная (`duplicate: true`). Точка — по
 * КПП грузополучателя, иначе точка из шапки (2026-11-01).
 */
export async function POST(request: Request) {
  const { session, organizationId, denied } = await guardSupply();
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Выберите файл УПД (XML)" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 5 МБ — это не УПД" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const parsed = parseUpd(bytes);
    const saved = await saveSupplyDocument({
      organizationId,
      source: "upload",
      externalId: fileExternalId(bytes),
      parsed,
      fileName: file.name.slice(0, 200) || null,
      actor: { id: session.user.id, name: session.user.name ?? null },
      // Загрузили на торговой точке — накладная её, если КПП точку не нашёл.
      fallbackBuildingId: await getViewedPointId(session),
    });
    return NextResponse.json({ id: saved.id, duplicate: !saved.created, number: parsed.number });
  } catch (error) {
    if (error instanceof UpdParseError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
