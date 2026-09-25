import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { resolveSectionName } from "@/lib/org-custom-names";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

import { IdeasClient } from "./ideas-client";

export const dynamic = "force-dynamic";

/**
 * Идеи и голосование: общая площадка всех клиентов. Руководители
 * предлагают и голосуют, статусы ставит команда WeSetup.
 */
export default async function IdeasPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  return (
    <div className="space-y-6">
      <PageHeader
        // Своё название раздела организации, если его задали.
        title={await resolveSectionName(getActiveOrgId(session), "ideas", "Идеи и голосование")}
        description="Чего не хватает в WeSetup? Предложите — или поддержите чужую идею голосом. Что набирает голоса, попадает в план; что вышло — на wesetup.ru/whats-new."
      />
      <IdeasClient />
    </div>
  );
}
