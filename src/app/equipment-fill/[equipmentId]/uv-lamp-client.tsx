"use client";

import { useEffect, useState } from "react";
import { Lightbulb, LightbulbOff, Loader2 } from "lucide-react";

import { EmployeePicker } from "@/components/qr-fill/employee-picker";
import { QrPassNote, QrPinOk, QrPinStep, QrPinUiStyles, QrRememberToggle, forgetQrPass, rememberQrEmployee } from "@/components/qr-fill/qr-pin-step";
import { QrPageShell } from "@/components/qr-fill/qr-page-shell";
import { SaveBlockedReason } from "@/components/qr-fill/save-blocked-reason";
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
  /** «Запомнить выбор на этом оборудовании» — сотрудник из cookie организации. */
  rememberedEmployeeId?: string | null;
  /** Чей пропуск после PIN лежит в cookie организации (30 минут) — ему PIN не спрашиваем. */
  passEmployeeId?: string | null;
}) {
  const [state, setState] = useState<LampState>(props.initialState);
  const [employeeId, setEmployeeId] = useState("");
  // Единые правила QR (2026-09-22): PIN — шагом до кнопки, дальше пропуск визита.
  const [pass, setPass] = useState<string | null>(null);
  const [pinOk, setPinOk] = useState(false);
  const [remember, setRemember] = useState(true);
  // Пропуск в cookie (F5, соседняя наклейка): действует для этого сотрудника.
  const [cookiePassFor, setCookiePassFor] = useState<string | null>(props.passEmployeeId ?? null);
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
      const remembered = props.passEmployeeId ?? props.rememberedEmployeeId ?? localStorage.getItem(LS_SHARED_EMPLOYEE_KEY);
      if (remembered && props.employees.some((e) => e.id === remembered)) setEmployeeId(remembered);
    } catch {
      /* приватный режим */
    }
  }, [props.employees, props.sessionEmployee, props.rememberedEmployeeId, props.passEmployeeId]);

  // «Не вы? Сменить»: снять пропуск и запомненный выбор — телефон общий.
  const logout = () => {
    void forgetQrPass({ kind: "equipment", objectId: props.lamp.id, token: props.token });
    setCookiePassFor(null);
    setPass(null);
    setPinOk(false);
    setEmployeeId("");
    try {
      localStorage.removeItem(LS_SHARED_EMPLOYEE_KEY);
    } catch {
      /* приватный режим */
    }
  };

  const pickEmployee = (id: string) => {
    setEmployeeId(id);
    setPass(null);
    setPinOk(false);
    const next = props.employees.find((e) => e.id === id);
    if (props.mode !== "auth" && !(props.mode === "pin" || next?.hasPin)) {
      rememberQrEmployee({ kind: "equipment", objectId: props.lamp.id, token: props.token, employeeId: id, remember });
    }
  };

  const selected = props.employees.find((e) => e.id === employeeId) ?? null;
  const pinRequired = props.mode !== "auth" && (props.mode === "pin" || Boolean(selected?.hasPin));
  const hasPass = Boolean(pass) || (cookiePassFor !== null && cookiePassFor === employeeId);
  const pinStepNeeded = Boolean(employeeId) && pinRequired && !hasPass;
  const running = Boolean(state.running);

  async function press() {
    if (busy || !employeeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/equipment-fill/${encodeURIComponent(props.lamp.id)}/uv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: props.token, employeeId, pass: pass ?? undefined, action: running ? "off" : "on" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось записать");
      try {
        localStorage.setItem(LS_SHARED_EMPLOYEE_KEY, employeeId);
      } catch {
        /* приватный режим */
      }
      if (data?.state) setState(data.state as LampState);
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
      <QrPinUiStyles />
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
            onChange={pickEmployee}
            fixedName={fixed ? props.sessionEmployee?.name ?? null : null}
            label="Кто включает и выключает"
          />
          {pinRequired && hasPass && !fixed ? <QrPassNote remembered={cookiePassFor === employeeId} onLogout={logout} /> : null}
          {!fixed && props.mode !== "auth" && props.employees.length > 1 && !(pinRequired && hasPass) ? <QrRememberToggle checked={remember} onChange={setRemember} /> : null}
          {pinStepNeeded && selected ? (
            <QrPinStep
              kind="equipment"
              objectId={props.lamp.id}
              token={props.token}
              employeeId={selected.id}
              employeeName={selected.name}
              hasPin={Boolean(selected.hasPin)}
              remember={remember}
              onPass={(value) => {
                setPass(value);
                setPinOk(true);
                setCookiePassFor(remember ? selected.id : null);
              }}
            />
          ) : null}
          {pinOk ? <QrPinOk /> : null}
          {pinStepNeeded ? null : (
          <div className={pinOk ? "qp-rise space-y-4" : "space-y-4"}>
          {state.running ? (
            <div className="rounded-2xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[17px] text-[#7a4a00]" data-testid="uv-running">
              Работает с <b>{state.running.since}</b>
              {state.running.byName ? ` · включил(а) ${state.running.byName}` : ""}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] text-[#a13a32]">{error}</div>
          ) : null}
          <button
            type="button"
            onClick={() => void press()}
            disabled={busy || !employeeId || (pinRequired && !hasPass)}
            data-testid="uv-toggle"
            className={`flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-3xl px-6 text-[26px] font-bold text-white shadow-[0_20px_50px_-20px_rgba(11,16,36,0.45)] transition-colors duration-150 disabled:opacity-60 ${
              running ? "bg-[#d2453d] hover:bg-[#bd3c35]" : "bg-[#16a34a] hover:bg-[#15803d]"
            }`}
          >
            {busy ? <Loader2 className="size-10 animate-spin" /> : running ? <LightbulbOff className="size-10" /> : <Lightbulb className="size-10" />}
            {running ? "Я выключил облучатель" : "Я включил облучатель"}
          </button>
          <SaveBlockedReason reason={!busy && !employeeId ? "Не выбран сотрудник" : null} />
          {state.lifetimeHours ? (
            <p className="text-center text-[15px] text-[#6f7282]">
              Наработка {formatHours(state.usedHours)} из {formatHours(state.lifetimeHours)}
              {state.remainingHours !== null ? ` · осталось ${formatHours(state.remainingHours)}` : ""}
            </p>
          ) : null}
          </div>
          )}
        </div>
      )}
    </QrPageShell>
  );
}
