import { getLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/locales";
import { auditActionLabel, formatAuditDate } from "./audit-presentation";
import { requireRoot } from "@/lib/auth-helpers";
import { BLANK_DOWNLOAD_AUDIT_ACTION } from "@/lib/blank-download";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Append-only audit-trail для root-админа платформы.
 * Источник истины — таблица AuditLog (заполняется через recordAuditLog).
 * Хранится 365 дней (cleanup через pruneOldAuditLogs).
 */

export default async function RootAuditPage() {
  await requireRoot();

  const logs = await db.auditLog.findMany({
    // Скачивания шаблонов с сайта — лиды, а не действия админов: у них
    // свой список (/root/blank-downloads), здесь они вытеснили бы аудит.
    where: { action: { not: BLANK_DOWNLOAD_AUDIT_ACTION } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const orgIds = [...new Set(logs.map((l) => l.organizationId))];
  const orgs = orgIds.length
    ? await db.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true },
      })
    : [];
  const orgById = new Map(orgs.map((o) => [o.id, o.name]));

  const t = await getTranslations("rootAudit");
  const selectedLocale = await getLocale();
  const locale = isLocale(selectedLocale) ? selectedLocale : "ru";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-black">
          {t("title")}
        </h1>
        <p className="mt-2 text-[15px] text-[#6f7282]">
          {t("description")}
        </p>
      </div>

      {logs.length === 0 ? (
        <div className="rounded-2xl border border-[#ececf4] bg-white p-8 text-center text-[14px] text-[#6f7282]">
          {t("empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white">
          <table className="w-full min-w-[900px] text-[14px]">
            <thead className="bg-[#f6f7fb] text-[13px] text-[#6f7282]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">{t("time")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("organization")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("actor")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("action")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("entity")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("details")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("ip")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-[#f1f1f6] align-top">
                  <td className="px-4 py-3 text-[12px] text-[#6f7282] whitespace-nowrap">
                    {formatAuditDate(log.createdAt, locale)}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[#0b1024]">
                    {orgById.get(log.organizationId) ?? log.organizationId}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[#0b1024]">
                    {log.userName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[13px] font-medium text-[#5566f6]">
                    {auditActionLabel(log.action, t)}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[#6f7282]">
                    {log.entity}{log.entityId ? `:${log.entityId.slice(0, 6)}` : ""}
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <pre className="overflow-x-auto rounded bg-[#f6f7fb] px-2 py-1 text-[11px] text-[#3a3f55]">
                      {JSON.stringify(log.details ?? {}, null, 0).slice(0, 200)}
                    </pre>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[#6f7282]">
                    {log.ipAddress ?? "—"}
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
