import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { formatDate, formatNumber, isLocale, type Locale } from "@/i18n/locales";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { readSupplyItems } from "@/lib/supply/documents.server";
import { orgTodayKey } from "@/lib/timezone";

import { AcceptanceForm } from "./acceptance-form";

export const dynamic = "force-dynamic";

const DATE: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
const DATE_TIME: Intl.DateTimeFormatOptions = { ...DATE, hour: "2-digit", minute: "2-digit" };

/**
 * Накладная (УПД): что пришло по документу и форма приёмки. После приёмки —
 * статус и ссылка на журнал приёмки, куда легли строки.
 */
export default async function EdoDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const { id } = await params;
  const [t, tPage, rawLocale, doc, organization] = await Promise.all([
    getTranslations("supplyEdo.document"),
    getTranslations("supplyEdo.page"),
    getLocale(),
    db.supplyDocument.findFirst({ where: { id, organizationId } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ]);
  if (!doc) notFound();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "ru";
  const timeZone = organization?.timezone || "Europe/Moscow";
  const items = readSupplyItems(doc.items);
  const money = (value: number) => formatNumber(locale, value, { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
  const quantity = (value: number | null, unit: string | null) =>
    value === null ? "—" : `${formatNumber(locale, value, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;
  const status = (["new", "processing", "accepted", "rejected", "ignored"] as const).find((s) => s === doc.status) ?? "new";
  const source = doc.source === "diadoc" || doc.source === "saby" ? doc.source : "upload";
  const now = new Date();
  const nowTime = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={tPage("eyebrow")}
        title={t("title", { number: doc.number, date: formatDate(locale, doc.date, "UTC", DATE) })}
      />

      <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6" data-edo-document>
        <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="text-[12.5px] text-[#6f7282]">{t("seller")}</dt>
            <dd className="mt-0.5 font-semibold text-[#0b1024] [overflow-wrap:anywhere]">{doc.sellerName}</dd>
            {doc.sellerInn ? <dd className="text-[13px] text-[#3c4053]">{t("inn", { inn: doc.sellerInn })}</dd> : null}
          </div>
          <div className="space-y-0.5 text-[13.5px] text-[#3c4053]">
            {doc.basis ? <div>{t("basis")}: {doc.basis}</div> : null}
            {doc.shippedDate ? <div>{t("shipped", { date: formatDate(locale, doc.shippedDate, "UTC", DATE) })}</div> : null}
            <div>{t("source", { source: tPage(`source.${source}`) })}</div>
            {doc.total !== null ? <div className="font-semibold text-[#0b1024]">{tPage("total", { sum: money(doc.total) })}</div> : null}
          </div>
        </dl>
        {status !== "new" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[14px] text-[#3c4053]">
            <span>
              {t("decided", {
                status: tPage(`status.${status}`),
                when: doc.decidedAt ? formatDate(locale, doc.decidedAt, timeZone, DATE_TIME) : "",
              })}
            </span>
            {doc.journalDocumentId ? (
              <Link
                href={`/journals/incoming_control/documents/${doc.journalDocumentId}`}
                className="inline-flex items-center gap-1.5 font-medium text-[#3848c7] hover:text-[#5566f6]"
              >
                {t("openJournal")}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {status === "new" ? (
        <AcceptanceForm
          documentId={doc.id}
          items={items.map((item) => ({ ...item, quantityLabel: quantity(item.quantity, item.unit) }))}
          defaults={{ deliveryDate: orgTodayKey(timeZone, now), deliveryTime: nowTime }}
        />
      ) : (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("lines")}</h2>
          <ul className="mt-3 divide-y divide-[#f0f1f7]">
            {items.map((item) => (
              <li key={item.line} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5 text-[14px]">
                <span className="min-w-0 text-[#0b1024] [overflow-wrap:anywhere]">{item.name}</span>
                <span className="text-[#3c4053]">{quantity(item.quantity, item.unit)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
