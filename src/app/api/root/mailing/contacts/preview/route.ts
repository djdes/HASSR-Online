import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { previewImport } from "@/lib/mailing/contacts.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";
import type { ColumnMapping } from "@/lib/mailing/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — разобрать файл или вставленный текст и показать, что загрузится. Ничего не пишет. */
export async function POST(request: Request) {
  await requireRoot();
  try {
    const body = await readJson(request);
    const preview = await previewImport({
      text: typeof body.text === "string" ? body.text : null,
      fileBase64: typeof body.fileBase64 === "string" ? body.fileBase64 : null,
      mapping: Array.isArray(body.mapping) ? (body.mapping as ColumnMapping) : null,
    });
    return NextResponse.json(preview);
  } catch (error) {
    return mailingErrorResponse(error, "contacts preview");
  }
}
