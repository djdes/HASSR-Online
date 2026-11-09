import Link from "next/link";
import { Kanban } from "lucide-react";

import type { loadContactPipeline } from "@/lib/crm/lifecycle/queries.server";
import { DEAL_KIND_LABELS, DEAL_STAGE_SHORT, isDealKind, isDealStage } from "@/lib/crm/lifecycle/stages";
import { cn } from "@/lib/utils";
import { CARD, ZONE_TITLE } from "../../crm-ui";
import { formatDateTime } from "../../crm-format";
import { ContractToggle, DealStageSelect, NewTaskButton, OfferButton, TaskCard, type Person } from "../../pipeline-ui";

type Pipeline = Awaited<ReturnType<typeof loadContactPipeline>>;

const RUB = new Intl.NumberFormat("ru-RU");
const TIERS: Record<string, string> = { standard: "«Стандарт»", premium: "«Премиум»", vip: "«ВИП»" };

/** Сделки и задачи контакта — над перепиской в карточке (серверный компонент). */
export function PipelinePanel({
  pipeline,
  contactId,
  contactEmail,
  people,
  viewerId,
  own,
  nowIso,
}: {
  pipeline: Pipeline;
  contactId: string;
  contactEmail: string | null;
  people: Person[];
  viewerId: string;
  own: boolean;
  nowIso: string;
}) {
  const openTasks = pipeline.tasks.filter((task) => task.status === "open");
  const closedTasks = pipeline.tasks.filter((task) => task.status !== "open").slice(0, 5);
  const current = pipeline.deals[0] ?? null;
  return (
    <section className={cn(CARD, "space-y-4 p-4 sm:p-5")} data-crm-pipeline>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Kanban className="size-4 text-[#5566f6]" />
          <span className="text-[15px] font-semibold text-[#0b1024]">Сделка и задачи</span>
          <Link href="/root/crm/funnel" className="text-[12.5px] text-[#3848c7] hover:underline">
            воронка
          </Link>
        </div>
        <NewTaskButton contactId={contactId} dealId={current?.id ?? null} people={people} defaultAssigneeId={viewerId} canAssign={!own} />
      </div>
      {pipeline.deals.length === 0 ? <p className="text-[13px] text-[#6f7282]">Сделки нет — она появится, когда клиент зарегистрируется на пробный или подойдёт срок продления.</p> : null}
      {pipeline.deals.map((deal) => {
        const offer = deal.offer;
        const kind = isDealKind(deal.kind) ? deal.kind : "trial";
        const open = deal.stage !== "won" && deal.stage !== "lost";
        return (
          <div key={deal.id} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3.5" data-crm-deal={deal.stage}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", kind === "trial" ? "bg-[#eef1ff] text-[#3848c7]" : "bg-[#fff1e6] text-[#9a4a00]")}>{DEAL_KIND_LABELS[kind]}</span>
              <DealStageSelect dealId={deal.id} stage={isDealStage(deal.stage) ? deal.stage : "registered"} compact />
              <ContractToggle dealId={deal.id} signed={deal.contractSigned} />
              {deal.periodEnd ? <span className="text-[12.5px] text-[#6f7282]">срок: {formatDateTime(new Date(new Date(deal.periodEnd).getTime() - 1).toISOString())}</span> : null}
              <span className="text-[12.5px] text-[#6f7282]">ответственный: {deal.ownerName ?? "—"}</span>
            </div>
            {offer ? (
              <div className="mt-2 text-[13px] leading-relaxed text-[#3c4053]">
                Рекомендация: {TIERS[offer.tier] ?? offer.tier}
                {offer.points > 1 ? ` на ${offer.points} точ.` : ""} {offer.cycle === "year" ? "за год" : "помесячно"} — {RUB.format(offer.amountRub)} ₽
                {offer.discountPercent ? `, скидка по лестнице ${offer.discountPercent} % (${RUB.format(offer.discountedRub)} ₽)` : ""}. Сотрудников {offer.users}, журналов {offer.journals}, записей за неделю {offer.entries7d}.
                {offer.sent ? (
                  <span className="block text-[#136c3a]">
                    КП отправлено {formatDateTime(offer.sent.at)}: скидка {offer.sent.discountPercent} %{offer.sent.code ? `, код ${offer.sent.code}` : ""}.
                  </span>
                ) : null}
              </div>
            ) : null}
            {deal.stage === "lost" && deal.lostReason ? <div className="mt-2 text-[12.5px] text-[#a13a32]">Отказ: {deal.lostReason}</div> : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#6f7282]">
              {deal.messageSentAt ? <span>письмо: {formatDateTime(deal.messageSentAt)}</span> : null}
              {deal.calledAt ? <span>звонок: {formatDateTime(deal.calledAt)}</span> : null}
              {deal.invoiceOrderId ? <span>счёт № {deal.invoiceOrderId}</span> : null}
              <span>колонка: {isDealStage(deal.stage) ? DEAL_STAGE_SHORT[deal.stage] : deal.stage}</span>
            </div>
            {open ? (
              <div className="mt-2.5">
                <OfferButton
                  seed={{
                    dealId: deal.id,
                    toEmail: contactEmail ?? undefined,
                    tier: offer?.tier,
                    cycle: offer?.cycle,
                    points: offer?.points,
                    discountPercent: offer?.discountPercent,
                  }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
      {openTasks.length ? (
        <div className="space-y-2">
          <div className={ZONE_TITLE}>Открытые задачи · {openTasks.length}</div>
          <ul className="space-y-2">
            {openTasks.map((task) => (
              <TaskCard key={task.id} task={task} nowIso={nowIso} people={people} canAssign={!own} showOrg={false} />
            ))}
          </ul>
        </div>
      ) : null}
      {closedTasks.length ? (
        <details>
          <summary className={cn(ZONE_TITLE, "cursor-pointer list-none")}>Закрытые задачи · {closedTasks.length}</summary>
          <ul className="mt-2 space-y-2">
            {closedTasks.map((task) => (
              <TaskCard key={task.id} task={task} nowIso={nowIso} people={people} canAssign={false} showOrg={false} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
