import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { parseByteRange } from "@/lib/crm/telphin";
import { crmCallFilePath } from "@/lib/crm/telphin.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/root/crm/contacts/:id/calls/:callId — запись звонка для плеера.
 * Доступ — как к карточке контакта (менеджер «свои» чужую не откроет:
 * `requireRoot` сверяет контакт из адреса). Range — чтобы плеер мог
 * перематывать.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; callId: string }> }) {
  await requireRoot();
  const { id, callId } = await params;
  const call = await db.crmCallRecording.findUnique({
    where: { id: callId },
    select: { filePath: true, audioStatus: true, interaction: { select: { contactId: true } } },
  });
  if (!call || call.interaction.contactId !== id || call.audioStatus !== "ready" || !call.filePath) {
    return new NextResponse("Not found", { status: 404 });
  }
  const path = crmCallFilePath(call.filePath);
  const info = path ? await stat(path).catch(() => null) : null;
  if (!path || !info?.isFile()) return new NextResponse("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  const range = parseByteRange(request.headers.get("range"), info.size);
  if (range === "invalid") {
    return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${info.size}` } });
  }
  const { start, end } = range ?? { start: 0, end: info.size - 1 };
  const stream = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}),
    },
  });
}
