import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { ProductsClient } from "./products-client";
import { ppkPageScope } from "@/lib/ppk/access.server";
import { ppkWhere } from "@/lib/ppk/scope";

export const dynamic = "force-dynamic";

/** ХАССП, шаг 2 — описание продукции: записи блока читаются сразу, правка идёт через API. */
export default async function ProductsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // ППК на точку (2026-11-01): ППК точки из шапки или организации.
  const scope = await ppkPageScope(session);

  const [rows, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "products" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.products"),
  ]);

  const initial = parsePpkRecords("products", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  const header = (
    <PpkBlockHeader
      blockKey="products"
      lead={t("lead")}
      actions={<PpkCreateButton label={t("add")} />}
    />
  );

  return <ProductsClient initial={initial} header={header} />;
}
