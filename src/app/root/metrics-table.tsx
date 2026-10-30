"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight, Mail, Minus, Phone, Search } from "lucide-react";
import { formatNumber } from "@/i18n/locales";
import { formatMetricsRelative, metricsDate, metricsPlanLabel, type JournalSourceNames } from "./metrics-presentation";
import type { OrgMetrics } from "@/lib/org-metrics";
import { normalizeOwnership, normalizeSphere } from "@/lib/org-profile";
import { ActivityDrawer } from "./activity-drawer";
import { OrgRowActions } from "@/app/root/organizations/org-row-actions";
import { cn } from "@/lib/utils";

/**
 * Список клиентов платформы (переделан 2026-10-29: «скролл снизу где-то,
 * непонятная логика, убрать лишние колонки»).
 *
 * Пять колонок, которые помещаются в экран без горизонтальной прокрутки:
 * клиент, контакт, тариф, активность, деньги. IP, сфера и ИНН — второй
 * строкой или в карточке клиента. Быстрые фильтры сверху вместо сортировки
 * по пятнадцати колонкам; на телефоне — карточки. Всё считается на клиенте:
 * организации приходят одним запросом.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 50;

export type ClientSegment = "all" | "paying" | "notPaying" | "new" | "sleeping" | "demo";
export type ClientSort = "mrr" | "newest" | "active" | "sleeping" | "name";

const SEGMENTS: ClientSegment[] = ["all", "paying", "notPaying", "new", "sleeping", "demo"];
const SORTS: ClientSort[] = ["mrr", "newest", "active", "sleeping", "name"];

function lastActivityMs(m: OrgMetrics): number | null {
  return m.lastEntryAt ? new Date(m.lastEntryAt).getTime() : null;
}

export function isSleeping(m: OrgMetrics, now: number): boolean {
  const last = lastActivityMs(m);
  return !m.isDemo && (last === null || now - last > 14 * DAY_MS);
}

export function inSegment(m: OrgMetrics, segment: ClientSegment, now: number): boolean {
  switch (segment) {
    case "all":
      return true;
    case "paying":
      return m.actualMrrRub > 0;
    case "notPaying":
      return m.actualMrrRub === 0 && !m.isDemo;
    case "new":
      return now - new Date(m.createdAt).getTime() <= 7 * DAY_MS;
    case "sleeping":
      return isSleeping(m, now);
    case "demo":
      return m.isDemo;
  }
}

/** Search across name, tax ID, owner name/e-mails/phones and the org phone. */
export function matchesClientQuery(m: OrgMetrics, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  const text = [m.organizationName, m.inn, m.ownerName, m.ownerEmail, m.ownerContactEmail, m.subscriptionPlan]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes(q)) return true;
  if (digits.length >= 4) {
    const phones = [m.ownerPhone, m.orgPhone, m.inn].map((value) => (value ?? "").replace(/\D/g, ""));
    return phones.some((value) => value.includes(digits));
  }
  return false;
}

export function sortClients(rows: OrgMetrics[], sort: ClientSort): OrgMetrics[] {
  const byName = (a: OrgMetrics, b: OrgMetrics) => a.organizationName.localeCompare(b.organizationName, "ru");
  return [...rows].sort((a, b) => {
    switch (sort) {
      case "mrr":
        return b.actualMrrRub - a.actualMrrRub || b.potentialMrrRub - a.potentialMrrRub || byName(a, b);
      case "newest":
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "active":
        return b.entries7d - a.entries7d || (lastActivityMs(b) ?? 0) - (lastActivityMs(a) ?? 0);
      case "sleeping":
        return (lastActivityMs(a) ?? 0) - (lastActivityMs(b) ?? 0);
      case "name":
        return byName(a, b);
    }
  });
}

