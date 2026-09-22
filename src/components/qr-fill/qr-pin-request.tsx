"use client";

import { useEffect, useId, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

import { SuccessCheck } from "@/components/qr-fill/success-check";
import type { PinRequestStatusLine, QrObjectPinTarget } from "@/lib/qr-object-pin-request";
import { validatePinRequestInput, type PinRequestKind } from "@/lib/qr-pin-requests-core";
import { validateQrPin } from "@/lib/qr-pin-rules";

/**
 * «Запросить доступ» и «Запросить смену PIN» на наклейках объектов — как на
 * серверных QR-журналах (`journal-fill-html.ts`): PIN придумывает сам
 * сотрудник (дважды), руководитель одобряет в «Сотрудниках», после этого
 * PIN работает. Внешний вид — общие классы шага PIN `qp-*` (`qr-pin-ui.ts`).
 */

export type QrPinRequestInfo = {
  /** PIN у сотрудника сейчас (по базе); null — ещё не знаем. */
  hasPin: boolean | null;
  status: PinRequestStatusLine | null;
  approvedNote: string | null;
};

const PRIMARY_BUTTON =
  "flex w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:bg-[#c8cbe0] disabled:shadow-none";
const SECONDARY_BUTTON =
  "flex h-14 w-full items-center justify-center rounded-2xl border border-[#5566f6]/30 bg-[#f5f6ff] text-[18px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25";

function isStatusLine(value: unknown): value is PinRequestStatusLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Record<string, unknown>;
  return typeof line.text === "string" && (line.tone === "wait" || line.tone === "bad");
}

