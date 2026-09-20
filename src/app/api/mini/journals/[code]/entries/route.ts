import { NextResponse } from "next/server";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { aclActorFromSession, hasJournalAccess } from "@/lib/journal-acl";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { hasDocumentFillUi } from "@/lib/journal-document-helpers";
import { buildFieldLabels } from "@/lib/field-labels";
import { DEFAULT_PIPELINE_FIELDS } from "@/lib/journal-default-pipelines";

export const dynamic = "force-dynamic";

/**
 * GET /api/mini/journals/[code]/entries
 *
 * Last 7 days of entries for the Mini App journal detail screen. Scoped
 * to the caller's active org; falls back to 401/403/404 in that order.
 * The payload intentionally strips sensitive fields: only the entry shell
 * + the JSON `data` blob + filler name are returned.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const actor = aclActorFromSession({
    user: {
      id: session.user.id,
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    },
  });
  const allowed = await hasJournalAccess(actor, code);
  if (!allowed) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const template = await db.journalTemplate.findUnique({
    where: { code },
    select: { id: true, name: true, description: true, fields: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  }

  const orgId = getActiveOrgId(session);
  // Журнал, выключенный в «Наборе журналов», пропадает из списка, но по прямой
  // ссылке (закладка, старое сообщение) открывался как ни в чём не бывало.
  if ((await getDisabledJournalCodes(orgId)).has(code)) {
    return NextResponse.json(
      { error: "Этот журнал отключён. Включить его может руководитель в настройках." },
      { status: 403 },
    );
  }
  // Шире, чем `isDocumentTemplate`: у протокола аудита, отчёта и журнала
  // жалоб заполнение тоже идёт таблицей. Пока они считались «полевыми»,
  // экран журнала рисовал им «Последние записи» и кнопку «Новая запись»,
  // которая у жалоб вела на «Страница не найдена».
  const isDocument = hasDocumentFillUi(code);

  if (isDocument) {
    // Document-based journals live in JournalDocument / JournalDocumentEntry.
    // Mini App v1 doesn't ship a full grid renderer — we surface the 5 most
    // recent documents + a deep-link to the existing dashboard grid so the
    // line worker can still fill hygiene / cold-equipment / etc. today.
    const documents = await db.journalDocument.findMany({
      where: {
        templateId: template.id,
        organizationId: orgId,
        // Точки: документы активной точки и общие.
        ...buildingWhere(await getActiveBuildingId(session)),
      },
      orderBy: [{ status: "asc" }, { dateFrom: "desc" }],
      take: 10,
      select: {
        id: true,
        title: true,
        status: true,
        dateFrom: true,
        dateTo: true,
        responsibleUserId: true,
      },
    });
    // Имя ответственного: в списке лежат таблицы всей организации, и без
    // подписи сотрудник не отличал свою от чужой.
    const responsibleIds = [
      ...new Set(
        documents
          .map((doc) => doc.responsibleUserId)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const responsibles = responsibleIds.length
      ? await db.user.findMany({
          where: { id: { in: responsibleIds }, organizationId: orgId },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(responsibles.map((user) => [user.id, user.name]));
    return NextResponse.json({
      template: {
        code,
        name: template.name,
        description: template.description,
      },
      isDocument: true,
      documents: documents.map(({ responsibleUserId, ...doc }) => ({
        ...doc,
        responsibleName: responsibleUserId
          ? nameById.get(responsibleUserId) ?? null
          : null,
        mine: responsibleUserId === session.user.id,
      })),
      entries: [],
    });
  }

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const entries = await db.journalEntry.findMany({
    where: {
      templateId: template.id,
      organizationId: orgId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      status: true,
      data: true,
      filledBy: { select: { name: true } },
      attachments: {
        select: { url: true, filename: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return NextResponse.json({
    template: { code, name: template.name, description: template.description },
    isDocument: false,
    entries,
    // Без этого словаря список записей печатал ключи JSON'а
    // («productName: Молоко»). Отдаём только пары «ключ → подпись»,
    // а не все описания полей: остальное экрану списка не нужно.
    labels: buildFieldLabels(template.fields, DEFAULT_PIPELINE_FIELDS[code]),
  });
}
