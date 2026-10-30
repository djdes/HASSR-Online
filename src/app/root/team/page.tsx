import { getTranslations } from "next-intl/server";
import { UsersRound } from "lucide-react";
import { requireSuperRoot } from "@/lib/auth-helpers";
import { listPlatformTeam } from "@/lib/platform-team.server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { TeamClient } from "./team-client";

export const dynamic = "force-dynamic";

/** «Команда и доступы» — who may open the platform panel (owner only). */
export default async function RootTeamPage() {
  await requireSuperRoot();
  const [t, members] = await Promise.all([getTranslations("rootPanel"), listPlatformTeam()]);
  return (
    <DomainMessagesBoundary namespaces={["rootPanel"]}>
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <UsersRound className="size-5" />
          </span>
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("team.title")}</h1>
            <p className="mt-1 max-w-[720px] text-[14px] leading-relaxed text-[#6f7282]">{t("team.description")}</p>
          </div>
        </div>
        <TeamClient initialMembers={members} />
      </div>
    </DomainMessagesBoundary>
  );
}
