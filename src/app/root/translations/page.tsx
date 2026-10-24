import { getTranslations } from "next-intl/server";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { TranslationEditor } from "@/components/translations/translation-editor";
import { TranslatorsPanel } from "@/components/translations/translators-panel";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { listCategoryStats } from "@/lib/translations/editor.server";

export const dynamic = "force-dynamic";

/** Переводы интерфейса: редактор каталогов ru/en/uz и список переводчиков. */
export default async function RootTranslationsPage() {
  await requireRoot();
  const [t, categories, translators] = await Promise.all([
    getTranslations("translationEditor"),
    listCategoryStats(),
    db.user.findMany({
      where: { canEditTranslations: true },
      select: { id: true, name: true, email: true, organization: { select: { name: true } } },
      orderBy: { email: "asc" },
    }),
  ]);
  return (
    <DomainMessagesBoundary namespaces={["translationEditor"]}>
      <div className="space-y-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
          <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">{t("description")}</p>
        </div>
        <TranslatorsPanel initial={translators} />
        <TranslationEditor initialCategories={categories} />
      </div>
    </DomainMessagesBoundary>
  );
}
