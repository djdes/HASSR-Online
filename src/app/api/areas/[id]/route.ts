import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    if (
      !hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      })
    ) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const area = await db.area.findUnique({ where: { id } });
    if (!area || area.organizationId !== getActiveOrgId(session)) {
      return NextResponse.json({ error: "Цех не найден" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { name, description } = body;

    // Раньше: name.trim() крашил если name был числом/null/object.
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название обязательно" }, { status: 400 });
    }

    const updated = await db.area.update({
      where: { id },
      data: {
        name: name.trim().slice(0, 200),
        description:
          typeof description === "string" && description.trim()
            ? description.trim().slice(0, 1000)
            : null,
      },
    });

    return NextResponse.json({ area: updated });
  } catch (error) {
    console.error("Area update error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Раньше: isManagerRole — только role=manager. head_chef мог
    // редактировать (isManagementRole в PUT выше), но не удалять —
    // непоследовательно. Теперь оба идут через единый
    // hasFullWorkspaceAccess (manager + head_chef + ROOT).
    if (
      !hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      })
    ) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const area = await db.area.findUnique({ where: { id } });
    if (!area || area.organizationId !== getActiveOrgId(session)) {
      return NextResponse.json({ error: "Цех не найден" }, { status: 404 });
    }

    // JournalEntry.area — Restrict: удаление цеха с записями бросало, и
    // человек видел «Внутренняя ошибка сервера» вместо причины.
    const blockers = await db.area.findUnique({
      where: { id },
      select: { _count: { select: { equipment: true, journalEntries: true } } },
    });
    const entryCount = blockers?._count.journalEntries ?? 0;
    if (entryCount > 0) {
      return NextResponse.json(
        {
          error: `Записей журналов в этом цехе: ${entryCount}. Цех нельзя удалить, иначе записи осиротеют — переименуйте цех или перенесите записи.`,
        },
        { status: 409 }
      );
    }

    await db.area.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Area deletion error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
