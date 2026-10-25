import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, BookText, Users } from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { isRequisitesComplete } from "@/lib/closing-documents/types";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { formatNumber } from "@/i18n/locales";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { organizationDate, organizationSphere, organizationRole, organizationPlan, organizationOrderStatus } from "./organization-presentation";
import { ImpersonateButton } from "./impersonate-button";
import { DeleteOrgButton } from "./delete-org-button";
import { OrgSettingsForm } from "./org-settings-form";
import { BalanceCard } from "./balance-card";
import { HeldOrderActions } from "./held-order-actions";
import { InvoiceActions } from "./invoice-actions";
import { isTopupOrder } from "@/lib/balance/topup-core";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function OrganizationDetailPage({ params }: PageProps) {
  await requireRoot();
  const [t, locale, profile, roleCopy, legacyPlans] = await Promise.all([getTranslations("rootOrganizationManagement"), getSiteLocale(), getTranslations("settingsManagement.organizationProfile.form"), getTranslations("staffManagement.roleLabels"), getTranslations("rootMetrics.plans")]);
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
      // Тариф 2026-10 живёт на аккаунте: тариф, период, точки, пробный.
      account: {
        select: { subscriptionPlan: true, subscriptionEnd: true, planCycle: true, planPoints: true, trialEndsAt: true },
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
      heldAt: true,
    },
  });
  const documentsReady = isRequisitesComplete(await readPlatformRequisites());
  // УПД — на любую оплату деньгами, в том числе на пополнение баланса.
  const closingEligible = (payment: (typeof payments)[number]) =>
    documentsReady &&
    payment.status === "paid" &&
    !payment.isTest &&
    !payment.refundedAt &&
    !payment.heldAt &&
    Number(payment.amountRub) > 0;
  // Оплата устаревшего заказа: ROOT применяет тариф вручную или возвращает деньги.
  const heldForReview = (payment: (typeof payments)[number]) =>
    payment.status === "paid" && Boolean(payment.heldAt) && !payment.refundedAt;
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
    <DomainMessagesBoundary namespaces={["rootOrganizationManagement"]}>
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link
            href="/root"
            className="inline-flex items-center gap-2 text-[14px] text-[#6f7282] hover:text-black"
          >
            <ArrowLeft className="size-4" />
            {t("page.back")}</Link>
          <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.03em] text-black">
            {org.name}
          </h1>
          <p className="mt-1 text-[15px] text-[#6f7282]">
            {t("page.created", { type: organizationSphere(org.type, profile), date: organizationDate(org.createdAt, locale, true) })}
            {org.inn ? t("page.inn", { inn: org.inn }) : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImpersonateButton organizationId={org.id} organizationName={org.name} />
          <DeleteOrgButton organizationId={org.id} organizationName={org.name} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={<Users className="size-5" />} label={t("stats.users")} value={formatNumber(locale, org._count.users)} />
        <StatCard icon={<BookText className="size-5" />} label={t("stats.documents")} value={formatNumber(locale, org._count.journalDocuments)} />
        <StatCard icon={<BadgeCheck className="size-5" />} label={t("stats.active")} value={formatNumber(locale, activeDocs)} />
        <StatCard icon={<BookText className="size-5" />} label={t("stats.entries")} value={formatNumber(locale, org._count.journalEntries)} />
      </div>

      <div className="rounded-2xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mb-4 text-[18px] font-semibold">{t("subscription.title")}</div>
        <dl className="grid grid-cols-1 gap-4 text-[14px] sm:grid-cols-3 sm:gap-6">
          <div>
            <dt className="text-[#8a8ea4]">{t("subscription.plan")}</dt>
            <dd className="mt-1 font-semibold text-black">
              {organizationPlan(
                org.subscriptionPlan === "paused" || org.subscriptionPlan === "cancelled"
                  ? org.subscriptionPlan
                  : (org.account?.subscriptionPlan ?? org.subscriptionPlan),
                t,
                legacyPlans
              )}
              {org.account?.planCycle ? ` · ${t(org.account.planCycle === "year" ? "subscription.cycleYear" : "subscription.cycleMonth")}` : ""}
              {org.account ? ` · ${t("subscription.pointsValue", { count: org.account.planPoints })}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[#8a8ea4]">{t("subscription.until")}</dt>
            <dd className="mt-1 font-semibold text-black">
              {(org.account?.subscriptionEnd ?? org.subscriptionEnd)
                ? organizationDate((org.account?.subscriptionEnd ?? org.subscriptionEnd)!, locale, true)
                : "—"}
            </dd>
          </div>
          {org.account?.trialEndsAt ? (
            <div>
              <dt className="text-[#8a8ea4]">{t("subscription.trialEnds")}</dt>
              <dd className="mt-1 font-semibold text-black">{organizationDate(org.account.trialEndsAt, locale, true)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-[#8a8ea4]">{t("subscription.token")}</dt>
            <dd className="mt-1 font-semibold text-black">
              {org.externalApiToken ? t("subscription.tokenIssued") : t("subscription.tokenMissing")}
            </dd>
          </div>
          <div>
            <dt className="text-[#8a8ea4]">{t("subscription.paidTotal")}</dt>
            <dd className="mt-1 font-semibold text-black tabular-nums">
              {t("format.rubles", { amount: paidTotalRub })}
            </dd>
          </div>
        </dl>

        <div className="mt-6 border-t border-[#eef0f6] pt-5">
          <OrgSettingsForm
            organizationId={org.id}
            initialName={org.name}
            initialPlan={
              org.subscriptionPlan === "paused" || org.subscriptionPlan === "cancelled"
                ? org.subscriptionPlan
                : (org.account?.subscriptionPlan ?? org.subscriptionPlan)
            }
            initialSubscriptionEnd={(org.account?.subscriptionEnd ?? org.subscriptionEnd)?.toISOString() ?? null}
            account={
              org.account
                ? {
                    planCycle: org.account.planCycle === "year" ? "year" : "month",
                    planPoints: org.account.planPoints,
                    trialEndsAt: org.account.trialEndsAt?.toISOString() ?? null,
                  }
                : null
            }
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
          <span className="text-[18px] font-semibold">{t("payments.title")}</span>
          <span className="text-[14px] text-[#8a8ea4]">
            {payments.length === 0
              ? t("payments.none")
              : t("payments.count", { count: payments.length })}
          </span>
        </div>

        {payments.length === 0 ? (
          <p className="text-[14px] text-[#9b9fb3]">
            {t("payments.empty")}</p>
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-[0.14em] text-[#8a8ea4]">
                <th className="pb-2 font-medium">{t("payments.date")}</th>
                <th className="pb-2 font-medium">{t("subscription.plan")}</th>
                <th className="pb-2 font-medium">{t("payments.status")}</th>
                <th className="pb-2 text-right font-medium">{t("payments.amount")}</th>
                <th className="pb-2 pl-4 font-medium">{t("payments.documents")}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-t border-[#f2f3f8]">
                  <td className="py-2.5 text-[#0b1024]">
                    {organizationDate(payment.paidAt ?? payment.createdAt, locale)}
                  </td>
                  <td className="py-2.5 text-[#6f7282]">
                    {isTopupOrder(payment) ? t("payments.topup") : payment.tariffKey}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={
                        payment.status === "paid"
                          ? "rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[12px] text-[#116b2a]"
                          : "rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] text-[#6f7282]"
                      }
                    >
                      {organizationOrderStatus(payment, t)}
                    </span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-[#0b1024]">
                    {t("format.rubles", { amount: Number(payment.amountRub) })}
                    {payment.pointsSpent > 0 ? (
                      <span className="ml-1 text-[12px] text-[#3848c7]">
                        {t("payments.pointsSpent", { amount: payment.pointsSpent })}
                      </span>
                    ) : null}
                    {/* Отчёт по скидкам: акция и промокод — снимком из заказа. */}
                    {payment.promotionPercent && payment.promotionDiscountRub > 0 ? (
                      <div className="text-[12px] text-[#116b2a]">
                        {t("payments.promotion", { percent: payment.promotionPercent, amount: payment.promotionDiscountRub })}
                      </div>
                    ) : null}
                    {payment.promoCode && payment.discountRub > 0 ? (
                      <div className="text-[12px] text-[#3848c7]">
                        {t("payments.promo", { code: payment.promoCode, amount: payment.discountRub })}
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
                        purpose={isTopupOrder(payment) ? "topup" : "subscription"}
                      />
                    ) : closingEligible(payment) ? (
                      <a
                        href={`/api/closing-documents/${payment.id}/pdf`}
                        className="inline-flex h-8 items-center rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                      >
                        {t("payments.closingPdf")}</a>
                    ) : heldForReview(payment) ? null : (
                      <span className="text-[#c9ccdb]">—</span>
                    )}
                    {heldForReview(payment) ? (
                      <div className={payment.paymentMethod === "invoice" ? "mt-1.5" : undefined}>
                        <HeldOrderActions orderId={payment.id} />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-center justify-between border-b border-[#eef0f6] px-6 py-4">
          <div className="text-[18px] font-semibold">{t("stats.users")}</div>
          <div className="text-[14px] text-[#8a8ea4]">{formatNumber(locale, org.users.length)}</div>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] text-[14px]">
          <thead className="bg-[#f8f9fc] text-[13px] text-[#6f7282]">
            <tr>
              <th className="px-6 py-3 text-left font-medium">{t("users.name")}</th>
              <th className="px-6 py-3 text-left font-medium">{t("users.email")}</th>
              <th className="px-6 py-3 text-left font-medium">{t("users.role")}</th>
              <th className="px-6 py-3 text-center font-medium">{t("users.telegram")}</th>
              <th className="px-6 py-3 text-center font-medium">{t("users.acl")}</th>
              <th className="px-6 py-3 text-center font-medium">{t("payments.status")}</th>
            </tr>
          </thead>
          <tbody>
            {org.users.map((user) => (
              <tr key={user.id} className="border-t border-[#eef0f6]">
                <td className="px-6 py-3 text-black">{user.name}</td>
                <td className="px-6 py-3 text-[#6f7282]">{user.email}</td>
                <td className="px-6 py-3 text-[#6f7282]">
                  {organizationRole(user.role, roleCopy)}
                </td>
                <td className="px-6 py-3 text-center">
                  {user.telegramChatId ? "✓" : "—"}
                </td>
                <td className="px-6 py-3 text-center">
                  {user.journalAccessMigrated ? "✓" : t("users.all")}
                </td>
                <td className="px-6 py-3 text-center">
                  {user.isActive ? t("users.active") : t("users.inactive")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
    </DomainMessagesBoundary>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
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
