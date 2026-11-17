import type { Metadata } from "next";

import { JournalsCalculator } from "@/app/calc/journals/journals-calculator";
import { EmbedShell } from "@/components/public/embed-shell";
import { JOURNAL_INFO } from "@/content/journal-info";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";

export const metadata: Metadata = {
  title: "Подбор журналов для заведения",
  // Встраиваемая копия: в выдаче должна быть только полная страница /calc/journals.
  robots: { index: false, follow: true },
  alternates: { canonical: "https://wesetup.ru/calc/journals" },
};

export default function EmbedJournalsPage() {
  const names: Record<string, string> = {};
  for (const j of ACTIVE_JOURNAL_CATALOG) names[j.code] = j.name;
  for (const code of Object.keys(JOURNAL_INFO)) if (!names[code]) names[code] = JOURNAL_INFO[code].tagline;
  return (
    <EmbedShell
      title="Какие журналы нужны заведению"
      href="https://wesetup.ru/calc/journals?utm_source=embed&utm_medium=widget&utm_campaign=calc_journals"
      linkLabel="Подбор журналов — WeSetup, электронные журналы СанПиН и ХАССП"
    >
      <JournalsCalculator names={names} />
    </EmbedShell>
  );
}
