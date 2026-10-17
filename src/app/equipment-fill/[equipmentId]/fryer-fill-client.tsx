"use client";

import { useQrFillCopy, useQrFeedback, qrResponseFeedback, type QrFeedback } from "@/components/qr-fill/qr-fill-presentation";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { EmployeePicker } from "@/components/qr-fill/employee-picker";
import { QrPassNote, QrPinOk, QrPinStep, QrPinUiStyles, QrRememberToggle, forgetQrPass, rememberQrEmployee } from "@/components/qr-fill/qr-pin-step";
import { QrPageShell } from "@/components/qr-fill/qr-page-shell";
import { SaveBlockedReason } from "@/components/qr-fill/save-blocked-reason";
import { SuccessCheck } from "@/components/qr-fill/success-check";
import { WhoRow } from "@/components/qr-fill/who-row";

type Employee = { id: string; name: string; positionTitle: string | null; hasPin?: boolean };

export type FryerFillTargetView = {
  phase: "start" | "end";
  fatTypes: string[];
  productTypes: string[];
  defaults: { fatType: string; productType: string };
  /** Начало жарки за сегодня (для шага «окончание»). */
  started: { time: string; fatType: string; productType: string } | null;
};

const LS_SHARED_EMPLOYEE_KEY = "wesetup.qr-fill.employeeId";
const SCORES = [5, 4, 3, 2, 1] as const;

function parseKg(value: string): number | null | "invalid" {
  const text = value.trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : "invalid";
}

/**
 * Наклейка фритюрницы (2026-10-17): первый скан за день — начало жарки
 * (жир → продукция → оценка), второй — окончание (оценка → остаток).
 * Строка ложится в журнал учёта фритюрных жиров, в строку этой фритюрницы.
 * Сотрудник и PIN — как у остальных наклеек оборудования.
 */
