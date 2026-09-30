import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarDays, Link2, Users } from "lucide-react";

import { AccrualsTable, serializeAccrual } from "@/components/partner/accruals-table";
import { ClientCardActions } from "@/components/partner/client-card-actions";
import { ClientNotes } from "@/components/partner/client-notes";
import { ClientAccessLevel } from "@/components/partner/client-access-level";
import { ClientHandoverCard } from "@/components/partner/client-handover-card";
import { ClientOrgCard } from "@/components/partner/client-org-card";
import { ClientReturnCard } from "@/components/partner/client-return-card";
import { Card, Pill, formatDate, formatRubFixed, planLabel } from "@/components/partner/ui";
import { PARTNER_ACCESS_LEVEL_LABELS } from "@/lib/partners/access-guard";
import { getPartnerClientCard } from "@/lib/partners/client-card";
import { loadReturnPreview } from "@/lib/partners/org-conversion";
import { CONVERTED_SOURCE } from "@/lib/partners/org-conversion-core";
import { PartnerError } from "@/lib/partners/errors";
import { requirePartnerPage } from "@/lib/partners/page-context";
import { sphereLabel } from "@/lib/org-profile";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  link: "по ссылке",
  code: "по коду",
  invite: "по email-приглашению",
  manual: "вручную",
  [CONVERTED_SOURCE]: "переведена из личного аккаунта",
};

const DETACHED_BY_LABELS: Record<string, string> = {
  client: "клиентом",
  partner: "вами",
  admin: "администратором WeSetup",
};

