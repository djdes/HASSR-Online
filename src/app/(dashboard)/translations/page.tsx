import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { TranslationEditor } from "@/components/translations/translation-editor";
import { getTranslationActor, listCategoryStats } from "@/lib/translations/editor.server";

export const dynamic = "force-dynamic";

/**
 * Редактор переводов для переводчика (`User.canEditTranslations`). Адрес
 * вне `/settings`, чтобы `proxy.ts` не уводил линейную роль в журналы;
 * без права — 404, как у закрытых разделов платформы.
 */
export default async function TranslationsPage() {
  const actor = await getTranslationActor();
  if (!actor) notFound();
  const [t, categories] = await Promise.all([getTranslations("translationEditor"), listCategoryStats()]);
  return (
    <DomainMessagesBoundary namespaces={["translationEditor"]}>
      <div className="space-y-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
          {/* На телефоне описание прячем: строки должны быть в первом экране. */}
          <p className="mt-1 hidden max-w-[760px] text-[14px] leading-relaxed text-[#6f7282] sm:block">{t("description")}</p>
        </div>
        <TranslationEditor initialCategories={categories} />
      </div>
    </DomainMessagesBoundary>
  );
}
