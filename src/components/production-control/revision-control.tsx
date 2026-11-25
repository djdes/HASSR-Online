"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PPK_APPROVE_ERROR_CODES, ppkErrorText } from "@/lib/ppk/api-errors";
import { toast } from "sonner";
import { BadgeCheck, Loader2, Stamp } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { revisionCode, type RevisionState } from "@/lib/ppk/revisions";
import { PPK_BUTTON_OUTLINE_CLASS, PPK_BUTTON_TEXT_CLASS } from "@/components/production-control/ppk-ui";
import { RevisionCompareButton } from "@/components/production-control/revision-compare";

const API = "/api/production-control/revisions";

export type ClientRevisionState = RevisionState & { title: string; empty: boolean };

const NO_STATES: Record<string, ClientRevisionState> = {};

/** Дата редакции в поясе организации: одинаково на сервере и в браузере. */
function revisionDate(iso: string, timeZone: string): string {
  const options = { day: "2-digit", month: "2-digit", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "Europe/Moscow" }).format(new Date(iso));
  }
}

/**
 * Состояния редакций документов. Перечитываются после сохранений (`ppk:changed`)
 * и утверждений (`ppk:revision`). Если документ был утверждён и после правки
 * стал «изменён», в `prompt` — его ключ: программа сама спрашивает про новую редакцию.
 */
export function useRevisionStates(docKeys: readonly string[], initial?: Record<string, ClientRevisionState>) {
  const keysParam = useMemo(() => [...new Set(docKeys)].join(","), [docKeys]);
  const [states, setStates] = useState<Record<string, ClientRevisionState>>(initial ?? {});
  const [prompt, setPrompt] = useState<string | null>(null);
  const statusRef = useRef<Record<string, ClientRevisionState["status"]>>(
    Object.fromEntries(Object.entries(initial ?? {}).map(([key, state]) => [key, state.status])),
  );

  const reload = useCallback(async () => {
    if (!keysParam) return;
    try {
      // Частями по 60 ключей: длинный список документов не упирается в длину адреса.
      const keys = keysParam.split(",");
      const chunks: string[][] = [];
      for (let index = 0; index < keys.length; index += 60) chunks.push(keys.slice(index, index + 60));
      const parts = await Promise.all(
        chunks.map(async (chunk) => {
          const response = await fetch(`${API}?docKeys=${encodeURIComponent(chunk.join(","))}`, { cache: "no-store" });
          if (!response.ok) return null;
          return ((await response.json()) as { states?: Record<string, ClientRevisionState> }).states ?? {};
        }),
      );
      if (parts.some((part) => part === null)) return;
      const next: Record<string, ClientRevisionState> = Object.assign({}, ...parts);
      const before = statusRef.current;
      const changed = Object.keys(next).find((key) => before[key] === "approved" && next[key].status === "changed");
      statusRef.current = Object.fromEntries(Object.entries(next).map(([key, state]) => [key, state.status]));
      setStates(next);
      if (changed) setPrompt(changed);
    } catch {
      /* плашка остаётся прежней */
    }
  }, [keysParam]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка с сервера: состояние меняется после ответа
    void reload();
    const onChange = () => void reload();
    window.addEventListener("ppk:changed", onChange);
    window.addEventListener("ppk:revision", onChange);
    return () => {
      window.removeEventListener("ppk:changed", onChange);
      window.removeEventListener("ppk:revision", onChange);
    };
  }, [reload]);

  // Без документов — без состояний (список ещё грузится или пуст).
  return { states: keysParam ? states : NO_STATES, reload, prompt, setPrompt };
}

type ApproveError = { error?: string; code?: string } | null;
type ApproveOutcome = { ok: true; created: boolean; code: string } | { ok: false; body: ApproveError };

/** POST утверждения: новая редакция или прежняя (без изменений). */
async function approve(docKey: string): Promise<ApproveOutcome> {
  try {
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docKey }),
    });
    const body = (await response.json().catch(() => null)) as
      | { created?: boolean; revision?: { code: string }; error?: string; code?: string }
      | null;
    if (!response.ok || !body?.revision) return { ok: false, body };
    window.dispatchEvent(new Event("ppk:revision"));
    return { ok: true, created: Boolean(body.created), code: body.revision.code };
  } catch {
    return { ok: false, body: null };
  }
}