/** Есть ли у сотрудника PIN и что с его последним запросом (GET `/api/qr-fill/pin-request`). */
export function useQrPinRequestInfo(target: QrObjectPinTarget) {
  const [info, setInfo] = useState<QrPinRequestInfo>({ hasPin: null, status: null, approvedNote: null });
  const { kind, objectId, token, employeeId } = target;
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ kind, objectId, token, employeeId });
    fetch(`/api/qr-fill/pin-request?${query.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Record<string, unknown> | null) => {
        if (!data || typeof data !== "object") return;
        setInfo({
          hasPin: typeof data.hasPin === "boolean" ? data.hasPin : null,
          status: isStatusLine(data.status) ? data.status : null,
          approvedNote: typeof data.approvedNote === "string" ? data.approvedNote : null,
        });
      })
      // Нет связи — экран работает и без строки статуса.
      .catch(() => null);
    return () => controller.abort();
  }, [kind, objectId, token, employeeId]);
  return [info, setInfo] as const;
}

/** Новый PIN дважды → запрос руководителю. «issue» — PIN ещё нет, «change» — сменить действующий. */
export function QrPinRequestForm({
  target,
  requestKind,
  onSent,
  onCancel,
}: {
  target: QrObjectPinTarget;
  requestKind: PinRequestKind;
  onSent: (status: PinRequestStatusLine | null) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const secondRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = requestKind === "change";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const invalid = validatePinRequestInput({ pin, repeat: pin2 });
    if (invalid) {
      setError(invalid);
      // Не совпал только повтор — стираем его; сам PIN не годится — оба.
      if (validateQrPin(pin) === null) {
        setPin2("");
        secondRef.current?.focus();
      } else {
        setPin("");
        setPin2("");
        firstRef.current?.focus();
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/qr-fill/pin-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, pin, pin2, requestKind }),
      }).catch(() => null);
      if (!response) throw new Error("Нет связи с сервером — проверьте интернет и попробуйте ещё раз.");
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; status?: unknown } | null;
      if (!response.ok || data?.ok !== true) throw new Error(data?.error ?? "Не удалось отправить запрос. Попробуйте ещё раз.");
      onSent(isStatusLine(data.status) ? data.status : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить запрос. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="qp-card" data-testid="qr-pin-request" data-kind={requestKind}>
      {change ? (
        <p className="qp-hint" style={{ margin: "4px 2px 14px", color: "#3c4053" }}>
          Введите новый PIN — ответственный получит запрос, после одобрения вы получите уведомление. До этого действует старый PIN.
        </p>
      ) : null}
      {error ? (
        <div className="qp-err" role="alert">
          {error}
        </div>
      ) : null}
      <div className="qp-head">
        <label className="qp-k" htmlFor={`${id}-pin`}>
          {change ? "Новый PIN" : "Придумайте PIN"}
        </label>
        <span className="shrink-0 text-[17px] font-medium text-[#6f7282]">4–6 цифр</span>
      </div>
      <input
        ref={firstRef}
        id={`${id}-pin`}
        className="qp-pin"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="new-password"
        autoFocus
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
        placeholder="••••"
      />
      <div className="qp-head" style={{ marginTop: 16 }}>
        <label className="qp-k" htmlFor={`${id}-pin2`} style={{ fontSize: 20 }}>
          Повторите PIN
        </label>
      </div>
      <input
        ref={secondRef}
        id={`${id}-pin2`}
        className="qp-pin"
        style={{ minHeight: 96 }}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="new-password"
        value={pin2}
        onChange={(event) => setPin2(event.target.value.replace(/\D/g, ""))}
        placeholder="••••"
      />
      {change ? null : <p className="qp-hint">Руководитель получит запрос — после его одобрения PIN заработает.</p>}
      <button type="submit" disabled={busy || pin.length < 4 || pin2.length < 4} className={`${PRIMARY_BUTTON} mt-4 h-14 text-[19px]`}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : null}
        Отправить запрос
      </button>
      <button type="button" onClick={onCancel} className={`${SECONDARY_BUTTON} mt-2`}>
        Отмена
      </button>
    </form>
  );
}

/** Запрос ушёл: что будет дальше. */
export function QrPinRequestSent({ requestKind, onDone }: { requestKind: PinRequestKind; onDone: () => void }) {
  const change = requestKind === "change";
  return (
    <div className="qp-card text-center" data-testid="qr-pin-request-sent">
      <SuccessCheck label="Запрос отправлен" />
      <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-[#0b1024]">Запрос отправлен</h2>
      <p className="qp-hint" style={{ color: "#3c4053" }}>
        {change
          ? "Как только руководитель одобрит — входите с новым PIN. Пока действует старый."
          : "Как только руководитель одобрит — войдите с этим PIN."}
      </p>
      <button type="button" onClick={onDone} className={`${SECONDARY_BUTTON} mt-5`}>
        {change ? "Вернуться к вводу PIN" : "Готово"}
      </button>
    </div>
  );
}

/**
 * PIN нужен, а у сотрудника его нет: коротко и крупно, строка статуса
 * прошлого запроса и большая «Запросить доступ» — под ней форма нового PIN.
 */
export function QrPinNoAccess({
  target,
  status,
  onStatus,
}: {
  target: QrObjectPinTarget;
  status: PinRequestStatusLine | null;
  onStatus: (status: PinRequestStatusLine | null) => void;
}) {
  const [view, setView] = useState<"idle" | "form" | "sent">("idle");
  if (view === "sent") return <QrPinRequestSent requestKind="issue" onDone={() => setView("idle")} />;
  return (
    <div data-testid="qr-pin-no-access">
      <div className="qp-note">Нужен личный PIN: он подтверждает, что запись делаете именно вы.</div>
      {status ? (
        <div className={status.tone === "bad" ? "qp-err" : "qp-ok-note"} role="status">
          {status.text}
        </div>
      ) : null}
      {view === "form" ? (
        <QrPinRequestForm
          target={target}
          requestKind="issue"
          onSent={(next) => {
            onStatus(next);
            setView("sent");
          }}
          onCancel={() => setView("idle")}
        />
      ) : (
        <>
          <button type="button" onClick={() => setView("form")} className={`${PRIMARY_BUTTON} min-h-16 px-5 text-[21px]`}>
            <KeyRound className="size-6 shrink-0" />
            Запросить доступ
          </button>
          <p className="qp-hint">
            {status?.tone === "wait"
              ? "Забыли придуманный PIN? Отправьте запрос заново — он заменит прежний."
              : "Вы придумаете PIN, руководитель его одобрит — и PIN заработает."}
          </p>
        </>
      )}
    </div>
  );
}