export function MetricsTable({
  rows,
  now,
  sourceJournalNames,
  canManage = true,
}: {
  rows: OrgMetrics[];
  /// Момент отрисовки приходит с сервера: Date.now() в рендере расходится
  /// между SSR и гидратацией.
  now: number;
  sourceJournalNames: JournalSourceNames;
  /** «Войти» и «Удалить» — только владельцу платформы. */
  canManage?: boolean;
}) {
  const t = useTranslations("rootMetrics");
  const profile = useTranslations("settingsManagement.organizationProfile.form");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<ClientSegment>("all");
  const [sort, setSort] = useState<ClientSort>("mrr");
  const [limit, setLimit] = useState(PAGE);
  const [openOrg, setOpenOrg] = useState<{ id: string; name: string } | null>(null);

  const counts = useMemo(() => {
    const result = {} as Record<ClientSegment, number>;
    for (const key of SEGMENTS) result[key] = rows.filter((m) => inSegment(m, key, now)).length;
    return result;
  }, [rows, now]);

  const visible = useMemo(
    () => sortClients(rows.filter((m) => inSegment(m, segment, now) && matchesClientQuery(m, query)), sort),
    [rows, segment, query, sort, now],
  );
  const shown = visible.slice(0, limit);

  const sphere = (m: OrgMetrics) =>
    [m.ownershipKind ? profile(`ownershipKinds.${normalizeOwnership(m.ownershipKind)}`) : null, profile(`spheres.${normalizeSphere(m.type)}`)]
      .filter(Boolean)
      .join(" · ");
  const lastActivity = (m: OrgMetrics) =>
    m.lastEntryAt ? formatMetricsRelative(new Date(m.lastEntryAt), now, t) : t("table.never");

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]" data-clients-list>
      <div className="space-y-3 border-b border-[#eef0f6] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">{t("table.searchLabel")}</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE);
              }}
              placeholder={t("list.searchPlaceholder")}
              data-clients-search
              className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-4 text-[14px] text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-[#6f7282]">
            {t("list.sortLabel")}
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as ClientSort)}
              data-clients-sort
              className="h-11 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] outline-none transition-colors focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            >
              {SORTS.map((key) => (
                <option key={key} value={key}>
                  {t(`list.sort.${key}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="tablist">
          {SEGMENTS.map((key) => {
            const active = key === segment;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                data-segment={key}
                onClick={() => {
                  setSegment(key);
                  setLimit(PAGE);
                }}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
                  active ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                )}
              >
                {t(`list.segments.${key}`)}
                <span className={cn("tabular-nums", active ? "text-white/75" : "text-[#9b9fb3]")}>{formatNumber(locale, counts[key])}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="px-5 py-14 text-center text-[14px] text-[#6f7282]">{rows.length === 0 ? t("table.noOrganizations") : t("table.noResults")}</div>
      ) : (
        <>
          {/* Desktop: five columns that fit the screen — no horizontal scroll. */}
          <table className="hidden w-full table-fixed text-[14px] lg:table">
            <colgroup>
              <col />
              <col className="w-[22%]" />
              <col className="w-[12%]" />
              <col className="w-[13%]" />
              <col className="w-[110px]" />
              <col className={canManage ? "w-[150px]" : "w-[40px]"} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#fafbff] text-[11.5px] uppercase tracking-[0.12em] text-[#6f7282]">
              <tr>
                <th className="px-5 py-3 text-left font-medium">{t("list.columns.client")}</th>
                <th className="px-3 py-3 text-left font-medium">{t("list.columns.contact")}</th>
                <th className="px-3 py-3 text-left font-medium">{t("list.columns.plan")}</th>
                <th className="px-3 py-3 text-left font-medium">{t("list.columns.activity")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("list.columns.money")}</th>
                <th className="px-3 py-3">
                  <span className="sr-only">{t("table.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.organizationId} className="group/row border-t border-[#eef0f6] align-top transition-colors hover:bg-[#fafbff]" data-client-row={m.organizationId}>
                  <td className="px-5 py-3">
                    <ClientCell m={m} sphere={sphere(m)} />
                  </td>
                  <td className="px-3 py-3">
                    <ContactCell m={m} />
                  </td>
                  <td className="px-3 py-3">
                    <PlanPill plan={m.subscriptionPlan} />
                    {m.subscriptionEnd && m.actualMrrRub > 0 ? (
                      <div className="mt-1 text-[12px] text-[#9b9fb3]">{t("list.until", { date: metricsDate(m.subscriptionEnd, locale, undefined, true) })}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setOpenOrg({ id: m.organizationId, name: m.organizationName })}
                      title={t("table.viewActivity")}
                      className="rounded-lg text-left transition-colors hover:text-[#3848c7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40"
                    >
                      <span className="flex items-center gap-1.5 tabular-nums text-[#0b1024]">
                        {t("list.entries7d", { count: formatNumber(locale, m.entries7d) })}
                        <TrendBadge value={m.weeklyTrendPct} />
                      </span>
                      <span className={cn("mt-0.5 block text-[12px]", isSleeping(m, now) ? "text-[#a13a32]" : "text-[#9b9fb3]")}>{lastActivity(m)}</span>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <MoneyCell m={m} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    {canManage ? (
                      <OrgRowActions organizationId={m.organizationId} organizationName={m.organizationName} usersCount={m.activeUsers} copy={t} />
                    ) : (
                      <Link href={`/root/organizations/${m.organizationId}`} aria-label={t("list.open")} className="inline-flex text-[#9b9fb3] hover:text-[#3848c7]">
                        <ChevronRight className="size-4" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phone and tablet: cards. */}
          <ul className="divide-y divide-[#eef0f6] lg:hidden">
            {shown.map((m) => (
              <li key={m.organizationId} className="px-4 py-4" data-client-card={m.organizationId}>
                <div className="flex items-start justify-between gap-3">
                  <ClientCell m={m} sphere={sphere(m)} />
                  <div className="shrink-0 text-right tabular-nums">
                    <MoneyCell m={m} />
                  </div>
                </div>
                <div className="mt-2">
                  <ContactCell m={m} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-[#6f7282]">
                  <PlanPill plan={m.subscriptionPlan} />
                  <button type="button" onClick={() => setOpenOrg({ id: m.organizationId, name: m.organizationName })} className="tabular-nums hover:text-[#3848c7]">
                    {t("list.entries7d", { count: formatNumber(locale, m.entries7d) })}
                  </button>
                  <span className={isSleeping(m, now) ? "text-[#a13a32]" : undefined}>· {lastActivity(m)}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef0f6] px-5 py-3 text-[13px] text-[#6f7282]">
            <span className="tabular-nums">{t("list.shown", { shown: shown.length, total: visible.length })}</span>
            {visible.length > shown.length ? (
              <button
                type="button"
                onClick={() => setLimit((current) => current + PAGE)}
                className="inline-flex h-10 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                {t("list.showMore", { count: Math.min(PAGE, visible.length - shown.length) })}
              </button>
            ) : null}
          </div>
        </>
      )}

      {openOrg ? (
        <ActivityDrawer
          organizationId={openOrg.id}
          organizationName={openOrg.name}
          onClose={() => setOpenOrg(null)}
          sourceJournalNames={sourceJournalNames}
        />
      ) : null}
    </section>
  );
}

function ClientCell({ m, sphere }: { m: OrgMetrics; sphere: string }) {
  const t = useTranslations("rootMetrics");
  const locale = useLocale();
  return (
    <div className="min-w-0">
      <Link href={`/root/organizations/${m.organizationId}`} className="group/name inline-flex max-w-full items-center gap-1 font-medium text-[#0b1024] hover:text-[#3848c7]">
        <span className="truncate">{m.organizationName}</span>
        <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-70" />
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {m.isDemo ? (
          <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11.5px] font-medium text-[#3848c7]">
            {m.demoExpiresAt ? t("table.demoUntil", { date: metricsDate(m.demoExpiresAt, locale, { day: "numeric", month: "short" }, true) }) : t("table.demo")}
          </span>
        ) : null}
        {m.isDirectory ? <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11.5px] font-medium text-[#3848c7]">{t("table.directory")}</span> : null}
        {m.locationsCount > 1 ? (
          <span className="rounded-full bg-[#fff3ed] px-2 py-0.5 text-[11.5px] font-medium text-[#b45309]">{t("list.points", { count: m.locationsCount })}</span>
        ) : null}
      </div>
      <div className="mt-0.5 truncate text-[12px] text-[#9b9fb3]">
        {[m.inn ? `${t("columns.inn")} ${m.inn}` : null, sphere || null, t("list.since", { date: metricsDate(m.createdAt, locale, undefined, true) })].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}

function ContactCell({ m }: { m: OrgMetrics }) {
  const t = useTranslations("rootMetrics");
  const phone = m.ownerPhone ?? m.orgPhone;
  const email = m.ownerContactEmail;
  if (!m.ownerName && !phone && !email) return <span className="text-[13px] text-[#9b9fb3]">{t("list.noContact")}</span>;
  return (
    <div className="min-w-0 text-[13px] leading-snug">
      {m.ownerName ? <div className="truncate text-[#0b1024]">{m.ownerName}</div> : null}
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="mt-0.5 flex items-center gap-1 truncate tabular-nums text-[#3848c7] hover:underline">
          <Phone className="size-3.5 shrink-0" />
          {phone}
        </a>
      ) : null}
      {email ? (
        <a href={`mailto:${email}`} className="mt-0.5 flex items-center gap-1 truncate text-[#3848c7] hover:underline">
          <Mail className="size-3.5 shrink-0" />
          <span className="truncate">{email}</span>
        </a>
      ) : null}
    </div>
  );
}

function MoneyCell({ m }: { m: OrgMetrics }) {
  const t = useTranslations("rootMetrics");
  const locale = useLocale();
  return (
    <>
      {m.actualMrrRub > 0 ? (
        <span className="font-semibold text-[#0b1024]">{formatNumber(locale, m.actualMrrRub)} ₽</span>
      ) : (
        <span className="text-[#9b9fb3]" title={m.potentialMrrRub > 0 ? t("stats.potential", { amount: m.potentialMrrRub }) : undefined}>
          {m.potentialMrrRub > 0 ? `(${formatNumber(locale, m.potentialMrrRub)})` : "—"}
        </span>
      )}
      {m.balanceRub > 0 ? <div className="mt-0.5 text-[12px] text-[#3848c7]">{t("list.balance", { amount: formatNumber(locale, m.balanceRub) })}</div> : null}
    </>
  );
}

function PlanPill({ plan }: { plan: string }) {
  const t = useTranslations("rootMetrics");
  const styles: Record<string, { bg: string; fg: string }> = {
    trial: { bg: "#fff8eb", fg: "#7a4a00" },
    paid: { bg: "#ecfdf5", fg: "#116b2a" },
    standard: { bg: "#ecfdf5", fg: "#116b2a" },
    premium: { bg: "#eef1ff", fg: "#3848c7" },
    pro: { bg: "#eef1ff", fg: "#3848c7" },
  };
  const s = styles[plan] ?? { bg: "#f5f6ff", fg: "#6f7282" };
  return (
    <span className="inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ backgroundColor: s.bg, color: s.fg }}>
      {metricsPlanLabel(plan, t)}
    </span>
  );
}

function TrendBadge({ value }: { value: number | null }) {
  const locale = useLocale();
  if (value === null) return null;
  const Icon = value > 5 ? ArrowUp : value < -5 ? ArrowDown : Minus;
  const fg = value > 5 ? "#116b2a" : value < -5 ? "#a13a32" : "#9b9fb3";
  return (
    <span className="inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums" style={{ color: fg }}>
      <Icon className="size-3" />
      {value > 0 ? "+" : ""}
      {formatNumber(locale, value)}%
    </span>
  );
}
