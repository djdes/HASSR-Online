import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { db } from "@/lib/db";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import { NormsClient } from "@/components/production-control/norms-client";

const OUTLINE_LINK =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Ссылка «Нормы СанПиН» — действие в шапке страницы нормативных документов. */
export async function NormDocumentsSanpinLink() {
  const t = await getTranslations("productionControl");
  return (
    <Link href="/sanpin" className={OUTLINE_LINK}>
      {t("norms.sanpinLink")}
    </Link>
  );
}

/**
 * Нормативные документы организации (законы, СанПиН, ТР ТС): отметки
 * каталога, свои документы, подписка на обновления и папка файлов. Один
 * блок на две страницы: «Программа производственного контроля → Нормативные
 * документы» и «Пришла проверка → Нормативные документы» (эскиз 2026-10-28).
 * Страница сама проверяет права и даёт сообщения `productionControl`.
 */
export async function NormDocumentsBody({ organizationId }: { organizationId: string }) {
  const [rows, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { organizationId, block: "norms" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    getTranslations("productionControl"),
  ]);

  const initial = parsePpkRecords("norms", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  return (
    <>
      <NormsClient initial={initial} />

      <section className="flex flex-col gap-4 rounded-3xl border border-[#ececf4] bg-white p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[#0b1024]">{t("norms.subscriptionTitle")}</h3>
          <p className="mt-1 max-w-[560px] text-[13.5px] text-[#6f7282]">{t("norms.subscriptionHint")}</p>
        </div>
        <Link href="/settings/services?order=norms-subscription" className={`${OUTLINE_LINK} shrink-0 justify-center`}>
          {t("norms.order")}
        </Link>
      </section>

      <section className="space-y-3 rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-[14.5px] font-medium text-[#0b1024]">
          <FileText className="size-4 text-[#3848c7]" aria-hidden />
          {t("norms.files")}
        </h3>
        <PpkFolder folder="norm-files" canManage />
      </section>
    </>
  );
}
