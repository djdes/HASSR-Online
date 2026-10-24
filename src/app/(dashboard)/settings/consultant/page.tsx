import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Handshake } from "lucide-react";

import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { isPartnerAccessLevel } from "@/lib/partners/access-guard";
import { validateSlug } from "@/lib/partners/validation";
import { ConsultantSettingsClient } from "./consultant-client";

export const dynamic = "force-dynamic";

/**
 * Настройки → «Консультант»: кто сопровождает организацию, какой у него
 * доступ, как отключить. Сюда же ведёт `/p/<slug>` для уже
 * зарегистрированных клиентов (`?attach=<slug>&level=view|edit`) — форма
 * подключения раскрывается с предзаполненным партнёром.
 *
 * Партнёр из кабинета клиента страницу не видит: путь в PARTNER_DENYLIST
 * middleware, здесь — второй рубеж.
 */
export default async function ConsultantSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ attach?: string; level?: string }>;
}) {
  const session = await requireAuth();
  const t = await getTranslations("settingsUi.consultantPage");
  if (session.user.partnerAccess) redirect("/partner/denied?reason=" + encodeURIComponent(t("clientOnly")));
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");

  const { attach, level } = await searchParams;
  const slugCheck = attach ? validateSlug(attach) : null;
  const attachSlug = slugCheck?.ok ? slugCheck.slug : null;
  const attachLevel = isPartnerAccessLevel(level) ? level : "view";

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Handshake className="size-5" />
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

      <ConsultantSettingsClient initialAttachSlug={attachSlug} initialAttachLevel={attachLevel} />
    </div>
  );
}
