import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Award } from "lucide-react";

import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PartnerApplicationClient } from "./partner-application-client";

export const dynamic = "force-dynamic";

/**
 * Настройки → «Стать партнёром»: заявка в партнёрскую программу и статус
 * уже поданной. Сюда ведут кнопка на публичной `/partners` (через
 * регистрацию) и плитка в хабе настроек. Партнёр, зашедший в кабинет
 * клиента, заявку подать не может — путь в PARTNER_DENYLIST middleware.
 */
export default async function PartnerApplicationPage() {
  const t = await getTranslations("settingsUi.partnerPage");
  const session = await requireAuth();
  if (session.user.partnerAccess) redirect("/partner");
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Award className="size-5" />
        </span>
        <div>
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-semibold tracking-[-0.02em] text-[#0b1024]">
            {t("title")}
          </h1>
          <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
            {t("description")}
          </p>
        </div>
      </div>

      <PartnerApplicationClient />
    </div>
  );
}
