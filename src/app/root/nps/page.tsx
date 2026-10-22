import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getSiteLocale } from "@/i18n/site-locale-server";
import type { Locale } from "@/i18n/locales";
import {
  NPS_RECOMMEND_AUDIT_ACTION,
  NPS_RECOMMEND_AUDIT_ENTITY,
  computeNpsReport,
  normalizeNpsScale,
  npsCategory,
  type NpsCategory,
  type NpsReport,
  type NpsScaleReport,
} from "@/lib/nps";
import { npsResponsesWithReview } from "@/lib/nps-review";
import { formatNpsTimestamp } from "./nps-presentation";

export const dynamic = "force-dynamic";

const BADGE_TONE: Record<NpsCategory, string> = {
  promoter: "bg-[#ecfdf5] text-[#116b2a]",
  passive: "bg-[#fff8eb] text-[#b25f00]",
  detractor: "bg-[#fff4f2] text-[#a13a32]",
};

const BAR_TONE: Record<NpsCategory, string> = {
  promoter: "bg-[#116b2a]/60",
  passive: "bg-[#b25f00]/45",
  detractor: "bg-[#a13a32]/55",
};

type NpsTranslator = Awaited<ReturnType<typeof getTranslations<"rootNps">>>;

/** Distribution for one NPS scale; values and geometry are the report's raw values. */
function ScaleBlock({ title, hint, report, t }: { title: string; hint: string; report: NpsScaleReport; t: NpsTranslator }) {
  const peak = Math.max(1, ...report.distribution.map((bar) => bar.count));
  const nps = report.nps === null ? "—" : report.nps;
  const stats = report.average === null
    ? t.rich("scale.stats", { metric: (chunks) => <span className="font-semibold text-[#0b1024]" data-testid={`nps-scale-${report.scale}-value`}>{chunks}</span>, nps: String(nps), total: String(report.total) })
    : t.rich("scale.statsWithAverage", { metric: (chunks) => <span className="font-semibold text-[#0b1024]" data-testid={`nps-scale-${report.scale}-value`}>{chunks}</span>, nps: String(nps), total: String(report.total), average: String(report.average) });

  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-testid={`nps-scale-${report.scale}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="text-[14px] font-semibold text-[#0b1024]">{title}</div>
        <div className="text-[13px] tabular-nums text-[#6f7282]">{stats}</div>
      </div>
      <div className="mt-0.5 text-[12px] text-[#9b9fb3]">{hint}</div>
      {report.total === 0 ? (
        <p className="mt-3 text-[13px] text-[#6f7282]">{t("scale.empty")}</p>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-1.5" aria-label={t("scale.distributionAria", { scale: report.scale === 5 ? "1–5" : "0–10" })}>
            {report.distribution.map((bar) => (
              <div key={bar.score} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div className="text-[11px] tabular-nums text-[#6f7282]">{bar.count}</div>
                <div
                  className={`w-full rounded-md ${bar.count > 0 ? BAR_TONE[bar.category] : "bg-[#ececf4]"}`}
                  style={{ height: `${Math.max(4, Math.round((bar.count / peak) * 48))}px` }}
                />
                <div className="text-[12px] font-medium tabular-nums text-[#3c4053]">{bar.score}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[12px] tabular-nums text-[#6f7282]">
            {t("scale.categoryStats", { promoters: String(report.promoters), passives: String(report.passives), detractors: String(report.detractors) })}
          </div>
        </>
      )}
    </div>
  );
}

function PeriodCard({ label, report, t }: { label: string; report: NpsReport; t: NpsTranslator }) {
  const overall = report.overall;
  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{label}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-[40px] font-semibold tabular-nums" data-testid="nps-value">{overall.nps === null ? "—" : overall.nps}</div>
        <div className="text-[13px] text-[#6f7282]">
          {t("overall.stats", { total: String(overall.total), promoters: String(overall.promoters), passives: String(overall.passives), detractors: String(overall.detractors) })}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <ScaleBlock title={t("scale.fiveTitle")} hint={t("scale.fiveHint")} report={report.scale5} t={t} />
        <ScaleBlock title={t("scale.tenTitle")} hint={t("scale.tenHint")} report={report.scale10} t={t} />
      </div>
    </section>
  );
}

/** ROOT-only NPS report. Query shapes, report calculation, and raw customer content stay unchanged. */
export async function generateMetadata() {
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "rootNps" });
  return { title: t("metadata.title"), description: t("heading.description"), robots: { index: false, follow: false } };
}

export default async function RootNpsPage() {
  await requireRoot();
  const now = new Date();
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const queryPromise = Promise.all([
    db.npsResponse.findMany({ where: { createdAt: { gte: since } }, select: { score: true, scale: true } }),
    db.npsResponse.findMany({ select: { score: true, scale: true } }),
    db.npsResponse.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const locale: Locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "rootNps" });
  const [recent, all, latest] = await queryPromise;
  const orgIds = Array.from(new Set(latest.map((r) => r.organizationId)));
  const [orgs, recommendations, reviewed] = await Promise.all([
    orgIds.length ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    latest.length
      ? db.auditLog.findMany({
          where: { entity: NPS_RECOMMEND_AUDIT_ENTITY, action: NPS_RECOMMEND_AUDIT_ACTION, entityId: { in: latest.map((r) => r.id) } },
          select: { entityId: true },
        })
      : Promise.resolve([]),
    npsResponsesWithReview(latest.map((r) => r.id)),
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const recommendedCount = new Map<string, number>();
  for (const row of recommendations) {
    if (row.entityId) recommendedCount.set(row.entityId, (recommendedCount.get(row.entityId) ?? 0) + 1);
  }

  return (
    <DomainMessagesBoundary namespaces={["rootNps"]}>
      <div className="space-y-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("heading.title")}</h1>
          <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">{t("heading.description")}</p>
          <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-[#6f7282]">
            {t.rich("heading.preview", {
              dashboard: (chunks) => <code className="rounded-md bg-[#f5f6ff] px-1.5 py-0.5 text-[12px] text-[#3848c7]">{chunks}</code>,
              mini: (chunks) => <code className="rounded-md bg-[#f5f6ff] px-1.5 py-0.5 text-[12px] text-[#3848c7]">{chunks}</code>,
            })}
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <PeriodCard label={t("period.recent")} report={computeNpsReport(recent)} t={t} />
          <PeriodCard label={t("period.all")} report={computeNpsReport(all)} t={t} />
        </div>
        {latest.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center text-[14px] text-[#6f7282]">{t("empty.all")}</div>
        ) : (
          <ul className="space-y-2">
            {latest.map((r) => {
              const scale = normalizeNpsScale(r.scale);
              const sent = recommendedCount.get(r.id) ?? 0;
              const timestamp = formatNpsTimestamp(r.createdAt, locale, t("timestamp.invalid"));
              return (
                <li key={r.id} className="flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-3">
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums ${BADGE_TONE[npsCategory(r.score, scale)]}`}>
                    {t.rich("response.scoreBadge", {
                      strong: (chunks) => chunks,
                      muted: (chunks) => <span className="font-normal opacity-70">{chunks}</span>,
                      score: String(r.score),
                      scale: String(scale),
                    })}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] text-[#6f7282]">
                      {orgName.get(r.organizationId) ?? r.organizationId} · {timestamp}
                      {sent > 0 ? (
                        <span className="ml-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#3848c7]">
                          {sent === 1 ? t("response.recommendationSingle") : t("response.recommendationMany", { count: String(sent) })}
                        </span>
                      ) : null}
                      {reviewed.has(r.id) ? (
                        <Link
                          href="/root/reviews"
                          className="ml-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#3848c7] transition-colors hover:bg-[#eef1ff]"
                          title={t("response.reviewTitle")}
                          data-testid="nps-review-left"
                        >
                          {t("response.reviewLink")}
                        </Link>
                      ) : null}
                    </div>
                    {r.comment ? <p className="mt-1 text-[14px] leading-relaxed text-[#0b1024]">{r.comment}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DomainMessagesBoundary>
  );
}
