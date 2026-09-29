import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { normalizeContactFilters } from "@/lib/mailing/audience";
import { commitImport, listContacts } from "@/lib/mailing/contacts.server";
import { intParam, mailingErrorResponse, readJson } from "@/lib/mailing/http.server";
import type { ColumnMapping } from "@/lib/mailing/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — контакты с фильтрами (`idsOnly=1` — все id); POST — записать загрузку. */
export async function GET(request: Request) {
  await requireRoot();
  try {
    const params = new URL(request.url).searchParams;
    const filters = normalizeContactFilters(Object.fromEntries(params.entries()));
    const result = await listContacts(filters, {
      offset: intParam(params.get("offset"), 0, 0, 1_000_000),
      limit: intParam(params.get("limit"), 100, 1, 500),
      idsOnly: params.get("idsOnly") === "1",
    });
    return NextResponse.json({ ...result, filters });
  } catch (error) {
    return mailingErrorResponse(error, "contacts list");
  }
}

export async function POST(request: Request) {
  const session = await requireRoot();
  try {
    const body = await readJson(request);
    const result = await commitImport(
      {
        text: typeof body.text === "string" ? body.text : null,
        fileBase64: typeof body.fileBase64 === "string" ? body.fileBase64 : null,
        fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 200) : null,
        mapping: Array.isArray(body.mapping) ? (body.mapping as ColumnMapping) : null,
        source: typeof body.source === "string" ? body.source : "",
        basis: typeof body.basis === "string" ? body.basis : "",
        tags: typeof body.tags === "string" ? body.tags : null,
      },
      { request, session }
    );
    return NextResponse.json(result);
  } catch (error) {
    return mailingErrorResponse(error, "contacts import");
  }
}
