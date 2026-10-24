import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import { SERIF } from "@/components/inspector/paper";
import { InspectorVisitForm } from "@/components/inspector/visit-form";
import type { InspectionNorms } from "@/lib/inspection-norms";
import { isInspectionVisitKind } from "@/lib/inspection-visits";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import type { InspectionVisitListItem } from "@/lib/inspection-visits.server";
import type { InspectorChecklistRow } from "@/lib/inspector-portal-extras.server";

/**
 * Дополнительные листы портала проверяющего (2026-10-17): журнал
 * посещений, ППК и ХАССП-план, нормативка, итоги чек-листов, медкнижки.
 * Оформление то же «бумажное», что у описи журналов: заголовки антиквой,
 * тонкие линейки, синие «чернила» ссылок. Только чтение, кроме записи о
 * посещении.
 */

const LINK =
  "text-[#1f3a8a] underline decoration-[#1f3a8a]/30 underline-offset-4 transition-colors duration-150 hover:decoration-[#1f3a8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/35";

function dayRu(ymd: string): string {
  return ymd.split("-").reverse().join(".");
}

type Translate = ReturnType<typeof useTranslations<"inspectorUi.portalSections">>;

function formatLocale(locale: string): string {
  return FORMAT_LOCALES[locale as Locale] ?? FORMAT_LOCALES.ru;
}

