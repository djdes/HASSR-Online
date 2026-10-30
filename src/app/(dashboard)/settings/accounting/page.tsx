import { forbidden } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { AccountingClient } from "./accounting-client";
import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export const dynamic = "force-dynamic";

export default async function AccountingSettingsPage() {
  const t = await getTranslations("settingsManagement.accounting");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    forbidden();
  }
  const orgId = getActiveOrgId(session);

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { accountantEmail: true },
  });

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement"]}>
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <FileSpreadsheet className="size-5" />
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

      <AccountingClient initialEmail={org?.accountantEmail ?? null} />
    </div>
    </DomainMessagesBoundary>
  );
}
