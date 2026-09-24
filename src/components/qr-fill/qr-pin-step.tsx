"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { QrPinNoAccess, QrPinRequestForm, QrPinRequestSent, useQrPinRequestInfo } from "@/components/qr-fill/qr-pin-request";
import { QR_PIN_OK_HTML, QR_PIN_UI_CSS, QR_REMEMBER_LABEL } from "@/lib/qr-pin-ui";

/**
 * Наклейки объектов по единым правилам QR (2026-09-22): PIN — отдельным
 * шагом ДО формы, крупно; после верного PIN — зелёная галочка, поля
 * всплывают под ней. Пропуск — в памяти вкладки и (при «Запомнить выбор»)
 * в cookie организации на 30 минут: F5 и соседняя наклейка без PIN.
 */
export function QrPinUiStyles() {
  return <style dangerouslySetInnerHTML={{ __html: QR_PIN_UI_CSS }} />;
}

export function QrPinOk() {
  return <div dangerouslySetInnerHTML={{ __html: QR_PIN_OK_HTML }} />;
}

export function QrRememberToggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="qp-remember">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} data-testid="qr-remember" />
      <span>{QR_REMEMBER_LABEL}</span>
    </label>
  );
}

/** Запомнить выбранного сотрудника на этом устройстве (без PIN — только cookie выбора). */
export function rememberQrEmployee(params: { kind: "equipment" | "room"; objectId: string; token: string; employeeId: string; remember: boolean }) {
  void fetch("/api/qr-fill/pass", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).catch(() => null);
}

/**
 * «Не вы? Сменить» на общем телефоне: снять пропуск (cookie на 30 минут) и
 * запомненный выбор организации — следующий человек выбирает себя и вводит PIN.
 */
export async function forgetQrPass(params: { kind: "equipment" | "room"; objectId: string; token: string }) {
  await fetch("/api/qr-fill/pass", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, logout: true }),
  }).catch(() => null);
}

/**
 * Строка под «Кто заполняет», когда PIN уже подтверждён: что это значит и
 * как выйти, если телефон общий.
 */
export function QrPassNote({ remembered, onLogout }: { remembered: boolean; onLogout: () => void }) {
  return (
    <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border border-[#bbf0d0] bg-[#ecfdf5] px-4 py-2.5 text-[15px] leading-snug text-[#116b2a]" data-testid="qr-pass-note">
      <span className="flex items-center gap-2">
        <ShieldCheck className="size-5 shrink-0" />
        {remembered ? "PIN подтверждён — 30 минут без повторного ввода" : "PIN подтверждён"}
      </span>
      <button
        type="button"
        onClick={onLogout}
        data-testid="qr-pass-logout"
        className="shrink-0 rounded-lg font-semibold text-[#3848c7] underline underline-offset-2 transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        Не вы? Сменить
      </button>
    </div>
  );
}

type QrPinStepProps = {
  kind: "equipment" | "room";
  objectId: string;
  token: string;
  employeeId: string;
  employeeName: string;
  /** У сотрудника задан PIN. false — PIN нужен, а его нет: экран «Запросить доступ». */
  hasPin?: boolean;
  remember: boolean;
  onPass: (pass: string) => void;
  onChangeEmployee?: () => void;
};

/**
 * Шаг PIN до формы: ввод PIN (справа в заголовке — «Запросить смену PIN»),
 * а если PIN нужен, но его нет, — «Запросить доступ». Как у QR-журналов.
 */
export function QrPinStep(props: QrPinStepProps) {
  // Другой сотрудник — шаг с чистого листа: цифры, ошибка, статус запроса.
  return <QrPinStepFor key={props.employeeId} {...props} />;
}

function QrPinStepFor(props: QrPinStepProps) {
  const target = { kind: props.kind, objectId: props.objectId, token: props.token, employeeId: props.employeeId };
  const [info, setInfo] = useQrPinRequestInfo(target);
  const [view, setView] = useState<"pin" | "change" | "change-sent">("pin");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PIN мог появиться, пока страница открыта: руководитель одобрил запрос.
  const hasPin = props.hasPin !== false || info.hasPin === true;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/qr-fill/pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: props.kind, objectId: props.objectId, token: props.token, employeeId: props.employeeId, pin, remember: props.remember }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.pass !== "string") throw new Error(data?.error ?? "Не удалось проверить PIN");
      props.onPass(data.pass);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось проверить PIN");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  if (!hasPin) {
    return <QrPinNoAccess target={target} status={info.status} onStatus={(status) => setInfo((current) => ({ ...current, status }))} />;
  }
  if (view === "change") {
    return <QrPinRequestForm target={target} requestKind="change" onSent={() => setView("change-sent")} onCancel={() => setView("pin")} />;
  }
  if (view === "change-sent") return <QrPinRequestSent requestKind="change" onDone={() => setView("pin")} />;

  return (
    <form onSubmit={submit} className="qp-card" data-testid="qr-pin-step">
      {info.approvedNote ? (
        <div className="qp-ok-note" role="status">
          {info.approvedNote}
        </div>
      ) : null}
      <div className="qp-head flex-wrap">
        <span className="qp-k">Ваш PIN</span>
        <span className="ml-auto flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
          <button
            type="button"
            className="qp-link"
            data-testid="qr-pin-change"
            onClick={() => {
              setError(null);
              setView("change");
            }}
          >
            Запросить смену PIN
          </button>
          {props.onChangeEmployee ? (
            <button type="button" className="qp-link" onClick={props.onChangeEmployee}>
              Не {props.employeeName.split(" ")[0]}?
            </button>
          ) : null}
        </span>
      </div>
      {error ? <div className="qp-err">{error}</div> : null}
      <input
        className="qp-pin"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        autoFocus
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
        placeholder="••••"
        aria-label="PIN"
      />
      <p className="qp-hint">PIN для подтверждения личности</p>
      <button
        type="submit"
        disabled={busy || pin.length < 4}
        className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[19px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : null}
        Продолжить
      </button>
    </form>
  );
}
