import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { PaperJournal } from "@/lib/sphere-journal-rules";

/**
 * Карточка-интро бумажного журнала: бейдж, зачем он нужен, штраф и
 * ссылка на норму. Живёт на странице списка; на странице документа
 * она не нужна — там человек уже знает, что заполняет.
 */
export async function PaperJournalIntro({ journal }: { journal: PaperJournal }) {
  const t = await getTranslations("settingsUi.journalsSettingsClient");
  return (
    <section className="rounded-3xl border border-[#ffd9d0] bg-[#fff8f6] p-5 sm:p-6">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${
          journal.paperOnly
            ? "bg-[#fff4f2] text-[#a13a32]"
            : "bg-[#fff1d6] text-[#b45309]"
        }`}
      >
        {journal.paperOnly ? t("paperOnly") : t("paperForPrint")}
      </span>
      <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">
        {journal.name}
      </h1>
      <p className="mt-2 max-w-[720px] text-[14px] leading-relaxed text-[#6f7282]">
        {t("paperCardHint", { why: journal.why, fine: journal.fineHint })}{" "}
        <a
          href={journal.law.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-[#5566f6] hover:underline"
        >
          {journal.law.label}
          <ExternalLink className="size-3" />
        </a>
      </p>
    </section>
  );
}
