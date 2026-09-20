import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** «Баланс и бонусы» — страница кабинета, открытая в оболочке (П-3). */
export default async function MiniBalanceRedirectPage() {
  await redirectToSitePage("/mini/balance", "/settings/balance");
}
