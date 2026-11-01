import Link from "next/link";
import { Receipt } from "lucide-react";
import { Prisma } from "@prisma/client";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { readGuestBuyer } from "@/lib/invoices/guest";
import { InvoiceActions } from "../organizations/[id]/invoice-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Счета гостей" };

const STATUS_LABEL: Record<string, string> = {
  pending: "Ждёт оплаты",
  paid: "Оплачен",
  completed: "Оплачен, кабинет создан",
  cancelled: "Отменён",
};

/**
 * Счета по ИНН без регистрации (/order, 2026-11-01). У такого счёта нет
 * организации, поэтому в карточке клиента его не видно: оплату отмечают
 * здесь. «Оплата поступила» ведёт по тому же пути, что касса: аккаунт,
 * ссылка на достройку, ИНН и реквизиты — в организацию.
 */
export default async function RootGuestInvoicesPage() {
  await requireRoot();
  const rows = await db.paymentOrder.findMany({
    where: { paymentMethod: "invoice", buyerJson: { not: Prisma.DbNull } },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      email: true,
      amountRub: true,
      status: true,
      description: true,
      createdAt: true,
      invoiceDueAt: true,
      organizationId: true,
      buyerJson: true,
    },
  });
  const pending = rows.filter((row) => row.status === "pending").length;

  return (
    <DomainMessagesBoundary namespaces={["rootOrganizationManagement"]}>
      <div className="mx-auto max-w-[1100px] space-y-6">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <Receipt className="size-5" />
          </span>
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Счета гостей</h1>
            <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
              Счета по ИНН, выставленные на странице оплаты без регистрации. Когда деньги придут — «Оплата поступила»:
              аккаунт заведётся сам, на почту уйдёт ссылка для входа, ИНН и реквизиты перейдут в организацию.
              Ждут оплаты: {pending}.
            </p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center text-[14px] text-[#6f7282]">
            Счетов без регистрации пока не было.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white">
            <table className="w-full min-w-[900px] text-[14px]" data-testid="guest-invoices">
              <thead className="bg-[#fafbff] text-[13px] text-[#6f7282]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Счёт</th>
                  <th className="px-4 py-3 text-left font-medium">Покупатель</th>
                  <th className="px-4 py-3 text-right font-medium">Сумма</th>
                  <th className="px-4 py-3 text-left font-medium">Статус</th>
                  <th className="px-4 py-3 text-left font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const buyer = readGuestBuyer(row.buyerJson);
                  return (
                    <tr key={row.id} className="border-t border-[#ececf4] align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#0b1024]">№ {row.id}</div>
                        <div className="text-[12px] text-[#6f7282]">{row.createdAt.toLocaleDateString("ru-RU")}</div>
                        {row.invoiceDueAt && row.status === "pending" ? (
                          <div className="text-[12px] text-[#6f7282]">до {row.invoiceDueAt.toLocaleDateString("ru-RU")}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#0b1024]">{buyer?.name ?? "—"}</div>
                        <div className="text-[12px] text-[#6f7282]">ИНН {buyer?.inn ?? "—"} · {row.email}</div>
                        <div className="mt-0.5 text-[12px] text-[#9b9fb3]">{row.description}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{Number(row.amountRub).toLocaleString("ru-RU")} ₽</td>
                      <td className="px-4 py-3">
                        <div>{STATUS_LABEL[row.status] ?? row.status}</div>
                        {row.organizationId ? (
                          <Link href={`/root/organizations/${row.organizationId}`} className="text-[12px] font-medium text-[#3848c7] hover:underline">
                            Карточка клиента
                          </Link>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {row.status === "cancelled" ? (
                          <span className="text-[13px] text-[#9b9fb3]">—</span>
                        ) : (
                          <InvoiceActions
                            orderId={row.id}
                            amountRub={Number(row.amountRub)}
                            organizationName={buyer?.name ?? row.email}
                            pending={row.status === "pending"}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DomainMessagesBoundary>
  );
}
