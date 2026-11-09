"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Save } from "lucide-react";
import { toast } from "sonner";

import type { LifecycleSettings } from "@/lib/crm/lifecycle/settings";
import { cn } from "@/lib/utils";
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON, TEXTAREA, ZONE_TITLE } from "../crm-ui";

type Person = { id: string; name: string };

function listText(values: number[]): string {
  return values.join(", ");
}

/** «4, 2» → [4, 2]; неверное (0, 120, буквы) — null: сохранять нечего, покажем ошибку. */
function parseList(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  const numbers = parts.map(Number);
  if (!parts.length || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 90)) return null;
  return [...new Set(numbers)].sort((a, b) => b - a);
}

function Toggle({ checked, onChange, title, hint, name }: { checked: boolean; onChange: (value: boolean) => void; title: string; hint: string; name: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3", checked ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4] bg-white")}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 size-4 accent-[#5566f6]" data-automation-toggle={name} />
      <span>
        <span className="block text-[14px] font-medium text-[#0b1024]">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-[#6f7282]">{hint}</span>
      </span>
    </label>
  );
}

export function AutomationClient({ initial, people }: { initial: LifecycleSettings; people: Person[] }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [texts, setTexts] = useState({
    trial: listText(initial.trialStages),
    year: listText(initial.renewalYearStages),
    month: listText(initial.renewalMonthStages),
    holidays: initial.holidays.join("\n"),
  });
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  async function save() {
    const trialStages = parseList(texts.trial);
    const renewalYearStages = parseList(texts.year);
    const renewalMonthStages = parseList(texts.month);
    if (!trialStages || !renewalYearStages || !renewalMonthStages) {
      toast.error("Ступени — целые числа дней от 1 до 90 через запятую, например «4, 2»");
      return;
    }
    setSaving(true);
    const body: LifecycleSettings = {
      ...settings,
      trialStages,
      renewalYearStages,
      renewalMonthStages,
      holidays: texts.holidays.split(/\s+/).filter(Boolean),
    };
    const response = await fetch("/api/root/crm/automation", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => null)) as { settings?: LifecycleSettings; error?: string } | null;
    setSaving(false);
    if (!response.ok || !data?.settings) {
      toast.error(data?.error ?? "Не сохранилось");
      return;
    }
    setSettings(data.settings);
    toast.success("Настройки автоворонки сохранены");
    router.refresh();
  }

  async function runNow() {
    setRunning(true);
    const response = await fetch("/api/root/crm/automation/run", { method: "POST" });
    const data = (await response.json().catch(() => null)) as { messages?: { sent: number }; tasks?: { created: number }; deals?: { created: number }; skipped?: string | null; errors?: string[] } | null;
    setRunning(false);
    if (!response.ok || !data) return void toast.error("Прогон не удался");
    if (data.skipped === "disabled") return void toast.message("Автоворонка выключена");
    toast.success(`Прогон: сделок +${data.deals?.created ?? 0}, писем ${data.messages?.sent ?? 0}, задач ${data.tasks?.created ?? 0}${data.errors?.length ? `, ошибок ${data.errors.length}` : ""}`);
    router.refresh();
  }

  return (
    <div className={cn(CARD, "space-y-6 p-5 sm:p-6")} data-automation-form>
      <div className="grid gap-3 lg:grid-cols-3">
        <Toggle
          name="enabled"
          checked={settings.enabled}
          onChange={(value) => setSettings({ ...settings, enabled: value })}
          title="Автоворонка включена"
          hint="Сделки в воронке, задачи менеджерам и письма клиентам по срокам пробного и оплаты."
        />
        <Toggle
          name="clientMessages"
          checked={settings.clientMessages}
          onChange={(value) => setSettings({ ...settings, clientMessages: value })}
          title="Письма клиентам"
          hint="Выключите — останутся только сделки и задачи. Пока включено, биллинг свои напоминания о конце пробного и оплаты не шлёт."
        />
        <Toggle
          name="attachInvoice"
          checked={settings.attachInvoice}
          onChange={(value) => setSettings({ ...settings, attachInvoice: value })}
          title="Счёт во вложении"
          hint="Организациям с ИНН — счёт PDF прямо в письме (действующий неоплаченный прикладывается повторно, новый не выставляется)."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-[13px] text-[#3c4053]">
          Пробный: письмо и задача за, дней
          <input className={cn(INPUT, "mt-1")} value={texts.trial} onChange={(e) => setTexts({ ...texts, trial: e.target.value })} data-automation-trial />
          <span className="mt-1 block text-[12px] text-[#6f7282]">Выходные и праздники переносят ступень на рабочий день раньше.</span>
        </label>
        <label className="text-[13px] text-[#3c4053]">
          Задачи менеджеру — на ступенях не раньше, чем за, дней
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            className={cn(INPUT, "mt-1")}
            value={settings.taskStageMax}
            onChange={(e) => setSettings({ ...settings, taskStageMax: Math.max(1, Math.min(30, Math.floor(Number(e.target.value) || 4))) })}
          />
        </label>
        <label className="text-[13px] text-[#3c4053]">
          Продление годового: письма за, дней
          <input className={cn(INPUT, "mt-1")} value={texts.year} onChange={(e) => setTexts({ ...texts, year: e.target.value })} />
        </label>
        <label className="text-[13px] text-[#3c4053]">
          Продление помесячного: письма за, дней
          <input className={cn(INPUT, "mt-1")} value={texts.month} onChange={(e) => setTexts({ ...texts, month: e.target.value })} />
        </label>
        <label className="text-[13px] text-[#3c4053]">
          Грейс: последнее письмо и срочная задача за, дней до отключения
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            className={cn(INPUT, "mt-1")}
            value={settings.graceLastStage}
            onChange={(e) => setSettings({ ...settings, graceLastStage: Math.max(1, Math.min(30, Math.floor(Number(e.target.value) || 2))) })}
          />
        </label>
        <label className="text-[13px] text-[#3c4053]">
          Задача «вернуть» после перехода на бесплатный, рабочих дней
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            className={cn(INPUT, "mt-1")}
            value={settings.winbackAfterWorkingDays}
            onChange={(e) => setSettings({ ...settings, winbackAfterWorkingDays: Math.max(1, Math.min(30, Math.floor(Number(e.target.value) || 3))) })}
          />
        </label>
        <label className="text-[13px] text-[#3c4053]">
          Счёт новому клиенту
          <select className={cn(INPUT, "mt-1")} value={settings.invoiceCycle} onChange={(e) => setSettings({ ...settings, invoiceCycle: e.target.value === "month" ? "month" : "year" })}>
            <option value="year">За год (выгоднее, по умолчанию)</option>
            <option value="month">За месяц</option>
          </select>
        </label>
        <label className="text-[13px] text-[#3c4053]">
          Ответственный, если у клиента нет менеджера
          <select className={cn(INPUT, "mt-1")} value={settings.defaultAssigneeId ?? ""} onChange={(e) => setSettings({ ...settings, defaultAssigneeId: e.target.value || null })} data-automation-assignee>
            <option value="">Первый РОП</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <div className={ZONE_TITLE}>Лестница скидок спец-КП (работающие аккаунты новых клиентов)</div>
        <div className="mt-2 space-y-2">
          {settings.discountLadder.map((step, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2 text-[13.5px] text-[#3c4053]">
              от
              <input
                type="number"
                inputMode="numeric"
                min={1}
                className={cn(INPUT, "h-9 w-24")}
                value={step.minUsers}
                onChange={(e) => {
                  const ladder = [...settings.discountLadder];
                  ladder[index] = { ...step, minUsers: Math.max(1, Math.floor(Number(e.target.value) || 1)) };
                  setSettings({ ...settings, discountLadder: ladder });
                }}
              />
              сотрудников —
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={90}
                className={cn(INPUT, "h-9 w-20")}
                value={step.percent}
                onChange={(e) => {
                  const ladder = [...settings.discountLadder];
                  ladder[index] = { ...step, percent: Math.max(1, Math.min(90, Math.floor(Number(e.target.value) || 1))) };
                  setSettings({ ...settings, discountLadder: ladder });
                }}
              />
              %
              <button type="button" className="text-[12.5px] text-[#a13a32] hover:underline" onClick={() => setSettings({ ...settings, discountLadder: settings.discountLadder.filter((_, i) => i !== index) })}>
                убрать
              </button>
            </div>
          ))}
          <button type="button" className="text-[13px] text-[#3848c7] hover:underline" onClick={() => setSettings({ ...settings, discountLadder: [...settings.discountLadder, { minUsers: 50, percent: 20 }] })}>
            + ступень
          </button>
          <p className="text-[12px] leading-snug text-[#6f7282]">Скидка больше лимита роли ответственного уходит на согласование (лимит — в «Команда и доступы» → роль).</p>
        </div>
      </div>

      <label className="block text-[13px] text-[#3c4053]">
        Дополнительные выходные (переносы праздников), по одной дате «ГГГГ-ММ-ДД» в строке
        <textarea className={cn(TEXTAREA, "mt-1 min-h-[70px]")} value={texts.holidays} onChange={(e) => setTexts({ ...texts, holidays: e.target.value })} placeholder="2026-12-31" />
      </label>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY_BUTTON} onClick={save} disabled={saving} data-automation-save>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Сохранить
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={runNow} disabled={running} data-automation-run>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Прогнать сейчас
        </button>
      </div>
    </div>
  );
}
