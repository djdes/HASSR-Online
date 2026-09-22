import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { BrandingForm } from "@/components/partner/branding-form";
import { PartnerVisibilityCard } from "@/components/partner/visibility-card";
import { btnOutline } from "@/components/partner/ui";
import { PageGuide } from "@/components/ui/page-guide";
import { getBrandingSettings } from "@/lib/partners/branding-admin";
import { requirePartnerPage } from "@/lib/partners/page-context";

export const dynamic = "force-dynamic";

export default async function PartnerBrandingPage() {
  const { membership } = await requirePartnerPage();
  const branding = await getBrandingSettings(membership.partnerId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Брендинг</h1>
          <p className="mt-1 text-[14px] text-[#6f7282]">
            Так вас увидят клиенты: на странице входа, в кабинете, в PDF-журналах, письмах и Telegram-боте.
          </p>
        </div>
        <Link href={`/p/${membership.partner.slug}`} target="_blank" className={btnOutline}>
          <ExternalLink className="size-4 text-[#5566f6]" />
          Открыть страницу входа
        </Link>
      </div>

      <PageGuide
        title="Где появляется брендинг"
        storageKey="partner-branding"
        bullets={[
          "Страница входа /p/<ваш-адрес>: логотип и приветствие. Подпись «Работает на платформе WeSetup» остаётся всегда.",
          "Кабинет клиента: логотип в шапке, акцентный цвет кнопок и блок «Ваш консультант» на главной и в разделе «Помощь».",
          "PDF: подпись внизу каждой страницы. Письма: логотип и «при сопровождении <бренд>». Telegram: строка «Ваш консультант».",
          "Изменения доходят до клиентов в течение 5 минут. Клиент может скрыть ваш брендинг у себя — тогда он увидит стандартный WeSetup.",
        ]}
      />

      <PartnerVisibilityCard
        initialHidden={membership.partner.hideFromClients}
        canEdit={membership.role === "owner"}
      />

      <BrandingForm initial={branding} />
    </div>
  );
}