export default async function PartnerClientPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { membership, session } = await requirePartnerPage();
  const { orgId } = await params;

  let card;
  try {
    card = await getPartnerClientCard(membership.partnerId, orgId);
  } catch (error) {
    if (error instanceof PartnerError && error.status === 404) notFound();
    throw error;
  }

  const { link, organization, notes, accruals, balances, handover } = card;
  const detached = Boolean(link.detachedAt);
  // «Сделать моей организацией» — только тому, кто сам перевёл её из
  // своего аккаунта (lib/partners/org-conversion-core.ts → planReturn).
  const returnPreview =
    !detached && link.source === CONVERTED_SOURCE
      ? await loadReturnPreview({
          partnerId: membership.partnerId,
          userId: session.user.id,
          organizationId: organization.id,
        })
      : null;

  return (
    <div className="space-y-5">
      <Link href="/partner" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6f7282] transition-colors hover:text-[#5566f6]">
        <ArrowLeft className="size-3.5" />
        Все клиенты
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{organization.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-[#6f7282]">
            <span>{sphereLabel(organization.type)}</span>
            <span aria-hidden>·</span>
            <span>{planLabel(organization.plan)}</span>
            {organization.subscriptionEnd ? <span>до {formatDate(organization.subscriptionEnd)}</span> : null}
            {detached ? (
              <Pill tone="danger">
                отключён {formatDate(link.detachedAt)}
                {link.detachedBy ? ` ${DETACHED_BY_LABELS[link.detachedBy] ?? link.detachedBy}` : ""}
              </Pill>
            ) : (
              <Pill tone={link.accessLevel === "edit" ? "indigo" : "neutral"}>{PARTNER_ACCESS_LEVEL_LABELS[link.accessLevel]}</Pill>
            )}
          </div>
        </div>
        <ClientCardActions
          organizationId={organization.id}
          organizationName={organization.name}
          accessLevel={link.accessLevel}
          detached={detached}
        />
      </div>

      {!detached ? (
        <Card title="Что вам доступно в кабинете клиента" eyebrow="Уровень доступа">
          <ClientAccessLevel
            organizationId={organization.id}
            organizationName={organization.name}
            level={link.accessLevel}
          />
          <p className="mt-3 text-[13px] leading-[1.55] text-[#6f7282]">
            {link.accessLevel === "view"
              ? "Сейчас открыт только просмотр: журналы и отчёты видны, но заполнить или настроить ничего нельзя. Переключите на редактирование, если ведёте журналы за клиента."
              : "Вы работаете в кабинете как руководитель. Деньги, подписка и удаление организации остаются только за клиентом."}{" "}
            О смене уровня клиент узнаёт сразу и может вернуть просмотр одним кликом.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card title="Заметки" eyebrow="Только для вашей команды">
            <ClientNotes organizationId={organization.id} initial={notes} />
          </Card>

          <Card
            title="Начисления по клиенту"
            eyebrow="Вознаграждение"
            actions={
              <Link href="/partner/rewards" className="text-[13px] font-medium text-[#3848c7] hover:text-[#5566f6]">
                Все начисления →
              </Link>
            }
          >
            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              <Stat label="Начислено" value={formatRubFixed(balances.accrued)} />
              <Stat label="К выплате" value={formatRubFixed(balances.payable)} />
              <Stat label="Выплачено" value={formatRubFixed(balances.paid)} />
            </div>
            <AccrualsTable
              rows={accruals.map(serializeAccrual)}
              showClient={false}
              emptyHint={
                link.firstPaymentAt
                  ? "Начисления появятся после следующей оплаты клиента."
                  : "Клиент ещё не оплачивал подписку. Первая оплата откроет 12-месячное окно вознаграждения."
              }
            />
          </Card>
        </div>

        <div className="space-y-5">
          <ClientOrgCard
            organizationId={organization.id}
            canEdit={!detached && link.accessLevel === "edit"}
            activeUsersCount={organization.activeUsersCount}
            usersCount={organization.usersCount}
            createdAt={formatDate(organization.createdAt)}
            initial={{
              name: organization.name,
              journalShortName: organization.journalShortName ?? "",
              type: organization.type,
              ownershipKind: organization.ownershipKind,
              inn: organization.inn ?? "",
              address: organization.address ?? "",
              phone: organization.phone ?? "",
              timezone: organization.timezone,
              locationsCount: organization.locationsCount,
            }}
          />

          {/* Только организации, которые партнёр завёл сам или перевёл из
              своего аккаунта: у клиента, пришедшего по ссылке, владелец —
              его дело. */}
          {!detached && (link.source === "manual" || link.source === CONVERTED_SOURCE) ? (
            <ClientHandoverCard organizationId={organization.id} handover={handover} />
          ) : null}

          {returnPreview?.offered ? (
            <ClientReturnCard
              view={{
                organizationId: organization.id,
                organizationName: organization.name,
                blockers: returnPreview.plan.ok ? [] : returnPreview.plan.blockers,
                consequences: returnPreview.plan.ok ? returnPreview.plan.consequences : null,
              }}
            />
          ) : null}

          <Card title="Подключение" eyebrow="Сопровождение">
            <dl className="space-y-3 text-[14px]">
              <Row icon={Link2} label="Источник" value={SOURCE_LABELS[link.source] ?? link.source} />
              <Row icon={CalendarDays} label="Подключён" value={formatDate(link.attachedAt)} />
              <Row icon={CalendarDays} label="Первая оплата" value={link.firstPaymentAt ? formatDate(link.firstPaymentAt) : "ещё не было"} />
              <Row
                icon={Users}
                label="Брендинг"
                value={link.clientHidesBranding ? "клиент скрыл ваш брендинг" : "клиент видит ваш брендинг"}
              />
            </dl>
            {detached ? (
              <p className="mt-4 text-[13px] leading-[1.55] text-[#6f7282]">
                Привязка завершена. Если клиент снова подключится по вашей ссылке или коду, здесь появится новая запись.
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#fafbff] px-4 py-3">
      <div className="text-[12px] text-[#6f7282]">{label}</div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums tracking-[-0.01em] text-[#0b1024]">{value}</div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-[12px] text-[#6f7282]">{label}</dt>
        <dd className="break-words text-[#0b1024]">{value}</dd>
      </div>
    </div>
  );
}
