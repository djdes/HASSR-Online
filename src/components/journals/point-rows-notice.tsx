import Link from "next/link";
import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Документ точки, собранный до разделения журналов по точкам (2026-10-29):
 * в нём оборудование или помещения других точек. Объясняем, что следующий
 * период соберётся по точке, и куда нажать, чтобы поправить сейчас.
 */
export async function PointRowsNotice({ kind, count }: { kind: "equipment" | "rooms"; count: number }) {
  if (count <= 0) return null;
  const t = await getTranslations("journals.pointRowsNotice");
  return (
    <div
      className="mx-auto mb-4 flex max-w-[1200px] gap-3 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] px-4 py-3 text-[13px] leading-[1.55] text-[#3c4053] print:hidden"
      data-point-rows-notice={kind}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
      <div className="min-w-0">
        <div className="font-semibold text-[#0b1024]">
          {kind === "equipment" ? t("equipmentTitle", { count: String(count) }) : t("roomsTitle", { count: String(count) })}
        </div>
        <p className="mt-0.5">{t("body")}</p>
        <Link
          href="/settings/journal-responsibles"
          className="mt-1.5 inline-flex items-center rounded-xl text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
        >
          {t("action")} →
        </Link>
      </div>
    </div>
  );
}
