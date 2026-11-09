"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, CalendarClock, CheckCircle2, ChevronDown, FileText, Handshake, Loader2, MessageCircle, Phone, Plus, Receipt, ShieldCheck, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TASK_KINDS, TASK_RESULTS, TASK_RESULT_LABELS, type TaskResult } from "@/lib/crm/lifecycle/forms";
import type { TaskRow } from "@/lib/crm/lifecycle/queries.server";
import { DEAL_STAGES, DEAL_STAGE_SHORT, type DealStage } from "@/lib/crm/lifecycle/stages";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDue, fromMoscowInput, toMoscowInput } from "./crm-format";
import { INPUT, SECONDARY_BUTTON, TEXTAREA } from "./crm-ui";

/** Задачи, спец-КП и колонка сделки — общие куски воронки, задач и карточки контакта. */

export type Person = { id: string; name: string };

const SMALL_BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

const KIND_ICON = { call: Phone, message: MessageCircle, offer: FileText, approval: ShieldCheck, invoice: Receipt, custom: CalendarClock } as const;

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) toast.error(typeof data?.error === "string" ? data.error : "Не получилось — попробуйте ещё раз");
  return { ok: response.ok, data };
}

function inDays(days: number, hour = 11): string {
  const at = new Date(Date.now() + days * 86_400_000);
  const msk = new Date(at.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  return `${msk}T${String(hour).padStart(2, "0")}:00`;
}

// ------------------------------------------------------------------ спец-КП

type OfferDraft = {
  tier: "standard" | "premium" | "vip";
  cycle: "month" | "year";
  points: number;
  discountPercent: number;
  lifetime: boolean;
  validDays: number;
  attachInvoice: boolean;
  toEmail: string;
  note: string;
};

export type OfferSeed = Partial<OfferDraft> & { dealId: string; taskId?: string | null; approvedPercent?: number | null };

function seedFromPayload(payload: Record<string, unknown> | null): Partial<OfferDraft> & { approvedPercent?: number } {
  if (!payload) return {};
  const offer = (payload.offer ?? payload) as Record<string, unknown>;
  const pick = <T,>(value: unknown, guard: (v: unknown) => v is T): T | undefined => (guard(value) ? value : undefined);
  const isNum = (v: unknown): v is number => typeof v === "number";
  return {
    tier: pick(offer.tier, (v): v is OfferDraft["tier"] => v === "standard" || v === "premium" || v === "vip"),
    cycle: pick(offer.cycle, (v): v is OfferDraft["cycle"] => v === "month" || v === "year"),
    points: pick(offer.points, isNum),
    discountPercent: pick(offer.discountPercent, isNum),
    lifetime: pick(payload.lifetime, (v): v is boolean => typeof v === "boolean"),
    validDays: pick(payload.validDays, isNum),
    attachInvoice: pick(payload.attachInvoice, (v): v is boolean => typeof v === "boolean"),
    toEmail: pick(payload.toEmail, (v): v is string => typeof v === "string"),
    note: pick(payload.note, (v): v is string => typeof v === "string"),
    approvedPercent: pick(payload.approvedPercent, isNum),
  };
}

export function OfferButton({ seed, payload, label = "Отправить КП со скидкой", className }: { seed: OfferSeed; payload?: Record<string, unknown> | null; label?: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const fromPayload = seedFromPayload(payload ?? null);
  const initial: OfferDraft = {
    tier: seed.tier ?? fromPayload.tier ?? "standard",
    cycle: seed.cycle ?? fromPayload.cycle ?? "year",
    points: seed.points ?? fromPayload.points ?? 1,
    discountPercent: seed.discountPercent ?? fromPayload.discountPercent ?? 0,
    lifetime: seed.lifetime ?? fromPayload.lifetime ?? false,
    validDays: seed.validDays ?? fromPayload.validDays ?? 7,
    attachInvoice: seed.attachInvoice ?? fromPayload.attachInvoice ?? true,
    toEmail: seed.toEmail ?? fromPayload.toEmail ?? "",
    note: seed.note ?? fromPayload.note ?? "",
  };
  const [draft, setDraft] = useState<OfferDraft>(initial);
  const approved = seed.approvedPercent ?? fromPayload.approvedPercent ?? null;

  async function submit() {
    const { ok, data } = await send("/api/root/crm/offers", "POST", { ...draft, dealId: seed.dealId, taskId: seed.taskId ?? null });
    if (!ok || !data) return;
    if (data.status === "approval") toast.success(`Скидка ${draft.discountPercent} % больше вашего лимита — отправили на согласование: ${String(data.approverName)}`);
    else toast.success(`КП отправлено${data.code ? `, код ${String(data.code)}` : ""}${data.invoiceId ? `, счёт № ${String(data.invoiceId)}` : ""}${data.note ? `. ${String(data.note)}` : ""}`);
    if (data.status === "sent" && typeof data.invoiceError === "string") toast.warning(`Счёт не приложен: ${data.invoiceError}`);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => (setDraft(initial), setOpen(true))} className={className ?? SMALL_BUTTON} data-crm-offer-open>
        <FileText className="size-3.5" />
        {label}
      </button>
      {open ? (
        <ConfirmDialog
          open
          onClose={() => setOpen(false)}
          onConfirm={submit}
          title="Спец-КП со скидкой"
          icon={FileText}
          description={approved ? `Скидка согласована: до ${approved} %.` : "В пределах вашего лимита КП уйдёт сразу, больше — на согласование."}
          confirmLabel="Отправить"
          confirmDisabled={!draft.toEmail.includes("@")}
        >
          <div className="grid gap-3 sm:grid-cols-2" data-crm-offer-form>
            <label className="text-[13px] text-[#3c4053]">
              Тариф
              <select className={cn(INPUT, "mt-1")} value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value as OfferDraft["tier"] })} data-offer-tier>
                <option value="standard">«Стандарт»</option>
                <option value="premium">«Премиум»</option>
                <option value="vip">«ВИП»</option>
              </select>
            </label>
            <label className="text-[13px] text-[#3c4053]">
              Период
              <select className={cn(INPUT, "mt-1")} value={draft.cycle} onChange={(e) => setDraft({ ...draft, cycle: e.target.value as OfferDraft["cycle"] })}>
                <option value="year">За год</option>
                <option value="month">Помесячно</option>
              </select>
            </label>
            <label className="text-[13px] text-[#3c4053]">
              Точек
              <input type="number" inputMode="numeric" min={1} max={500} className={cn(INPUT, "mt-1")} value={draft.points} onChange={(e) => setDraft({ ...draft, points: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
            </label>
            <label className="text-[13px] text-[#3c4053]">
              Скидка, %
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={90}
                className={cn(INPUT, "mt-1")}
                value={draft.discountPercent}
                onChange={(e) => setDraft({ ...draft, discountPercent: Math.max(0, Math.min(90, Math.floor(Number(e.target.value) || 0))) })}
                data-offer-discount
              />
            </label>
            <label className="text-[13px] text-[#3c4053]">
              Код действует, дней
              <input type="number" inputMode="numeric" min={1} max={60} className={cn(INPUT, "mt-1")} value={draft.validDays} onChange={(e) => setDraft({ ...draft, validDays: Math.max(1, Math.min(60, Math.floor(Number(e.target.value) || 7))) })} />
            </label>
            <label className="text-[13px] text-[#3c4053]">
              Кому
              <input type="email" className={cn(INPUT, "mt-1")} value={draft.toEmail} onChange={(e) => setDraft({ ...draft, toEmail: e.target.value })} placeholder="director@company.ru" data-offer-email />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#3c4053] sm:col-span-2">
              <input type="checkbox" checked={draft.attachInvoice} onChange={(e) => setDraft({ ...draft, attachInvoice: e.target.checked })} className="size-4 accent-[#5566f6]" />
              Приложить счёт со скидкой (если у организации есть ИНН)
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#3c4053] sm:col-span-2">
              <input type="checkbox" checked={draft.lifetime} onChange={(e) => setDraft({ ...draft, lifetime: e.target.checked })} className="size-4 accent-[#5566f6]" />
              Скидка на все продления (иначе — на первую оплату)
            </label>
            <label className="text-[13px] text-[#3c4053] sm:col-span-2">
              Сопроводительный текст
              <textarea className={cn(TEXTAREA, "mt-1 min-h-[80px]")} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Как договорились по телефону — условия для вашей сети." />
            </label>
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ задача

export function TaskCard({ task, nowIso, people, canAssign, showOrg = true }: { task: TaskRow; nowIso: string; people: Person[]; canAssign: boolean; showOrg?: boolean }) {
  const router = useRouter();
  const now = new Date(nowIso);
  const due = formatDue(task.dueAt, now);
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState<"complete" | "postpone" | "approve" | "reject" | null>(null);
  const [result, setResult] = useState<TaskResult>(task.kind === "call" ? "reached" : task.kind === "message" ? "messaged" : "done");
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [dueInput, setDueInput] = useState(toMoscowInput(task.dueAt));
  const [percent, setPercent] = useState<number>(typeof task.payload?.discountPercent === "number" ? (task.payload.discountPercent as number) : 0);
  const [busy, setBusy] = useState(false);
  const Icon = KIND_ICON[task.kind as keyof typeof KIND_ICON] ?? CalendarClock;
  const open = task.status === "open";
  // Рекомендация: из задачи автоворонки, иначе — из сделки (своя задача, «Перезвонить»).
  const offer = (task.payload?.offer as Record<string, unknown> | undefined) ?? task.dealOffer ?? undefined;

  async function complete() {
    const followUpAt = followUp ? fromMoscowInput(followUp) : null;
    const { ok } = await send(`/api/root/crm/tasks/${task.id}/complete`, "POST", { result, note, followUpAt });
    if (!ok) return;
    toast.success(`Задача закрыта: ${TASK_RESULT_LABELS[result]}`);
    setDialog(null);
    router.refresh();
  }
  async function postpone() {
    const dueAt = fromMoscowInput(dueInput);
    if (!dueAt) return void toast.error("Укажите дату и время");
    const { ok } = await send(`/api/root/crm/tasks/${task.id}`, "PATCH", { dueAt });
    if (!ok) return;
    toast.success("Срок перенесён");
    setDialog(null);
    router.refresh();
  }
  async function decide(approve: boolean) {
    const { ok } = await send(`/api/root/crm/tasks/${task.id}/approval`, "POST", { approve, percent: approve ? percent : undefined, comment: note });
    if (!ok) return;
    toast.success(approve ? `Скидка ${percent} % согласована — менеджеру ушла задача` : "Скидка отклонена");
    setDialog(null);
    router.refresh();
  }
  async function assign(assigneeId: string) {
    setBusy(true);
    const { ok } = await send(`/api/root/crm/tasks/${task.id}`, "PATCH", { assigneeId: assigneeId || null });
    setBusy(false);
    if (ok) {
      toast.success("Ответственный изменён");
      router.refresh();
    }
  }

  return (
    <li className={cn("rounded-2xl border bg-white px-3.5 py-3", task.kind === "approval" && open ? "border-[#c9cff8] bg-[#f7f8ff]" : due?.tone === "overdue" && open ? "border-[#ffd2cc]" : "border-[#ececf4]")} data-crm-task={task.scenario}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl", open ? "bg-[#eef1ff] text-[#3848c7]" : "bg-[#f1f2f6] text-[#9b9fb3]")}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn("text-[14px] font-medium leading-snug", open ? "text-[#0b1024]" : "text-[#6f7282] line-through decoration-[#c6c8d4]")}>{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#6f7282]">
            {open && due ? <span className={cn(due.tone === "overdue" ? "font-medium text-[#c0392b]" : due.tone === "today" ? "font-medium text-[#3848c7]" : "")}>{due.label}</span> : null}
            {!open ? <span>{TASK_RESULT_LABELS[task.result ?? ""] ?? task.result}{task.resultNote ? ` — ${task.resultNote}` : ""} · {formatDateTime(task.completedAt)}</span> : null}
            <span>{TASK_KINDS[task.kind as keyof typeof TASK_KINDS] ?? task.kind}</span>
            {showOrg && task.organizationName ? <span className="truncate">{task.organizationName}</span> : null}
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3" />
              {task.assigneeName ?? "без ответственного"}
            </span>
            {task.contactId ? (
              <Link href={`/root/crm/contacts/${task.contactId}`} className="text-[#3848c7] hover:underline">
                переписка
              </Link>
            ) : null}
          </div>
          {task.body ? (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-[#3848c7]">
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Скрыть подробности" : "Что видно и что предложить"}
            </button>
          ) : null}
          {expanded ? <div className="mt-2 whitespace-pre-line rounded-xl bg-[#fafbff] px-3 py-2 text-[12.5px] leading-relaxed text-[#3c4053]">{task.body}</div> : null}
          {open ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {task.kind === "approval" ? (
                <>
                  <button type="button" className={SMALL_BUTTON} onClick={() => setDialog("approve")} data-approval-approve>
                    <CheckCircle2 className="size-3.5 text-[#136c3a]" />
                    Согласовать
                  </button>
                  <button type="button" className={SMALL_BUTTON} onClick={() => setDialog("reject")} data-approval-reject>
                    <XCircle className="size-3.5 text-[#a13a32]" />
                    Отклонить
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={SMALL_BUTTON} onClick={() => setDialog("complete")} data-task-complete>
                    <BadgeCheck className="size-3.5" />
                    Готово…
                  </button>
                  <button type="button" className={SMALL_BUTTON} onClick={() => setDialog("postpone")}>
                    <CalendarClock className="size-3.5" />
                    Перенести
                  </button>
                  {task.dealId && task.kind !== "invoice" ? (
                    <OfferButton
                      seed={{ dealId: task.dealId, taskId: task.id, toEmail: task.clientEmail ?? undefined }}
                      payload={task.kind === "offer" ? task.payload : offer ? { offer } : null}
                      label={task.kind === "offer" ? "Отправить КП" : "КП со скидкой"}
                    />
                  ) : null}
                </>
              )}
              {canAssign && people.length ? (
                <select
                  aria-label="Ответственный"
                  className="h-8 rounded-xl border border-[#dcdfed] bg-white px-2 text-[12.5px] text-[#0b1024]"
                  value={task.assigneeId ?? ""}
                  disabled={busy}
                  onChange={(event) => assign(event.target.value)}
                >
                  <option value="">Без ответственного</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {dialog === "complete" ? (
        <ConfirmDialog open onClose={() => setDialog(null)} onConfirm={complete} title="Итог задачи" icon={BadgeCheck} confirmLabel="Закрыть задачу">
          <div className="space-y-3" data-task-complete-form>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(Object.keys(TASK_RESULTS) as TaskResult[]).map((key) => (
                <label key={key} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13.5px]", result === key ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4]")}>
                  <input type="radio" name={`result-${task.id}`} checked={result === key} onChange={() => setResult(key)} className="accent-[#5566f6]" data-result={key} />
                  {TASK_RESULTS[key]}
                </label>
              ))}
            </div>
            <label className="block text-[13px] text-[#3c4053]">
              Комментарий {result === "declined" ? "(причина отказа)" : ""}
              <textarea className={cn(TEXTAREA, "mt-1 min-h-[70px]")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={result === "promised" ? "Оплатят в пятницу, счёт у бухгалтерии" : ""} />
            </label>
            {result !== "declined" ? (
              <label className="block text-[13px] text-[#3c4053]">
                Перезвонить (необязательно)
                <input type="datetime-local" className={cn(INPUT, "mt-1")} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {[1, 2, 3].map((days) => (
                    <button key={days} type="button" onClick={() => setFollowUp(inDays(days))} className="rounded-lg bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#3848c7]">
                      через {days} дн.
                    </button>
                  ))}
                </span>
              </label>
            ) : (
              <p className="text-[12.5px] text-[#a13a32]">Сделка уйдёт в «Отказ», письма и задачи по ней остановятся.</p>
            )}
          </div>
        </ConfirmDialog>
      ) : null}
      {dialog === "postpone" ? (
        <ConfirmDialog open onClose={() => setDialog(null)} onConfirm={postpone} title="Перенести задачу" icon={CalendarClock} confirmLabel="Перенести">
          <input type="datetime-local" className={INPUT} value={dueInput} onChange={(e) => setDueInput(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[1, 2, 3, 7].map((days) => (
              <button key={days} type="button" onClick={() => setDueInput(inDays(days))} className="rounded-lg bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#3848c7]">
                через {days} дн.
              </button>
            ))}
          </div>
        </ConfirmDialog>
      ) : null}
      {dialog === "approve" || dialog === "reject" ? (
        <ConfirmDialog
          open
          onClose={() => setDialog(null)}
          onConfirm={() => decide(dialog === "approve")}
          title={dialog === "approve" ? "Согласовать скидку" : "Отклонить скидку"}
          icon={dialog === "approve" ? Handshake : XCircle}
          variant={dialog === "approve" ? "default" : "danger"}
          confirmLabel={dialog === "approve" ? "Согласовать" : "Отклонить"}
        >
          <div className="space-y-3">
            {dialog === "approve" ? (
              <label className="block text-[13px] text-[#3c4053]">
                Скидка, % (можно меньше запрошенной)
                <input type="number" inputMode="numeric" min={1} max={90} className={cn(INPUT, "mt-1")} value={percent} onChange={(e) => setPercent(Math.max(1, Math.min(90, Math.floor(Number(e.target.value) || 1))))} data-approval-percent />
              </label>
            ) : null}
            <label className="block text-[13px] text-[#3c4053]">
              Комментарий
              <textarea className={cn(TEXTAREA, "mt-1 min-h-[70px]")} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
        </ConfirmDialog>
      ) : null}
    </li>
  );
}

// ------------------------------------------------------------------ своя задача

export function NewTaskButton({ contactId, dealId, people, defaultAssigneeId, canAssign }: { contactId?: string | null; dealId?: string | null; people: Person[]; defaultAssigneeId: string; canAssign: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"call" | "message" | "custom">("call");
  const [due, setDue] = useState(inDays(1));
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);
  async function submit() {
    const dueAt = fromMoscowInput(due);
    if (!dueAt) return void toast.error("Укажите срок");
    const { ok } = await send("/api/root/crm/tasks", "POST", { contactId: contactId ?? null, dealId: dealId ?? null, title, body, kind, dueAt, assigneeId: assigneeId || null });
    if (!ok) return;
    toast.success("Задача поставлена");
    setOpen(false);
    setTitle("");
    setBody("");
    router.refresh();
  }
  return (
    <>
      <button type="button" className={SECONDARY_BUTTON} onClick={() => setOpen(true)} data-task-new>
        <Plus className="size-4" />
        Новая задача
      </button>
      {open ? (
        <ConfirmDialog open onClose={() => setOpen(false)} onConfirm={submit} title="Новая задача" icon={Plus} confirmLabel="Поставить" confirmDisabled={title.trim().length < 3}>
          <div className="space-y-3">
            <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Перезвонить директору по счёту" data-task-title />
            <div className="grid gap-3 sm:grid-cols-2">
              <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="call">Позвонить</option>
                <option value="message">Написать</option>
                <option value="custom">Другое</option>
              </select>
              <input type="datetime-local" className={INPUT} value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            {canAssign ? (
              <select className={INPUT} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Без ответственного</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            ) : null}
            <textarea className={cn(TEXTAREA, "min-h-[70px]")} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Подробности" />
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ колонка сделки

export function DealStageSelect({ dealId, stage, compact = false }: { dealId: string; stage: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<DealStage | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  async function move(to: DealStage, lostReason?: string) {
    setSaving(true);
    const { ok } = await send(`/api/root/crm/deals/${dealId}`, "PATCH", { stage: to, ...(lostReason ? { lostReason } : {}) });
    setSaving(false);
    if (!ok) return;
    toast.success(`Сделка → «${DEAL_STAGE_SHORT[to]}»`);
    setPending(null);
    router.refresh();
  }
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <select
          aria-label="Колонка воронки"
          className={cn("rounded-xl border border-[#dcdfed] bg-white px-2 text-[12.5px] text-[#0b1024]", compact ? "h-7" : "h-9")}
          value={stage}
          disabled={saving}
          onChange={(event) => {
            const to = event.target.value as DealStage;
            if (to === "lost") setPending("lost");
            else void move(to);
          }}
          data-deal-stage-select
        >
          {DEAL_STAGES.map((key) => (
            <option key={key} value={key}>
              {DEAL_STAGE_SHORT[key]}
            </option>
          ))}
        </select>
        {saving ? <Loader2 className="size-3.5 animate-spin text-[#6f7282]" /> : null}
      </span>
      {pending === "lost" ? (
        <ConfirmDialog open onClose={() => setPending(null)} onConfirm={() => move("lost", reason || "Отказ клиента")} title="Отказ" variant="danger" icon={XCircle} confirmLabel="В отказ">
          <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина: дорого, не нужно сейчас, выбрали другое…" data-deal-lost-reason />
          <p className="mt-2 text-[12.5px] text-[#6f7282]">Письма автоворонки и задачи по сделке остановятся. Оплатят позже — сделка сама станет «Оплачено».</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

export function ContractToggle({ dealId, signed }: { dealId: string; signed: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-[#3c4053]">
      <input
        type="checkbox"
        checked={signed}
        disabled={saving}
        className="size-4 accent-[#5566f6]"
        onChange={async (event) => {
          setSaving(true);
          const { ok } = await send(`/api/root/crm/deals/${dealId}`, "PATCH", { contractSigned: event.target.checked });
          setSaving(false);
          if (ok) router.refresh();
        }}
        data-deal-contract
      />
      Договор подписан
    </label>
  );
}
