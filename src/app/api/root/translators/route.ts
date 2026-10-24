import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Переводчики интерфейса — право `User.canEditTranslations`. Только ROOT.
 *   GET — список; POST { email, enabled } — выдать или снять право.
 */

const select = { id: true, name: true, email: true, organization: { select: { name: true } } } as const;

const Body = z.object({
  email: z.string().trim().min(3).max(200),
  enabled: z.boolean(),
});

export async function GET() {
  await requireRoot();
  const translators = await db.user.findMany({
    where: { canEditTranslations: true },
    select,
    orderBy: { email: "asc" },
  });
  return NextResponse.json({ translators });
}

export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  // Точное совпадение первым: почты, отличающиеся регистром, — разные люди.
  const user =
    (await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, canEditTranslations: true } })) ??
    (await db.user.findFirst({
      where: { email: { equals: parsed.data.email, mode: "insensitive" } },
      select: { id: true, canEditTranslations: true },
    }));
  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  if (user.canEditTranslations !== parsed.data.enabled) {
    await db.user.update({ where: { id: user.id }, data: { canEditTranslations: parsed.data.enabled } });
    await db.auditLog
      .create({
        data: {
          organizationId: session.user.organizationId,
          userId: session.user.id,
          userName: session.user.name ?? null,
          action: parsed.data.enabled ? "translator.grant" : "translator.revoke",
          entity: "user",
          entityId: user.id,
          details: { email: parsed.data.email },
        },
      })
      .catch((error) => console.error("[translators] audit failed", error));
  }
  const translator = await db.user.findUnique({ where: { id: user.id }, select });
  return NextResponse.json({ translator, enabled: parsed.data.enabled });
}
