import { requireAuth } from "@/lib/auth-helpers";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { loadMessages } from "@/i18n/messages";
import { SanpinReferenceView } from "@/components/sanpin/sanpin-reference-view";

export default async function SanpinReferencePage() {
  await requireAuth();
  const locale = await getSiteLocale();
  const messages = await loadMessages(locale);
  return <SanpinReferenceView locale={locale} messages={messages.sanpinReference} />;
}
