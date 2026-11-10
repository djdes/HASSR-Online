"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ListPlus, ShieldCheck, ShieldX, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TASK_OUTCOME_KEYS, TASK_OUTCOMES, outcomeNeedsFollowUp, outcomeSuggestsFollowUp, type TaskOutcome } from "@/lib/lifecycle/task-outcomes";
import { cn } from "@/lib/utils";
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON, TEXTAREA } from "../crm-ui";

type Person = { id: string; name: string };
type TaskView = { id: string; kind: string; status: string; discountPercent: number | null; approvalPending: boolean };
type Action = "done" | "cancel" | "approve" | "reject";

const ACTION_COPY: Record<Action, { title: string; description: string; confirm: string; placeholder: string; variant: "default" | "danger" | "info" }> = {
  done: { title: "Чем закончилось?", description: "Итог останется в истории клиента и передвинет сделку в воронке.", confirm: "Закрыть задачу", placeholder: "Директор согласует в пятницу…", variant: "default" },
  cancel: { title: "Отменить задачу", description: "Задача уйдёт в закрытые. Напишите, почему — например, клиент уже ответил в чате.", confirm: "Отменить задачу", placeholder: "Клиент оплатил картой…", variant: "danger" },
  approve: { title: "Согласовать скидку", description: "Менеджеру сразу придёт задача со скидкой из решения. Согласовать можно не больше запрошенного и в пределах вашего лимита.", confirm: "Согласовать", placeholder: "Комментарий для менеджера (необязательно)", variant: "info" },
  reject: { title: "Отказать в скидке", description: "Менеджер предложит обычные условия. Напишите почему — он передаст клиенту.", confirm: "Отказать", placeholder: "Клиент на 120 человек — достаточно 15 %", variant: "danger" },
};

async function send(url: string, method: string, body: unknown): Promise<boolean> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    toast.error(data?.error ?? "Не получилось — попробуйте ещё раз");
    return false;
  }
  return true;
}

/** «2026-11-11» и «11:00» — следующий рабочий день по Москве (для подсказки следующего шага). */
function nextWorkdayMsk(): { date: string; time: string } {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  return { date: day.toISOString().slice(0, 10), time: "11:00" };
}

