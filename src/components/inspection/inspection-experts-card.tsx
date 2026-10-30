import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, ClipboardCheck, MapPin } from "lucide-react";

import { ContactUsButton } from "@/components/contact/contact-us-dialog";
import { contactTelegramUrl } from "@/lib/contact-us";
import type { PlatformServiceItem } from "@/lib/services/constants";

export const INSPECTION_EXPERT_SERVICES = [
  { key: "pre-inspection-audit", label: "audit", hint: "auditHint", icon: ClipboardCheck },
  { key: "site-visit", label: "visit", hint: "visitHint", icon: MapPin },
] as const;

/**
 * «Подготовка с экспертом» и «Выезд специалиста» (скан 83: «модуль
 * подготовки — платно; выезд — платно»): кнопки на существующие услуги
 * каталога. Заказ — на странице услуг, как у остальных (`?order=<ключ>`).
 * Услуга выключена в каталоге — её кнопки нет. Цен нет (владелец,
 * 2026-10-29): под карточками — «Свяжитесь с нами» с крупными контактами.
 */
export async function InspectionExpertsCard({ services }: { services: PlatformServiceItem[] }) {
  const t = await getTranslations("inspectionDay.experts");
  const items = INSPECTION_EXPERT_SERVICES.flatMap((item) => {
    const service = services.find((candidate) => candidate.key === item.key && candidate.active);
    return service ? [{ ...item, service }] : [];
  });
  if (items.length === 0) return null;

  return (
    <section
      id="experts"
      className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      data-inspection-experts
    >
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
      <p className="mt-1 text-[14px] text-[#6f7282]">{t("lead")}</p>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map(({ key, label, hint, icon: Icon }) => (
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
                <span className="block text-[15px] font-semibold text-[#0b1024]">{t(label)}</span>
                <span className="mt-1 block text-[13.5px] leading-[1.55] text-[#3c4053]">{t(hint)}</span>
              </span>
              <ArrowRight className="mt-2.5 size-4 shrink-0 text-[#9b9fb3] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#5566f6]" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[#f5f6ff] p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13.5px] leading-[1.55] text-[#3c4053]">{t("priceNote")}</p>
        <ContactUsButton
          variant="outline"
          telegramUrl={contactTelegramUrl(process.env)}
          testId="inspection-experts-contact"
          className="shrink-0"
        />
      </div>
    </section>
  );
}
