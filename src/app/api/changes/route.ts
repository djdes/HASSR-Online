import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const changes = await db.changeRequest.findMany({
    where: { organizationId: getActiveOrgId(session) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(changes);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Базовая валидация — раньше принимали что угодно. Пустой title
  // или title-как-объект ломал UI и Prisma бросала truncate-error.
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || body.title.trim().length === 0) {
    return NextResponse.json({ error: "Заголовок обязателен" }, { status: 400 });
  }

  const VALID_TYPES = ["recipe", "supplier", "process", "equipment", "other"];
  const changeType =
    typeof body.changeType === "string" && VALID_TYPES.includes(body.changeType)
      ? body.changeType
      : "recipe";

  const orgId = getActiveOrgId(session);

  // Auto-increment version
  const lastChange = await db.changeRequest.findFirst({
    where: { organizationId: orgId },
    orderBy: { version: "desc" },
  });

  const change = await db.changeRequest.create({
    data: {
      organizationId: orgId,
      title: body.title.trim().slice(0, 200),
      changeType,
      description:
        typeof body.description === "string"
          ? body.description.slice(0, 5000)
          : null,
      riskAssessment:
        typeof body.riskAssessment === "string"
          ? body.riskAssessment.slice(0, 5000)
          : null,
      version: (lastChange?.version || 0) + 1,
      requestedById: session.user.id,
    },
  });

  return NextResponse.json(change, { status: 201 });
}
