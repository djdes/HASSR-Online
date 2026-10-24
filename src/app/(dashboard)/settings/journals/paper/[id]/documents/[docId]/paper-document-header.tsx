import Link from "next/link";
import { Archive, ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { formatJournalPeriodLabel } from "@/lib/journal-document-title";
import { personFieldLabels } from "@/lib/paper-journal-columns";
import type { PaperJournal } from "@/lib/sphere-journal-rules";

/**
 * Шапка документа бумажного журнала.
 *
 * Своя, а не `document-page-header.tsx` электронных журналов: тот
 * завязан на `JournalDocument` с шаблоном, ответственными по слотам и
 * проверкой, чего у бумажного документа нет. Здесь только то, что
 * выбрали в модалке: название, период, люди и статус.
 */
export async function PaperDocumentHeader({
  journal,
  title,
  period,
  responsible,
  verifier,
  closed,
}: {
  journal: PaperJournal;
  title: string;
  period: { from: string | null; to: string | null };
  responsible: string | null;
  verifier: string | null;
  closed: boolean;
}) {
  const t = await getTranslations("settingsUi.paperDocumentHeader");
  const labels = personFieldLabels(journal);
  const periodLabel = formatJournalPeriodLabel(period.from, period.to);
  const facts = [
    periodLabel ? { label: t("period"), value: periodLabel } : null,
    responsible ? { label: labels.responsible, value: responsible } : null,
    verifier ? { label: labels.verifier, value: verifier } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
      <Link
        href={`/settings/journals/paper/${journal.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024]"
      >
        <ArrowLeft className="size-3.5" />
        {journal.name}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">
          {title}
        </h1>
        {closed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">
            <Archive className="size-3.5" />
            {t("closed")}
          </span>
        ) : null}
      </div>
      {facts.length > 0 ? (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[13.5px]">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-baseline gap-1.5">
              <dt className="text-[#9b9fb3]">{fact.label}:</dt>
              <dd className="font-medium text-[#0b1024]">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
