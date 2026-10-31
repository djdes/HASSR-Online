import Link from "next/link";
import { forbidden } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";

import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { formatDate, formatNumber, isLocale, type Locale } from "@/i18n/locales";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { readSupplyItems } from "@/lib/supply/documents.server";

import { EdoInboxActions } from "./edo-inbox-actions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  new: "bg-[#eef1ff] text-[#3848c7]",
  processing: "bg-[#fff8eb] text-[#7a4a00]",
  accepted: "bg-[#ecfdf5] text-[#136c3e]",
  rejected: "bg-[#fff4f2] text-[#a13a32]",
  ignored: "bg-[#f4f4f7] text-[#6f7282]",
};
const DATE: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
const DATE_TIME: Intl.DateTimeFormatOptions = { ...DATE, hour: "2-digit", minute: "2-digit" };

/**
 * «Входящие накладные» (ЭДО, 2026-10-31): УПД поставщиков из Диадока, СБИС
 * или файлом. Ждущие приёмки — сверху; открыл, проверил товар — строки в
 * журнале приёмки. `?tab=done` — разобранные.
 */
export default async function EdoInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ [name: string]: string | string[] | undefined }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const tab = (await searchParams).tab === "done" ? "done" : "new";
  const [t, rawLocale, organization, connections, pendingCount, documents] = await Promise.all([
    getTranslations("supplyEdo.page"),
    getLocale(),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.supplyConnection.findMany({
      where: { organizationId },
      select: { provider: true, status: true, lastSyncAt: true, lastError: true },
    }),
    db.supplyDocument.count({ where: { organizationId, status: { in: ["new", "processing"] } } }),
    db.supplyDocument.findMany({
      where: { organizationId, status: tab === "new" ? { in: ["new", "processing"] } : { in: ["accepted", "rejected", "ignored"] } },
      orderBy: tab === "new" ? [{ date: "desc" }, { createdAt: "desc" }] : [{ decidedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        source: true,
        number: true,
        date: true,
        sellerName: true,
        sellerInn: true,
        items: true,
        total: true,
        status: true,
        decidedAt: true,
      },
    }),
  ]);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "ru";
  const timeZone = organization?.timezone || "Europe/Moscow";
  const sourceLabel = (source: string) => t(`source.${source === "diadoc" || source === "saby" ? source : "upload"}`);
  const money = (value: number) => formatNumber(locale, value, { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
  const tabClass = (active: boolean) =>
    `inline-flex h-10 items-center rounded-2xl px-4 text-[13.5px] font-medium transition-colors ${
      active
        ? "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]"
        : "border border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
    }`;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {pendingCount > 0 ? <PageHeaderStat tone="warn">{t("pending", { count: pendingCount })}</PageHeaderStat> : null}
            <Link
              href="/settings/integrations/edo"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              {t("settings")}
            </Link>
          </>
        }
      />

      <EdoInboxActions
        connections={connections.map((connection) => ({
          provider: connection.provider === "saby" ? "saby" : "diadoc",
          ok: connection.status !== "error",
          lastError: connection.lastError,
          lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
        }))}
      />

      <div className="flex flex-wrap gap-2" data-edo-tabs>
        <Link href="/edo" aria-current={tab === "new" ? "page" : undefined} className={tabClass(tab === "new")}>
          {t("tabs.new")}
        </Link>
        <Link href="/edo?tab=done" aria-current={tab === "done" ? "page" : undefined} className={tabClass(tab === "done")}>
          {t("tabs.done")}
        </Link>
      </div>

      {documents.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-[#dcdfed] bg-white px-6 py-10 text-center text-[14px] leading-relaxed text-[#6f7282]">
          {tab === "new" ? t("empty") : t("emptyDone")}
        </p>
      ) : (
        <ul className="space-y-2.5" data-edo-documents>
          {documents.map((doc) => {
            const items = readSupplyItems(doc.items);
            const preview = items.slice(0, 3).map((item) => item.name).join(", ");
            return (
              <li key={doc.id}>
                <Link
                  href={`/edo/${doc.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-3.5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-colors hover:border-[#5566f6]/40 hover:bg-[#fafbff] sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[15.5px] font-semibold text-[#0b1024] [overflow-wrap:anywhere]">{doc.sellerName}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${STATUS_TONE[doc.status] ?? STATUS_TONE.new}`}>
                        {t(`status.${(["new", "processing", "accepted", "rejected", "ignored"] as const).find((s) => s === doc.status) ?? "new"}`)}
                      </span>
                    </div>
                    <div className="mt-1 text-[13.5px] text-[#3c4053]">
                      {[
                        t("number", { number: doc.number }),
                        t("date", { date: formatDate(locale, doc.date, "UTC", DATE) }),
                        t("items", { count: items.length }),
                        doc.total !== null ? t("total", { sum: money(doc.total) }) : null,
                        sourceLabel(doc.source),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {preview ? (
                      <div className="mt-0.5 truncate text-[12.5px] text-[#6f7282]">{preview}{items.length > 3 ? "…" : ""}</div>
                    ) : null}
                    {doc.decidedAt ? (
                      <div className="mt-0.5 text-[12.5px] text-[#6f7282]">{formatDate(locale, doc.decidedAt, timeZone, DATE_TIME)}</div>
                    ) : null}
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-[#9b9fb3]" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
