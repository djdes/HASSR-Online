"use client";

import { useEffect, useState } from "react";
import { Loader2, LogIn, LogOut, Coffee } from "lucide-react";
import { haptic } from "./use-haptic";
import { toast } from "sonner";

type ShiftStatus =
  | "none"
  | "scheduled"
  | "working"
  | "ended"
  | "absent"
  | "off"
  | "vacation"
  | "sick";

type Snapshot = {
  status: ShiftStatus;
  shiftId: string | null;
  updatedAt: string | null;
};

/**
 * Compact-карточка «моя смена» для главной /mini.
 *
 * Один primary-action вместо двух кнопок:
 *  - none/scheduled → «Я вышел на смену» (POST start).
 *  - working        → «Закончить смену» (POST end).
 *  - ended/absent   → блок-сообщение «смена закрыта», без действий.
 *
 * Загружается lazy через GET /api/mini/shift/me; при неавторизованном
 * (anon на /mini) ничего не показываем.
 */
/** Подписи статусов смены: в тексте для человека кодов быть не должно. */
const OFF_LABEL: Record<string, string> = {
  off: "сегодня у вас выходной",
  vacation: "вы в отпуске",
  sick: "вы на больничном",
};

export function MyShiftButton() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [pending, setPending] = useState(false);
  // Без этого неуспешный ответ оставлял на главной серую полосу-заглушку
  // навсегда: `state` так и не появлялся, а скелетон рисуется по `!state`.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mini/shift/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Snapshot | null) => {
        if (cancelled) return;
        if (!data) setFailed(true);
        else setState(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function trigger(action: "start" | "end") {
    if (pending) return;
    haptic("light");
    setPending(true);
    try {
      const resp = await fetch("/api/mini/shift/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await resp.json()) as Snapshot & { error?: string };
      if (!resp.ok) {
        toast.error(data.error || `Не получилось (HTTP ${resp.status})`);
        haptic("error");
        return;
      }
      setState(data);
      haptic("success");
      toast.success(
        action === "start" ? "Смена открыта" : "Смена закрыта. Хорошего отдыха!"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Сеть недоступна");
      haptic("error");
    } finally {
      setPending(false);
    }
  }

  if (failed) return null;
  if (!state) {
    // Skeleton-плейсхолдер той же высоты что финальная card —
    // предотвращаем CLS (cumulative layout shift) на главной.
    return (
      <div
        className="mini-skeleton-bar"
        style={{ height: 60, borderRadius: 16 }}
        aria-hidden="true"
      />
    );
  }

  const isWorking = state.status === "working";
  const isClosed = state.status === "ended" || state.status === "absent";
  const isOff = state.status === "off" || state.status === "vacation" || state.status === "sick";

  if (isOff) {
    // Менеджер заранее проставил выходной/отпуск/больничный — не
    // предлагаем самообслуживания, чтобы не было иллюзии что сегодня
    // нужно «выходить».
    return (
      <div
        className="flex items-center gap-3 rounded-2xl px-4 py-3"
        style={{
          background: "var(--mini-surface-1)",
          border: "1px solid var(--mini-divider)",
          color: "var(--mini-text-muted)",
        }}
      >
        <Coffee className="size-5" style={{ color: "var(--mini-text-muted)" }} />
        <div className="text-[14px] leading-snug">
          Сегодня вы не на смене — {OFF_LABEL[state.status] ?? "смена не назначена"}.
        </div>
      </div>
    );
  }

  if (isClosed) {
    return (
      <div
        className="flex items-center gap-3 rounded-2xl px-4 py-3"
        style={{
          background: "var(--mini-sage-soft)",
          border: "1px solid var(--mini-divider)",
          color: "var(--mini-sage)",
        }}
      >
        <LogOut className="size-5" />
        <div className="text-[14px] leading-snug">
          Смена сегодня уже закрыта.
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => trigger(isWorking ? "end" : "start")}
      disabled={pending}
      className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-opacity disabled:opacity-60"
      style={{
        background: isWorking ? "var(--mini-amber-soft)" : "var(--mini-lime-soft)",
        border: `1px solid ${isWorking ? "rgba(255, 144, 64, 0.32)" : "var(--mini-lime-strong)"}`,
        color: isWorking ? "var(--mini-amber)" : "var(--mini-lime)",
      }}
      aria-label={isWorking ? "Закончить смену" : "Начать смену"}
    >
      {pending ? (
        <Loader2 className="size-5 animate-spin" />
      ) : isWorking ? (
        <LogOut className="size-5" />
      ) : (
        <LogIn className="size-5" />
      )}
      <div className="flex-1">
        <div className="text-[14px] font-medium">
          {isWorking ? "Закончить смену" : "Я вышел на смену"}
        </div>
        <div
          className="text-[12px] opacity-70"
          style={{ color: "currentcolor" }}
        >
          {isWorking
            ? "Напоминания о незаполненных задачах перестанут приходить."
            : "Руководитель увидит, что вы на работе, и придут напоминания о задачах."}
        </div>
      </div>
    </button>
  );
}