export function FryerFillClient(props: {
  token: string;
  organizationName: string;
  journalTitle: string;
  fryer: { id: string; name: string };
  employees: Employee[];
  mode: "public" | "pin" | "auth";
  sessionEmployee: { id: string; name: string; canPickOthers: boolean } | null;
  rememberedEmployeeId?: string | null;
  passEmployeeId?: string | null;
  /** `null` — активного журнала нет, записать некуда. */
  target: FryerFillTargetView | null;
}) {
  const { t } = useQrFillCopy();
  const feedback = useQrFeedback();
  const hydrated = useRef(false);
  const [employeeId, setEmployeeId] = useState("");
  const [pass, setPass] = useState<string | null>(null);
  const [pinOk, setPinOk] = useState(false);
  const [remember, setRemember] = useState(true);
  const [cookiePassFor, setCookiePassFor] = useState<string | null>(props.passEmployeeId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<QrFeedback | null>(null);
  const [phase, setPhase] = useState<"start" | "end">(props.target?.phase ?? "start");
  const [started, setStarted] = useState(props.target?.started ?? null);
  const [fatType, setFatType] = useState(props.target?.defaults.fatType ?? "");
  const [productType, setProductType] = useState(props.target?.defaults.productType ?? "");
  const [quality, setQuality] = useState<number | null>(null);
  const [carryover, setCarryover] = useState("");
  const [disposed, setDisposed] = useState("");
  const [done, setDone] = useState<{ phase: "start" | "end"; time: string } | null>(null);
  const fixed = props.mode === "auth" && props.sessionEmployee && !props.sessionEmployee.canPickOthers;

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (props.sessionEmployee) {
      setEmployeeId(props.sessionEmployee.id);
      return;
    }
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

  const logout = () => {
    void forgetQrPass({ kind: "equipment", objectId: props.fryer.id, token: props.token });
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
      rememberQrEmployee({ kind: "equipment", objectId: props.fryer.id, token: props.token, employeeId: id, remember });
    }
  };

  const selected = props.employees.find((e) => e.id === employeeId) ?? null;
  const pinRequired = props.mode !== "auth" && (props.mode === "pin" || Boolean(selected?.hasPin));
  const hasPass = Boolean(pass) || (cookiePassFor !== null && cookiePassFor === employeeId);
  const pinStepNeeded = Boolean(employeeId) && pinRequired && !hasPass;
  const carryoverKg = parseKg(carryover);
  const disposedKg = parseKg(disposed);
  const kgInvalid = carryoverKg === "invalid" || disposedKg === "invalid";

  // Почему кнопка неактивна — пишем под ней, а не оставляем серой загадкой.
  const blockedReason = !props.target
    ? t("reading.noDocumentBlocked")
    : !employeeId
      ? t("reading.noEmployee")
      : pinRequired && !hasPass
        ? t("reading.noPin")
        : phase === "start" && !fatType.trim()
          ? t("fryer.fat")
          : phase === "start" && !productType.trim()
            ? t("fryer.product")
            : quality === null
              ? t(phase === "start" ? "fryer.qualityStart" : "fryer.qualityEnd")
              : kgInvalid
                ? t("fryer.kgInvalid")
                : null;

  async function save() {
    if (busy || blockedReason) return;
    setBusy(true);
    setError(null);
    try {
      const body =
        phase === "start"
          ? { phase, fatType, productType, quality }
          : {
              phase,
              quality,
              carryoverKg: typeof carryoverKg === "number" ? carryoverKg : 0,
              disposedKg: typeof disposedKg === "number" ? disposedKg : 0,
            };
      const res = await fetch(`/api/equipment-fill/${encodeURIComponent(props.fryer.id)}/fryer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: props.token, employeeId, pass: pass ?? undefined, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(qrResponseFeedback(data, "fryer.saveError"));
        return;
      }
      try {
        localStorage.setItem(LS_SHARED_EMPLOYEE_KEY, employeeId);
      } catch {
        /* приватный режим */
      }
      const time = typeof data?.time === "string" ? data.time : "";
      setDone({ phase, time });
      if (phase === "start") {
        // Следующий скан — окончание жарки этой же строки.
        setStarted({ time, fatType, productType });
        setPhase("end");
      }
      setQuality(null);
    } catch {
      setError({ key: "fryer.saveError" });
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean) =>
    `min-h-11 rounded-2xl border px-4 py-2 text-left text-[15px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
      active
        ? "border-[#5566f6] bg-[#eef1ff] font-medium text-[#3848c7]"
        : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
    }`;
  const stepTitle = "mb-2 text-[15px] font-semibold text-[#0b1024]";

  return (
    <QrPageShell orgName={props.organizationName} title={props.journalTitle}>
      <QrPinUiStyles />
      <WhoRow label={t("fryer.fryer")} value={props.fryer.name} />
      {!props.target ? (
        <div className="mb-5 flex gap-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4 text-[14px] leading-relaxed text-[#7a4a00]" data-testid="fryer-no-document">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <span>{t("fryer.noDocument")}</span>
        </div>
      ) : null}
      {done ? (
        <div className="rounded-3xl border border-[#ececf4] bg-white p-8 text-center" role="status" data-testid="fryer-done">
          <SuccessCheck />
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">{t(done.phase === "start" ? "fryer.startTitle" : "fryer.endTitle")}</h2>
          <p className="mt-2 text-[17px] leading-relaxed text-[#3c4053]">{t(done.phase === "start" ? "fryer.startText" : "fryer.endText", { time: done.time })}</p>
          <button
            type="button"
            onClick={() => setDone(null)}
            className="mt-6 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white text-[16px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff]"
          >
            {t("common.done")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <EmployeePicker
            employees={props.employees.map((e) => ({ id: e.id, name: e.name, position: e.positionTitle, hasPin: e.hasPin }))}
            value={employeeId}
            onChange={pickEmployee}
            fixedName={fixed ? props.sessionEmployee?.name ?? null : null}
            label={t("fryer.operator")}
          />
          {pinRequired && hasPass && !fixed ? <QrPassNote remembered={cookiePassFor === employeeId} onLogout={logout} /> : null}
          {!fixed && props.mode !== "auth" && props.employees.length > 1 && !(pinRequired && hasPass) ? <QrRememberToggle checked={remember} onChange={setRemember} /> : null}
          {pinStepNeeded && selected ? (
            <QrPinStep
              kind="equipment"
              objectId={props.fryer.id}
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
          {pinStepNeeded || !props.target ? null : (
            <div className={pinOk ? "qp-rise space-y-5" : "space-y-5"}>
              <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
                <div className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">
                  {t(phase === "start" ? "fryer.startHeading" : "fryer.endHeading")}
                </div>
                <p className="mt-1 text-[14px] leading-relaxed text-[#6f7282]">{t(phase === "start" ? "fryer.startIntro" : "fryer.endIntro")}</p>
                {phase === "end" && started ? (
                  <p className="mt-2 text-[14px] text-[#3c4053]" data-testid="fryer-started">
                    {t("fryer.started", { time: started.time, fat: started.fatType || "—", product: started.productType || "—" })}
                  </p>
                ) : null}
              </div>

              {phase === "start" ? (
                <>
                  <fieldset>
                    <legend className={stepTitle}>{t("fryer.fat")}</legend>
                    <div className="flex flex-wrap gap-2">
                      {props.target.fatTypes.map((value) => (
                        <button key={value} type="button" aria-pressed={fatType === value} className={chip(fatType === value)} onClick={() => setFatType(value)}>
                          {value}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className={stepTitle}>{t("fryer.product")}</legend>
                    <div className="flex flex-wrap gap-2">
                      {props.target.productTypes.map((value) => (
                        <button key={value} type="button" aria-pressed={productType === value} className={chip(productType === value)} onClick={() => setProductType(value)}>
                          {value}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </>
              ) : null}

              <fieldset>
                <legend className={stepTitle}>{t(phase === "start" ? "fryer.qualityStart" : "fryer.qualityEnd")}</legend>
                <p className="-mt-1 mb-2 text-[13px] text-[#6f7282]">{t("fryer.qualityHint")}</p>
                <div className="grid grid-cols-1 gap-2" data-testid="fryer-quality">
                  {SCORES.map((score) => (
                    <button
                      key={score}
                      type="button"
                      aria-pressed={quality === score}
                      onClick={() => setQuality(score)}
                      className={`${chip(quality === score)} flex items-center gap-3 ${score <= 2 && quality === score ? "border-[#d2453d] bg-[#fff4f2] text-[#a13a32]" : ""}`}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-[15px] font-semibold tabular-nums shadow-[0_0_0_1px_rgba(220,223,237,0.9)]">{score}</span>
                      {t(`fryer.q${score}`)}
                    </button>
                  ))}
                </div>
              </fieldset>

              {phase === "end" ? (
                <fieldset>
                  <legend className={stepTitle}>{t("fryer.leftover")}</legend>
                  <p className="-mt-1 mb-2 text-[13px] text-[#6f7282]">{t("fryer.leftoverHint")}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-[13px] text-[#3c4053]">
                      <span>{t("fryer.carryover")}</span>
                      <input
                        inputMode="decimal"
                        value={carryover}
                        onChange={(event) => setCarryover(event.target.value)}
                        placeholder="0"
                        className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                      />
                    </label>
                    <label className="space-y-1 text-[13px] text-[#3c4053]">
                      <span>{t("fryer.disposed")}</span>
                      <input
                        inputMode="decimal"
                        value={disposed}
                        onChange={(event) => setDisposed(event.target.value)}
                        placeholder="0"
                        className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                      />
                    </label>
                  </div>
                </fieldset>
              ) : null}

              {error ? <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] text-[#a13a32]">{feedback(error)}</div> : null}
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || Boolean(blockedReason)}
                data-testid="fryer-save"
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[17px] font-semibold text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : null}
                {t(phase === "start" ? "fryer.saveStart" : "fryer.saveEnd")}
              </button>
              <SaveBlockedReason reason={busy ? null : blockedReason} />
            </div>
          )}
        </div>
      )}
    </QrPageShell>
  );
}
