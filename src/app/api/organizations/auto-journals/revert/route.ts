import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { revertAutoFill } from "@/lib/journal-autofill-undo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/organizations/auto-journals/revert
 * Body: { code: string }
 *
 * «Вернуть как было» после выключения автозаполнения: удаляет строки,
 * которые завёл сайт, и возвращает прежние значения в клетки, которые
 * он заполнил. Ручные отметки не трогает — в журнале отката их нет
 * (см. `journal-autofill-undo.ts`).
 *
 * Работает по активным документам журнала: закрытые не редактируем.
 */
const bodySchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const organizationId = getActiveOrgId(session);
  const documents = await db.journalDocument.findMany({
    where: {
      organizationId,
      status: "active",
      template: { code: parsed.code },
    },
    select: { id: true, config: true },
  });

  let removed = 0;
  let restored = 0;
  for (const document of documents) {
    const result = await revertAutoFill(db, {
      documentId: document.id,
      config: document.config,
    }).catch((error) => {
      console.warn(`[auto-journals/revert] ${document.id}`, error);
      return { removed: 0, restored: 0 };
    });
    removed += result.removed;
    restored += result.restored;
  }

  return NextResponse.json({
    documents: documents.length,
    removed,
    restored,
  });
}
