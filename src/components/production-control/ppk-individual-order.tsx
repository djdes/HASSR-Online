import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";

import { ContactUsButton } from "@/components/contact/contact-us-dialog";
import { contactTelegramUrl } from "@/lib/contact-us";
import { PPK_SERVICE_KEY } from "@/lib/services/catalog";

/**
 * «ППК под ваш объект — заказать индивидуально» — внизу обзора раздела
 * «Производственный контроль» и блока «Пакет документов», у любого тарифа
 * (тарифы 2026-10). Цены нет (владелец, 2026-10-29): вместо неё «Свяжитесь с
 * нами» — окно с крупными контактами; заявка — на странице услуг.
 */
export async function PpkIndividualOrder() {
  const t = await getTranslations("productionControl.individual");
  return (
    <section
      data-testid="ppk-individual-order"
      className="flex flex-col gap-4 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <FileText className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("title")}</h2>
          <p className="mt-1 max-w-[600px] text-[13.5px] leading-[1.55] text-[#6f7282]">{t("text")}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
        <ContactUsButton
          variant="link"
          service={t("title")}
          telegramUrl={contactTelegramUrl(process.env)}
          testId="ppk-individual-contact"
          className="self-center text-[15px] font-semibold sm:self-end"
        />
        <Link
          href={`/settings/services?order=${PPK_SERVICE_KEY}`}
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          {t("cta")}
        </Link>
      </div>
    </section>
  );
}
