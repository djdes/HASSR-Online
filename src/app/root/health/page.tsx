import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { FORMAT_LOCALES } from "@/i18n/locales";


import { requireRoot } from "@/lib/auth-helpers";
import { collectClientHealth, RISK_LABEL, type RiskFlag } from "@/lib/root-health";

export const dynamic = "force-dynamic";

const FLAG_TONE: Record<RiskFlag["key"], string> = {
  "no-entries": "bg-[#fff4f2] text-[#a13a32]",
  "never-started": "bg-[#fff4f2] text-[#a13a32]",
  subscription: "bg-[#fff8eb] text-[#b25f00]",
  incidents: "bg-[#fff8eb] text-[#b25f00]",
  "no-telegram": "bg-[#f5f6ff] text-[#3848c7]",
  solo: "bg-[#f4f4f7] text-[#6f7282]",
};

function ago(date: Date | null, now: Date, t: Awaited<ReturnType<typeof getTranslations<"rootHealthAudit.health">>>): string {
  if (!date) return t("never");
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  return days === 0 ? t("today") : t("daysAgo", { days });
}

/** Здоровье клиентов: кто на грани ухода, с чего начать разговор. */
export default async function RootHealthPage() {
  await requireRoot();
  const now = new Date();
  const [t, locale] = await Promise.all([getTranslations("rootHealthAudit.health"), getSiteLocale()]);
  const rows = await collectClientHealth(now);
  const risky = rows.filter((r) => r.flags.length > 0);
  const counts = new Map<RiskFlag["key"], number>();
  for (const r of risky) for (const f of r.flags) counts.set(f.key, (counts.get(f.key) ?? 0) + 1);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
          {t("description")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] text-[#3848c7]">{t("organizationSummary", { total: rows.length, risky: risky.length })}</span>
        {(Object.keys(RISK_LABEL) as RiskFlag["key"][]).filter((k) => counts.get(k)).map((k) => (
          <span key={k} className={`rounded-full px-3 py-1 text-[13px] ${FLAG_TONE[k]}`}>
            {t("riskSummary", { label: t(`risks.${k}`), count: counts.get(k) ?? 0 })}
          </span>
        ))}
      </div>
      {risky.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center text-[14px] text-[#116b2a]">{t("empty")}</div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full min-w-[820px] text-[13.5px]" data-testid="health-table">
            <thead>
              <tr className="bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                <th className="px-4 py-3">{t("organization")}</th>
                <th className="px-4 py-3">{t("lastEntry")}</th>
                <th className="px-4 py-3">{t("subscription")}</th>
                <th className="px-4 py-3">{t("people")}</th>
                <th className="px-4 py-3">{t("risksHeading")}</th>
              </tr>
            </thead>
            <tbody>
              {risky.map((r) => (
                <tr key={r.id} className="border-t border-[#ececf4] align-top">
                  <td className="px-4 py-3">
                    <Link href={`/root/organizations/${r.id}`} className="font-medium text-[#0b1024] underline-offset-2 hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-[12px] text-[#9b9fb3]">{t("registeredSince", { date: r.createdAt.toLocaleDateString(FORMAT_LOCALES[locale]) })}</div>
                  </td>
                  <td className="px-4 py-3 text-[#3c4053]">{ago(r.lastEntryAt, now, t)}</td>
                  <td className="px-4 py-3 text-[#3c4053]">
                    {r.subscriptionPlan ?? "—"}
                    {r.subscriptionEnd ? <div className="text-[12px] text-[#9b9fb3]">{t("validUntil", { date: r.subscriptionEnd.toLocaleDateString(FORMAT_LOCALES[locale]) })}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-[#3c4053]">
                    {t("peopleSummary", { active: r.activeUsers, telegram: r.managersWithTelegram })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {r.flags.map((f) => (
                        <span key={f.key} className={`rounded-full px-2.5 py-0.5 text-[12px] ${FLAG_TONE[f.key]}`}>
                          {t(`risks.${f.key}`)}
                        </span>
                      ))}
                    </div>
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
