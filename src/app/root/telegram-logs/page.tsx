import { FORMAT_LOCALES } from "@/i18n/locales";
import { rootTelegramStatus } from "@/lib/root-operations-logs-presentation";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-[#e6f7ea] text-[#136b2a]",
  queued: "bg-[#eef1ff] text-[#5566f6]",
  failed: "bg-[#fff4f2] text-[#d2453d]",
  rate_limited: "bg-[#fff7e6] text-[#a3690a]",
  // Push в приложение человеку без Telegram: запись нужна, чтобы при
  // повторном прогоне рассылки не слать push второй раз.
  push_only: "bg-[#eef0fb] text-[#6f7282]",
  // Тихие часы: сообщение (или push в приложение) уйдёт утром.
  deferred: "bg-[#f5f3ff] text-[#6d5bd0]",
};

export default async function RootTelegramLogsPage() {
  await requireRoot();
  const locale = await getSiteLocale();
  const copy = await getTranslations({ locale, namespace: "rootOperationsLogs" });

  const logs = await db.telegramLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      chatId: true,
      body: true,
      status: true,
      error: true,
      attempts: true,
      sentAt: true,
      createdAt: true,
      userId: true,
    },
  });

  const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, organization: { select: { name: true } } },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-black">
          {copy("telegram.title")}
        </h1>
        <p className="mt-2 text-[15px] text-[#6f7282]">
          {copy("telegram.description")}
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white">
        <table className="w-full min-w-[900px] text-[14px]">
          <thead className="bg-[#f6f7fb] text-[13px] text-[#6f7282]">
            <tr>
              <th className="px-6 py-3 text-left font-medium">{copy("telegram.time")}</th>
              <th className="px-6 py-3 text-left font-medium">{copy("telegram.recipient")}</th>
              <th className="px-6 py-3 text-left font-medium">{copy("telegram.chat")}</th>
              <th className="px-6 py-3 text-left font-medium">{copy("telegram.message")}</th>
              <th className="px-6 py-3 text-center font-medium">{copy("telegram.status")}</th>
              <th className="px-6 py-3 text-center font-medium">{copy("telegram.attempts")}</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-[#6f7282]">
                  {copy("telegram.empty")}
                </td>
              </tr>
            )}
            {logs.map((log) => {
              const user = log.userId ? userById.get(log.userId) : null;
              const statusClass =
                Object.hasOwn(STATUS_STYLES, log.status) ? STATUS_STYLES[log.status] : "bg-[#eef0fb] text-[#6f7282]";
              return (
                <tr key={log.id} className="border-t border-[#eef0f6] align-top">
                  <td className="px-6 py-3 text-[#6f7282] whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString(FORMAT_LOCALES[locale])}
                  </td>
                  <td className="px-6 py-3">
                    {user ? (
                      <div>
                        <div className="text-black">{user.name}</div>
                        <div className="text-[12px] text-[#8a8ea4]">
                          {user.email} · {user.organization.name}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[#8a8ea4]">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3 font-mono text-[12px] text-[#6f7282]">
                    {log.chatId || copy("telegram.app")}
                  </td>
                  <td className="px-6 py-3 max-w-[420px]">
                    <div className="truncate" title={log.body}>
                      {log.body}
                    </div>
                    {log.error && (
                      <div className="mt-1 text-[12px] text-[#d2453d]">
                        {log.error}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-[12px] font-medium ${statusClass}`}
                    >
                      {rootTelegramStatus(log.status, locale)}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-center text-[#6f7282]">
                    {log.attempts}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
