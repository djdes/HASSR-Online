import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** Смены ставит руководитель в графике кабинета. */
export default async function MiniShiftHandoverRedirectPage() {
  await redirectToSitePage("/mini/shift-handover", "/settings/schedule");
}
