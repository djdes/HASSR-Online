import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { edoErrorResponse } from "@/lib/edo/api-response.server";
import { EDO_KINDS, EDO_MAX_FILE_BYTES } from "@/lib/edo/registry";
import { listEdoDocuments, sendToEdo } from "@/lib/edo/send.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * История ЭДО и отправка.
 * GET ?organizationId= — последние отправленные документы (все или одной организации).
 * POST — записать документ черновиком в Saby: JSON `{organizationId, kind, sourceId}` для счёта/УПД
 * (и договора из WeSetup) или multipart с `file` (договор/прочее, ≤10 МБ, pdf/docx/odt/rtf) и
 * полями `organizationId`, `kind`, `number`, `date`, `participantId`.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);

const sendSchema = z.object({
  organizationId: z.string().trim().min(1, "Выберите организацию").max(64),
  kind: z.enum(EDO_KINDS, { message: "Выберите вид документа" }),
  sourceId: optionalText(64),
  number: optionalText(100),
  date: optionalText(10),
  participantId: optionalText(120),
});

export async function GET(request: Request) {
  await requireRoot();
  const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim() || undefined;
  try {
    return NextResponse.json({ documents: await listEdoDocuments({ organizationId: organizationId?.slice(0, 64) }) });
  } catch (e) {
    return edoErrorResponse(e, "documents GET");
  }
}

export async function POST(request: Request) {
  const session = await requireRoot();
  const contentType = request.headers.get("content-type") ?? "";

  let raw: Record<string, unknown> | null = null;
  let file: { name: string; bytes: Uint8Array } | null = null;
  if (contentType.includes("multipart/form-data")) {
    // Тело больше лимита отсекаем до разбора: файл уходит в Saby base64 в теле запроса.
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > EDO_MAX_FILE_BYTES + 64 * 1024) return NextResponse.json({ error: "Файл больше 10 МБ" }, { status: 413 });
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Не удалось прочитать форму" }, { status: 400 });
    raw = {};
    for (const key of ["organizationId", "kind", "sourceId", "number", "date", "participantId"]) {
      const v = form.get(key);
      if (typeof v === "string") raw[key] = v;
    }
    const f = form.get("file");
    if (f instanceof File && f.size > 0) {
      if (f.size > EDO_MAX_FILE_BYTES) return NextResponse.json({ error: "Файл больше 10 МБ" }, { status: 413 });
      file = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
    }
  } else {
    raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  }

  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  try {
    const result = await sendToEdo({ ...parsed.data, file, sentByUserId: session.user.id ?? null });
    return NextResponse.json(result);
  } catch (e) {
    return edoErrorResponse(e, "documents POST");
  }
}
