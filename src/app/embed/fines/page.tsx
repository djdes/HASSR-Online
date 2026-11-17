import type { Metadata } from "next";

import { FinesCalculator } from "@/app/calc/fines/fines-calculator";
import { EmbedShell } from "@/components/public/embed-shell";

export const metadata: Metadata = {
  title: "Калькулятор штрафов Роспотребнадзора",
  // Встраиваемая копия: в выдаче должна быть только полная страница /calc/fines.
  robots: { index: false, follow: true },
  alternates: { canonical: "https://wesetup.ru/calc/fines" },
};

export default function EmbedFinesPage() {
  return (
    <EmbedShell
      title="Калькулятор штрафов Роспотребнадзора для общепита"
      href="https://wesetup.ru/calc/fines?utm_source=embed&utm_medium=widget&utm_campaign=calc_fines"
      linkLabel="Калькулятор штрафов — WeSetup, электронные журналы СанПиН и ХАССП"
    >
      <FinesCalculator />
    </EmbedShell>
  );
}
