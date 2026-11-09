"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSignature, Mail, Phone, Receipt, ShieldCheck, UserRound, Users } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { FunnelCard } from "@/lib/crm/lifecycle/queries.server";
import { DEAL_KIND_LABELS, DEAL_STAGES, DEAL_STAGE_LABELS, DEAL_STAGE_SHORT, type DealStage } from "@/lib/crm/lifecycle/stages";
import { cn } from "@/lib/utils";
import { formatDue } from "../crm-format";
import { INPUT } from "../crm-ui";

const RUB = new Intl.NumberFormat("ru-RU");
const COLUMN_TONE: Record<DealStage, string> = {
  registered: "bg-[#f5f6ff] text-[#3848c7]",
  contract_signed: "bg-[#eef7ff] text-[#1d5fa8]",
  message_sent: "bg-[#fff8eb] text-[#7a4a00]",
  called: "bg-[#f3efff] text-[#5a3cc9]",
  won: "bg-[#ecfdf3] text-[#136c3a]",
  lost: "bg-[#f4f4f6] text-[#6f7282]",
};

function periodLabel(card: FunnelCard, now: Date): string | null {
  if (!card.periodEnd) return null;
  const end = new Date(card.periodEnd);
  const last = new Date(end.getTime() - 1);
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" }).format(last);
  const days = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
  const what = card.kind === "trial" ? "пробный" : "оплачено";
  if (days < 0) return `${what} до ${day} · закончился`;
  return `${what} до ${day}${days <= 14 ? ` · ${days <= 1 ? "последний день" : `${days} дн.`}` : ""}`;
}

function Badge({ icon: Icon, label, tone }: { icon: typeof Mail; label: string; tone: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium", tone)}>
      <Icon className="size-3" />
      {label}
    </span>
  );
}