function dateTimeRu(iso: string, timeZone: string, locale: string): string {
  return new Date(iso).toLocaleString(formatLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function visitKindLabel(kind: string, note: string | null | undefined, t: Translate): string {
  let label: string = kind;
  if (isInspectionVisitKind(kind)) {
    switch (kind) {
      case "planned": label = t("kindPlanned"); break;
      case "unplanned": label = t("kindUnplanned"); break;
      case "complaint": label = t("kindComplaint"); break;
      default: label = t("kindOther"); break;
    }
  }
  return kind === "other" && note ? `${label}: ${note}` : label;
}

function visitBasisLabel(number: string | null, date: Date | string | null, t: Translate): string {
  const day = date ? (typeof date === "string" ? date : date.toISOString().slice(0, 10)) : null;
  const dateRu = day ? day.split("-").reverse().join(".") : null;
  if (number && dateRu) return t("basisNumberDate", { number, date: dateRu });
  if (number) return t("basisNumber", { number });
  if (dateRu) return t("basisDate", { date: dateRu });
  return "—";
}

function PortalSection({
  id,
  title,
  aside,
  children,
  data,
}: {
  id?: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  data: string;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-6" data-portal-section={data}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#141821] pb-2">
        <h2 className={`${SERIF} text-[22px]`}>{title}</h2>
        {aside ? <span className="text-[13px] tabular-nums text-[#5b6170]">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Под реквизитами: напоминание внести запись о посещении (или отметка, что внесена). */
export function PortalVisitCallout({ last, timeZone }: { last: InspectionVisitListItem | null; timeZone: string }) {
  const t = useTranslations("inspectorUi.portalSections");
  const locale = useLocale();
  return (
    <div
      className="mx-auto mt-6 flex max-w-[620px] flex-col gap-2 border border-[#1f3a8a]/35 bg-[#f6f7fb] px-4 py-3 text-[14px] leading-relaxed text-[#141821] sm:flex-row sm:items-center sm:justify-between"
      data-visit-callout={last ? "done" : "todo"}
    >
      {last ? (
        <span>
          {t("visitRecorded", { dateTime: dateTimeRu(last.visitedAt, timeZone, locale), name: last.inspectorName })}
        </span>
      ) : (
        <span>{t("visitPrompt")}</span>
      )}
      <a href="#visit" className={`${LINK} shrink-0 font-medium`}>
        {last ? t("visitJournal") : t("addRecord")}
      </a>
    </div>
  );
}

export function PortalProductionControl({ token, norms }: { token: string; norms: InspectionNorms }) {
  const t = useTranslations("inspectorUi.portalSections");
  const docs: Array<{ key: "ppk" | "haccp-plan"; title: string }> = [
    { key: "ppk", title: t("docPpk") },
    { key: "haccp-plan", title: t("docHaccpPlan") },
  ];
  const base = `/api/inspector/${token}/production-control`;
  return (
    <PortalSection title={t("productionControl")} aside={t("viewOnly")} data="production-control">
      <ol className="border-t border-[#e3e5ea]">
        {docs.map((doc, index) => {
          const approval = norms.approvals[doc.key];
          const uploaded = norms.uploaded[doc.key];
          return (
            <li
              key={doc.key}
              className="grid grid-cols-[2.25rem_1fr] gap-x-2 border-b border-[#e3e5ea] py-3 sm:grid-cols-[2.5rem_1fr]"
              data-ppk-doc={doc.key}
            >
              <span className="text-right text-[13px] tabular-nums text-[#8a8f9c]">{index + 1}.</span>
              <div className="min-w-0">
                <div className="text-[15px] leading-snug text-[#141821]">{doc.title}</div>
                <div className="mt-0.5 text-[13px] text-[#5b6170]">
                  {approval ? t("approvedVersion", { version: approval.version, date: dayRu(approval.approvedAt) }) : t("assembledFromSections")}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
                  <a href={`${base}/${doc.key}`} target="_blank" rel="noopener" className={LINK}>
                    {t("openPdf")}
                  </a>
                  {uploaded ? (
                    <a href={`${base}/${doc.key}?file=1`} target="_blank" rel="noopener" className={`${LINK} min-w-0 [overflow-wrap:anywhere]`}>
                      {t("signedCopy", { name: uploaded.fileName })}
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </PortalSection>
  );
}

export function PortalNorms({ norms }: { norms: InspectionNorms }) {
  const t = useTranslations("inspectorUi.portalSections");
  return (
    <PortalSection title={t("normsTitle")} aside={`${norms.norms.length}`} data="norms">
      <p className="mt-3 text-[13.5px] text-[#5b6170]">
        {norms.normsSource === "org"
          ? t("normsOrg")
          : t("normsDefault")}
      </p>
      <ol className="mt-2 border-t border-[#e3e5ea]">
        {norms.norms.map((title, index) => (
          <li key={`${index}-${title}`} className="grid grid-cols-[2.25rem_1fr] gap-x-2 border-b border-[#e3e5ea] py-2.5 text-[14.5px] leading-snug sm:grid-cols-[2.5rem_1fr]">
            <span className="text-right text-[13px] tabular-nums text-[#8a8f9c]">{index + 1}.</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
          </li>
        ))}
      </ol>
    </PortalSection>
  );
}

export function PortalChecklists({ rows, total, timeZone }: { rows: InspectorChecklistRow[]; total: number; timeZone: string }) {
  const t = useTranslations("inspectorUi.portalSections");
  const locale = useLocale();
  return (
    <PortalSection title={t("checklistsTitle")} aside={t("checklistsPeriod", { total })} data="checklists">
      {rows.length === 0 ? (
        <p className="mt-3 text-[14px] text-[#5b6170]">{t("checklistsEmpty")}</p>
      ) : (
        <ol className="border-t border-[#e3e5ea]">
          {rows.map((row) => {
            const s = row.summary;
            return (
              <li
                key={row.id}
                className="grid gap-x-4 gap-y-0.5 border-b border-[#e3e5ea] py-2.5 text-[14.5px] sm:grid-cols-[7.5rem_1fr_auto] sm:items-baseline"
                data-checklist-row
              >
                <span className="text-[13px] tabular-nums text-[#8a8f9c]">
                  {new Date(row.completedAt).toLocaleDateString(formatLocale(locale), { timeZone })}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{row.title}</span>
                <span className={`text-[13px] tabular-nums ${s && (s.critical > 0 || s.violations > 0) ? "text-[#a13a32]" : "text-[#5b6170]"}`}>
                  {s
                    ? [
                        s.percent !== null ? `${s.percent}%` : null,
                        t("violations", { count: s.violations }),
                        s.critical > 0 ? t("critical", { count: s.critical }) : null,
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : t("noSummary")}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {total > rows.length ? (
        <p className="mt-2 text-[12.5px] text-[#8a8f9c]">{t("showingLast", { shown: rows.length, total })}</p>
      ) : null}
    </PortalSection>
  );
}

export function PortalMedBooks({ counts }: { counts: { valid: number; expired: number } }) {
  const t = useTranslations("inspectorUi.portalSections");
  return (
    <PortalSection title={t("medBooksTitle")} data="med-books">
      <dl className="mt-3 grid max-w-[420px] grid-cols-2 border border-[#e3e5ea] text-center">
        <div className="border-r border-[#e3e5ea] px-3 py-3">
          <dt className="text-[13px] text-[#5b6170]">{t("medValid")}</dt>
          <dd className={`${SERIF} mt-1 text-[26px] tabular-nums`} data-med-valid>
            {counts.valid}
          </dd>
        </div>
        <div className="px-3 py-3">
          <dt className="text-[13px] text-[#5b6170]">{t("medExpired")}</dt>
          <dd className={`${SERIF} mt-1 text-[26px] tabular-nums ${counts.expired > 0 ? "text-[#a13a32]" : ""}`} data-med-expired>
            {counts.expired}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[12.5px] text-[#8a8f9c]">
        {t("medPrivacy")}
      </p>
    </PortalSection>
  );
}

export function PortalVisitJournal({
  token,
  visits,
  timeZone,
}: {
  token: string;
  visits: InspectionVisitListItem[];
  timeZone: string;
}) {
  const t = useTranslations("inspectorUi.portalSections");
  const locale = useLocale();
  return (
    <PortalSection id="visit" title={t("visitJournal")} data="visits">
      <p className="mt-3 text-[13px] leading-relaxed text-[#5b6170]" data-own-visits-note>
        {t("ownVisitsNote")}
      </p>
      {visits.length > 0 ? (
        <ol className="border-b border-[#e3e5ea]" data-own-visits>
          {visits.map((visit) => (
            <li key={visit.id} className="grid gap-1 border-t border-[#e3e5ea] py-3 text-[14.5px]" data-own-visit>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">
                  {visit.inspectorName}
                  {visit.inspectorPosition ? <span className="font-normal text-[#5b6170]">, {visit.inspectorPosition}</span> : null}
                </span>
                <span className="text-[13px] tabular-nums text-[#8a8f9c]">{dateTimeRu(visit.visitedAt, timeZone, locale)}</span>
              </div>
              <div className="text-[13.5px] text-[#3a3f4c] [overflow-wrap:anywhere]">
                {visit.authority} · {visitKindLabel(visit.kind, visit.kindNote, t)} · {t("basis")}{" "}
                {visitBasisLabel(visit.basisNumber, visit.basisDate, t)}
              </div>
              {visit.files.length > 0 ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13.5px]">
                  {visit.files.map((file, index) => (
                    <a
                      key={file.id}
                      href={`/api/inspector/${token}/visit-files/${file.id}`}
                      target="_blank"
                      rel="noopener"
                      className={`${LINK} min-w-0 [overflow-wrap:anywhere]`}
                    >
                      {t("scan", { index: index + 1, name: file.fileName })}
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] text-[#8a8f9c]">{t("noScan")}</div>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      <h3 className={`${SERIF} mb-3 mt-6 text-[17px]`}>{visits.length > 0 ? t("addAnother") : t("addVisitRecord")}</h3>
      <InspectorVisitForm token={token} />
    </PortalSection>
  );
}
