import type { ReactNode } from "react";

import { SERIF } from "@/components/inspector/paper";
import { InspectorVisitForm } from "@/components/inspector/visit-form";
import type { InspectionNorms } from "@/lib/inspection-norms";
import { inspectionVisitBasisRu, inspectionVisitKindLabelRu } from "@/lib/inspection-visits";
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

function dateTimeRu(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
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
  return (
    <div
      className="mx-auto mt-6 flex max-w-[620px] flex-col gap-2 border border-[#1f3a8a]/35 bg-[#f6f7fb] px-4 py-3 text-[14px] leading-relaxed text-[#141821] sm:flex-row sm:items-center sm:justify-between"
      data-visit-callout={last ? "done" : "todo"}
    >
      {last ? (
        <span>
          Запись о посещении внесена {dateTimeRu(last.visitedAt, timeZone)}: {last.inspectorName}.
        </span>
      ) : (
        <span>Пожалуйста, внесите запись о посещении и приложите скан или фото решения (распоряжения) о проверке.</span>
      )}
      <a href="#visit" className={`${LINK} shrink-0 font-medium`}>
        {last ? "Журнал посещений" : "Внести запись"}
      </a>
    </div>
  );
}

const DOCS: Array<{ key: "ppk" | "haccp-plan"; title: string }> = [
  { key: "ppk", title: "Программа производственного контроля (ППК)" },
  { key: "haccp-plan", title: "План ХАССП" },
];

export function PortalProductionControl({ token, norms }: { token: string; norms: InspectionNorms }) {
  const base = `/api/inspector/${token}/production-control`;
  return (
    <PortalSection title="Производственный контроль" aside="только просмотр" data="production-control">
      <ol className="border-t border-[#e3e5ea]">
        {DOCS.map((doc, index) => {
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
                  {approval ? `Утверждена версия ${approval.version} от ${dayRu(approval.approvedAt)}` : "Собрана из разделов электронного ППК"}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
                  <a href={`${base}/${doc.key}`} target="_blank" rel="noopener" className={LINK}>
                    Открыть PDF
                  </a>
                  {uploaded ? (
                    <a href={`${base}/${doc.key}?file=1`} target="_blank" rel="noopener" className={`${LINK} min-w-0 [overflow-wrap:anywhere]`}>
                      Подписанный экземпляр: {uploaded.fileName}
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
  return (
    <PortalSection title="Нормативные документы" aside={`${norms.norms.length}`} data="norms">
      <p className="mt-3 text-[13.5px] text-[#5b6170]">
        {norms.normsSource === "org"
          ? "Документы, по которым организация ведёт производственный контроль."
          : "Основные документы, по которым ведётся производственный контроль на предприятиях питания."}
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
  return (
    <PortalSection title="Внутренние проверки по чек-листам" aside={`за период: ${total}`} data="checklists">
      {rows.length === 0 ? (
        <p className="mt-3 text-[14px] text-[#5b6170]">За выбранный период проверок по чек-листам не проводилось.</p>
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
                  {new Date(row.completedAt).toLocaleDateString("ru-RU", { timeZone })}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{row.title}</span>
                <span className={`text-[13px] tabular-nums ${s && (s.critical > 0 || s.violations > 0) ? "text-[#a13a32]" : "text-[#5b6170]"}`}>
                  {s
                    ? [
                        s.percent !== null ? `${s.percent}%` : null,
                        `нарушений: ${s.violations}`,
                        s.critical > 0 ? `критических: ${s.critical}` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : "итог не записан"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {total > rows.length ? (
        <p className="mt-2 text-[12.5px] text-[#8a8f9c]">Показаны последние {rows.length} из {total}.</p>
      ) : null}
    </PortalSection>
  );
}

export function PortalMedBooks({ counts }: { counts: { valid: number; expired: number } }) {
  return (
    <PortalSection title="Личные медицинские книжки" data="med-books">
      <dl className="mt-3 grid max-w-[420px] grid-cols-2 border border-[#e3e5ea] text-center">
        <div className="border-r border-[#e3e5ea] px-3 py-3">
          <dt className="text-[13px] text-[#5b6170]">Действуют</dt>
          <dd className={`${SERIF} mt-1 text-[26px] tabular-nums`} data-med-valid>
            {counts.valid}
          </dd>
        </div>
        <div className="px-3 py-3">
          <dt className="text-[13px] text-[#5b6170]">Просрочены</dt>
          <dd className={`${SERIF} mt-1 text-[26px] tabular-nums ${counts.expired > 0 ? "text-[#a13a32]" : ""}`} data-med-expired>
            {counts.expired}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[12.5px] text-[#8a8f9c]">
        Сведения о конкретных сотрудниках здесь не показываются (152-ФЗ) — их предъявит руководство организации.
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
  return (
    <PortalSection id="visit" title="Журнал посещений" data="visits">
      <p className="mt-3 text-[13px] leading-relaxed text-[#5b6170]" data-own-visits-note>
        Здесь видны записи, внесённые с этого устройства. Все записи журнала посещений видит руководство организации.
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
                <span className="text-[13px] tabular-nums text-[#8a8f9c]">{dateTimeRu(visit.visitedAt, timeZone)}</span>
              </div>
              <div className="text-[13.5px] text-[#3a3f4c] [overflow-wrap:anywhere]">
                {visit.authority} · {inspectionVisitKindLabelRu(visit.kind, visit.kindNote)} · основание:{" "}
                {inspectionVisitBasisRu(visit.basisNumber, visit.basisDate)}
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
                      Скан {index + 1}: {file.fileName}
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] text-[#8a8f9c]">Скан основания не приложен</div>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      <h3 className={`${SERIF} mb-3 mt-6 text-[17px]`}>{visits.length > 0 ? "Внести ещё одну запись" : "Внести запись о посещении"}</h3>
      <InspectorVisitForm token={token} />
    </PortalSection>
  );
}
