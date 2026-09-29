import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { addSuppression, listSuppressions } from "@/lib/mailing/contacts.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?search= — стоп-лист; POST { email, note } — добавить адрес вручную. */
export async function GET(request: Request) {
  await requireRoot();
  try {
    const search = new URL(request.url).searchParams.get("search") ?? "";
    return NextResponse.json(await listSuppressions(search));
  } catch (error) {
    return mailingErrorResponse(error, "suppression list");
  }
}

export async function POST(request: Request) {
  const session = await requireRoot();
  try {
    const body = await readJson(request);
    const row = await addSuppression(
      typeof body.email === "string" ? body.email : "",
      typeof body.note === "string" ? body.note : null,
      { request, session }
    );
    return NextResponse.json({ suppression: row });
  } catch (error) {
    return mailingErrorResponse(error, "suppression add");
  }
}
