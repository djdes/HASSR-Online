"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ListPlus, Loader2, ShieldCheck, ShieldX, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { LifecycleSettings } from "@/lib/lifecycle/plan";
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON, TEXTAREA } from "../crm-ui";

type Person = { id: string; name: string };
type TaskView = { id: string; kind: string; status: string; discountPercent: number | null; approvalPending: boolean };
type Action = "done" | "cancel" | "approve" | "reject";

const ACTION_COPY: Record<Action, { title: string; description: string; confirm: string; placeholder: string; variant: "default" | "danger" | "info" }> = {
  done: { title: "Задача выполнена", description: "Напишите итог — он останется в истории клиента.", confirm: "Отметить выполненной", placeholder: "Договорились оплатить до пятницы…", variant: "default" },
  cancel: { title: "Отменить задачу", description: "Задача уйдёт в закрытые. Напишите, почему — например, клиент уже ответил в чате.", confirm: "Отменить задачу", placeholder: "Клиент оплатил картой…", variant: "danger" },
  approve: { title: "Согласовать скидку", description: "Менеджеру сразу придёт задача позвонить клиенту со скидкой из решения.", confirm: "Согласовать", placeholder: "Комментарий для менеджера (необязательно)", variant: "info" },
  reject: { title: "Отказать в скидке", description: "Менеджер позвонит с обычной скидкой. Напишите почему — он передаст клиенту.", confirm: "Отказать", placeholder: "Клиент на 120 человек — достаточно 15 %", variant: "danger" },
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

/** Кнопки задачи: выполнено / отменить, у согласования — согласовать / отказать. */
export function TaskActions({ task }: { task: TaskView }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [result, setResult] = useState("");
  const [percent, setPercent] = useState(String(task.discountPercent ?? 0));
  const approval = task.kind === "approve_discount" && task.approvalPending;

  async function confirm() {
    if (!action) return;
    const ok = await send(`/api/root/crm/tasks/${task.id}`, "PATCH", {
      action,
      result: result.trim() || null,
      percent: action === "approve" ? Math.round(Number(percent) || 0) : null,
    });
    if (!ok) return;
    toast.success(action === "approve" ? "Скидка согласована — менеджеру ушла задача" : action === "reject" ? "Отказ записан — менеджер позвонит с обычной скидкой" : action === "done" ? "Задача выполнена" : "Задача отменена");
    setAction(null);
    setResult("");
    router.refresh();
  }

  const copy = action ? ACTION_COPY[action] : null;
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {approval ? (
        <>
          <button type="button" onClick={() => setAction("approve")} className={PRIMARY_BUTTON} data-crm-task-approve>
            <ShieldCheck className="size-4" />
            Согласовать
          </button>
          <button type="button" onClick={() => setAction("reject")} className={SECONDARY_BUTTON}>
            <ShieldX className="size-4" />
            Отказать
          </button>
        </>
      ) : (
        <>
          {task.status === "open" ? (
            <button type="button" onClick={() => setAction("done")} className={PRIMARY_BUTTON} data-crm-task-done>
              <Check className="size-4" />
              Выполнено
            </button>
          ) : null}
          <button type="button" onClick={() => setAction("cancel")} className={SECONDARY_BUTTON}>
            <X className="size-4" />
            Отменить
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
        >
          <div className="space-y-3">
            {action === "approve" ? (
              <label className="block text-[13px] text-[#3c4053]">
                Скидка, %
                <input value={percent} onChange={(event) => setPercent(event.target.value.replace(/\D/g, "").slice(0, 2))} className={`${INPUT} mt-1 w-28`} inputMode="numeric" name="percent" />
              </label>
            ) : null}
            <label className="block text-[13px] text-[#3c4053]">
              {action === "done" ? "Итог" : "Комментарий"}
              <textarea value={result} onChange={(event) => setResult(event.target.value)} className={`${TEXTAREA} mt-1`} placeholder={copy.placeholder} name="result" />
            </label>
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
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

/** Настройки сценария: кому задачи, кто согласует, пороги и скидки. */
export function LifecycleSettingsForm({ settings, people }: { settings: LifecycleSettings; people: Person[] }) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const num = (key: "approvalSeats" | "trialFirstWorkdays" | "trialSecondWorkdays" | "invoiceAheadWorkdays" | "activeMinUsers") => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: Number(event.target.value.replace(/\D/g, "")) || 0 }));
  const band = (index: number, key: "minSeats" | "percent") => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, discounts: current.discounts.map((item, i) => (i === index ? { ...item, [key]: Number(event.target.value.replace(/\D/g, "")) || 0 } : item)) }));

  async function save() {
    setBusy(true);
    const ok = await send("/api/root/crm/tasks/settings", "PUT", form);
    setBusy(false);
    if (!ok) return;
    toast.success("Настройки сохранены — применятся завтра утром");
    router.refresh();
  }

  const field = "block text-[13px] text-[#3c4053]";
  return (
    <div className="mt-5 space-y-5">
      <label className="flex items-center gap-3 text-[14px] text-[#0b1024]">
        <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="size-4 accent-[#5566f6]" />
        Сценарий включён: письма со счётом и задачи ставятся сами
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          Кому задачи по умолчанию
          <select value={form.assigneeId ?? ""} onChange={(event) => setForm({ ...form, assigneeId: event.target.value || null })} className={`${INPUT} mt-1`}>
            <option value="">РОП (общая очередь)</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Кто согласует особую скидку
          <select value={form.approverId ?? ""} onChange={(event) => setForm({ ...form, approverId: event.target.value || null })} className={`${INPUT} mt-1`}>
            <option value="">РОП, без него — владелец платформы</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <label className={field}>
          Первое письмо, раб. дней
          <input value={form.trialFirstWorkdays} onChange={num("trialFirstWorkdays")} className={`${INPUT} mt-1`} inputMode="numeric" />
        </label>
        <label className={field}>
          Второе письмо, раб. дней
          <input value={form.trialSecondWorkdays} onChange={num("trialSecondWorkdays")} className={`${INPUT} mt-1`} inputMode="numeric" />
        </label>
        <label className={field}>
          Счёт на продление, раб. дней
          <input value={form.invoiceAheadWorkdays} onChange={num("invoiceAheadWorkdays")} className={`${INPUT} mt-1`} inputMode="numeric" />
        </label>
        <label className={field}>
          Согласование от, сотрудников
          <input value={form.approvalSeats} onChange={num("approvalSeats")} className={`${INPUT} mt-1`} inputMode="numeric" />
        </label>
        <label className={field}>
          «Живой» аккаунт от, сотрудников
          <input value={form.activeMinUsers} onChange={num("activeMinUsers")} className={`${INPUT} mt-1`} inputMode="numeric" />
        </label>
      </div>
      <div>
        <div className="text-[13px] text-[#3c4053]">Скидка в КП по числу сотрудников</div>
        <div className="mt-2 flex flex-wrap gap-3">
          {form.discounts.map((item, index) => (
            <div key={index} className="flex items-center gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[13px] text-[#3c4053]">
              от
              <input value={item.minSeats} onChange={band(index, "minSeats")} className={`${INPUT} h-9 w-20`} inputMode="numeric" aria-label="Сотрудников от" />
              чел. —
              <input value={item.percent} onChange={band(index, "percent")} className={`${INPUT} h-9 w-16`} inputMode="numeric" aria-label="Скидка, %" />%
            </div>
          ))}
        </div>
      </div>
      <button type="button" onClick={save} disabled={busy} className={PRIMARY_BUTTON} data-crm-lifecycle-save>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Сохранить настройки
      </button>
    </div>
  );
}
