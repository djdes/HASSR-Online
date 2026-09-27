import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { sortJournalsByName } from "@/lib/journal-sort";
import {
  parseJournalPeriodsJson,
  resolveJournalPeriodKind,
  type JournalPeriodKind,
} from "@/lib/journal-period";
import { JournalPeriodsClient } from "./journal-periods-client";

export const dynamic = "force-dynamic";

export default async function JournalPeriodsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const orgId = getActiveOrgId(session);

  const [templates, org] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.organization.findUnique({
      where: { id: orgId },
      select: { journalPeriods: true, disabledJournalCodes: true },
    }),
  ]);

  const overrides = parseJournalPeriodsJson(org?.journalPeriods ?? null);

  // Дефолтный kind, если override не задан — для подсказки в UI.
  // Журналы по алфавиту.
  const initial = sortJournalsByName(templates, (t) => t.name).map((t) => {
    const o = overrides[t.code];
    const defaultKind: JournalPeriodKind = resolveJournalPeriodKind(t.code);
    return {
      code: t.code,
      name: t.name,
      defaultKind,
      kind: (o?.kind ?? null) as JournalPeriodKind | null,
      days: o?.days ?? null,
    };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
          Периоды журналов
        </h1>
        <p className="mt-1.5 max-w-[680px] text-[14px] leading-[1.6] text-[#6f7282]">
          Для каждого журнала можно выбрать на какой срок создаётся
          документ. <b>«По N дней»</b> режет окна от 1-го числа месяца:
          например, N=10 → 1–10 / 11–20 / 21–конец. Существующие документы
          не пересоздаются — изменение применится при следующем
          автосоздании или ручном создании. Если не выбрано —
          используется значение по умолчанию (см. подсказки в правом
          столбце).
        </p>
      </div>
      <JournalPeriodsClient initial={initial} />
    </div>
  );
}
