import { redirect } from "next/navigation";
import { Coins } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { sortJournalsByName } from "@/lib/journal-sort";
import { JournalBonusesEditor } from "@/components/settings/journal-bonuses-editor";

export const dynamic = "force-dynamic";

const NO_BONUS_DEFAULT_CODES = new Set([
  "hygiene",
  "health_check",
  "med_books",
]);

/**
 * Журнальные премии. Один screen — все шаблоны, у каждого свой ввод
 * для рублёвой суммы. Источник истины — `JournalTemplate.bonusAmountKopecks`,
 * глобальный для всех орг (как и остальные настройки шаблона).
 *
 * Дефолты для новых организаций:
 *   • hygiene / health_check / med_books — 0 ₽ (личные журналы, бонус
 *     демотивирует ответственность)
 *   • прочее — 0 ₽ по умолчанию (менеджер сам ставит уместные суммы)
 *
 * Бейдж «обычно без премии» — мягкая подсказка, не запрет: если орг
 * хочет — можно поставить бонус и на гигиену.
 */
export default async function JournalBonusesPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");

  const codes = ACTIVE_JOURNAL_CATALOG.map((j) => j.code);
  const templates = await db.journalTemplate.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, bonusAmountKopecks: true },
  });
  const bonusByCode = new Map(
    templates.map((t) => [t.code, t.bonusAmountKopecks])
  );

  // Журналы по алфавиту.
  const items = sortJournalsByName(ACTIVE_JOURNAL_CATALOG, (j) => j.name).map((j) => ({
    code: j.code,
    name: j.name,
    bonusKopecks: bonusByCode.get(j.code) ?? 0,
    suggestNoBonus: NO_BONUS_DEFAULT_CODES.has(j.code),
  }));

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#fde68a] to-[#fbbf24] text-[#7c2d12] shadow-[0_8px_24px_-12px_rgba(217,119,6,0.5)]">
            <Coins className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024] dark:text-white">
              Премии за журналы
            </h1>
            <p className="mt-1.5 max-w-[720px] text-[14px] leading-relaxed text-[#6f7282] dark:text-white/70">
              Сумма, которую сотрудник получает на счёт «Дополнительной
              премии» в TasksFlow за выполнение «единичного» журнала за
              день. Видна работнику прямо на карточке задачи и
              стимулирует «забрать» работу первым. Если поставить 0 —
              бонус не начисляется.
            </p>
          </div>
        </div>
      </div>

      <JournalBonusesEditor items={items} />
    </div>
  );
}
