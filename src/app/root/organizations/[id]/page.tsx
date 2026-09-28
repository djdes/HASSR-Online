import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, BookText, Users } from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { isRequisitesComplete } from "@/lib/closing-documents/types";
import { getUserRoleLabel } from "@/lib/user-roles";
import { ImpersonateButton } from "./impersonate-button";
import { DeleteOrgButton } from "./delete-org-button";
import { OrgSettingsForm } from "./org-settings-form";
import { BalanceCard } from "./balance-card";
import { InvoiceActions } from "./invoice-actions";
import { orderStatusLabel } from "@/lib/order-status";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function OrganizationDetailPage({ params }: PageProps) {
  await requireRoot();
  const { id } = await params;

  const org = await db.organization.findUnique({
    where: { id },
    include: {
      users: {
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          telegramChatId: true,
          journalAccessMigrated: true,
        },
      },
      _count: {
        select: {
          users: true,
          journalDocuments: true,
          journalEntries: true,
          auditLogs: true,
        },
      },
    },
  });

  if (!org) notFound();

  const activeDocs = await db.journalDocument.count({
    where: { organizationId: id, status: "active" },
  });

  // История оплат и сумма за всё время. Считаем только проведённые
  // платежи: pending-заказ денег не принёс, и складывать его в «оплачено»
  // значит показывать выручку, которой нет.
  const payments = await db.paymentOrder.findMany({
    where: { organizationId: id },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      tariffKey: true,
      amountRub: true,
      status: true,
      paidAt: true,
      createdAt: true,
      pointsSpent: true,
      isTest: true,
      refundedAt: true,
      paymentMethod: true,
      promoCode: true,
      discountRub: true,
      promotionPercent: true,
      promotionDiscountRub: true,
    },
  });
  const documentsReady = isRequisitesComplete(await readPlatformRequisites());
  const closingEligible = (payment: (typeof payments)[number]) =>
    documentsReady &&
    payment.status === "paid" &&
    !payment.isTest &&
    !payment.refundedAt &&
    Number(payment.amountRub) > 0;
  const paidTotalRub = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + Number(payment.amountRub), 0);

  // Баллы: движения, кто привёл организацию и скольких привела она.
  // Всё читается здесь, чтобы карточка была чистым представлением.
  const [transactions, referredBy, referredCount] = await Promise.all([
    db.balanceTransaction.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        amount: true,
        kind: true,
        description: true,
        createdAt: true,
      },
    }),
    org.referredByOrganizationId
      ? db.organization.findUnique({
          where: { id: org.referredByOrganizationId },
          select: { name: true },
        })
      : Promise.resolve(null),
    db.organization.count({ where: { referredByOrganizationId: id } }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link
            href="/root"
            className="inline-flex items-center gap-2 text-[14px] text-[#6f7282] hover:text-black"
          >
            <ArrowLeft className="size-4" />
            Все организации
          </Link>
          <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.03em] text-black">
            {org.name}
          </h1>
          <p className="mt-1 text-[15px] text-[#6f7282]">
            {org.type} · создана {new Date(org.createdAt).toLocaleDateString("ru-RU")}
            {org.inn ? ` · ИНН ${org.inn}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImpersonateButton organizationId={org.id} organizationName={org.name} />
          <DeleteOrgButton organizationId={org.id} organizationName={org.name} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={<Users className="size-5" />} label="Сотрудники" value={org._count.users} />
        <StatCard icon={<BookText className="size-5" />} label="Документов" value={org._count.journalDocuments} />
        <StatCard icon={<BadgeCheck className="size-5" />} label="Активных" value={activeDocs} />
        <StatCard icon={<BookText className="size-5" />} label="Записей" value={org._count.journalEntries} />
      </div>

      <div className="rounded-2xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mb-4 text-[18px] font-semibold">Подписка</div>
        <dl className="grid grid-cols-1 gap-4 text-[14px] sm:grid-cols-3 sm:gap-6">
          <div>
            <dt className="text-[#8a8ea4]">Тариф</dt>
            <dd className="mt-1 font-semibold text-black">{org.subscriptionPlan}</dd>
          </div>
          <div>
            <dt className="text-[#8a8ea4]">Действует до</dt>
            <dd className="mt-1 font-semibold text-black">
              {org.subscriptionEnd
                ? new Date(org.subscriptionEnd).toLocaleDateString("ru-RU")
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[#8a8ea4]">Внешний API-токен</dt>
            <dd className="mt-1 font-semibold text-black">
              {org.externalApiToken ? "выдан" : "не выдан"}
            </dd>
          </div>
          <div>
            <dt className="text-[#8a8ea4]">Оплачено за всё время</dt>
            <dd className="mt-1 font-semibold text-black tabular-nums">
              {paidTotalRub.toLocaleString("ru-RU")} ₽
            </dd>
          </div>
        </dl>

        <div className="mt-6 border-t border-[#eef0f6] pt-5">
          <OrgSettingsForm
            organizationId={org.id}
            initialName={org.name}
            initialPlan={org.subscriptionPlan}
            initialSubscriptionEnd={org.subscriptionEnd?.toISOString() ?? null}
          />
        </div>
      </div>

      <BalanceCard
        organizationId={org.id}
        organizationName={org.name}
        balanceRub={org.balanceRub}
        referredByName={referredBy?.name ?? null}
        referredCount={referredCount}
        transactions={transactions.map((t) => ({
          id: t.id,
          amount: t.amount,
          kind: t.kind,
          description: t.description,
          createdAt: t.createdAt.toISOString(),
        }))}
      />

      <div className="rounded-2xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mb-4 flex items-baseline gap-3">
          <span className="text-[18px] font-semibold">История оплат</span>
          <span className="text-[14px] text-[#8a8ea4]">
            {payments.length === 0
              ? "платежей нет"
              : `платежей: ${payments.length}`}
          </span>
        </div>

        {payments.length === 0 ? (
          <p className="text-[14px] text-[#9b9fb3]">
            Организация ещё ничего не оплачивала.
          </p>
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-[0.14em] text-[#8a8ea4]">
                <th className="pb-2 font-medium">Дата и время</th>
                <th className="pb-2 font-medium">Тариф</th>
                <th className="pb-2 font-medium">Статус</th>
                <th className="pb-2 text-right font-medium">Сумма</th>
                <th className="pb-2 pl-4 font-medium">Документы</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-t border-[#f2f3f8]">
                  <td className="py-2.5 text-[#0b1024]">
                    {(payment.paidAt ?? payment.createdAt).toLocaleString("ru-RU")}
                  </td>
                  <td className="py-2.5 text-[#6f7282]">{payment.tariffKey}</td>
                  <td className="py-2.5">
                    <span
                      className={
                        payment.status === "paid"
                          ? "rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[12px] text-[#116b2a]"
                          : "rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] text-[#6f7282]"
                      }
                    >
                      {orderStatusLabel(payment)}
                    </span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-[#0b1024]">
                    {Number(payment.amountRub).toLocaleString("ru-RU")} ₽
                    {payment.pointsSpent > 0 ? (
                      <span className="ml-1 text-[12px] text-[#3848c7]">
                        баллами −{payment.pointsSpent.toLocaleString("ru-RU")}
                      </span>
                    ) : null}
                    {/* Отчёт по скидкам: акция и промокод — снимком из заказа. */}
                    {payment.promotionPercent && payment.promotionDiscountRub > 0 ? (
                      <div className="text-[12px] text-[#116b2a]">
                        акция −{payment.promotionPercent} % (−{payment.promotionDiscountRub.toLocaleString("ru-RU")} ₽)
                      </div>
                    ) : null}
                    {payment.promoCode && payment.discountRub > 0 ? (
                      <div className="text-[12px] text-[#3848c7]">
                        {payment.promoCode} −{payment.discountRub.toLocaleString("ru-RU")} ₽
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2.5 pl-4">
                    {payment.paymentMethod === "invoice" && payment.status !== "cancelled" ? (
                      <InvoiceActions
                        orderId={payment.id}
                        amountRub={Number(payment.amountRub)}
                        organizationName={org.name}
                        pending={payment.status === "pending"}
                      />
                    ) : closingEligible(payment) ? (
                      <a
                        href={`/api/closing-documents/${payment.id}/pdf`}
                        className="inline-flex h-8 items-center rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                      >
                        УПД (PDF)
                      </a>
                    ) : (
                      <span className="text-[#c9ccdb]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-center justify-between border-b border-[#eef0f6] px-6 py-4">
          <div className="text-[18px] font-semibold">Сотрудники</div>
          <div className="text-[14px] text-[#8a8ea4]">{org.users.length}</div>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] text-[14px]">
          <thead className="bg-[#f8f9fc] text-[13px] text-[#6f7282]">
            <tr>
              <th className="px-6 py-3 text-left font-medium">Имя</th>
              <th className="px-6 py-3 text-left font-medium">Email</th>
              <th className="px-6 py-3 text-left font-medium">Роль</th>
              <th className="px-6 py-3 text-center font-medium">Telegram</th>
              <th className="px-6 py-3 text-center font-medium">ACL</th>
              <th className="px-6 py-3 text-center font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {org.users.map((user) => (
              <tr key={user.id} className="border-t border-[#eef0f6]">
                <td className="px-6 py-3 text-black">{user.name}</td>
                <td className="px-6 py-3 text-[#6f7282]">{user.email}</td>
                <td className="px-6 py-3 text-[#6f7282]">
                  {getUserRoleLabel(user.role)}
                </td>
                <td className="px-6 py-3 text-center">
                  {user.telegramChatId ? "✓" : "—"}
                </td>
                <td className="px-6 py-3 text-center">
                  {user.journalAccessMigrated ? "✓" : "все"}
                </td>
                <td className="px-6 py-3 text-center">
                  {user.isActive ? "активен" : "неактивен"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex items-center gap-3 text-[#5566f6]">{icon}</div>
      <div className="mt-3 text-[28px] font-semibold leading-none text-black">
        {value}
      </div>
      <div className="mt-2 text-[13px] text-[#8a8ea4]">{label}</div>
    </div>
  );
}
