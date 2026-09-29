import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { deleteContacts, updateContact, type ContactPatch } from "@/lib/mailing/contacts.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = ["name", "company", "sphere", "city", "phone", "tags", "source", "basis", "status", "note"] as const;

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    const body = await readJson(request);
    const patch: ContactPatch = {};
    for (const key of FIELDS) {
      if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key];
    }
    const contact = await updateContact(id, patch, { request, session });
    return NextResponse.json({ contact });
  } catch (error) {
    return mailingErrorResponse(error, "contact update");
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  try {
    const deleted = await deleteContacts([id], { request, session });
    return NextResponse.json({ deleted });
  } catch (error) {
    return mailingErrorResponse(error, "contact delete");
  }
}
