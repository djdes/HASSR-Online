import Link from "next/link";
import {
  Bug,
  Lightbulb,
  LifeBuoy,
  Handshake,
  MessageSquareText,
  Phone,
  Send,
  Globe,
  User,
  Building2,
  Filter,
  Link2,
} from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  getPlatformAdminEmails,
  getPlatformAdminRecipientChatIds,
  maskChatId,
  maskEmail,
} from "@/lib/platform-admin";
import type { Prisma } from "@prisma/client";
import { parseStoredAttachments } from "@/lib/support-attachments";
import { ticketCode } from "@/lib/bug-report";
import { getPartnerThreadOwnership } from "@/lib/support-threads";
import { threadKindOf } from "@/lib/support-threads-shared";
import { FeedbackReply } from "./feedback-reply";
import { SupportChats, type RootChatThread } from "./support-chats";
import { ClientLinks, FeedbackHashFocus } from "./client-links";
import { resolveSupportClientHrefs } from "@/lib/support-staff-alerts.server";
import { supportAlertWho } from "@/lib/support-staff-alerts";
import { canEnterClientCabinets } from "@/lib/platform-access";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { TestNotifyButton } from "./test-notify-button";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { FeedbackCopyProvider } from "./feedback-copy-provider";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { feedbackSourceKey, feedbackTypeKey, formatFeedbackReportDate } from "./feedback-report-presentation";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("rootFeedbackReports.metadata");
  return { title: t("title") };
}

const TYPE_LABELS: Record<string, { icon: typeof Bug; color: string; bg: string; border: string }> = {
  bug: {
    icon: Bug,
    color: "#d2453d",
    bg: "#fff4f2",
    border: "#ffd2cd",
  },
  suggestion: {
    icon: Lightbulb,
    color: "#5566f6",
    bg: "#eef1ff",
    border: "#c7ccea",
  },
  partnership: {
    icon: Handshake,
    color: "#7a5cff",
    bg: "#f5f3ff",
    border: "#ddd6fe",
  },
  // Обращение из Telegram-бота — человек просто написал в поддержку.
  support: {
    icon: LifeBuoy,
    color: "#116b2a",
    bg: "#ecfdf5",
    border: "#b6e3d2",
  },
};

const SOURCE_LABELS: Record<string, { icon: typeof Globe }> = {
  site: { icon: Globe },
  telegram: { icon: Send },
};

type SearchParams = {
  type?: string;
  org?: string;
  answered?: string;
};

