import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/locales";
import { authOptions } from "@/lib/auth";
import { withDeniedParam } from "@/lib/denied-notice";
import { buildMiniAppAuthBootstrapPath } from "@/lib/journal-obligation-links";
import { loadMiniNetwork, type MiniNetworkRow } from "@/lib/network-mini.server";
import { NETWORK_HREF, formatNetworkDay, formatNetworkRub, type JournalDayStatus } from "@/lib/network-summary";
import { getServerSession } from "@/lib/server-session";

import { MiniNetworkGoButton } from "./network-go-button";

export const dynamic = "force-dynamic";

const JOURNAL_TONE: Record<JournalDayStatus, "ok" | "warn" | "danger" | null> = {
  done: "ok",
  partial: "warn",
  none: "danger",
  empty: null,
  unknown: null,
};

/**
 * «Сеть» в мини-приложении (серия E, Р8): организации аккаунта списком —
 * журналы сегодня, баланс, свои 14 дней и «Перейти». Владельцу аккаунта и
 * управляющему сетью (`loadMiniNetwork`); остальных уводим на главную
 * приложения с пометкой «раздел закрыт». Полная таблица — «Сеть» на сайте.
 */
export default async function MiniNetworkPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect(buildMiniAppAuthBootstrapPath("/mini/network"));
  const view = await loadMiniNetwork(session);
  if (!view) redirect(withDeniedParam("/mini", NETWORK_HREF));

  const [t, locale] = await Promise.all([getTranslations("settingsManagement.network"), getLocale() as Promise<Locale>]);
  const { rows, totals } = view;

  const trialPill = (row: MiniNetworkRow) => {
    if (row.trial.state === "trial") {
      return (
        <span className="mini-pill" style={{ minHeight: 26, fontSize: 13 }}>
          {t("trial.active", { date: formatNetworkDay(row.trial.lastDay, locale) })}
        </span>
      );
    }
    if (row.trial.state === "locked") {
      return (
        <span className="mini-pill" data-tone="danger" style={{ minHeight: 26, fontSize: 13 }}>
          {t("trial.locked")}
        </span>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24" data-mini-network data-mini-stagger>
      <header className="mini-card px-5 py-5">
        <p className="mini-eyebrow">{t("mini.eyebrow")}</p>
        <h1 className="mini-h1 mt-1">{t("mini.title")}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt className="mini-label">{t("totals.balance")}</dt>
            <dd className="mt-1 text-[20px] font-semibold tabular-nums" style={{ color: "var(--mini-text)" }} data-mini-network-balance>
              {formatNetworkRub(totals.balanceRub, locale)}
            </dd>
          </div>
          <div>
            <dt className="mini-label">{t("mini.unfilled")}</dt>
            <dd className="mt-1 text-[20px] font-semibold tabular-nums" style={{ color: "var(--mini-text)" }}>
              {t("totals.unfilledValue", { count: String(totals.withUnfilled), total: String(totals.organizations) })}
            </dd>
          </div>
        </dl>
      </header>

      <ul className="space-y-3">
        {rows.map((row) => {
          const tone = JOURNAL_TONE[row.journalStatus];
          return (
            <li key={row.id} className="mini-card p-4" data-mini-network-org={row.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-words text-[17px] font-semibold" style={{ color: "var(--mini-text)" }}>
                  {row.name}
                </span>
                {row.current ? (
                  <span className="mini-pill" data-tone="accent" style={{ minHeight: 26, fontSize: 13 }}>
                    {t("current")}
                  </span>
                ) : null}
              </div>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-[15px]">
                <dt style={{ color: "var(--mini-text-muted)" }}>{t("columns.journals")}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums" style={{ color: "var(--mini-text)" }}>
                    {row.journals
                      ? t("journals.value", { done: String(row.journals.done), total: String(row.journals.total) })
                      : t("journals.unknown")}
                  </span>
                  <span className="mini-pill" data-tone={tone ?? undefined} style={{ minHeight: 26, fontSize: 13 }}>
                    {t(`journals.status.${row.journalStatus}`)}
                  </span>
                </dd>
                <dt style={{ color: "var(--mini-text-muted)" }}>{t("columns.balance")}</dt>
                <dd className="font-semibold tabular-nums" style={{ color: "var(--mini-text)" }}>
                  {formatNetworkRub(row.balanceRub, locale)}
                </dd>
                {row.trial.state !== "none" ? (
                  <>
                    <dt style={{ color: "var(--mini-text-muted)" }}>{t("columns.trial")}</dt>
                    <dd>{trialPill(row)}</dd>
                  </>
                ) : null}
              </dl>
              {row.canOpen ? (
                <div className="mt-3">
                  <MiniNetworkGoButton organizationId={row.id} current={row.current} label={t("go")} failedLabel={t("goFailed")} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {view.truncated ? (
        <p className="px-1 text-[14px]" style={{ color: "var(--mini-text-muted)" }}>
          {t("truncated", { count: String(rows.length) })}
        </p>
      ) : null}

      <Link href={NETWORK_HREF} className="mini-btn-ghost mini-press w-full" data-mini-network-full>
        {t("mini.full")}
      </Link>
    </div>
  );
}
