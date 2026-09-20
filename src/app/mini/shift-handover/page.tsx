"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { haptic } from "../_components/use-haptic";

type Shift = {
  id: string;
  user: { id: string; name: string };
  status: string;
  handoverNotes: string | null;
  handoverToId: string | null;
  handoverAt: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "По графику",
  working: "На смене",
  ended: "Закрыта",
  off: "Выходной",
  vacation: "Отпуск",
  sick: "Больничный",
  absent: "Не вышли",
};

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  scheduled: { bg: "var(--mini-ice-soft)", fg: "var(--mini-ice)" },
  working: { bg: "var(--mini-lime-soft)", fg: "var(--mini-lime)" },
  ended: { bg: "var(--mini-sage-soft)", fg: "var(--mini-sage)" },
  off: { bg: "var(--mini-surface-2)", fg: "var(--mini-text-muted)" },
  vacation: { bg: "var(--mini-surface-2)", fg: "var(--mini-text-muted)" },
  sick: { bg: "var(--mini-surface-2)", fg: "var(--mini-text-muted)" },
  absent: { bg: "var(--mini-crimson-soft)", fg: "var(--mini-crimson)" },
};

export default function MiniShiftHandoverPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editShiftId, setEditShiftId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  // Базовое значение notes на момент входа в edit-режим — нужно
  // чтобы сравнить «есть ли несохранённые правки» при попытке отмены.
  const [baseNotes, setBaseNotes] = useState("");
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const loadShifts = useCallback(async () => {
    try {
      const res = await fetch("/api/mini/shift-handover", { cache: "no-store" });
      if (!res.ok) {
        setError(
          res.status === 401
            ? "Вход закончился — войдите заново."
            : "Не удалось загрузить смены."
        );
        return;
      }
      const data = await res.json();
      setShifts(data.shifts ?? []);
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  async function saveHandover(shiftId: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/mini/shift-handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId, notes }),
      });
      if (!res.ok) throw new Error("Failed");
      const refreshed = await fetch("/api/mini/shift-handover", { cache: "no-store" });
      if (refreshed.ok) {
        const data = await refreshed.json();
        setShifts(data.shifts ?? []);
      }
      setEditShiftId(null);
      setNotes("");
      setBaseNotes("");
      haptic("success");
      toast.success("Передача сохранена");
    } catch {
      haptic("error");
      toast.error("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(shift: Shift) {
    haptic("light");
    setEditShiftId(shift.id);
    const initial = shift.handoverNotes ?? "";
    setNotes(initial);
    setBaseNotes(initial);
  }

  function attemptCancel() {
    if (notes.trim() === baseNotes.trim()) {
      // Нет правок — закрываем без подтверждения.
      setEditShiftId(null);
      setNotes("");
      setBaseNotes("");
      return;
    }
    setConfirmCancelOpen(true);
  }

  function discardEdit() {
    setEditShiftId(null);
    setNotes("");
    setBaseNotes("");
    setConfirmCancelOpen(false);
  }

  if (loading) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-[14px]"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <Loader2
          className="mr-2 size-4 animate-spin"
          style={{ color: "var(--mini-lime)" }}
        />
        Загружаем смены…
      </div>
    );
  }
  if (error) {
    // Раньше это был тупик: только строка ошибки, без выхода и без
    // возможности повторить — оставалось закрывать приложение.
    return (
      <div className="flex flex-1 flex-col gap-4 pb-24">
        <Link
          href="/mini"
          className="mini-press inline-flex w-fit items-center gap-1 text-[13px] font-medium"
          style={{ color: "var(--mini-text-muted)" }}
        >
          <ArrowLeft className="size-4" />
          На главную
        </Link>
        <div
          className="rounded-2xl px-4 py-4 text-[14px] leading-relaxed"
          style={{
            background: "var(--mini-crimson-soft)",
            border: "1px solid var(--mini-divider-strong)",
            color: "var(--mini-text)",
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setLoading(true);
              void loadShifts();
            }}
            className="mini-press mt-4 inline-flex h-11 items-center justify-center rounded-2xl px-5 text-[14px] font-semibold"
            style={{
              background: "var(--mini-lime)",
              color: "var(--mini-primary-contrast)",
            }}
          >
            Попробовать ещё раз
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <Link
        href="/mini"
        className="-my-2 min-h-9 inline-flex items-center gap-1 text-[13px] font-medium"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <ArrowLeft className="size-4" />
        На главную
      </Link>

      <header className="px-1">
        <h1
          className="text-[20px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          Передача смен
        </h1>
        <p
          className="mt-0.5 text-[13px]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {new Date().toLocaleDateString("ru-RU")}
        </p>
      </header>

      {shifts.length === 0 ? (
        <div
          className="rounded-2xl px-4 py-6 text-center text-[14px]"
          style={{
            background: "var(--mini-surface-1)",
            border: "1px dashed var(--mini-divider-strong)",
            color: "var(--mini-text-muted)",
          }}
        >
          На сегодня смен не запланировано.
        </div>
      ) : (
        <section className="space-y-3">
          {shifts.map((shift) => {
            const tone = STATUS_TONE[shift.status] ?? STATUS_TONE.off;
            return (
              <div
                key={shift.id}
                className="rounded-2xl px-4 py-3"
                style={{
                  background: "var(--mini-card-solid-bg)",
                  border: "1px solid var(--mini-divider)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[15px] font-medium"
                    style={{ color: "var(--mini-text)" }}
                  >
                    {shift.user.name}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {STATUS_LABEL[shift.status] ?? shift.status}
                  </span>
                </div>

                {shift.handoverNotes ? (
                  <div
                    className="mt-2 rounded-lg px-3 py-2 text-[13px]"
                    style={{
                      background: "var(--mini-surface-2)",
                      color: "var(--mini-text)",
                    }}
                  >
                    <span
                      className="font-medium"
                      style={{ color: "var(--mini-text-muted)" }}
                    >
                      Передано:
                    </span>{" "}
                    {shift.handoverNotes}
                    {shift.handoverAt ? (
                      <div
                        className="mt-1 text-[11px]"
                        style={{ color: "var(--mini-text-faint)" }}
                      >
                        {new Date(shift.handoverAt).toLocaleString("ru-RU")}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {editShiftId === shift.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Что нужно знать следующей смене?"
                      rows={3}
                      className="w-full rounded-xl px-3 py-2 text-[14px] focus:outline-none"
                      style={{
                        background: "var(--mini-surface-2)",
                        border: "1px solid var(--mini-divider-strong)",
                        color: "var(--mini-text)",
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveHandover(shift.id)}
                        disabled={saving || !notes.trim()}
                        className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                        style={{
                          background: "var(--mini-lime)",
                          color: "var(--mini-primary-contrast)",
                        }}
                      >
                        {saving ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            Сохраняем…
                          </>
                        ) : (
                          "Сохранить"
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={attemptCancel}
                        className="rounded-xl px-4 py-2 text-[13px] font-medium"
                        style={{
                          background: "transparent",
                          border: "1px solid var(--mini-divider-strong)",
                          color: "var(--mini-text-muted)",
                        }}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit(shift)}
                    className="mt-2 text-[13px] font-medium underline underline-offset-2"
                    style={{ color: "var(--mini-lime)" }}
                  >
                    {shift.handoverNotes
                      ? "Редактировать"
                      : "Добавить примечание"}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      <ConfirmDialog
        open={confirmCancelOpen}
        onClose={() => setConfirmCancelOpen(false)}
        onConfirm={discardEdit}
        title="Отменить и потерять изменения?"
        description="Вы редактировали примечание для следующей смены. Если отменить — введённый текст пропадёт."
        confirmLabel="Отменить и потерять"
        cancelLabel="Продолжить редактировать"
        variant="warn"
      />
    </div>
  );
}