/** Кнопки задачи: закрыть с итогом / отменить, у согласования — согласовать / отказать. */
export function TaskActions({ task }: { task: TaskView }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [result, setResult] = useState("");
  const [percent, setPercent] = useState(String(task.discountPercent ?? 0));
  const [outcome, setOutcome] = useState<TaskOutcome | null>(null);
  const [next, setNext] = useState<{ on: boolean; date: string; time: string }>({ on: false, date: "", time: "11:00" });
  const approval = task.kind === "approve_discount" && task.approvalPending;

  function pick(value: TaskOutcome) {
    setOutcome(value);
    if (outcomeSuggestsFollowUp(value) && !next.on) setNext({ on: true, ...nextWorkdayMsk() });
    if (value === "declined" || value === "reached") setNext((current) => ({ ...current, on: value === "reached" ? current.on : false }));
  }

  async function confirm() {
    if (!action) return;
    const ok = await send(`/api/root/crm/tasks/${task.id}`, "PATCH", {
      action,
      result: result.trim() || null,
      percent: action === "approve" ? Math.round(Number(percent) || 0) : null,
      outcome: action === "done" ? outcome : null,
      nextDueAt: action === "done" && next.on && next.date ? `${next.date}T${next.time || "11:00"}:00+03:00` : null,
    });
    if (!ok) return;
    toast.success(
      action === "approve"
        ? "Скидка согласована — менеджеру ушла задача"
        : action === "reject"
          ? "Отказ записан — менеджер предложит обычные условия"
          : action === "done"
            ? next.on
              ? "Задача закрыта, следующий шаг — в задачах"
              : "Задача закрыта"
            : "Задача отменена",
    );
    setAction(null);
    setResult("");
    setOutcome(null);
    setNext({ on: false, date: "", time: "11:00" });
    router.refresh();
  }

  const copy = action ? ACTION_COPY[action] : null;
  const needsDate = action === "done" && outcome !== null && outcomeNeedsFollowUp(outcome) && !(next.on && next.date);
  return (
    <>
      {approval ? (
        <>
          <button type="button" onClick={() => setAction("approve")} className={cn(PRIMARY_BUTTON, "h-9 px-3 text-[13px]")} data-crm-task-approve>
            <ShieldCheck className="size-4" />
            Согласовать
          </button>
          <button type="button" onClick={() => setAction("reject")} className={cn(SECONDARY_BUTTON, "h-9 px-3 text-[13px]")}>
            <ShieldX className="size-4" />
            Отказать
          </button>
        </>
      ) : (
        <>
          {task.status === "open" ? (
            <button type="button" onClick={() => setAction("done")} className={cn(PRIMARY_BUTTON, "h-9 px-3 text-[13px]")} data-crm-task-done>
              <Check className="size-4" />
              Итог
            </button>
          ) : null}
          <button type="button" onClick={() => setAction("cancel")} className={cn(SECONDARY_BUTTON, "h-9 px-3 text-[13px]")} aria-label="Отменить задачу" title="Отменить задачу">
            <X className="size-4" />
          </button>
        </>
      )}
      {copy ? (
        <ConfirmDialog
          open
          onClose={() => setAction(null)}
          onConfirm={confirm}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.confirm}
          cancelLabel="Назад"
          variant={copy.variant}
          confirmDisabled={(action === "done" && !outcome && !result.trim()) || needsDate}
        >
          <div className="space-y-3">
            {action === "done" ? (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Итог" data-crm-task-outcomes>
                {TASK_OUTCOME_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={outcome === key}
                    onClick={() => pick(key)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                      outcome === key ? "border-[#5566f6] bg-[#eef1ff] font-medium text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40",
                    )}
                    data-crm-outcome={key}
                  >
                    {TASK_OUTCOMES[key]}
                  </button>
                ))}
              </div>
            ) : null}
            {action === "approve" ? (
              <label className="block text-[13px] text-[#3c4053]">
                Скидка, %
                <input value={percent} onChange={(event) => setPercent(event.target.value.replace(/\D/g, "").slice(0, 2))} className={`${INPUT} mt-1 w-28`} inputMode="numeric" name="percent" />
              </label>
            ) : null}
            <label className="block text-[13px] text-[#3c4053]">
              {action === "done" ? (outcome === "declined" ? "Причина отказа" : "Комментарий") : "Комментарий"}
              <textarea value={result} onChange={(event) => setResult(event.target.value)} className={`${TEXTAREA} mt-1 min-h-[80px]`} placeholder={copy.placeholder} name="result" />
            </label>
            {action === "done" && outcome !== "declined" ? (
              <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
                <label className="flex items-center gap-2 text-[13.5px] text-[#0b1024]">
                  <input
                    type="checkbox"
                    checked={next.on}
                    onChange={(event) => setNext(event.target.checked ? { on: true, ...(next.date ? { date: next.date, time: next.time } : nextWorkdayMsk()) } : { ...next, on: false })}
                    className="size-4 accent-[#5566f6]"
                    data-crm-next-step
                  />
                  Следующий шаг — задача «Перезвонить»
                </label>
                {next.on ? (
                  <div className="mt-2 grid grid-cols-[1fr_104px] gap-2">
                    <input type="date" value={next.date} onChange={(event) => setNext({ ...next, date: event.target.value })} className={INPUT} name="nextDate" aria-label="Дата" />
                    <input type="time" value={next.time} onChange={(event) => setNext({ ...next, time: event.target.value })} className={INPUT} name="nextTime" aria-label="Время" />
                  </div>
                ) : null}
                {needsDate ? <p className="mt-2 text-[12.5px] text-[#a13a32]">Когда перезвонить? Укажите дату.</p> : null}
              </div>
            ) : null}
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/** Задача руками: кому, что и к какому сроку. */
/** `tomorrow` — «2026-11-10» по Москве, считает сервер (рендер должен быть чистым). */
export function NewTaskButton({ people, me, tomorrow }: { people: Person[]; me: string; tomorrow: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", note: "", assigneeId: me, date: tomorrow, time: "12:00" });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    const ok = await send("/api/root/crm/tasks", "POST", {
      title: form.title,
      note: form.note || null,
      assigneeId: form.assigneeId || null,
      dueAt: `${form.date}T${form.time}:00+03:00`,
    });
    if (!ok) return;
    toast.success(form.assigneeId === me ? "Задача создана" : "Задача создана — исполнителю ушло уведомление");
    setOpen(false);
    setForm({ title: "", note: "", assigneeId: me, date: tomorrow, time: "12:00" });
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={PRIMARY_BUTTON} data-crm-new-task>
        <ListPlus className="size-4" />
        Новая задача
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={save}
        title="Новая задача"
        description="Исполнителю придёт уведомление в Telegram или на почту. Срок — по Москве."
        icon={ListPlus}
        confirmLabel="Создать"
        cancelLabel="Отмена"
        confirmDisabled={form.title.trim().length < 2 || !form.date}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px] text-[#3c4053] sm:col-span-2">
            Что сделать
            <input value={form.title} onChange={set("title")} className={`${INPUT} mt-1`} placeholder="Позвонить в «Ромашку» насчёт счёта" name="title" />
          </label>
          <label className="block text-[13px] text-[#3c4053] sm:col-span-2">
            Подробности
            <textarea value={form.note} onChange={set("note")} className={`${TEXTAREA} mt-1`} placeholder="Контакт, сумма, договорённости…" name="note" />
          </label>
          <label className="block text-[13px] text-[#3c4053]">
            Кому
            <select value={form.assigneeId} onChange={set("assigneeId")} className={`${INPUT} mt-1`} name="assigneeId">
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.id === me ? `${person.name} (я)` : person.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <label className="block text-[13px] text-[#3c4053]">
              Когда
              <input type="date" value={form.date} onChange={set("date")} className={`${INPUT} mt-1`} name="date" />
            </label>
            <label className="block text-[13px] text-[#3c4053]">
              Время
              <input type="time" value={form.time} onChange={set("time")} className={`${INPUT} mt-1`} name="time" />
            </label>
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}
