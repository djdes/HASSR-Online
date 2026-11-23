import { useTranslations } from "next-intl";
import { QrActions } from "@/components/layout/qr-actions";

/**
 * «QR-наклейки · Плакаты А4 · Таблички» оборудования — на «Оборудовании» и
 * на «Цехах и участках» (скан 98, 2026-10-28: кнопки дорисованы ручкой).
 * Печатают то, что отмечено в фильтре по местам над списком (2026-10-28):
 * `point` — точка или офис (их оборудование и цехов без точки, как в
 * списке), `all` — всё, `none` — только цеха без точки. Без него экран QR
 * берёт точку из шапки (`loadQrPostersView`). Таблички нумеруются по цехам.
 *
 * Без хуков состояния — рисуют серверные страницы; на телефоне три кнопки
 * сворачиваются в одну «QR» с листом (`QrActions`, владелец 2026-11-23), чтобы
 * встать в одну строку с «Добавить».
 */
export function EquipmentQrButtons({ point = null }: { point?: string | null } = {}) {
  const t = useTranslations("settingsUi.equipmentPage");
  const scope = point ? `&point=${encodeURIComponent(point)}` : "";
  return (
    <QrActions
      items={[
        {
          key: "stickers",
          href: `/settings/qr-posters?kind=equipment&layout=sheet${scope}`,
          label: t("stickers"),
          hint: t("stickersHint"),
          primary: true,
        },
        { key: "posters", href: `/settings/qr-posters?kind=equipment${scope}`, label: t("posters"), hint: t("postersHint") },
        { key: "plates", href: `/settings/qr-posters?kind=equipment&layout=plate${scope}`, label: t("plates"), hint: t("platesHint") },
      ]}
    />
  );
}
