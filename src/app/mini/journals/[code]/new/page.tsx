import { redirectToSitePage } from "../../../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** Форма новой записи теперь одна — страница кабинета. */
export default async function MiniNewJournalEntryRedirectPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const encoded = encodeURIComponent(code);

  await redirectToSitePage(
    `/mini/journals/${encoded}/new`,
    `/journals/${encoded}/new`
  );
}
