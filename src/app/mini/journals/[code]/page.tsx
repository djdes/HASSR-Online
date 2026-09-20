import { keepSearchParams, redirectToSitePage } from "../../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** Журнал теперь один — страница кабинета. Вкладку (`?tab=`) сохраняем. */
export default async function MiniJournalRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const query = keepSearchParams(await searchParams, ["tab"]);
  const encoded = encodeURIComponent(code);

  await redirectToSitePage(
    `/mini/journals/${encoded}`,
    `/journals/${encoded}${query}`
  );
}
