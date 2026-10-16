import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  PRODUCTION_DOC_KINDS,
  productionDocServiceKey,
} from "@/lib/production-control-docs";
import { DocumentSlot } from "@/components/production-control/document-slot";

export const dynamic = "force-dynamic";

/**
 * «Производственный контроль → Программа»: два главных документа
 * заведения — программа производственного контроля и ХАССП-план. Либо
 * свой файл, либо заказ разработки у специалиста (решение владельца
 * 2026-10-16: «папка документов»). Приказы, инструкции и СанПиН — во
 * вкладках раздела.
 */
export default async function ProductionControlPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const canManage = hasCapability(session.user, "admin.full");

  const [rows, tRoutes] = await Promise.all([
    db.knowledgeDocument.findMany({
      where: { organizationId, kind: { in: [...PRODUCTION_DOC_KINDS] } },
      select: { kind: true, fileName: true, mimeType: true, sizeBytes: true, updatedAt: true },
    }),
    getTranslations("navigation.routes"),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="sr-only">{tRoutes("production_control")}</h1>
      {PRODUCTION_DOC_KINDS.map((kind) => {
        const row = rows.find((doc) => doc.kind === kind);
        return (
          <DocumentSlot
            key={kind}
            kind={kind}
            document={
              row
                ? { fileName: row.fileName, sizeBytes: row.sizeBytes, updatedAt: row.updatedAt.toISOString() }
                : null
            }
            canManage={canManage}
            orderHref={`/settings/services?order=${productionDocServiceKey(kind)}`}
          />
        );
      })}
    </div>
  );
}