export function FunnelBoard({ cards, nowIso }: { cards: FunnelCard[]; nowIso: string }) {
  const router = useRouter();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<DealStage | null>(null);
  const [lost, setLost] = useState<{ id: string } | null>(null);
  const [reason, setReason] = useState("");
  const [local, setLocal] = useState<Record<string, DealStage>>({});

  const stageOf = (card: FunnelCard) => local[card.id] ?? card.stage;
  const columns = DEAL_STAGES.map((stage) => {
    const list = cards.filter((card) => stageOf(card) === stage);
    const sum = list.reduce((total, card) => total + (card.offer?.sent ? Math.round(((card.offer.amountRub ?? 0) * (100 - card.offer.sent.discountPercent)) / 100) : (card.amountRub ?? 0)), 0);
    return { stage, list, sum };
  });

  async function move(id: string, to: DealStage, lostReason?: string) {
    const card = cards.find((item) => item.id === id);
    if (!card || stageOf(card) === to) return;
    setLocal((prev) => ({ ...prev, [id]: to }));
    const response = await fetch(`/api/root/crm/deals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: to, ...(lostReason ? { lostReason } : {}) }) });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(data?.error ?? "Не получилось перенести");
      setLocal((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    toast.success(`«${card.organizationName}» → ${DEAL_STAGE_SHORT[to]}`);
    router.refresh();
  }

  function drop(stage: DealStage) {
    setOver(null);
    if (!dragging) return;
    if (stage === "lost") setLost({ id: dragging });
    else void move(dragging, stage);
    setDragging(null);
  }

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" data-crm-funnel>
        <div className="grid min-w-[1440px] grid-cols-6 gap-3">
          {columns.map(({ stage, list, sum }) => (
            <section
              key={stage}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((current) => (current === stage ? null : current))}
              onDrop={() => drop(stage)}
              className={cn("flex min-h-[420px] flex-col rounded-3xl border bg-[#fafbff] p-2.5 transition-colors", over === stage ? "border-[#5566f6] bg-[#f2f4ff]" : "border-[#ececf4]")}
              data-funnel-column={stage}
            >
              <header className="px-1.5 pb-2 pt-1">
                <div className={cn("inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold", COLUMN_TONE[stage])}>{list.length}</div>
                <h2 className="mt-1.5 text-[13.5px] font-semibold leading-snug text-[#0b1024]">{DEAL_STAGE_LABELS[stage]}</h2>
                {sum > 0 ? <div className="mt-0.5 text-[12px] text-[#6f7282]">{RUB.format(sum)} ₽</div> : null}
              </header>
              <ul className="flex flex-1 flex-col gap-2">
                {list.map((card) => {
                  const due = card.nextTask ? formatDue(card.nextTask.dueAt, now) : null;
                  const href = card.contactId ? `/root/crm/contacts/${card.contactId}` : `/root/organizations/${card.organizationId}`;
                  const discount = card.offer?.sent?.discountPercent ?? 0;
                  return (
                    <li
                      key={card.id}
                      draggable
                      onDragStart={() => setDragging(card.id)}
                      onDragEnd={() => setDragging(null)}
                      className={cn("cursor-grab rounded-2xl border border-[#ececf4] bg-white p-3 shadow-[0_1px_0_rgba(11,16,36,0.03)] active:cursor-grabbing", dragging === card.id && "opacity-50")}
                      data-funnel-card={card.organizationName}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link href={href} className="min-w-0 text-[14px] font-semibold leading-snug text-[#0b1024] hover:text-[#3848c7]" data-funnel-open>
                          {card.organizationName}
                        </Link>
                        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium", card.kind === "trial" ? "bg-[#eef1ff] text-[#3848c7]" : "bg-[#fff1e6] text-[#9a4a00]")}>
                          {DEAL_KIND_LABELS[card.kind]}
                        </span>
                      </div>
                      <div className="mt-1 text-[12px] text-[#6f7282]">{periodLabel(card, now)}</div>
                      {card.offer ? (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-[#3c4053]">
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3" />
                            {card.offer.users} · {card.offer.points} точ.
                          </span>
                          {card.amountRub ? <span className="font-medium">{RUB.format(card.amountRub)} ₽</span> : null}
                          {discount ? <span className="text-[#136c3a]">−{discount} %</span> : null}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {card.contractSigned ? <Badge icon={FileSignature} label="договор" tone="bg-[#eef7ff] text-[#1d5fa8]" /> : null}
                        {card.invoiceOrderId ? <Badge icon={Receipt} label={`счёт ${card.invoiceOrderId}`} tone="bg-[#f5f6ff] text-[#3848c7]" /> : null}
                        {card.messageSent ? <Badge icon={Mail} label="письмо" tone="bg-[#fff8eb] text-[#7a4a00]" /> : null}
                        {card.called ? <Badge icon={Phone} label="звонок" tone="bg-[#f3efff] text-[#5a3cc9]" /> : null}
                        {card.approvalPending ? <Badge icon={ShieldCheck} label="скидка на согласовании" tone="bg-[#fff1f0] text-[#a13a32]" /> : null}
                        {stageOf(card) === "won" ? <Badge icon={CheckCircle2} label="оплачено" tone="bg-[#ecfdf3] text-[#136c3a]" /> : null}
                      </div>
                      {card.nextTask && stageOf(card) !== "won" && stageOf(card) !== "lost" ? (
                        <div className={cn("mt-2 rounded-xl px-2 py-1.5 text-[12px] leading-snug", card.nextTask.overdue ? "bg-[#fff1f0] text-[#a13a32]" : "bg-[#f7f8ff] text-[#3c4053]")}>
                          {due ? <span className="font-medium">{due.label}: </span> : null}
                          {card.nextTask.title}
                          {card.openTasks > 1 ? <span className="text-[#9b9fb3]"> (+{card.openTasks - 1})</span> : null}
                        </div>
                      ) : null}
                      {stageOf(card) === "lost" && card.lostReason ? <div className="mt-2 text-[12px] text-[#6f7282]">{card.lostReason}</div> : null}
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#f1f2f6] pt-2">
                        <span className="inline-flex min-w-0 items-center gap-1 truncate text-[12px] text-[#6f7282]">
                          <UserRound className="size-3 shrink-0" />
                          {card.ownerName ?? "без ответственного"}
                        </span>
                        <select
                          aria-label="Перенести в колонку"
                          className="h-7 max-w-[130px] rounded-lg border border-[#dcdfed] bg-white px-1.5 text-[11.5px] text-[#0b1024]"
                          value={stageOf(card)}
                          onChange={(event) => {
                            const to = event.target.value as DealStage;
                            if (to === "lost") setLost({ id: card.id });
                            else void move(card.id, to);
                          }}
                          data-funnel-move
                        >
                          {DEAL_STAGES.map((key) => (
                            <option key={key} value={key}>
                              {DEAL_STAGE_SHORT[key]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  );
                })}
                {list.length === 0 ? <li className="rounded-2xl border border-dashed border-[#e2e4ef] px-3 py-6 text-center text-[12px] text-[#9b9fb3]">Пусто</li> : null}
              </ul>
            </section>
          ))}
        </div>
      </div>
      {lost ? (
        <ConfirmDialog
          open
          onClose={() => setLost(null)}
          onConfirm={async () => {
            await move(lost.id, "lost", reason || "Отказ клиента");
            setLost(null);
            setReason("");
          }}
          title="Отказ"
          variant="danger"
          confirmLabel="В отказ"
        >
          <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина: дорого, не нужно сейчас, выбрали другое…" data-funnel-lost-reason />
          <p className="mt-2 text-[12.5px] text-[#6f7282]">Письма автоворонки и задачи по сделке остановятся. Оплатят позже — сделка сама станет «Оплачено».</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
