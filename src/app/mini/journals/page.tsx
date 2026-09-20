import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** Список журналов теперь один — страница кабинета. */
export default async function MiniJournalsRedirectPage() {
  await redirectToSitePage("/mini/journals", "/journals");
}
