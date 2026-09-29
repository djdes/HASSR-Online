import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { deleteContacts } from "@/lib/mailing/contacts.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { ids } — удалить выбранные контакты. История рассылок сохраняется (связь обнуляется). */
export async function POST(request: Request) {
  const session = await requireRoot();
  try {
    const body = await readJson(request);
    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
    const deleted = await deleteContacts(ids, { request, session });
    return NextResponse.json({ deleted });
  } catch (error) {
    return mailingErrorResponse(error, "contacts bulk delete");
  }
}
