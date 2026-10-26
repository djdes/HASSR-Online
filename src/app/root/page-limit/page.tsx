import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { FORMAT_LOCALES } from "@/i18n/locales";

import { requireRoot } from "@/lib/auth-helpers";
import { PAGE_NAVIGATION_LIMITS, pageLimitMode } from "@/lib/page-navigation-limit";
import { readPageLimitOverview, type PageLimitCount, type PageLimitOverview } from "@/lib/page-limit-stats.server";

export const dynamic = "force-dynamic";

type Translate = Awaited<ReturnType<typeof getTranslations<"rootPageLimit">>>;
type Dimension = keyof PageLimitOverview["by"];

const DIMENSIONS: Dimension[] = ["subject", "reason", "client", "platform", "request", "metadata", "section"];

const CARD = "overflow-x-auto rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const HEAD = "bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]";

function valueLabel(t: Translate, dimension: Dimension, value: string): string {
  // `raw` returns the whole subtree at runtime; the typed signature only names leaves.
  const raw = t.raw as unknown as (key: string) => Record<string, Record<string, string> | undefined>;
  const labels = raw("values")[dimension];
  return labels?.[value] ?? (dimension === "section" ? `/${value}` : value);
}

/** Ограничитель переходов: сколько страниц открыто и кому показана пауза (429). */
export default async function RootPageLimitPage() {
  await requireRoot();
  const [t, locale, overview] = await Promise.all([getTranslations("rootPageLimit"), getSiteLocale(), readPageLimitOverview(7)]);
  const formatLocale = FORMAT_LOCALES[locale];
  const number = new Intl.NumberFormat(formatLocale);
  const percent = new Intl.NumberFormat(formatLocale, { style: "percent", maximumFractionDigits: 2 });
  const share = (limited: number, passed: number) => (limited + passed ? percent.format(limited / (limited + passed)) : "—");
  const mode = pageLimitMode();
  const visitorCookie = Boolean(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET);
  const limits = PAGE_NAVIGATION_LIMITS;
  const n = (value: number) => number.format(value);
  const settings = [
    mode.off ? t("modeOff") : t("modeOn"),
    t("scale", { scale: n(mode.scale) }),
    t("browserLimit", { burst: n(limits.browser.burst), minute: n(limits.browser.minute) }),
    t("automatedLimit", { burst: n(limits.automated.burst), minute: n(limits.automated.minute) }),
    t("backgroundLimit", { count: n(limits.background) }),
    t("cooldown", { seconds: n(limits.cooldownSeconds) }),
    t("userScale", { scale: n(limits.userScale) }),
    visitorCookie ? t("visitorScale", { scale: n(limits.visitorIpScale) }) : t("visitorOff"),
    t("crawlers"),
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">{t("description")}</p>
      </div>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#0b1024]">{t("settings")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {settings.map((line, index) => (
            <span
              key={line}
              className={`rounded-full px-3 py-1 text-[13px] ${index === 0 && mode.off ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#f5f6ff] text-[#3848c7]"}`}
            >
              {line}
            </span>
          ))}
        </div>
      </section>

      {overview.passed + overview.limited === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center text-[14px] text-[#6f7282]">{t("empty")}</div>
      ) : (
        <>
          <p className="text-[14px] text-[#3c4053]" data-testid="page-limit-summary">
            {t("summary", { passed: n(overview.passed), limited: n(overview.limited), share: share(overview.limited, overview.passed) })}
          </p>
          <div className={CARD}>
            {/* ds-no-scroll: the tables fit a phone; the mobile rule would shrink them to their content. */}
            <table className="ds-no-scroll w-full text-[13.5px]" data-testid="page-limit-days">
              <caption className="px-4 pt-4 text-left text-[15px] font-semibold text-[#0b1024]">{t("byDay")}</caption>
              <thead>
                <tr className={HEAD}>
                  <th className="px-4 py-3">{t("day")}</th>
                  <th className="px-4 py-3 text-right">{t("pages")}</th>
                  <th className="px-4 py-3 text-right">{t("limited")}</th>
                  <th className="px-4 py-3 text-right">{t("share")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.days.map((day) => (
                  <tr key={day.day} className="border-t border-[#ececf4]">
                    <td className="px-4 py-3 text-[#0b1024]">
                      {new Date(`${day.day}T00:00:00Z`).toLocaleDateString(formatLocale, { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" })}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#3c4053]">{number.format(day.passed)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#3c4053]">{number.format(day.limited)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#3c4053]">{share(day.limited, day.passed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {DIMENSIONS.map((dimension) => (
              <BreakdownTable
                key={dimension}
                title={t(`dimensions.${dimension}`)}
                rows={overview.by[dimension]}
                limitedOnly={dimension === "reason" || dimension === "section"}
                label={(value) => valueLabel(t, dimension, value)}
                headings={{ value: t("value"), pages: t("pages"), limited: t("limited"), share: t("share") }}
                number={number}
                share={share}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  limitedOnly,
  label,
  headings,
  number,
  share,
}: {
  title: string;
  rows: PageLimitCount[];
  limitedOnly: boolean;
  label: (value: string) => string;
  headings: { value: string; pages: string; limited: string; share: string };
  number: Intl.NumberFormat;
  share: (limited: number, passed: number) => string;
}) {
  return (
    <div className={CARD}>
      <table className="ds-no-scroll w-full text-[13.5px]">
        <caption className="px-4 pt-4 text-left text-[15px] font-semibold text-[#0b1024]">{title}</caption>
        <thead>
          <tr className={HEAD}>
            <th className="px-4 py-3">{headings.value}</th>
            {limitedOnly ? null : <th className="px-4 py-3 text-right">{headings.pages}</th>}
            <th className="px-4 py-3 text-right">{headings.limited}</th>
            {limitedOnly ? null : <th className="px-4 py-3 text-right">{headings.share}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((row) => (
            <tr key={row.value} className="border-t border-[#ececf4]">
              <td className="px-4 py-3 text-[#0b1024]">{label(row.value)}</td>
              {limitedOnly ? null : <td className="px-4 py-3 text-right tabular-nums text-[#3c4053]">{number.format(row.passed)}</td>}
              <td className="px-4 py-3 text-right tabular-nums text-[#3c4053]">{number.format(row.limited)}</td>
              {limitedOnly ? null : <td className="px-4 py-3 text-right tabular-nums text-[#3c4053]">{share(row.limited, row.passed)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
