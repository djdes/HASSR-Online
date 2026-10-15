import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { tryAutolinkTasksflowByPhone } from "@/lib/tasksflow-autolink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Self-service phone binding for the logged-in user.
 *
 *   PUT  /api/users/me/phone   { phone: "..." }     — save + auto-link TF
 *   DELETE /api/users/me/phone                     — clear the number
 *
 * Lives under `/settings/phone` as the UI entry point. Autolink runs
 * inline here (not fire-and-forget) so the response can tell the user
 * whether the TasksFlow pairing worked or not — that's the whole reason
 * they set a phone in the first place.
 */

const bodySchema = z.object({
  phone: z.string().trim().min(1, "Телефон не может быть пустым"),
});

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован", errorCode: "PHONE_UNAUTHORIZED" }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Некорректный запрос", errorCode: "PHONE_INVALID_REQUEST" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Некорректный запрос", errorCode: "PHONE_INVALID_REQUEST" }, { status: 400 });
  }

  const normalized = normalizePhone(parsed.phone);
  if (!normalized) {
    return NextResponse.json(
      {
        error: "Неверный формат. Пример: +7 985 123-45-67",
        errorCode: "PHONE_INVALID_FORMAT",
      },
      { status: 400 }
    );
  }

  // Phone uniqueness within an org keeps the TasksFlow link unambiguous
  // (two WeSetup users with the same number would fight for the same
  // TF worker). Enforce softly here.
  const dup = await db.user.findFirst({
    where: {
      organizationId: getActiveOrgId(session),
      phone: normalized,
      id: { not: session.user.id },
      archivedAt: null,
    },
    select: { id: true, name: true },
  });
  if (dup) {
    return NextResponse.json(
      {
        error: `Этот номер уже привязан к сотруднику: ${dup.name}. У каждого должен быть свой уникальный.`,
        errorCode: "PHONE_DUPLICATE",
        errorParams: { name: dup.name },
      },
      { status: 409 }
    );
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { phone: normalized },
  });

  const link = await tryAutolinkTasksflowByPhone({
    organizationId: getActiveOrgId(session),
    weSetupUserId: session.user.id,
    phone: normalized,
  });

  return NextResponse.json({
    phone: normalized,
    display: formatPhone(normalized),
    autolink: link,
  });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован", errorCode: "PHONE_UNAUTHORIZED" }, { status: 401 });
  }
  await db.user.update({
    where: { id: session.user.id },
    data: { phone: null },
  });
  // Clearing the phone also breaks the TF link for the user — remove it
  // so an out-of-date bind doesn't keep firing tasks at the wrong
  // number.
  const integrations = await db.tasksFlowIntegration.findMany({
    where: { organizationId: getActiveOrgId(session) },
    select: { id: true },
  });
  if (integrations.length > 0) {
    await db.tasksFlowUserLink.deleteMany({
      where: {
        integrationId: { in: integrations.map((i) => i.id) },
        wesetupUserId: session.user.id,
      },
    });
  }
  return NextResponse.json({ phone: null });
}
