import { requireRoot } from "@/lib/auth-helpers";
import { loadCrmMailPage } from "@/lib/crm/queries.server";
import { CrmHeader } from "../crm-ui";
import { SyncButton } from "../crm-toolbar";
import { MailClient } from "./mail-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "CRM: почта и фильтры" };

export default async function CrmMailPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await requireRoot();
  const { page } = await searchParams;
  const data = await loadCrmMailPage(Number(page) || 1);
  return (
    <div className="space-y-6" data-crm-mail>
      <CrmHeader
        active="/root/crm/mail"
        title="Почта и фильтры"
        description="CRM читает рабочие ящики по IMAP раз в 5 минут: письма людей попадают в переписку, автоответы, рассылки, недоставки, роботы и спам — в «Отсеяно». Ошибся фильтр — верните письмо и разрешите отправителя."
        actions={<SyncButton />}
      />
      <MailClient data={data} canManageMailboxes={session.user.isRoot === true} />
    </div>
  );
}
