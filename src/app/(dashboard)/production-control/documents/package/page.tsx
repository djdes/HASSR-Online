import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download, FileText, Lock } from "lucide-react";

import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { hasFeature } from "@/lib/billing-period";
import { loadAccountBilling } from "@/lib/billing.server";
import { groupedOrderTemplates, ORDER_TEMPLATES } from "@/lib/orders/catalog";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import { PpkIndividualOrder } from "@/components/production-control/ppk-individual-order";
import { isPointScoped } from "@/lib/point-scope";

export const dynamic = "force-dynamic";

/**
 * Блок «Пакет документов» (тарифы 2026-10).
 *
 * «Премиум» и пробный период — типовой пакет: все приказы с реквизитами
 * организации (поля прочерками — распечатать и заполнить), по одному PDF и
 * архивом. «Стандарт» — замок на типовом пакете и своя папка документов в
 * пределах хранилища тарифа (10 МБ). Внизу — «Заказать индивидуально».
 */
export default async function Page() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const canManage = hasCapability(session.user, "admin.full");
  const [t, loaded] = await Promise.all([
    getTranslations("productionControl"),
    loadAccountBilling(organizationId).catch((error) => {
      console.error("[ppk] package: billing load failed", error);
      return null;
    }),
  ]);
  const typical = hasFeature(loaded?.state, "typicalPackage");
  // Типовой пакет — приказы компании с её реквизитами: руководителю точки
  // закрыт, как и «Приказы» (2026-11-01). Свои файлы пакета точки — ниже.
  const companyOrders = !isPointScoped(session.user);
  const uploadsClosed = loaded?.state.entitlements.storageBytes === 0;

  return (
    <div className="space-y-5">
      <PpkBlockHeader blockKey="package" lead={t("blocks.package.lead")} />

      {companyOrders ? (
      <section
        data-testid={typical ? "ppk-package-typical" : "ppk-package-locked"}
        className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("package.typicalTitle")}</h2>
            <p className="mt-1 max-w-[620px] text-[13.5px] leading-[1.55] text-[#6f7282]">
              {t("package.typicalLead", { count: ORDER_TEMPLATES.length })}
            </p>
          </div>
          {typical ? (
            <a
              href="/api/production-control/package/zip"
              data-testid="ppk-package-zip"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <Download className="size-4" />
              {t("package.downloadAll")}
            </a>
          ) : null}
        </div>

        {typical ? null : (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 size-4 shrink-0 text-[#6f7282]" aria-hidden />
              <div>
                <div className="text-[14px] font-semibold text-[#0b1024]">{t("package.lockedTitle")}</div>
                <p className="mt-0.5 text-[13px] leading-[1.5] text-[#6f7282]">{t("package.lockedText")}</p>
              </div>
            </div>
            <Link
              href="/settings/subscription#tariffs"
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              {t("package.upgrade")}
            </Link>
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {groupedOrderTemplates().map((group) => (
            <div key={group.category}>
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{group.label}</h3>
              <ul className="mt-2 divide-y divide-[#f2f3f8] rounded-2xl border border-[#ececf4]">
                {group.items.map((template) => (
                  <li key={template.code} className="flex items-center gap-3 px-3.5 py-2.5">
                    <FileText className={typical ? "size-4 shrink-0 text-[#5566f6]" : "size-4 shrink-0 text-[#c9ccdb]"} aria-hidden />
                    <span className={typical ? "min-w-0 flex-1 text-[14px] text-[#0b1024]" : "min-w-0 flex-1 text-[14px] text-[#9b9fb3]"}>
                      {template.title}
                    </span>
                    {typical ? (
                      <a
                        href={`/api/orders/${template.code}/pdf`}
                        className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-medium text-[#3848c7] hover:bg-[#f5f6ff]"
                      >
                        {t("package.download")}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("package.ownTitle")}</h2>
          <p className="mt-1 max-w-[640px] text-[13.5px] leading-[1.55] text-[#6f7282]">
            {uploadsClosed ? t("package.storageClosed") : t("package.ownLead")}
          </p>
        </div>
        <PpkFolder folder="package" canManage={canManage && !uploadsClosed} />
      </section>

      <PpkIndividualOrder />
    </div>
  );
}
