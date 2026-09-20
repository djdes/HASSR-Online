import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/**
 * Передача смены — про людей и записки сменщику, а не про график
 * работы. Раньше вёл на «Настройки → График», и человек попадал
 * совсем в другое место.
 */
export default async function MiniShiftHandoverRedirectPage() {
  await redirectToSitePage("/mini/shift-handover", "/team");
}
