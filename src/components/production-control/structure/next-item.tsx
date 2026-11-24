import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { ppkItemHref, type PpkStructureItem } from "@/lib/ppk/structure";

/** «Следующий пункт»: первый незаполненный пункт структуры — открывается окном. */
export async function PpkNextItem({ item }: { item: PpkStructureItem }) {
  const t = await getTranslations("productionControl.structure");
  const number = item.section === "appendix" ? t("appendixNumber", { n: item.number }) : item.number;
  return (
    <section
      data-ppk-next-item={item.id}
      className="flex flex-col gap-3 rounded-3xl bg-[#f5f6ff] p-5 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          {t("nextItem", { item: `${number} ${t(`items.${item.id}.title`)}` })}
        </h2>
        <p className="mt-0.5 text-[13.5px] text-[#6f7282]">{t(`items.${item.id}.source`)}</p>
      </div>
      <Link
        href={ppkItemHref(item.id)}
        scroll={false}
        prefetch={false}
        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        {t("fill")}
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
