"use client";

import { useEffect, useState } from "react";
import { Lightbulb, LightbulbOff, Loader2 } from "lucide-react";

import { EmployeePicker } from "@/components/qr-fill/employee-picker";
import { PinPrompt } from "@/components/qr-fill/pin-prompt";
import { QrPageShell } from "@/components/qr-fill/qr-page-shell";
import { SuccessCheck } from "@/components/qr-fill/success-check";
import { WhoRow } from "@/components/qr-fill/who-row";
import { formatHours } from "@/lib/uv-lamp";

type Employee = { id: string; name: string; positionTitle: string | null; hasPin?: boolean };
type LampState = {
  running: { since: string; byName: string | null } | null;
  lifetimeHours: number | null;
  usedHours: number;
  remainingHours: number | null;
};

const LS_SHARED_EMPLOYEE_KEY = "wesetup.qr-fill.employeeId";

/**
 * Наклейка УФ-лампы (2026-09-22): выбрать себя из списка журнала → огромная
 * кнопка «Я включил облучатель» → после нажатия её место занимает «Я
 * выключил облучатель». Наработка и остаток ресурса — сразу на экране.
 */
export function UvLampClient(props: {
  token: string;
  organizationName: string;
  lamp: { id: string; name: string; areaName: string };
  employees: Employee[];
  mode: "public" | "pin" | "auth";
  sessionEmployee: { id: string; name: string; canPickOthers: boolean } | null;
  initialState: LampState;
}) {
  const [state, setState] = useState<LampState>(props.initialState);
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; text: string; warn: string | null } | null>(null);
  const fixed = props.mode === "auth" && props.sessionEmployee && !props.sessionEmployee.canPickOthers;

  useEffect(() => {
    if (props.sessionEmployee) {
      setEmployeeId(props.sessionEmployee.id);
      return;
    }
    // В списке журнала один человек — выбирать нечего.
    if (props.employees.length === 1) {
      setEmployeeId(props.employees[0].id);
      return;
    }
    try {
      const remembered = localStorage.getItem(LS_SHARED_EMPLOYEE_KEY);
      if (remembered && props.employees.some((e) => e.id === remembered)) setEmployeeId(remembered);
    } catch {
      /* приватный режим */
    }
  }, [props.employees, props.sessionEmployee]);

  const selected = props.employees.find((e) => e.id === employeeId) ?? null;
  const pinRequired = props.mode === "pin" || Boolean(selected?.hasPin);
  const running = Boolean(state.running);

  async function press() {
    if (busy || !employeeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/equipment-fill/${props.lamp.id}/uv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: props.token, employeeId, pin: pin || undefined, action: running ? "off" : "on" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось записать");
      try {
        localStorage.setItem(LS_SHARED_EMPLOYEE_KEY, employeeId);
      } catch {
        /* приватный режим */
      }
      if (data?.state) setState(data.state as LampState);
      setPin("");
      if (data?.action === "on") {
        setDone({ title: "Облучатель включён", text: `Отметка в ${data.since}. Когда выключите — отсканируйте эту же наклейку и нажмите «Я выключил».`, warn: null });
      } else {
        const remaining = typeof data?.remainingHours === "number" ? ` Осталось ресурса: ${formatHours(data.remainingHours)}.` : "";
        setDone({
          title: "Облучатель выключен",
          text: `Работал ${data?.durationLabel ?? ""} — записано в журнал.${remaining}`,
          warn: data?.warn === "over" ? "Ресурс лампы исчерпан — замените лампу. Ответственный уже знает." : data?.warn === "warn" ? "Ресурс лампы почти исчерпан — ответственному отправлено напоминание заказать лампу." : null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось записать");
    } finally {
      setBusy(false);
    }
  }

  return (
    <QrPageShell orgName={props.organizationName} title="Журнал учёта работы УФ-лампы">
      <WhoRow label="Лампа" value={props.lamp.name} />
      {done ? (
        <div className="rounded-3xl border border-[#ececf4] bg-white p-8 text-center" role="status">
          <SuccessCheck />
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">{done.title}</h2>
          <p className="mt-2 text-[17px] leading-relaxed text-[#3c4053]">{done.text}</p>
          {done.warn ? <p className="mt-3 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] text-[#a13a32]">{done.warn}</p> : null}
          <button
            type="button"
            onClick={() => setDone(null)}
            className="mt-6 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white text-[16px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff]"
          >
            Готово
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <EmployeePicker
            employees={props.employees.map((e) => ({ id: e.id, name: e.name, position: e.positionTitle, hasPin: e.hasPin }))}
            value={employeeId}
            onChange={setEmployeeId}
            fixedName={fixed ? props.sessionEmployee?.name ?? null : null}
            label="Кто включает и выключает"
          />
          {state.running ? (
            <div className="rounded-2xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[17px] text-[#7a4a00]" data-testid="uv-running">
              Работает с <b>{state.running.since}</b>
              {state.running.byName ? ` · включил(а) ${state.running.byName}` : ""}
            </div>
          ) : null}
          {error && !/PIN/.test(error) ? (
            <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] text-[#a13a32]">{error}</div>
          ) : null}
          {pinRequired ? <PinPrompt value={pin} onChange={setPin} error={error && /PIN/.test(error) ? error : null} /> : null}
          <button
            type="button"
            onClick={() => void press()}
            disabled={busy || !employeeId || (pinRequired && pin.length < 4)}
            data-testid="uv-toggle"
            className={`flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-3xl px-6 text-[26px] font-bold text-white shadow-[0_20px_50px_-20px_rgba(11,16,36,0.45)] transition-colors duration-150 disabled:opacity-60 ${
              running ? "bg-[#d2453d] hover:bg-[#bd3c35]" : "bg-[#16a34a] hover:bg-[#15803d]"
            }`}
          >
            {busy ? <Loader2 className="size-10 animate-spin" /> : running ? <LightbulbOff className="size-10" /> : <Lightbulb className="size-10" />}
            {running ? "Я выключил облучатель" : "Я включил облучатель"}
          </button>
          {state.lifetimeHours ? (
            <p className="text-center text-[15px] text-[#6f7282]">
              Наработка {formatHours(state.usedHours)} из {formatHours(state.lifetimeHours)}
              {state.remainingHours !== null ? ` · осталось ${formatHours(state.remainingHours)}` : ""}
            </p>
          ) : null}
        </div>
      )}
    </QrPageShell>
  );
}