/**
 * Плашка редакции документа и «Утвердить редакцию» с вопросом, где виден
 * будущий номер. `compact` — строка списка документов.
 */
export function RevisionControl({
  state,
  timeZone,
  canApprove,
  compact = false,
  askOpen = false,
  onAskClose,
}: {
  state: ClientRevisionState | undefined;
  timeZone: string;
  canApprove: boolean;
  compact?: boolean;
  /** Открыть вопрос сразу (документ изменён после утверждения). */
  askOpen?: boolean;
  onAskClose?: () => void;
}) {
  const t = useTranslations("productionControl.revisions");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = asking || askOpen;
  if (!state) return null;

  const close = () => {
    setAsking(false);
    onAskClose?.();
  };
  const code = revisionCode(state.nextNumber);
  const chip =
    state.status === "approved" && state.latest ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] font-medium text-[#116b2a]" data-revision-status="approved">
        <BadgeCheck className="size-3.5" aria-hidden />
        {t("approved", { code: state.latest.code, date: revisionDate(state.latest.approvedAt, timeZone) })}
      </span>
    ) : state.status === "changed" && state.latest ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff7e6] px-2.5 py-1 text-[12px] font-medium text-[#8a5a00]" data-revision-status="changed">
        {t("changed", { code: state.latest.code })}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--app-veil)] px-2.5 py-1 text-[12px] font-medium text-[#6f7282]" data-revision-status="none">
        {t("none")}
      </span>
    );
  const canPress = canApprove && state.status !== "approved" && !state.empty;

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-wrap items-center gap-2.5"} data-revision={state.docKey}>
      {chip}
      {state.status === "approved" && state.latest ? (
        <span className={compact ? "text-[12px] text-[#6f7282]" : "text-[12.5px] text-[#6f7282]"}>
          {t("approvedBy", { name: state.latest.approvedByName || "—" })}
        </span>
      ) : null}
      {canPress ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setAsking(true)}
          className={compact ? PPK_BUTTON_TEXT_CLASS : PPK_BUTTON_OUTLINE_CLASS}
          data-revision-approve
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Stamp className="size-4" aria-hidden />}
          {state.status === "changed" ? t("approveNew") : t("approve")}
        </button>
      ) : null}
      {canApprove && state.empty && !compact ? <span className="text-[12.5px] text-[#6f7282]">{t("emptyHint")}</span> : null}
      {/* «Сравнить» (2026-11-25): изменён после утверждения — последняя редакция ↔ текущий текст, иначе — предыдущая ↔ последняя. */}
      {state.latest ? <RevisionCompareButton docKey={state.docKey} timeZone={timeZone} /> : null}
      <ConfirmDialog
        open={open && canApprove && !state.empty && state.status !== "approved"}
        onClose={close}
        onConfirm={async () => {
          setBusy(true);
          try {
            const outcome = await approve(state.docKey);
            if (outcome.ok) {
              toast.success(outcome.created ? t("approvedToast", { code: outcome.code }) : t("sameToast", { code: outcome.code }));
              close();
            } else {
              // Текст по коду — на языке интерфейса; неизвестный код — текст сервера.
              toast.error(ppkErrorText(outcome.body, PPK_APPROVE_ERROR_CODES, (key) => t(`errors.${key}`), t("failed")));
            }
          } finally {
            setBusy(false);
          }
        }}
        title={state.status === "changed" ? t("changedTitle") : t("confirmTitle")}
        description={
          state.status === "changed" && state.latest
            ? t("changedBody", { title: state.title, old: state.latest.code, code })
            : t("confirmBody", { title: state.title, code })
        }
        confirmLabel={t("confirmLabel", { code })}
        cancelLabel={t("later")}
      />
    </div>
  );
}

/** Плашка одного документа (тексты структуры, политика). */
export function RevisionBar({
  docKey,
  timeZone,
  canApprove = true,
  initial,
}: {
  docKey: string;
  timeZone: string;
  canApprove?: boolean;
  initial?: ClientRevisionState | null;
}) {
  const keys = useMemo(() => [docKey], [docKey]);
  const { states, prompt, setPrompt } = useRevisionStates(keys, initial ? { [docKey]: initial } : undefined);
  return (
    <RevisionControl
      state={states[docKey]}
      timeZone={timeZone}
      canApprove={canApprove}
      askOpen={prompt === docKey}
      onAskClose={() => setPrompt(null)}
    />
  );
}
