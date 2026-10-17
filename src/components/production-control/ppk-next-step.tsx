import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ppkBlock, ppkBlockHref, type PpkBlockKey } from "@/lib/ppk/registry";
import { PPK_ICONS } from "./ppk-icons";

/** Карточка «Следующий шаг»: что сделать дальше и одна кнопка, чтобы перейти. */
export async function PpkNextStep({ blockKey }: { blockKey: PpkBlockKey }) {
  const t = await getTranslations("productionControl");
  const nav = await getTranslations("navigation");
  const block = ppkBlock(blockKey);
  const Icon = PPK_ICONS[block.icon];
  return (
    <section
      data-ppk-next-step={blockKey}
      className="flex flex-col gap-4 rounded-3xl border border-[#5566f6]/15 bg-[#f5f6ff] p-5 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#5566f6]">
          {Icon ? <Icon className="size-5" aria-hidden /> : null}
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {t("nextStep", { block: nav(`shell.items.${blockKey}`) })}
          </h2>
          <p className="mt-0.5 text-[13.5px] text-[#6f7282]">{t(`blocks.${blockKey}.hint`)}</p>
        </div>
      </div>
      <Link
        href={ppkBlockHref(block)}
        className="inline-flex h-11 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        {t("open")}
      </Link>
    </section>
  );
}
