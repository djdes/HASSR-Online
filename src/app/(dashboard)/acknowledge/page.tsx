import Link from "next/link";
import { CheckCircle2, ChevronRight, FileSignature } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { ackDocPath, formatAckMoment } from "@/lib/ppk/acknowledge";
import { listAckDocsForUser } from "@/lib/ppk/acknowledge.server";

export const dynamic = "force-dynamic";

/** Документы, с которыми сотруднику нужно ознакомиться: политика, положение, инструкции. */
export default async function AcknowledgeListPage() {
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);
  const [docs, org, t] = await Promise.all([
    listAckDocsForUser(organizationId, session.user.id),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    getTranslations("acknowledge"),
  ]);
  const timeZone = org?.timezone ?? "Europe/Moscow";

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("lead")} />
      {docs.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-10 text-center">
          <FileSignature className="mx-auto size-8 text-[#5566f6]" aria-hidden />
          <div className="mt-3 text-[16px] font-semibold text-[#0b1024]">{t("emptyTitle")}</div>
          <p className="mt-1 text-[14px] text-[#6f7282]">{t("emptyHint")}</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {docs.map((doc) => (
            <li key={doc.docKey}>
              <Link
                href={ackDocPath(doc.docKey)}
                className="flex items-center gap-3.5 rounded-2xl border border-[#ececf4] bg-white p-4 transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                  <FileSignature className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[15px] font-semibold text-[#0b1024]">{doc.title}</div>
                  {doc.acknowledgedAt ? (
                    <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[#e9f8ef] px-2.5 py-1 text-[12px] font-medium text-[#1f7a45]">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {t("doneOn", { date: formatAckMoment(doc.acknowledgedAt, timeZone).date })}
                    </span>
                  ) : (
                    <span className="mt-1.5 inline-flex rounded-full bg-[#fff7e6] px-2.5 py-1 text-[12px] font-medium text-[#8a5a00]">
                      {t("needed")}
                    </span>
                  )}
                </div>
                <ChevronRight className="size-5 shrink-0 text-[#9b9fb3]" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
