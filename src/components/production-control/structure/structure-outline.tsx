import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { PpkStatus } from "@/lib/ppk/status";
import { PPK_STRUCTURE, ppkItemHref, type PpkStructureItem } from "@/lib/ppk/structure";
import { PpkStatusDot } from "@/components/production-control/ppk-status-dot";

/**
 * Структура «Электронной программы производственного контроля» как в
 * документе: разделы 1–3 и «Приложения», у пункта — номер, название-ссылка и
 * точка статуса. Ссылка открывает окно пункта поверх обзора (`@modal`).
 */
export async function PpkStructureOutline({ statuses }: { statuses: Record<string, PpkStatus> }) {
  const t = await getTranslations("productionControl.structure");
  const title = (item: PpkStructureItem) => t(`items.${item.id}.title`);

  return (
    <section aria-labelledby="ppk-structure-title" className="space-y-3" data-ppk-structure>
      <h2 id="ppk-structure-title" className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">
        {t("title")}
      </h2>
      <div className="space-y-4">
        {PPK_STRUCTURE.map((section) => (
          <div key={section.key} className="rounded-3xl bg-white p-4 sm:p-5" data-ppk-section={section.key}>
            <h3 className="flex items-baseline gap-2 px-2 text-[16px] leading-snug font-semibold text-[#0b1024]">
              {section.number ? <span className="tabular-nums">{section.number}.</span> : null}
              <span className="min-w-0">{t(`sections.${section.key}`)}</span>
            </h3>
            <ol className="mt-2">
              {section.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={ppkItemHref(item.id)}
                    scroll={false}
                    prefetch={false}
                    data-ppk-item={item.id}
                    className="group flex min-h-[44px] items-start gap-3 rounded-xl px-2 py-2.5 text-[14.5px] leading-snug transition-colors duration-150 hover:bg-[var(--app-veil)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  >
                    <span
                      className={
                        section.key === "appendix"
                          ? "shrink-0 pt-px text-[13.5px] whitespace-nowrap tabular-nums text-[#6f7282]"
                          : "w-10 shrink-0 pt-px text-[13.5px] tabular-nums text-[#6f7282]"
                      }
                    >
                      {section.key === "appendix" ? t("appendixNumber", { n: item.number }) : item.number}
                    </span>
                    <span className="min-w-0 flex-1 text-[#3848c7] underline-offset-[3px] group-hover:underline">
                      {section.key === "appendix" ? `«${title(item)}»` : title(item)}
                    </span>
                    <PpkStatusDot status={statuses[item.id] ?? "empty"} className="mt-1.5" />
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
