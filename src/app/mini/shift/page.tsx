import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** «Кто на смене» показывает раздел «Команда» в кабинете. */
export default async function MiniShiftRedirectPage() {
  await redirectToSitePage("/mini/shift", "/team");
}
