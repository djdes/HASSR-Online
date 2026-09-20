import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { buildMiniAppAuthBootstrapPath } from "@/lib/journal-obligation-links";
import { getServerSession } from "@/lib/server-session";

import { keepSearchParams } from "../../_lib/site-redirect";

export const dynamic = "force-dynamic";

/**
 * Старый адрес таблицы журнала → та же таблица на сайте.
 *
 * В адресе приложения кода журнала нет, поэтому резолвим его по
 * документу — ровно как раньше это делал экран-обёртка. Чужой или
 * несуществующий документ уводим в список журналов: «страница не
 * найдена» здесь ничего не объясняет и не даёт выхода.
 */
export default async function MiniDocumentRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) {
    redirect(
      buildMiniAppAuthBootstrapPath(`/mini/documents/${encodeURIComponent(id)}`)
    );
  }

  const doc = await db.journalDocument.findFirst({
    where: { id, organizationId: getActiveOrgId(session) },
    select: { template: { select: { code: true } } },
  });
  if (!doc) {
    redirect("/journals");
  }

  const query = keepSearchParams(await searchParams, ["page"]);
  redirect(
    `/journals/${encodeURIComponent(doc.template.code)}/documents/${encodeURIComponent(id)}${query}`
  );
}
