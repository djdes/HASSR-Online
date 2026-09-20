import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** Датчики — это то же оборудование кабинета, отдельного экрана нет. */
export default async function MiniIotRedirectPage() {
  await redirectToSitePage("/mini/iot", "/settings/equipment");
}
