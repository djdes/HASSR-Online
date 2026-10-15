"use client";

import { useQrFillCopy, useQrFeedback, qrResponseFeedback, type QrFeedback } from "@/components/qr-fill/qr-fill-presentation";

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
  approvedMessageCode?: string;
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
          approvedMessageCode: typeof data.approvedMessageCode === "string" ? data.approvedMessageCode : undefined,
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
  const { t } = useQrFillCopy();
  const feedback = useQrFeedback();
  const id = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const secondRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<QrFeedback | null>(null);
  const change = requestKind === "change";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const invalid = validatePinRequestInput({ pin, repeat: pin2 });
    if (invalid) {
      setError({ key: validateQrPin(pin) ? "pin.invalid" : "pin.mismatch" });
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
      if (!response) { setError({ key: "pin.networkError" }); return; }
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; status?: unknown } | null;
      if (!response.ok || data?.ok !== true) { setError(qrResponseFeedback(data, "pin.requestError")); return; }
      onSent(isStatusLine(data.status) ? data.status : null);
    } catch {
      setError({ key: "pin.requestError" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="qp-card" data-testid="qr-pin-request" data-kind={requestKind}>
      {change ? (
        <p className="qp-hint" style={{ margin: "4px 2px 14px", color: "#3c4053" }}>
          {t("pin.changeHint")}</p>
      ) : null}
      {error ? (
        <div className="qp-err" role="alert">
          {feedback(error)}
        </div>
      ) : null}
      <div className="qp-head">
        <label className="qp-k" htmlFor={`${id}-pin`}>
          {change ? t("pin.newPin") : t("pin.createPin")}
        </label>
        <span className="shrink-0 text-[17px] font-medium text-[#6f7282]">{t("pin.lengthHint")}</span>
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
          {t("pin.repeat")}</label>
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
      {change ? null : <p className="qp-hint">{t("pin.approvalHint")}</p>}
      <button type="submit" disabled={busy || pin.length < 4 || pin2.length < 4} className={`${PRIMARY_BUTTON} mt-4 h-14 text-[19px]`}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : null}
        {t("pin.sendRequest")}</button>
      <button type="button" onClick={onCancel} className={`${SECONDARY_BUTTON} mt-2`}>
        {t("common.cancel")}</button>
    </form>
  );
}

/** Запрос ушёл: что будет дальше. */
export function QrPinRequestSent({ requestKind, onDone }: { requestKind: PinRequestKind; onDone: () => void }) {
  const { t } = useQrFillCopy();
  const change = requestKind === "change";
  return (
    <div className="qp-card text-center" data-testid="qr-pin-request-sent">
      <SuccessCheck label={t("pin.requestSent")} />
      <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("pin.requestSent")}</h2>
      <p className="qp-hint" style={{ color: "#3c4053" }}>
        {change
          ? t("pin.changeSentHint")
          : t("pin.issueSentHint")}
      </p>
      <button type="button" onClick={onDone} className={`${SECONDARY_BUTTON} mt-5`}>
        {change ? t("pin.backToPin") : t("common.done")}
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
  const { t, scoped } = useQrFillCopy();
  const feedback = useQrFeedback();
  const [view, setView] = useState<"idle" | "form" | "sent">("idle");
  function localizedStatus(line: PinRequestStatusLine) {
    const fallback = line.tone === "bad" ? "pin.rejected" : "pin.pending";
    const descriptor = qrResponseFeedback({ errorCode: line.messageCode, errorParams: line.messageParams }, fallback);
    return descriptor.key === "pin.rejected" && !descriptor.values
      ? t("pin.rejected", { hasNote: "no", note: "" })
      : feedback(descriptor);
  }
  if (view === "sent") return <QrPinRequestSent requestKind="issue" onDone={() => setView("idle")} />;
  return (
    <div data-testid="qr-pin-no-access">
      <div className="qp-note">{t("pin.personalRequired")}</div>
      {status ? (
        <div className={status.tone === "bad" ? "qp-err" : "qp-ok-note"} role="status">
          {scoped ? localizedStatus(status) : status.messageCode ? feedback(qrResponseFeedback({ errorCode: status.messageCode, errorParams: status.messageParams }, "pin.pending")) : status.text}
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
            {t("pin.requestAccess")}</button>
          <p className="qp-hint">
            {status?.tone === "wait"
              ? t("pin.forgotPending")
              : t("pin.issueExplanation")}
          </p>
        </>
      )}
    </div>
  );
}
