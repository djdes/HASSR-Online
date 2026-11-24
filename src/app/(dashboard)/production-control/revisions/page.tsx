import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ppkPageScope } from "@/lib/ppk/access.server";
import { loadRevisionRegister } from "@/lib/ppk/revisions.server";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

function ruDate(iso: string, timeZone: string): string {
  const options = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } as const;
  try {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "Europe/Moscow" }).format(new Date(iso));
  }
}

/**
 * Реестр редакций документов ППК (2026-11-24): номер «ППК NNN», документ,
 * дата и кто утвердил; у прежних редакций — какой редакцией заменены.
 */
export default async function RevisionsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const scope = await ppkPageScope(session);
  const [rows, org, t] = await Promise.all([
    loadRevisionRegister(scope.organizationId),
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { timezone: true } }),
    getTranslations("productionControl.revisions"),
  ]);
  const timeZone = org?.timezone || "Europe/Moscow";

  return (
    <div className="space-y-5" data-ppk-revisions>
      <Link
        href="/production-control"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <PageHeader title={t("registerTitle")} description={t("registerLead")} />
      {rows.length === 0 ? (
        <p className="rounded-3xl bg-[var(--app-veil)] px-5 py-8 text-center text-[14px] text-[#6f7282]">{t("registerEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-3xl bg-white p-1">
          <table className="w-full min-w-[640px] border-collapse text-left text-[14px] text-[#0b1024]">
            <thead>
              <tr className="text-[12.5px] text-[#6f7282]">
                <th className="px-3 py-2.5 font-medium">{t("colNumber")}</th>
                <th className="px-3 py-2.5 font-medium">{t("colDocument")}</th>
                <th className="px-3 py-2.5 font-medium">{t("colDate")}</th>
                <th className="px-3 py-2.5 font-medium">{t("colApprover")}</th>
                <th className="px-3 py-2.5 font-medium">{t("colState")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.number} className="border-t border-[#ececf4] align-top" data-revision-row={row.code}>
                  <td className="whitespace-nowrap px-3 py-2.5 font-semibold tabular-nums">{row.code}</td>
                  <td className="px-3 py-2.5 [overflow-wrap:anywhere]">{row.title}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{ruDate(row.approvedAt, timeZone)}</td>
                  <td className="px-3 py-2.5">{row.approvedByName || "—"}</td>
                  <td className="px-3 py-2.5 text-[13px]">
                    {row.supersededBy ? (
                      <span className="text-[#6f7282]">{t("stateSuperseded", { code: row.supersededBy })}</span>
                    ) : (
                      <span className="font-medium text-[#116b2a]">{t("stateCurrent")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