export default async function RootFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireRoot();
  const viewer = await platformViewerForSession(session);
  // «Войти в кабинет» — тем, кому панель разрешает вход к клиенту.
  const canEnter = canEnterClientCabinets(viewer);
  const t = await getTranslations("rootFeedbackReports");
  const pageLocale = await getSiteLocale();
  const { type: rawType, org: rawOrg, answered: rawAnswered } = await searchParams;

  const typeFilter =
    rawType === "bug" || rawType === "suggestion" || rawType === "support"
      ? rawType
      : null;
  const orgFilter = rawOrg && rawOrg.trim() !== "" ? rawOrg : null;
  // «Без ответа» — рабочий inbox: что осталось разобрать.
  const unansweredOnly = rawAnswered === "no";

  const where: Prisma.FeedbackReportWhereInput = {
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(orgFilter ? { organizationId: orgFilter } : {}),
    ...(unansweredOnly ? { responseMessage: null } : {}),
  };

  const [
    reports,
    totalAll,
    totalBugs,
    totalSuggestions,
    totalSupport,
    totalUnanswered,
    orgs,
  ] = await Promise.all([
      db.feedbackReport.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      db.feedbackReport.count(),
      db.feedbackReport.count({ where: { type: "bug" } }),
      db.feedbackReport.count({ where: { type: "suggestion" } }),
      db.feedbackReport.count({ where: { type: "support" } }),
      db.feedbackReport.count({ where: { responseMessage: null } }),
      db.feedbackReport.groupBy({
        by: ["organizationId", "organizationName"],
        _count: { _all: true },
        orderBy: { _count: { organizationId: "desc" } },
      }),
    ]);

  // Кому уходят обращения: env, администраторы и менеджеры с разделом «Обратная связь» (почта и привязанный Telegram).
  const [recipientChatIds, recipientEmails] = await Promise.all([
    getPlatformAdminRecipientChatIds("support"),
    getPlatformAdminEmails("support"),
  ]);
  const adminChatIds = recipientChatIds.map(maskChatId);
  const adminEmail = recipientEmails.length ? recipientEmails.map(maskEmail).join(", ") : null;

  const orgOptions = orgs
    .filter((o) => o.organizationId)
    .map((o) => ({
      id: o.organizationId as string,
      name: o.organizationName ?? o.organizationId ?? "—",
      count: o._count._all,
    }));

  const filtered = Boolean(typeFilter || orgFilter || unansweredOnly);

  // Онлайн-чаты: отдельная сущность от обращений, поэтому и грузим
  // отдельно. Показываем последние ветки целиком — переписка коротка,
  // а разбирать её без контекста бессмысленно.
  const [chatThreadRows, allOrganizations] = await Promise.all([
    db.supportThread.findMany({
      orderBy: { lastMessageAt: "desc" },
      take: 30,
      select: {
        id: true,
        key: true,
        userName: true,
        userEmail: true,
        phone: true,
        organizationId: true,
        organizationName: true,
        unreadForStaff: true,
        unreadForClient: true,
        lastMessageAt: true,
        // Последние 50 реплик ветки (раньше — первые 50: в длинной ветке
        // новые сообщения не было видно).
        messages: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            author: true,
            body: true,
            operatorName: true,
            authorName: true,
            attachments: true,
            replyToId: true,
            createdAt: true,
          },
        },
      },
    }),
    db.organization.findMany({
      where: { isDemo: false },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  // Кто отвечает: организация с активным партнёром ждёт партнёра, не нас.
  const ownership = await getPartnerThreadOwnership(
    chatThreadRows.map((t) => t.organizationId).filter((id): id is string => Boolean(id))
  );
  // Карточки клиентов одним заходом: обращения и ветки чатов.
  const clientHrefs = await resolveSupportClientHrefs([
    ...reports.map((r) => ({ key: `report:${r.id}`, organizationId: r.organizationId, email: r.userEmail, phone: r.phone })),
    ...chatThreadRows.map((thread) => ({
      key: `chat:${thread.id}`,
      organizationId: thread.organizationId,
      email: thread.userEmail,
      phone: thread.phone,
    })),
  ]).catch(() => new Map<string, string | null>());
  const platform = platformOrgId();
  const cabinetOf = (organizationId: string | null) =>
    canEnter && organizationId && organizationId !== platform ? organizationId : null;
  const clientLinkLabels = {
    clientCard: t("page.clientCard"),
    enterCabinet: t("page.enterCabinet"),
    enterCabinetFailed: t("page.enterCabinetFailed"),
    call: t("page.call"),
    writeEmail: t("page.writeEmail"),
  };

  const chatThreads: RootChatThread[] = chatThreadRows.map((t) => ({
    id: t.id,
    kind: threadKindOf(t.key),
    organizationId: t.organizationId,
    organizationName: t.organizationName,
    userName: t.userName,
    userEmail: t.userEmail,
    phone: t.phone,
    unreadForStaff: t.unreadForStaff,
    unreadForClient: t.unreadForClient,
    lastMessageAt: t.lastMessageAt.toISOString(),
    partner: (t.organizationId && ownership.get(t.organizationId)) || null,
    clientHref: clientHrefs.get(`chat:${t.id}`) ?? null,
    cabinetOrganizationId: cabinetOf(t.organizationId),
    messages: [...t.messages].reverse().map((m) => ({
      id: m.id,
      author: m.author,
      body: m.body,
      operatorName: m.operatorName,
      authorName: m.authorName,
      attachments: parseStoredAttachments(m.attachments),
      replyToId: m.replyToId,
      createdAt: m.createdAt.toISOString(),
    })),
  }));

  return (
    <DomainMessagesBoundary namespaces={["rootFeedbackReports"]}>
    <FeedbackCopyProvider>
    {/* «Открыть» из всплывашки и колокольчика: якорь обращения или ветки. */}
    <FeedbackHashFocus />
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-black">
            {t("page.title")}
          </h1>
          <p className="mt-2 text-[15px] text-[#6f7282]">
            {t("page.stats", { total: String(totalAll), bugs: String(totalBugs), suggestions: String(totalSuggestions), support: String(totalSupport), unanswered: String(totalUnanswered) })}
            {filtered ? t("page.filteredCount", { count: String(reports.length) }) : ""}
          </p>
        </div>
        <TestNotifyButton
          chatIdsMasked={adminChatIds}
          emailMasked={adminEmail}
        />
      </div>

      {/* Владелец, 2026-11-23: чаты — короткий блок, обращения видно сразу.
          На широком экране — рядом: чаты слева (своя прокрутка), обращения
          справа; на узком — чаты в короткой прокрутке, обращения под ними. */}
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start" data-feedback-layout>
      <div className="min-w-0 xl:sticky xl:top-4" data-feedback-column="chats">
        <SupportChats threads={chatThreads} organizations={allOrganizations} />
      </div>

      <div className="min-w-0 space-y-4" data-feedback-column="reports">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
        {t("page.requestsTitle")}
        <span className="ml-2 text-[13px] font-normal text-[#6f7282]">{reports.length}</span>
      </h2>
      <div className="rounded-2xl bg-white p-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#6f7282]">
          <Filter className="size-4" />
          {t("page.filters")}
        </div>
        <form
          method="GET"
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="type"
              className="text-[12px] font-medium uppercase tracking-wider text-[#9b9fb3]"
            >
              {t("page.typeLabel")}
            </label>
            <select
              id="type"
              name="type"
              defaultValue={typeFilter ?? ""}
              className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 sm:w-auto sm:min-w-[160px]"
            >
              <option value="">{t("page.allTypes")}</option>
              <option value="bug">{t("page.bugCount", { count: String(totalBugs) })}</option>
              <option value="suggestion">{t("page.suggestionCount", { count: String(totalSuggestions) })}</option>
              <option value="support">{t("page.supportCount", { count: String(totalSupport) })}</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="answered"
              className="text-[12px] font-medium uppercase tracking-wider text-[#9b9fb3]"
            >
              {t("page.statusLabel")}
            </label>
            <select
              id="answered"
              name="answered"
              defaultValue={unansweredOnly ? "no" : ""}
              className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 sm:w-auto sm:min-w-[160px]"
            >
              <option value="">{t("page.allReports")}</option>
              <option value="no">{t("page.unansweredCount", { count: String(totalUnanswered) })}</option>
            </select>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label
              htmlFor="org"
              className="text-[12px] font-medium uppercase tracking-wider text-[#9b9fb3]"
            >
              {t("page.organizationLabel")}
            </label>
            <select
              id="org"
              name="org"
              defaultValue={orgFilter ?? ""}
              className="h-10 w-full min-w-0 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 sm:min-w-[200px]"
            >
              <option value="">{t("page.allOrganizations")}</option>
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.count})
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="h-10 rounded-xl bg-[#5566f6] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
          >
            {t("page.apply")}
          </button>

          {filtered ? (
            <Link
              href="/root/feedback"
              className="h-10 rounded-xl bg-[var(--app-veil)] px-4 text-[13px] font-medium leading-10 text-[#0b1024] transition-colors hover:bg-[var(--app-veil-hover)]"
            >
              {t("page.reset")}
            </Link>
          ) : null}
        </form>
      </div>

      {reports.length === 0 ? (
        <div className="rounded-2xl bg-white px-8 py-16 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#f5f6ff] text-[#5566f6]">
            <MessageSquareText className="size-7" />
          </div>
          <p className="mt-4 text-[17px] font-semibold text-[#0b1024]">
            {t("page.emptyTitle")}
          </p>
          <p className="mt-2 text-[14px] text-[#6f7282]">
            {filtered
              ? t("page.emptyFiltered")
              : t("page.emptyAll")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const theme = Object.hasOwn(TYPE_LABELS, r.type) ? TYPE_LABELS[r.type] : TYPE_LABELS.suggestion;
            const Icon = theme.icon;
            const source = Object.hasOwn(SOURCE_LABELS, r.source) ? SOURCE_LABELS[r.source] : SOURCE_LABELS.site;
            const SourceIcon = source.icon;
            const attachments = parseStoredAttachments(r.attachments);
            const replyAttachments = parseStoredAttachments(r.replyAttachments);
            return (
              <li
                key={r.id}
                id={`report-${r.id}`}
                className="scroll-mt-24 rounded-2xl bg-white p-5 transition-shadow duration-300 target:ring-2 target:ring-[#5566f6] data-[flash]:ring-2 data-[flash]:ring-[#5566f6]"
              >
                <div className="flex items-start gap-4">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: theme.bg,
                      color: theme.color,
                    }}
                    aria-hidden
                  >
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                        )}
                        style={{
                          backgroundColor: theme.bg,
                          color: theme.color,
                        }}
                      >
                        {t(feedbackTypeKey(r.type))}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
                        <SourceIcon className="size-3" />
                        {t(feedbackSourceKey(r.source))}
                      </span>
                      {r.responseMessage ? null : (
                        <span className="inline-flex items-center rounded-full bg-[#fff4f2] px-2 py-0.5 text-[11px] font-medium text-[#a13a32]">
                          {t("page.unansweredBadge")}
                        </span>
                      )}
                      {r.organizationName ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-medium text-[#5566f6]">
                          <Building2 className="size-3" />
                          {r.organizationName}
                        </span>
                      ) : null}
                      <span className="ml-auto text-[12px] text-[#9b9fb3]">
                        <span className="font-mono">{ticketCode(r.id)}</span>
                        {" · "}
                        {formatFeedbackReportDate(r.createdAt, pageLocale)}
                      </span>
                    </div>

                    <p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-[1.55] text-[#0b1024]">
                      {r.message}
                    </p>

                    {attachments.map((a, ai) => (
                      <a
                        key={ai}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block text-[13px] text-[#3848c7] underline-offset-2 hover:underline"
                      >
                        📎 {a.filename}
                      </a>
                    ))}

                    {r.responseMessage ? (
                      <div className="mt-4 rounded-xl bg-[#f5f6ff] p-3">
                        <div className="text-[12px] font-medium text-[#5566f6]">
                          {t("page.responseHeading")}{r.respondedByName ? ` · ${r.respondedByName}` : ""}
                          {r.respondedAt ? ` · ${formatFeedbackReportDate(r.respondedAt, pageLocale)}` : ""}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-[1.55] text-[#0b1024]">
                          {r.responseMessage}
                        </p>
                        {replyAttachments.map((a, ai) => (
                          <a
                            key={ai}
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block text-[13px] text-[#3848c7] underline-offset-2 hover:underline"
                          >
                            📎 {a.filename}
                          </a>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#6f7282]">
                      {r.userName || r.userEmail ? (
                        <span className="inline-flex items-center gap-1.5">
                          <User className="size-3.5" />
                          {[r.userName, r.userEmail]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                      {r.phone ? (
                        <a
                          href={`tel:${r.phone.replace(/[^+\d]/g, "")}`}
                          className="inline-flex items-center gap-1.5 hover:text-[#5566f6]"
                        >
                          <Phone className="size-3.5" />
                          {r.phone}
                        </a>
                      ) : null}
                      {r.pageUrl ? (
                        <a
                          href={r.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={t("page.openPage")}
                          className="inline-flex min-w-0 items-center gap-1.5 break-all hover:text-[#5566f6]"
                        >
                          <Link2 className="size-3.5 shrink-0" />
                          {r.pageUrl.replace(/^https?:\/\/[^/]+/, "")}
                        </a>
                      ) : null}
                    </div>
                    {/* Статусы появились вместе с этой панелью: у старых
                        обращений обеих отметок нет, и «✗✗» там врало бы. */}
                    <div className="mt-2 text-[11px] text-[#9b9fb3]">
                      {r.adminTgNotifiedAt || r.adminEmailedAt
                        ? t("page.adminNotifications", { telegram: r.adminTgNotifiedAt ? "✓" : "✗", email: r.adminEmailedAt ? "✓" : "✗" })
                        : t("page.adminNotificationsNoData")}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <FeedbackReply
                        reportId={r.id}
                        hasRecipient={Boolean(r.userId && r.organizationId)}
                        hasTelegram={Boolean(r.telegramChatId)}
                        hasEmail={Boolean(r.userEmail)}
                        context={{
                          ticket: ticketCode(r.id),
                          typeLabel: t(feedbackTypeKey(r.type)),
                          dateLabel: formatFeedbackReportDate(r.createdAt, pageLocale),
                          message: r.message,
                          attachments,
                          pageUrl: r.pageUrl,
                          who: supportAlertWho({
                            name: r.userName,
                            email: r.userEmail,
                            phone: r.phone,
                            organizationName: r.organizationName,
                          }),
                        }}
                      />
                      {/* К клиенту из обращения: карточка, кабинет, звонок, почта. */}
                      <ClientLinks
                        clientHref={clientHrefs.get(`report:${r.id}`) ?? null}
                        cabinetOrganizationId={cabinetOf(r.organizationId)}
                        phone={r.phone}
                        email={r.userEmail}
                        labels={clientLinkLabels}
                      />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      </div>
      </div>
    </div>
    </FeedbackCopyProvider>
    </DomainMessagesBoundary>
  );
}
