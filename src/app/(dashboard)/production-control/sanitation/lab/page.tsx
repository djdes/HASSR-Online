import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import { LabClient } from "./lab-client";

export const dynamic = "force-dynamic";

/** Лабораторные исследования, санитария: план исследований и папки договора, протоколов и актов. */
export default async function LabPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const [rows, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { organizationId, block: "lab-plan" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl.lab"),
  ]);

  const initial = parsePpkRecords("lab-plan", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  const header = (
    <PpkBlockHeader
      blockKey="lab"
      lead={t("lead")}
      reminderHint
      actions={<PpkCreateButton label={t("add")} />}
    />
  );

  return (
    <div className="space-y-10">
      <LabClient initial={initial} header={header} />

      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("contract")}</h2>
          <PpkFolder folder="lab-contract" canManage />
        </section>
        <section className="space-y-4">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("protocols")}</h2>
          <PpkFolder folder="lab-protocols" canManage />
        </section>
        <section className="space-y-4 md:col-span-2">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("acts")}</h2>
          <PpkFolder folder="lab-acts" canManage />
        </section>
      </div>
    </div>
  );
}
