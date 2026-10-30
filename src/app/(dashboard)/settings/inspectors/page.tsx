import Link from "next/link";
import { forbidden } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { journalTitle } from "@/i18n/journal-presentation";
import { loadMessages } from "@/i18n/messages";
import { ArrowRight, Link2, QrCode } from "lucide-react";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { loadInspectorsAuditors } from "@/lib/inspectors-auditors.server";
import type { ExternalInspectorStatus, InternalRoleKind } from "@/lib/inspectors-auditors";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import {
  PersonAvatar,
  STAFF_BUTTON_PRIMARY,
  STAFF_LINK,
  STAFF_PILL,
  StaffCard,
  StaffEmptyState,
} from "@/components/staff/staff-page-ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PORTAL_HREF = "/settings/inspector-portal";
/** Сколько объектов роли показываем в строке до «и ещё N». */
const ITEMS_PREVIEW = 3;

const STATUS_CLASS: Record<ExternalInspectorStatus, string> = {
  active: "bg-[#ecfdf5] text-[#116b2a]",
  expired: "bg-[#f3f4f8] text-[#6f7282]",
  revoked: "bg-[#fff4f2] text-[#a13a32]",
};

/**
 * «Проверяющие и аудиторы» — общий список (скан 82, «Отдельно»): внешние —
 * доступы портала проверяющего (QR и ссылки) с визитами, внутренние —
 * сотрудники с ролями проверки. Данные — та же функция, что у
 * `GET /api/staff/inspectors-auditors`.
 */
