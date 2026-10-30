import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AtSign, Building2, Calculator, Globe, Mail, MapPin, MessageCircle, Phone, ShieldCheck, UserRound } from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { isRequisitesComplete } from "@/lib/closing-documents/types";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { canUsePlatformSection } from "@/lib/platform-access";
import { loadClientContacts, type ClientPerson } from "@/lib/root-client-card.server";
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
import { CopyButton } from "./copy-button";
import { PanelAccessButton } from "./panel-access-button";
import { isTopupOrder } from "@/lib/balance/topup-core";
import { ClientDocumentsSection } from "@/components/root/client-documents-section";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

const CARD = "rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const SECTION_TITLE = "text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]";

/**
 * Карточка клиента в панели платформы (переделана 2026-10-29): сверху —
 * как связаться (телефоны и почты владельца, компании, сотрудников) и
 * реквизиты, затем документы, подписка и оплаты, сотрудники и входы.
 * Деньги меняет только тот, у кого раздел «Оплаты и тарифы»; войти под
 * клиента и удалить организацию — только владелец платформы.
 */
export default async function OrganizationDetailPage({ params }: PageProps) {
  const session = await requireRoot();
  const [t, locale, profile, roleCopy, legacyPlans] = await Promise.all([
    getTranslations("rootOrganizationManagement"),
    getSiteLocale(),
    getTranslations("settingsManagement.organizationProfile.form"),
    getTranslations("staffManagement.roleLabels"),
    getTranslations("rootMetrics.plans"),
  ]);
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

  const [viewer, contacts, activeDocs] = await Promise.all([
    platformViewerForSession(session),
    loadClientContacts(id),
    db.journalDocument.count({ where: { organizationId: id, status: "active" } }),
  ]);
  const canBill = canUsePlatformSection(viewer, "billing");

  // История оплат и сумма за всё время. Считаем только проведённые платежи.
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
    documentsReady && payment.status === "paid" && !payment.isTest && !payment.refundedAt && !payment.heldAt && Number(payment.amountRub) > 0;
  // Оплата устаревшего заказа: ROOT применяет тариф вручную или возвращает деньги.
  const heldForReview = (payment: (typeof payments)[number]) => payment.status === "paid" && Boolean(payment.heldAt) && !payment.refundedAt;
  const paidTotalRub = payments.filter((payment) => payment.status === "paid" && !payment.refundedAt).reduce((sum, payment) => sum + Number(payment.amountRub), 0);

  const [transactions, referredBy, referredCount] = await Promise.all([
    db.balanceTransaction.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, amount: true, kind: true, description: true, createdAt: true },
    }),
    org.referredByOrganizationId
      ? db.organization.findUnique({ where: { id: org.referredByOrganizationId }, select: { name: true } })
      : Promise.resolve(null),
    db.organization.count({ where: { referredByOrganizationId: id } }),
  ]);

  const plan =
    org.subscriptionPlan === "paused" || org.subscriptionPlan === "cancelled" ? org.subscriptionPlan : (org.account?.subscriptionPlan ?? org.subscriptionPlan);
  const paidUntil = org.account?.subscriptionEnd ?? org.subscriptionEnd;
  // Сотрудники: из карточки контактов (телефоны, почты, мессенджеры); если
  // загрузчик ничего не вернул — из основного запроса.
  const people: ClientPerson[] =
    contacts?.people ??
    org.users.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      position: null,
      phone: null,
      email: user.email,
      loginEmail: null,
      telegram: Boolean(user.telegramChatId),
      max: false,
      isActive: user.isActive,
      archived: false,
      isOwner: false,
      isRoot: false,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: null,
      lastLoginIp: null,
      registrationIp: null,
      journalAccessMigrated: user.journalAccessMigrated,
      platformSections: [],
    }));
  const owner = contacts?.owner ?? null;
  const requisites = contacts?.requisites ?? null;
  const company = contacts?.company ?? { phones: [], emails: [], accountantEmail: null, website: null, address: null };
  const withContacts = people.filter((person) => person.phone || person.email).length;
  const requisitesText = requisites
    ? [requisites.fullName, requisites.inn ? `ИНН ${requisites.inn}` : null, requisites.kpp ? `КПП ${requisites.kpp}` : null, requisites.ogrn ? `${requisites.ogrnLabel} ${requisites.ogrn}` : null, requisites.legalAddress]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <DomainMessagesBoundary namespaces={["rootOrganizationManagement", "rootPanel"]}>
      <div className="space-y-6">
        {/* Шапка */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href="/root" className="inline-flex items-center gap-2 text-[14px] text-[#6f7282] transition-colors hover:text-[#3848c7]">
              <ArrowLeft className="size-4" />
              {t("page.backToClients")}
            </Link>
            <h1 className="mt-2 break-words text-[28px] font-semibold tracking-[-0.02em] text-[#0b1024]">{org.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-[#6f7282]">
              <span className="rounded-full bg-[#eef1ff] px-2.5 py-0.5 text-[12.5px] font-medium text-[#3848c7]">{organizationPlan(plan, t, legacyPlans)}</span>
              {paidUntil ? <span>{t("subscription.until")}: {organizationDate(paidUntil, locale, true)}</span> : null}
              <span>·</span>
              <span>{organizationSphere(org.type, profile)}</span>
              {org.inn ? <span>· {t("requisites.inn")} {org.inn}</span> : null}
              <span>· {t("page.since", { date: organizationDate(org.createdAt, locale, true) })}</span>
            </div>
          </div>
          {viewer.superadmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <ImpersonateButton organizationId={org.id} organizationName={org.name} />
              <DeleteOrgButton organizationId={org.id} organizationName={org.name} />
            </div>
          ) : null}
        </div>

        {/* Навигация по карточке: всё на одной странице, разделы — якорями. */}
        <nav aria-label={t("nav.label")} className="sticky top-0 z-20 -mx-4 overflow-x-auto border-b border-[#ececf4] bg-[#f4f5fb]/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8">
          <div className="flex gap-1.5">
            {(["contacts", "documents", "billing", "people", "security"] as const).map((key) => (
              <a key={key} href={`#${key}`} className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium text-[#3c4053] transition-colors duration-150 hover:bg-white hover:text-[#3848c7]">
                {t(`nav.${key}`)}
              </a>
            ))}
          </div>
        </nav>

        {/* Контакты и реквизиты */}
        <section id="contacts" className="grid scroll-mt-16 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className={`${CARD} p-5 md:p-6`} data-client-contacts>
            <div className={SECTION_TITLE}>{t("contacts.title")}</div>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <UserRound className="size-3.5" />
                  {t("contacts.owner")}
                </div>
                {owner ? (
                  <div className="space-y-1.5">
                    <div className="text-[15px] font-medium text-[#0b1024]">{owner.name}</div>
                    <div className="text-[12.5px] text-[#9b9fb3]">{[owner.position, organizationRole(owner.role, roleCopy)].filter(Boolean).join(" · ")}</div>
                    <ContactLine icon={<Phone className="size-4" />} value={owner.phone} href={owner.phone ? `tel:${owner.phone.replace(/[^\d+]/g, "")}` : null} empty={t("contacts.noPhone")} big dataKey="owner-phone" />
                    <ContactLine icon={<Mail className="size-4" />} value={owner.email} href={owner.email ? `mailto:${owner.email}` : null} empty={t("contacts.noEmail")} dataKey="owner-email" />
                    {owner.loginEmail ? <ContactLine icon={<AtSign className="size-4" />} value={owner.loginEmail} href={`mailto:${owner.loginEmail}`} hint={t("contacts.login")} /> : null}
                    {owner.telegram || owner.max ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {owner.telegram ? <Badge>{t("contacts.telegramLinked")}</Badge> : null}
                        {owner.max ? <Badge>{t("contacts.maxLinked")}</Badge> : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[13px] text-[#9b9fb3]">{t("contacts.ownerMissing")}</p>
                )}
              </div>
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <Building2 className="size-3.5" />
                  {t("contacts.company")}
                </div>
                <div className="space-y-1.5">
                  {company.phones.map((phone) => (
                    <ContactLine key={phone} icon={<Phone className="size-4" />} value={phone} href={`tel:${phone.replace(/[^\d+]/g, "")}`} dataKey="company-phone" />
                  ))}
                  {company.emails.map((email) => (
                    <ContactLine key={email} icon={<Mail className="size-4" />} value={email} href={`mailto:${email}`} hint={t("contacts.fromRegistry")} />
                  ))}
                  {company.accountantEmail ? (
                    <ContactLine icon={<Calculator className="size-4" />} value={company.accountantEmail} href={`mailto:${company.accountantEmail}`} hint={t("contacts.accountant")} />
                  ) : null}
                  {company.website ? (
                    <ContactLine icon={<Globe className="size-4" />} value={company.website} href={/^https?:\/\//.test(company.website) ? company.website : `https://${company.website}`} external />
                  ) : null}
                  {company.address ? <ContactLine icon={<MapPin className="size-4" />} value={company.address} /> : null}
                  {!company.phones.length && !company.emails.length && !company.accountantEmail && !company.website ? (
                    <p className="text-[13px] leading-snug text-[#9b9fb3]">{t("contacts.noCompanyContacts")}</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className={`${CARD} p-5 md:p-6`} data-client-requisites>
              <div className="flex items-center justify-between gap-2">
                <div className={SECTION_TITLE}>{t("requisites.title")}</div>
                {requisitesText ? <CopyButton value={requisitesText} label={t("requisites.copyAll")} /> : null}
              </div>
              {requisites?.inn ? (
                <dl className="mt-3 space-y-2 text-[13.5px]">
                  <Row label={t("requisites.fullName")} value={requisites.fullName} />
                  <Row label={t("requisites.inn")} value={[requisites.inn, requisites.kpp ? `${t("requisites.kpp")} ${requisites.kpp}` : null].filter(Boolean).join(" · ")} />
                  {requisites.ogrn ? <Row label={requisites.ogrnLabel} value={requisites.ogrn} /> : null}
                  {requisites.legalAddress ? <Row label={t("requisites.address")} value={requisites.legalAddress} /> : null}
                  {requisites.directorName ? <Row label={t("requisites.director")} value={[requisites.directorPost, requisites.directorName].filter(Boolean).join(" ")} /> : null}
                </dl>
              ) : (
                <p className="mt-3 text-[13px] text-[#9b9fb3]">{t("requisites.missing")}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label={t("summary.people")} value={formatNumber(locale, org._count.users)} />
              <MiniStat label={t("summary.documents")} value={`${formatNumber(locale, org._count.journalDocuments)} · ${formatNumber(locale, activeDocs)}`} hint={t("summary.activeDocuments")} />
              <MiniStat label={t("summary.entries")} value={formatNumber(locale, org._count.journalEntries)} />
              <MiniStat label={t("subscription.paidTotal")} value={t("format.rubles", { amount: paidTotalRub })} />
            </div>
          </div>
        </section>

        {/* Документы клиенту: договор, КП и счёт — с почты сотрудника. */}
        <section id="documents" className="scroll-mt-16">
          <ClientDocumentsSection organizationId={org.id} />
        </section>

        {/* Подписка, баллы и оплаты */}
        <section id="billing" className="scroll-mt-16 space-y-4">
          <div className={`${CARD} p-5 md:p-6`}>
            <div className={SECTION_TITLE}>{t("subscription.title")}</div>
            <dl className="mt-4 grid grid-cols-1 gap-4 text-[14px] sm:grid-cols-3 sm:gap-6">
              <div>
                <dt className="text-[#8a8ea4]">{t("subscription.plan")}</dt>
                <dd className="mt-1 font-semibold text-[#0b1024]">
                  {organizationPlan(plan, t, legacyPlans)}
                  {org.account?.planCycle ? ` · ${t(org.account.planCycle === "year" ? "subscription.cycleYear" : "subscription.cycleMonth")}` : ""}
                  {org.account ? ` · ${t("subscription.pointsValue", { count: org.account.planPoints })}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[#8a8ea4]">{t("subscription.until")}</dt>
                <dd className="mt-1 font-semibold text-[#0b1024]">{paidUntil ? organizationDate(paidUntil, locale, true) : "—"}</dd>
              </div>
              {org.account?.trialEndsAt ? (
                <div>
                  <dt className="text-[#8a8ea4]">{t("subscription.trialEnds")}</dt>
                  <dd className="mt-1 font-semibold text-[#0b1024]">{organizationDate(org.account.trialEndsAt, locale, true)}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-[#8a8ea4]">{t("subscription.token")}</dt>
                <dd className="mt-1 font-semibold text-[#0b1024]">{org.externalApiToken ? t("subscription.tokenIssued") : t("subscription.tokenMissing")}</dd>
              </div>
              <div>
                <dt className="text-[#8a8ea4]">{t("subscription.paidTotal")}</dt>
                <dd className="mt-1 font-semibold tabular-nums text-[#0b1024]">{t("format.rubles", { amount: paidTotalRub })}</dd>
              </div>
            </dl>
            {canBill ? (
              <div className="mt-6 border-t border-[#eef0f6] pt-5">
                <OrgSettingsForm
                  organizationId={org.id}
                  initialName={org.name}
                  initialPlan={plan}
                  initialSubscriptionEnd={paidUntil?.toISOString() ?? null}
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
            ) : (
              <p className="mt-5 border-t border-[#eef0f6] pt-4 text-[12.5px] text-[#9b9fb3]">{t("readOnly")}</p>
            )}
          </div>

          {canBill ? (
            <BalanceCard
              organizationId={org.id}
              organizationName={org.name}
              balanceRub={org.balanceRub}
              referredByName={referredBy?.name ?? null}
              referredCount={referredCount}
              transactions={transactions.map((tx) => ({
                id: tx.id,
                amount: tx.amount,
                kind: tx.kind,
                description: tx.description,
                createdAt: tx.createdAt.toISOString(),
              }))}
            />
          ) : null}

          <div className={`${CARD} p-5 md:p-6`}>
            <div className="mb-4 flex items-baseline gap-3">
              <span className={SECTION_TITLE}>{t("payments.title")}</span>
              <span className="text-[14px] text-[#8a8ea4]">{payments.length === 0 ? t("payments.none") : t("payments.count", { count: payments.length })}</span>
            </div>
            {payments.length === 0 ? (
              <p className="text-[14px] text-[#9b9fb3]">{t("payments.empty")}</p>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5 md:-mx-6 md:px-6">
                <table className="w-full min-w-[640px] text-[14px]">
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
                      <tr key={payment.id} className="border-t border-[#f2f3f8] align-top">
                        <td className="py-2.5 text-[#0b1024]">{organizationDate(payment.paidAt ?? payment.createdAt, locale)}</td>
                        <td className="py-2.5 text-[#6f7282]">{isTopupOrder(payment) ? t("payments.topup") : payment.tariffKey}</td>
                        <td className="py-2.5">
                          <span
                            className={
                              payment.status === "paid" && !payment.refundedAt
                                ? "rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[12px] text-[#116b2a]"
                                : "rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] text-[#6f7282]"
                            }
                          >
                            {organizationOrderStatus(payment, t)}
                          </span>
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-[#0b1024]">
                          {t("format.rubles", { amount: Number(payment.amountRub) })}
                          {payment.pointsSpent > 0 && !payment.refundedAt ? (
                            <span className="ml-1 text-[12px] text-[#3848c7]">{t("payments.pointsSpent", { amount: payment.pointsSpent })}</span>
                          ) : null}
                          {payment.promotionPercent && payment.promotionDiscountRub > 0 ? (
                            <div className="text-[12px] text-[#116b2a]">{t("payments.promotion", { percent: payment.promotionPercent, amount: payment.promotionDiscountRub })}</div>
                          ) : null}
                          {payment.promoCode && payment.discountRub > 0 ? (
                            <div className="text-[12px] text-[#3848c7]">{t("payments.promo", { code: payment.promoCode, amount: payment.discountRub })}</div>
                          ) : null}
                        </td>
                        <td className="py-2.5 pl-4">
                          {payment.paymentMethod === "invoice" && payment.status !== "cancelled" ? (
                            canBill ? (
                              <InvoiceActions
                                orderId={payment.id}
                                amountRub={Number(payment.amountRub)}
                                organizationName={org.name}
                                pending={payment.status === "pending"}
                                purpose={isTopupOrder(payment) ? "topup" : "subscription"}
                              />
                            ) : (
                              <a href={`/api/payments/invoice/${payment.id}/pdf`} className="text-[13px] font-medium text-[#3848c7] hover:underline">
                                PDF
                              </a>
                            )
                          ) : closingEligible(payment) ? (
                            <a
                              href={`/api/closing-documents/${payment.id}/pdf`}
                              className="inline-flex h-8 items-center rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                            >
                              {t("payments.closingPdf")}
                            </a>
                          ) : heldForReview(payment) ? null : (
                            <span className="text-[#c9ccdb]">—</span>
                          )}
                          {heldForReview(payment) && canBill ? (
                            <div className={payment.paymentMethod === "invoice" ? "mt-1.5" : undefined}>
                              <HeldOrderActions orderId={payment.id} />
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Сотрудники с контактами */}
        <section id="people" className={`${CARD} scroll-mt-16`} data-client-people>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#eef0f6] px-5 py-4 md:px-6">
            <span className={SECTION_TITLE}>{t("people.title")}</span>
            <span className="text-[13px] text-[#8a8ea4]">
              {formatNumber(locale, people.length)} · {t("people.withContacts", { count: withContacts })}
            </span>
          </div>
          <ul className="divide-y divide-[#eef0f6]">
            {people.map((person) => (
              <li
                key={person.id}
                data-person={person.id}
                className={`grid gap-2 px-5 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_auto] md:items-center md:gap-4 md:px-6 ${person.archived || !person.isActive ? "opacity-60" : ""}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium text-[#0b1024]">{person.name}</span>
                    {person.isOwner ? <Badge tone="gold">{t("people.ownerBadge")}</Badge> : null}
                    {person.archived ? <Badge>{t("people.archived")}</Badge> : !person.isActive ? <Badge>{t("users.inactive")}</Badge> : null}
                  </div>
                  <div className="truncate text-[12px] text-[#9b9fb3]">{[person.position, organizationRole(person.role, roleCopy)].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="min-w-0 text-[13px]">
                  {person.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <a href={`tel:${person.phone.replace(/[^\d+]/g, "")}`} className="tabular-nums text-[#3848c7] hover:underline">
                        {person.phone}
                      </a>
                      <CopyButton value={person.phone} />
                    </span>
                  ) : (
                    <span className="text-[#c9ccdb]">—</span>
                  )}
                </div>
                <div className="min-w-0 text-[13px]">
                  {person.email ? (
                    <span className="inline-flex max-w-full items-center gap-1">
                      <a href={`mailto:${person.email}`} className="truncate text-[#3848c7] hover:underline">
                        {person.email}
                      </a>
                      <CopyButton value={person.email} />
                    </span>
                  ) : (
                    <span className="text-[#c9ccdb]">—</span>
                  )}
                  {person.telegram || person.max ? (
                    <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-[#6f7282]">
                      <MessageCircle className="size-3" />
                      {[person.telegram ? "Telegram" : null, person.max ? "MAX" : null].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                </div>
                <div className="text-[12.5px] text-[#6f7282]">
                  {person.lastLoginAt ? organizationDate(new Date(person.lastLoginAt), locale) : t("people.never")}
                </div>
                <div className="md:text-right">
                  {viewer.superadmin && !person.isRoot ? <PanelAccessButton user={{ id: person.id, name: person.name }} sections={person.platformSections} /> : null}
                  {person.isRoot ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-[#3848c7]">
                      <ShieldCheck className="size-3.5" />
                      {t("people.panel")}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Входы владельца: IP при регистрации и последнего входа. */}
        <section id="security" className={`${CARD} scroll-mt-16 p-5 md:p-6`}>
          <div className={SECTION_TITLE}>{t("security.title")}</div>
          {owner && (owner.registrationIp || owner.lastLoginIp) ? (
            <dl className="mt-3 grid gap-4 text-[13.5px] sm:grid-cols-3">
              <IpRow label={t("security.registrationIp")} ip={owner.registrationIp} />
              <IpRow label={t("security.lastLoginIp")} ip={owner.lastLoginIp} />
              <div>
                <dt className="text-[#8a8ea4]">{t("security.lastLoginAt")}</dt>
                <dd className="mt-1 text-[#0b1024]">{owner.lastLoginAt ? organizationDate(new Date(owner.lastLoginAt), locale) : "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-[13px] text-[#9b9fb3]">{t("security.none")}</p>
          )}
        </section>
      </div>
    </DomainMessagesBoundary>
  );
}

function ContactLine({
  icon,
  value,
  href,
  empty,
  hint,
  big,
  external,
  dataKey,
}: {
  icon: React.ReactNode;
  value: string | null;
  href?: string | null;
  empty?: string;
  hint?: string;
  big?: boolean;
  external?: boolean;
  dataKey?: string;
}) {
  if (!value) return empty ? <div className="flex items-center gap-2 text-[13px] text-[#c9ccdb]">{icon}{empty}</div> : null;
  return (
    <div className="flex min-w-0 items-center gap-2" data-contact={dataKey}>
      <span className="shrink-0 text-[#5566f6]">{icon}</span>
      {href ? (
        <a
          href={href}
          {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
          className={`truncate tabular-nums text-[#3848c7] hover:underline ${big ? "text-[16px] font-semibold" : "text-[14px]"}`}
        >
          {value}
        </a>
      ) : (
        <span className="text-[13.5px] leading-snug text-[#3c4053]">{value}</span>
      )}
      {hint ? <span className="shrink-0 text-[11.5px] text-[#9b9fb3]">{hint}</span> : null}
      {href ? <CopyButton value={value} /> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
      <dt className="text-[#8a8ea4]">{label}</dt>
      <dd className="break-words text-[#0b1024]">{value}</dd>
    </div>
  );
}

function IpRow({ label, ip }: { label: string; ip: string | null }) {
  return (
    <div>
      <dt className="text-[#8a8ea4]">{label}</dt>
      <dd className="mt-1">
        {ip ? (
          <a href={`https://ipinfo.io/${encodeURIComponent(ip)}`} target="_blank" rel="noreferrer noopener" className="tabular-nums text-[#3848c7] hover:underline">
            {ip}
          </a>
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "gold" }) {
  return (
    <span className={tone === "gold" ? "rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11.5px] font-medium text-[#7a4a00]" : "rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11.5px] font-medium text-[#3848c7]"}>
      {children}
    </span>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white p-3.5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="text-[11.5px] font-medium uppercase tracking-wider text-[#8a8ea4]">{label}</div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums text-[#0b1024]">{value}</div>
      {hint ? <div className="text-[11.5px] text-[#9b9fb3]">{hint}</div> : null}
    </div>
  );
}
