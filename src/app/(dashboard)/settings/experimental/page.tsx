import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FlaskConical } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ExperimentalClient } from "./experimental-client";

export const dynamic = "force-dynamic";

/**
 * Beta-настройки. Здесь живут feature flag'и которые ещё не готовы к
 * широкому релизу — менеджер включает на свою орг чтобы попробовать.
 *
 * Текущие флаги:
 *   • experimentalUiV2 — Design v2 для журнальных интерфейсов
 *     (см. docs/PIPELINE-VISION.md раздел P3)
 */
export default async function ExperimentalPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    forbidden();
  }
  const orgId = getActiveOrgId(session);
  const t = await getTranslations("settingsUi.experimentalPage");

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      experimentalUiV2: true,
    },
  });

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <FlaskConical className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              {t("title")}
            </h1>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              {t("description")}
            </p>
          </div>
        </div>
      </div>

      <ExperimentalClient
        initialExperimentalUiV2={org?.experimentalUiV2 ?? true}
      />
    </div>
  );
}
