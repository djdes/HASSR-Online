import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { ProductsClient } from "./products-client";

export const dynamic = "force-dynamic";

/** ХАССП, шаг 2 — описание продукции: записи блока читаются сразу, правка идёт через API. */
export default async function ProductsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const [rows, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { organizationId, block: "products" },
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
