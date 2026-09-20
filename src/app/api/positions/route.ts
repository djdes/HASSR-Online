import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Название должности слишком короткое")
    .max(120, "Слишком длинное название"),
  categoryKey: z.enum(["management", "staff"], {
    message: "Недопустимая категория",
  }),
});

function forbidden() {
  return NextResponse.json(
    { error: "Это действие доступно руководителю" },
    { status: 403 }
  );
}

export async function GET() {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  const positions = await db.jobPosition.findMany({
    where: { organizationId: orgId },
    orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      categoryKey: true,
      sortOrder: true,
      _count: { select: { users: { where: { archivedAt: null } } } },
    },
  });
  return NextResponse.json({ positions });
}

export async function POST(request: Request) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return forbidden();
  }
  const orgId = getActiveOrgId(session);

  let parsed;
  try {
    parsed = createSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Не удалось прочитать запрос" }, { status: 400 });
  }

  const existing = await db.jobPosition.findUnique({
    where: {
      organizationId_categoryKey_name: {
        organizationId: orgId,
        categoryKey: parsed.categoryKey,
        name: parsed.name,
      },
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Такая должность уже существует" },
      { status: 409 }
    );
  }

  const last = await db.jobPosition.findFirst({
    where: { organizationId: orgId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const position = await db.jobPosition.create({
    data: {
      organizationId: orgId,
      categoryKey: parsed.categoryKey,
      name: parsed.name,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });

  return NextResponse.json({ position });
}
