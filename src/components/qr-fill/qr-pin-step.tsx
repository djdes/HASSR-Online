"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { QR_PIN_OK_HTML, QR_PIN_UI_CSS, QR_REMEMBER_LABEL } from "@/lib/qr-pin-ui";

/**
 * Наклейки объектов по единым правилам QR (2026-09-22): PIN — отдельным
 * шагом ДО формы, крупно; после верного PIN — зелёная галочка, поля
 * всплывают под ней. Пропуск визита живёт в памяти вкладки.
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

export function QrPinStep(props: {
  kind: "equipment" | "room";
  objectId: string;
  token: string;
  employeeId: string;
  employeeName: string;
  remember: boolean;
  onPass: (pass: string) => void;
  onChangeEmployee?: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <form onSubmit={submit} className="qp-card" data-testid="qr-pin-step">
      <div className="qp-head">
        <span className="qp-k">Ваш PIN</span>
        {props.onChangeEmployee ? (
          <button type="button" className="qp-link" onClick={props.onChangeEmployee}>
            Не {props.employeeName.split(" ")[0]}?
          </button>
        ) : null}
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
      <p className="qp-hint">PIN подтверждает, что запись делаете именно вы.</p>
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
