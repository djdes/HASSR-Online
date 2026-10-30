import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { ORG_TEMPLATES } from "@/lib/onboarding-templates";
import { OnboardingTemplateClient } from "@/components/settings/onboarding-template-client";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function OnboardingTemplatePage() {
  const t = await getTranslations("settingsUi.onboardingTemplatePage");
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) forbidden();

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: он занимал первый экран и повторял название
          раздела из хлебных крошек PageNav. Строка-заголовок даёт то же
          объяснение, а карточки шаблонов видны сразу. */}
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <OnboardingTemplateClient templates={ORG_TEMPLATES} />
    </div>
  );
}