export default async function InspectorsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // «Ответственных за журналы» (там меняют проверяющего журнала и аудиторов) открывает admin.full.
  const canEditResponsibles = hasCapability(session.user, "admin.full");

  const [data, organization, t, locale] = await Promise.all([
    loadInspectorsAuditors(organizationId),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    getTranslations("staffPages.inspectors"),
    getLocale(),
  ]);
  const journalNames = (await loadMessages(locale)).journals.names;
  // Журналы — на языке страницы; документы и помещения названы людьми.
  const itemName = (kind: InternalRoleKind, item: { id: string; name: string }) =>
    kind === "document_verifier" || kind === "room_verifier"
      ? item.name
      : journalTitle(locale, journalNames, item.id, item.name);
  const timeZone = organization?.timezone || "Europe/Moscow";
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone });
  const dateTime = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

  /** Где роль меняется: ссылка (если страница откроется) или подсказка. */
  const roleLink = (kind: InternalRoleKind, itemId: string): { href: string; label: string } | null => {
    if (kind === "document_verifier") {
      const code = data.documentJournals[itemId];
      return code ? { href: `/journals/${code}/documents/${itemId}`, label: t("internal.openDocument") } : null;
    }
    if (kind === "room_verifier") return { href: "/settings/buildings", label: t("internal.openRooms") };
    return canEditResponsibles ? { href: "/settings/journal-responsibles", label: t("internal.openResponsibles") } : null;
  };

  const issueButton = (
    <Link href={PORTAL_HREF} className={STAFF_BUTTON_PRIMARY} data-testid="inspectors-issue-qr">
      <QrCode className="size-4" />
      {t("external.issue")}
    </Link>
  );

  return (
    <div className="space-y-4" data-inspectors-page>
      <SectionPageHeader description={t("description")} />

      <StaffCard
        id="external"
        number={1}
        title={t("external.title")}
        description={t("external.hint")}
        aside={data.external.length > 0 ? issueButton : null}
      >
        {data.external.length === 0 ? (
          <StaffEmptyState title={t("external.emptyTitle")} hint={t("external.emptyHint")}>
            {issueButton}
          </StaffEmptyState>
        ) : (
          <>
            <p className="mb-3 text-[13px] text-[#6f7282]">
              {t("external.summary", { active: String(data.totals.externalActive), total: String(data.totals.externalTotal) })}
            </p>
            <ul className="space-y-2" data-inspectors-external>
              {data.external.map((entry) => {
                return (
                  <li
                    key={entry.id}
                    data-token-status={entry.status}
                    className={cn(
                      "rounded-2xl border border-[#ececf4] px-4 py-3",
                      entry.active ? "bg-white" : "bg-[#fafbff]"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
                        {entry.kind === "qr" ? (
                          <QrCode className="size-4" aria-hidden />
                        ) : (
                          <Link2 className="size-4" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 basis-[180px] text-[14px] font-medium text-[#0b1024] [overflow-wrap:anywhere]">
                        {entry.label?.trim() || t(`external.kind.${entry.kind}`)}
                      </span>
                      <span className={cn(STAFF_PILL, STATUS_CLASS[entry.status])}>{t(`external.status.${entry.status}`)}</span>
                    </div>
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
                      <div className="flex gap-1.5">
                        <dt className="text-[#9b9fb3]">{t("external.period")}</dt>
                        <dd className="text-[#3c4053]">
                          {entry.periodFrom && entry.periodTo
                            ? `${date.format(new Date(entry.periodFrom))} — ${date.format(new Date(entry.periodTo))}`
                            : t("external.periodOpen")}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-[#9b9fb3]">{entry.status === "expired" ? t("external.expired") : t("external.expires")}</dt>
                        <dd className="tabular-nums text-[#3c4053]">{date.format(new Date(entry.expiresAt))}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-[#9b9fb3]">{t("external.issuedBy")}</dt>
                        <dd className="text-[#3c4053]">{entry.issuedBy?.name ?? t("external.issuedUnknown")}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-[#9b9fb3]">{t("external.opened")}</dt>
                        <dd className="text-[#3c4053]">
                          {entry.accessCount > 0
                            ? t("external.openedCount", {
                                count: entry.accessCount,
                                last: entry.lastAccessedAt ? dateTime.format(new Date(entry.lastAccessedAt)) : "—",
                              })
                            : t("external.openedNever")}
                        </dd>
                      </div>
                    </dl>
                    {entry.visits.length > 0 ? (
                      <div className="mt-2 border-t border-[#ececf4] pt-2">
                        <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                          {t("external.visits", { count: String(entry.visits.length) })}
                        </div>
                        <ul className="mt-1 space-y-0.5 text-[12.5px] text-[#3c4053]">
                          {entry.visits.slice(0, ITEMS_PREVIEW).map((visit) => (
                            <li key={visit.id} className="[overflow-wrap:anywhere]">
                              <span className="tabular-nums text-[#6f7282]">{dateTime.format(new Date(visit.signedAt))}</span>
                              {" — "}
                              {visit.inspectorName?.trim() || t("external.visitAnonymous")}
                              {visit.journalsViewed > 0 ? (
                                <span className="text-[#6f7282]">{` · ${t("external.visitJournals", { count: String(visit.journalsViewed) })}`}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </StaffCard>

      <StaffCard id="internal" number={2} title={t("internal.title")} description={t("internal.hint")}>
        {data.internal.length === 0 ? (
          <StaffEmptyState title={t("internal.emptyTitle")} hint={t("internal.emptyHint")}>
            {canEditResponsibles ? (
              <Link href="/settings/journal-responsibles" className={STAFF_LINK}>
                {t("internal.openResponsibles")}
                <ArrowRight className="size-3.5" />
              </Link>
            ) : null}
          </StaffEmptyState>
        ) : (
          <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]" data-inspectors-internal>
            {data.internal.map((person) => (
              <li key={person.userId} data-person={person.name} className="flex flex-wrap items-start gap-x-3 gap-y-2 bg-white px-3 py-3 sm:px-4">
                <PersonAvatar name={person.name} />
                <div className="min-w-0 flex-1 basis-[220px]">
                  <div className="text-[14px] font-medium text-[#0b1024]">{person.name}</div>
                  {person.position ? <div className="text-[12.5px] text-[#6f7282]">{person.position}</div> : null}
                  <ul className="mt-2 space-y-1.5">
                    {person.roles.map((role) => {
                      const preview = role.items.slice(0, ITEMS_PREVIEW);
                      const rest = role.items.length - preview.length;
                      // Документ — своя ссылка на каждый; остальные роли меняются в одном месте.
                      const shared = role.kind === "document_verifier" ? null : roleLink(role.kind, "");
                      return (
                        <li key={role.kind} className="space-y-1.5 text-[12.5px]" data-role={role.kind}>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className={cn(STAFF_PILL, "bg-[#eef1ff] text-[#3848c7]")}>{t(`roles.${role.kind}`)}</span>
                            {shared ? (
                              <Link href={shared.href} className={cn(STAFF_LINK, "text-[12.5px]")}>
                                {shared.label}
                                <ArrowRight className="size-3" />
                              </Link>
                            ) : null}
                          </div>
                          <ul className="flex flex-wrap gap-1.5">
                            {preview.map((item) => {
                              const link = role.kind === "document_verifier" ? roleLink(role.kind, item.id) : null;
                              return (
                                <li key={item.id} className="min-w-0 max-w-full">
                                  {link ? (
                                    <Link
                                      href={link.href}
                                      title={link.label}
                                      className="inline-flex max-w-full items-center rounded-full border border-[#dfe3ff] bg-white px-2.5 py-0.5 text-[12px] text-[#3848c7] transition-colors duration-150 [overflow-wrap:anywhere] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                                    >
                                      {itemName(role.kind, item)}
                                    </Link>
                                  ) : (
                                    <span className="inline-flex max-w-full items-center rounded-full border border-[#ececf4] bg-[#fafbff] px-2.5 py-0.5 text-[12px] text-[#3c4053] [overflow-wrap:anywhere]">
                                      {itemName(role.kind, item)}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                            {rest > 0 ? (
                              <li className="inline-flex items-center px-1 text-[12px] text-[#6f7282]">
                                {t("internal.more", { count: String(rest) })}
                              </li>
                            ) : null}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </StaffCard>
    </div>
  );
}
