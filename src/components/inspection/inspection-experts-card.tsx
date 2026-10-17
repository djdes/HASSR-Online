import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, ClipboardCheck, MapPin } from "lucide-react";

import type { PlatformServiceItem } from "@/lib/services/constants";

export const INSPECTION_EXPERT_SERVICES = [
  { key: "pre-inspection-audit", label: "audit", hint: "auditHint", icon: ClipboardCheck },
  { key: "site-visit", label: "visit", hint: "visitHint", icon: MapPin },
] as const;

/**
 * «Подготовка с экспертом» и «Выезд специалиста» (скан 83: «модуль
 * подготовки — платно; выезд — платно»): кнопки на существующие услуги
 * каталога. Заказ — на странице услуг, как у остальных (`?order=<ключ>`).
 * Услуга выключена в каталоге — её кнопки нет.
 */
export async function InspectionExpertsCard({ services }: { services: PlatformServiceItem[] }) {
  const [t, locale] = await Promise.all([getTranslations("inspectionDay.experts"), getLocale()]);
  const items = INSPECTION_EXPERT_SERVICES.flatMap((item) => {
    const service = services.find((candidate) => candidate.key === item.key && candidate.active);
    return service ? [{ ...item, service }] : [];
  });
  if (items.length === 0) return null;
  const price = (service: PlatformServiceItem) =>
    service.priceRub === null
      ? t("priceOnRequest")
      : t(service.priceFrom ? "priceFrom" : "priceExact", { price: service.priceRub.toLocaleString(locale) });

  return (
    <section
      id="experts"
      className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      data-inspection-experts
    >
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
      <p className="mt-1 text-[14px] text-[#6f7282]">{t("lead")}</p>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map(({ key, label, hint, icon: Icon, service }) => (
          <li key={key}>
            <Link
              href={`/settings/services?order=${key}`}
              className="group flex h-full items-start gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 transition-[border-color,box-shadow,background-color] duration-200 hover:border-[#5566f6]/40 hover:bg-white hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              data-expert-service={key}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-[15px] font-semibold text-[#0b1024]">{t(label)}</span>
                  <span className="rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12.5px] font-medium tabular-nums text-[#3848c7]">
                    {price(service)}
                  </span>
                </span>
                <span className="mt-1 block text-[13.5px] leading-[1.55] text-[#3c4053]">{t(hint)}</span>
              </span>
              <ArrowRight className="mt-2.5 size-4 shrink-0 text-[#9b9fb3] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#5566f6]" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
