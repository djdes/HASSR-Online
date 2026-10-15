import { getRequestConfig } from "next-intl/server";
import { getSiteLocale } from "./site-locale-server";
import { loadMessages } from "./messages";

export default getRequestConfig(async () => {
  const locale = await getSiteLocale();
  return { locale, messages: await loadMessages(locale) };
});
