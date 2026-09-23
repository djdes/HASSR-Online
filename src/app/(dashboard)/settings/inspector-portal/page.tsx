import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadCabinetInspectorData } from "@/lib/inspector-qr-service";
import { InspectorPortalClient } from "./inspector-portal-client";

export const dynamic = "force-dynamic";

export default async function InspectorPortalPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    redirect("/settings");
  }
  const orgId = getActiveOrgId(session);
  const { tokens, activity } = await loadCabinetInspectorData(orgId);

  return (
    <div className="space-y-5">
      <div className="mt-4 flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
            Портал инспектора
          </h1>
          <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
            Доступ только для просмотра для СЭС / Роспотребнадзора. Проверяющий
            сканирует QR, выбирает период и смотрит журналы листами, как в
            бумажной папке. Изменить ничего не может, каждый просмотр
            фиксируется.
          </p>
        </div>
      </div>

      <InspectorPortalClient initialTokens={tokens} initialActivity={activity} />
    </div>
  );
}
