import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { navAllows, type NavActor, type NavFacts } from "@/lib/app-nav";
import { customSectionNameByHref, type CustomNames } from "@/lib/custom-names";
import {
  settingsCardGroups,
  settingsCardsFor,
  type SettingsCardSection,
} from "@/lib/settings-cards";
import { NavIconChip } from "@/components/layout/nav-icons";
import { LinkPendingOverlay } from "@/components/ui/link-pending";
import { automationOn, type JournalControls } from "@/lib/journal-controls";

/**
 * Карточки настроек раздела — бывший хаб `/settings`, разложенный по
 * разделам меню. Показываем только то, что человек откроет: правило
 * карточки повторяет guard её страницы.
 */
export async function SettingsCardGrid({
  section,
  actor,
  facts,
  customNames,
  controls = null,
}: {
  section: SettingsCardSection;
  actor: NavActor;
  facts: NavFacts;
  customNames: CustomNames | null;
  /** Спецрежим: карточки автоматики видны только по своей галочке. */
  controls?: JournalControls | null;
}) {
  const tCards = await getTranslations("settingsManagement.home.cards");
  const tGroups = await getTranslations("navigation.shell.groups");
  const groups = settingsCardGroups(section)
    .map((group) => ({
      group,
      cards: settingsCardsFor(section, group).filter(
        (card) =>
          navAllows(actor, card.href, card.access, facts) &&
          (!card.requiresAutomation || (controls !== null && automationOn(controls, card.requiresAutomation))),
      ),
    }))
    .filter((entry) => entry.cards.length > 0);
  // Одна группа — без заголовка: раздел и так назван вкладкой.
  const titled = groups.length > 1;

  return (
    <div className="space-y-6">
      {groups.map(({ group, cards }) => (
        <section key={group} className="space-y-3" data-settings-group={group}>
          {titled ? (
            <h2 className="px-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {tGroups(group)}
            </h2>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
              const title =
                customSectionNameByHref(customNames, card.href) ?? tCards(`${card.id}.title`);
              return (
                <Link
                  key={card.href}
                  href={card.href}
                  data-settings-card={card.id}
                  data-nav-row
                  className="group relative overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <div className="flex h-full items-start gap-4 rounded-2xl border border-[#ececf4] bg-white px-5 py-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all duration-150 hover:border-[#d6d9ee] hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]">
                    <NavIconChip name={card.icon} className="size-10 rounded-xl" iconClassName="size-5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[15px] font-semibold text-[#0b1024]">{title}</div>
                        <ArrowRight className="size-4 shrink-0 text-[#c7ccea] transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-[#5566f6]" />
                      </div>
                      <div className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">
                        {tCards(`${card.id}.description`)}
                      </div>
                    </div>
                  </div>
                  <LinkPendingOverlay />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
