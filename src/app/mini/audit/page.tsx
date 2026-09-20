import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** Журнал действий один — страница кабинета (она строже: только владелец). */
export default async function MiniAuditRedirectPage() {
  await redirectToSitePage("/mini/audit", "/settings/audit");
}
