import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { areaSchema } from "@/lib/validators";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    const areas = await db.area.findMany({
      where: { organizationId: getActiveOrgId(session) },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { equipment: true } },
      },
    });

    return NextResponse.json({ areas });
  } catch (error) {
    console.error("Areas list error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    if (
      !hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      })
    ) {
      return NextResponse.json(
        { error: "Это действие доступно руководителю" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = areaSchema.parse(body);

    const area = await db.area.create({
      data: {
        name: validatedData.name,
        description: validatedData.description || null,
        organizationId: getActiveOrgId(session),
      },
    });

    return NextResponse.json({ area }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Некорректные данные",
          details: error.issues,
        },
        { status: 400 }
      );
    }

    console.error("Area creation error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
