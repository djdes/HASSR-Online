import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { loadAdCampaignReport } from "@/lib/ad-campaign.server";
import { AD_CAMPAIGN_ERID } from "@/lib/ad-campaign";

/** Mounted only within the authenticated /root/funnel page. */
export async function AdCampaignReport() {
  const [t, locale] = await Promise.all([getTranslations("rootAdCampaign"), getLocale()]);
  let report: Awaited<ReturnType<typeof loadAdCampaignReport>>;
  try { report = await loadAdCampaignReport(); }
  catch { return <section className="rounded-2xl bg-white p-5"><h2 className="font-semibold">{t("title")}</h2><p className="mt-2 text-sm text-[#6f7282]">{t("unavailable")}</p></section>; }
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Moscow" }).format(value);
  const metrics = [
    [t("views"), report.views], [t("visitors"), report.visitors],
    [t("registrations"), report.registrations],
    [t("conversion"), report.conversion === null ? "—" : `${report.conversion.toLocaleString(locale)} %`],
  ];
  return (
    <section className="space-y-4 rounded-2xl bg-white p-5" data-testid="ad-campaign-report">
      <div><h2 className="text-lg font-semibold text-[#0b1024]">{t("title")}</h2>
        <p className="mt-1 text-sm text-[#6f7282]">{t("description")}</p>
        <p className="mt-2 break-all text-xs text-[#6f7282]">/akciya · erid: {AD_CAMPAIGN_ERID}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map(([label, value]) => <div key={label} className="rounded-xl bg-[var(--app-veil)] p-4">
          <div className="text-sm text-[#6f7282]">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        </div>)}
      </div>
      <p className="text-xs leading-relaxed text-[#6f7282]">{report.since ? t("since", { date: date(report.since) }) : t("notStarted")} {t("limitations")}</p>
      <h3 className="font-medium">{t("recent")}</h3>
      {report.organizations.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr><th className="py-2 font-medium">{t("organization")}</th><th className="py-2 font-medium">{t("registeredAt")}</th></tr></thead>
        <tbody>{report.organizations.map((org) => <tr key={org.id}>
          <td className="py-2"><Link href={`/root/organizations/${org.id}`} className="underline underline-offset-4">{org.name}</Link></td>
          <td className="py-2 text-[#6f7282]">{date(org.createdAt)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="text-sm text-[#6f7282]">{t("empty")}</p>}
    </section>
  );
}
