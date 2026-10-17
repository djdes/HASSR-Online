import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import { NormsClient } from "./norms-client";

export const dynamic = "force-dynamic";

/** Нормативные документы: отметки каталога, свои документы, подписка на обновления и папка файлов. */
export default async function NormsDocumentsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const [rows, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { organizationId, block: "norms" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl"),
  ]);

  const initial = parsePpkRecords("norms", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  return (
    <div className="space-y-6">
      <PpkBlockHeader
        blockKey="norm-documents"
        lead={t("norms.lead")}
        actions={
          <Link
            href="/sanpin"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {t("norms.sanpinLink")}
          </Link>
        }
      />

      <NormsClient initial={initial} />

      <section className="flex flex-col gap-4 rounded-3xl border border-[#ececf4] bg-white p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[#0b1024]">{t("norms.subscriptionTitle")}</h3>
          <p className="mt-1 max-w-[560px] text-[13.5px] text-[#6f7282]">{t("norms.subscriptionHint")}</p>
        </div>
        <Link
          href="/settings/services?order=norms-subscription"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          {t("norms.order")}
        </Link>
      </section>

      <section className="space-y-3 rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-[14.5px] font-medium text-[#0b1024]">
          <FileText className="size-4 text-[#3848c7]" aria-hidden />
          {t("norms.files")}
        </h3>
        <PpkFolder folder="norm-files" canManage />
      </section>
    </div>
  );
}
