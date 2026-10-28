import Link from "next/link";
import { useTranslations } from "next-intl";
import { QrCode } from "lucide-react";

const OUTLINE =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * «QR-наклейки · Плакаты А4 · Таблички» оборудования — на «Оборудовании» и
 * на «Цехах и участках» (скан 98, 2026-10-28: кнопки дорисованы ручкой).
 * Печатают то, что отмечено в фильтре по местам над списком (2026-10-28):
 * `point` — точка или офис (их оборудование и цехов без точки, как в
 * списке), `all` — всё, `none` — только цеха без точки. Без него экран QR
 * берёт точку из шапки (`loadQrPostersView`). Таблички нумеруются по цехам.
 * Без хуков состояния — рисуют серверные страницы.
 */
export function EquipmentQrButtons({ point = null }: { point?: string | null } = {}) {
  const t = useTranslations("settingsUi.equipmentPage");
  const scope = point ? `&point=${encodeURIComponent(point)}` : "";
  return (
    <>
      <Link
        href={`/settings/qr-posters?kind=equipment&layout=sheet${scope}`}
        className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6]/[0.06] px-4 text-[14px] font-semibold text-[#3848c7] transition-colors duration-150 hover:bg-[#5566f6]/[0.12] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        title={t("stickersHint")}
        data-equipment-qr="stickers"
      >
        <QrCode className="size-4" />
        {t("stickers")}
      </Link>
      <Link href={`/settings/qr-posters?kind=equipment${scope}`} className={OUTLINE} title={t("postersHint")} data-equipment-qr="posters">
        <QrCode className="size-4 text-[#5566f6]" />
        {t("posters")}
      </Link>
      <Link
        href={`/settings/qr-posters?kind=equipment&layout=plate${scope}`}
        className={OUTLINE}
        title={t("platesHint")}
        data-equipment-qr="plates"
      >
        <QrCode className="size-4 text-[#5566f6]" />
        {t("plates")}
      </Link>
    </>
  );
}
