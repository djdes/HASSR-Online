import { forbidden } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ppkPageScope } from "@/lib/ppk/access.server";
import { ppkStructureItem } from "@/lib/ppk/structure";
import { PpkItemPanel } from "@/components/production-control/structure/item-panel";

export const dynamic = "force-dynamic";

/** Содержимое окна пункта: те же права и та же область ППК, что у страниц раздела. */
export default async function ItemModalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = ppkStructureItem(id);
  if (!item) return null;
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const scope = await ppkPageScope(session);
  return <PpkItemPanel item={item} scope={scope} session={session} />;
}
