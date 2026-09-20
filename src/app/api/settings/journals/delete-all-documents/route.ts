import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { destructiveOpsRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — preflight: считает что именно удалится. UI вызывает перед
 * показом prompt'а, чтобы юзер видел количество в подтверждении.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  const [docCount, entryCount] = await Promise.all([
    db.journalDocument.count({ where: { organizationId } }),
    db.journalDocumentEntry.count({
      where: { document: { organizationId } },
    }),
  ]);
  return NextResponse.json({ docCount, entryCount });
}

/**
 * POST /api/settings/journals/delete-all-documents
 *
 * Жёсткое удаление ВСЕХ JournalDocument'ов организации (и их entries
 * через cascade в schema). Опасная операция:
 *   • Удаляет всю историю заполнения журналов
 *   • Не оставляет даже closed-документы для compliance-выгрузок
 *   • Не восстановимо
 *
 * Используется только когда орга реально хочет начать с нуля
 * (потестировали, насоздали мусор, надо вычистить). UI требует
 * подтверждения вводом «УДАЛИТЬ» в client'е.
 *
 * Связанные TasksFlowTaskLink тоже удаляются — они каскадятся через
 * journalDocumentId FK с onDelete: SetNull, поэтому отдельно их
 * убирать не нужно (они станут osnubled и просто не будут показываться
 * в bulk-assign).
 *
 * AuditLog пишется (action='journal.delete_all_documents').
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const confirmation = (body as { confirmation?: unknown } | null)?.confirmation;
  if (confirmation !== "УДАЛИТЬ") {
    return NextResponse.json(
      {
        error:
          "Для подтверждения передайте { confirmation: 'УДАЛИТЬ' } в body",
      },
      { status: 400 }
    );
  }

  const organizationId = getActiveOrgId(session);
  // Rate-limit: 2 раза в час на org. Hard-delete необратим — этого
  // достаточно чтобы блокировать случайный двойной клик / автоматизацию.
  if (!destructiveOpsRateLimiter.consume(`delete-all:${organizationId}`)) {
    const ms = destructiveOpsRateLimiter.remainingMs(
      `delete-all:${organizationId}`
    );
    return NextResponse.json(
      {
        error: `Лимит на удаление: 2 раза в час. Следующая попытка через ${Math.ceil(ms / 60_000)} мин.`,
      },
      { status: 429 }
    );
  }

  // Считаем сколько документов и entries удалится — для аудита и UI.
  const [docCount, entryCount] = await Promise.all([
    db.journalDocument.count({ where: { organizationId } }),
    db.journalDocumentEntry.count({
      where: { document: { organizationId } },
    }),
  ]);

  if (docCount === 0) {
    return NextResponse.json({
      ok: true,
      deletedDocuments: 0,
      deletedEntries: 0,
      message: "У организации нет документов",
    });
  }

  // Cascade в schema — entries удалятся вместе с документами.
  const result = await db.journalDocument.deleteMany({
    where: { organizationId },
  });

  await db.auditLog.create({
    data: {
      organizationId,
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? null,
      action: "journal.delete_all_documents",
      entity: "JournalDocument",
      entityId: organizationId,
      details: {
        deletedDocuments: result.count,
        approxEntries: entryCount,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    deletedDocuments: result.count,
    deletedEntries: entryCount,
  });
}
