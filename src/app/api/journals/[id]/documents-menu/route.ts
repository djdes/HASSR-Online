import { NextResponse } from "next/server";
import { getActiveBuildingId } from "@/lib/active-building";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { aclActorFromSession, hasJournalAccess } from "@/lib/journal-acl";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import { getDocumentCrumbMenu } from "@/lib/journal-crumb-menu";
import { isLocale } from "@/i18n/locales";
import { getSiteLocale } from "@/i18n/site-locale-server";

export const dynamic = "force-dynamic";

/**
 * Документы журнала для вложенного меню хлебных крошек.
 *
 * Список грузится по наведению на строку журнала, а не вместе со
 * страницей: журналов в наборе три-четыре десятка, и тянуть документы
 * всех сразу ради одного подменю — тридцать пять лишних запросов на
 * каждый рендер. По наведению нужен ровно один.
 *
 * ACL проверяем здесь же: маршрут отдаёт названия документов, и сотрудник
 * без доступа к журналу не должен видеть их подбором кода в URL.
 */
export async function GET(
  req: Request,
  // Сегмент называется [id], а не [code], хотя внутри лежит код журнала:
  // рядом уже есть /api/journals/[id]/*, а Next.js запрещает два разных
  // имени слага на одном уровне пути — приложение падало целиком.
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { id: code } = await params;
  const resolvedCode = resolveJournalCodeAlias(code);

  const allowed = await hasJournalAccess(
    aclActorFromSession(session),
    resolvedCode,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const requestedLocale = new URL(req.url).searchParams.get("locale");
  const locale = isLocale(requestedLocale) ? requestedLocale : await getSiteLocale();
  const items = await getDocumentCrumbMenu(
    getActiveOrgId(session),
    resolvedCode,
    undefined,
    await getActiveBuildingId(session),
    locale,
  );

  return NextResponse.json({ items });
}
