import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { ServiceRequestsClient } from "./service-requests-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const t = await getTranslations("rootServiceRequests");
  return { title: t("metadata.title") };
}

/**
 * Заявки на платные услуги — из кабинета и с публичной страницы.
 *
 * Показываем и отметки о доставке уведомлений: если Telegram промолчал,
 * это должно быть видно здесь, а не только в логах сервера, иначе
 * заявка тихо пролежит непрочитанной.
 */
export default async function RootServiceRequestsPage() {
  await requireRoot();

  const requests = await db.serviceRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const t = await getTranslations("rootServiceRequests");

  return (
    <DomainMessagesBoundary namespaces={["rootServiceRequests"]}>
      <div className="mx-auto max-w-[1000px]">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">
          {t("page.title")}
        </h1>
        <p className="mt-2 text-[14px] leading-[1.6] text-[#6f7282]">
          {t("page.description")}
        </p>
        <div className="mt-6">
          <ServiceRequestsClient
            initial={requests.map((request) => ({
              id: request.id,
              serviceTitle: request.serviceTitle,
              organizationName: request.organizationName,
              contactName: request.contactName,
              contactPhone: request.contactPhone,
              contactEmail: request.contactEmail,
              comment: request.comment,
              status: request.status,
              paidRub: request.paidRub,
              source: request.source,
              notifiedTg: request.adminTgNotifiedAt !== null,
              notifiedEmail: request.adminEmailedAt !== null,
              createdAt: request.createdAt.toISOString(),
            }))}
          />
        </div>
      </div>
    </DomainMessagesBoundary>
  );
}
