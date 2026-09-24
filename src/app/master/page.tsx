import { redirect } from "next/navigation";

import { MasterDirectoryClient, type MasterTab } from "@/components/master/master-directory-client";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { listPoolOrganizations, listSharedItems, readOrgKind } from "@/lib/master-directory";

export const dynamic = "force-dynamic";

const TABS: readonly MasterTab[] = ["menu", "raw", "objects"];

export default async function MasterPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  // Layout проверяет то же самое, но страница рендерится параллельно с ним —
  // не читаем списки чужой организации даже на мгновение.
  if ((await readOrgKind(orgId)) !== "directory") redirect("/dashboard");

  const params = await searchParams;
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab: MasterTab = TABS.includes(rawTab as MasterTab) ? (rawTab as MasterTab) : "menu";

  const [dishes, products, organizations] = await Promise.all([
    listSharedItems(orgId, "dish"),
    listSharedItems(orgId, "product"),
    listPoolOrganizations(orgId),
  ]);

  return (
    <MasterDirectoryClient
      initialTab={initialTab}
      initialDishes={dishes}
      initialProducts={products}
      organizations={organizations}
    />
  );
}
