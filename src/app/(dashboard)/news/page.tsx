import { getTranslations } from "next-intl/server";
import { Newspaper } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { SectionPageHeader } from "@/components/layout/section-page-header";

export const dynamic = "force-dynamic";

/**
 * «Новости, статьи, обзоры экспертов» (руководитель, 2026-11-05): раздел
 * главного меню для всех вошедших — любой роли и набора прав, на сайте и в
 * мини-приложении (П-3). Пока заглушка «Раздел в разработке»: здесь будут
 * статьи, советы, мнения экспертов и независимые консультации.
 */
export default async function NewsPage() {
  await requireAuth();
  const t = await getTranslations("newsPage");

  return (
    <div className="space-y-4">
      <SectionPageHeader title={t("title")} />

      <section
        className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center md:py-20"
        data-news-empty
      >
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Newspaper className="size-7" aria-hidden />
        </div>
        <span className="mt-5 inline-flex rounded-full bg-[#f5f6ff] px-3 py-1 text-[12px] font-medium text-[#3848c7]">
          {t("badge")}
        </span>
        <h2 className="mt-3 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
          {t("emptyTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-[460px] text-[14px] leading-[1.6] text-[#6f7282]">{t("emptyText")}</p>
      </section>
    </div>
  );
}
