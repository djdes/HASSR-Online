import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** Отчёты одни — страница кабинета. */
export default async function MiniReportsRedirectPage() {
  await redirectToSitePage("/mini/reports", "/reports");
}
