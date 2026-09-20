import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  email: z.string().email().nullable(),
});

/**
 * PATCH — сохранить или очистить `Organization.accountantEmail`.
 * Используется на странице /settings/accounting для подключения
 * еженедельной выгрузки списаний в 1С (`/api/cron/losses-export-1c`).
 */
export async function PATCH(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid email" },
        { status: 400 }
      );
    }
    throw err;
  }

  await db.organization.update({
    where: { id: orgId },
    data: { accountantEmail: body.email },
  });

  return NextResponse.json({ ok: true });
}
