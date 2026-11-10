import { forbidden } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadOfflineOverview, OFFLINE_RECORDS_LIMIT } from "@/lib/offline/overview.server";

export const dynamic = "force-dynamic";

/**
 * «Настройки → Работа без связи»: which devices fill journals without the
 * internet and which records were made offline over the last month — when
 * they were made, when they reached the server and how the author was
 * confirmed. Management only.
 */
export default async function OfflineSettingsPage() {
  const t = await getTranslations("offlineApp.manager");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const locale = await getLocale();
  const { devices, records, timeZone } = await loadOfflineOverview(getActiveOrgId(session));

  const stamp = (at: Date | null) =>
    at ? new Intl.DateTimeFormat(locale, { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(at) : t("never");
  const delay = (minutes: number) =>
    minutes < 60
      ? t("delayMinutes", { count: String(Math.max(minutes, 0)) })
      : minutes < 48 * 60
        ? t("delayHours", { count: String(Math.round(minutes / 60)) })
        : t("delayDays", { count: String(Math.round(minutes / (24 * 60))) });
  const stateText = { ok: t("stateOk"), waiting: t("stateWaiting"), stuck: t("stateStuck"), silent: t("stateSilent") };
  const stateTone = { ok: "text-[#136b3a]", waiting: "text-[#3848c7]", stuck: "text-[#a13a32]", silent: "text-[#7a4a00]" };
  const authText = { pin: t("authPin"), list: t("authList"), self: t("authSelf") };
  const th = "px-3 py-2.5 text-left text-[13px] font-medium text-[#6f7282]";
  const td = "px-3 py-2.5 align-top text-[14px] text-[#0b1024]";

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />

      <section>
        <h2 className="mb-3 text-[18px] font-semibold text-[#0b1024]">{t("devices")}</h2>
        {devices.length === 0 ? (
          <p className="rounded-2xl border border-[#ececf4] bg-white p-5 text-[14px] leading-relaxed text-[#6f7282]">{t("noDevices")}</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white">
            <table className="w-full min-w-[640px] border-collapse" data-testid="offline-devices">
              <thead>
                <tr className="border-b border-[#ececf4]">
                  <th className={th}>{t("colDevice")}</th>
                  <th className={th}>{t("colUser")}</th>
                  <th className={th}>{t("colSeen")}</th>
                  <th className={th}>{t("colData")}</th>
                  <th className={th}>{t("colWaiting")}</th>
                  <th className={th}>{t("colState")}</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id} className="border-b border-[#f1f2f8] last:border-0" data-state={device.state}>
                    <td className={td}>{device.label}</td>
                    <td className={td}>{device.userName}</td>
                    <td className={td}>{stamp(device.lastSeenAt)}</td>
                    <td className={td}>{stamp(device.packAt)}</td>
                    <td className={td}>
                      {device.pendingCount} / {device.stuckCount}
                    </td>
                    <td className={`${td} font-medium ${stateTone[device.state]}`}>{stateText[device.state]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[18px] font-semibold text-[#0b1024]">{t("records")}</h2>
        {records.length === 0 ? (
          <p className="rounded-2xl border border-[#ececf4] bg-white p-5 text-[14px] leading-relaxed text-[#6f7282]">{t("noRecords")}</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white">
              <table className="w-full min-w-[720px] border-collapse" data-testid="offline-records">
                <thead>
                  <tr className="border-b border-[#ececf4]">
                    <th className={th}>{t("colWho")}</th>
                    <th className={th}>{t("colWhat")}</th>
                    <th className={th}>{t("colMade")}</th>
                    <th className={th}>{t("colReceived")}</th>
                    <th className={th}>{t("colDelay")}</th>
                    <th className={th}>{t("colAuth")}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-b border-[#f1f2f8] last:border-0">
                      <td className={td}>{record.who}</td>
                      <td className={td}>
                        {record.what}
                        {record.pastDay ? <span className="text-[#6f7282]"> · {t("pastDay", { day: record.pastDay })}</span> : null}
                      </td>
                      <td className={td}>{stamp(record.recordedAt)}</td>
                      <td className={td}>{stamp(record.syncedAt)}</td>
                      <td className={td}>{delay(record.delayMinutes)}</td>
                      <td className={td}>{authText[record.auth]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {records.length >= OFFLINE_RECORDS_LIMIT ? <p className="mt-2 text-[13px] text-[#6f7282]">{t("shownLimit", { count: String(OFFLINE_RECORDS_LIMIT) })}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
