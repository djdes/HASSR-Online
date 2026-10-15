"use client";

import { useTranslations } from "next-intl";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ListChecks, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type ChecklistItem = {
  id: string;
  label: string;
  required: boolean;
  hint: string | null;
  sortOrder: number;
  /** Если задан — пункт привязан к конкретной комнате. */
  roomId?: string | null;
  /** "daily" | "weekly" | "monthly" — для UI-индикатора. */
  frequency?: string;
};

type Props = {
  taskId: number;
  token: string;
  /** Callback пробрасывает наверх: «всё ли требуемое отмечено» — для
   *  блокировки submit-кнопки в TaskFillClient. */
  onReadyChange?: (ready: boolean) => void;
};

/**
 * Чек-лист сотрудника на странице task-fill. Рисуется ВЫШЕ form-fields,
 * чтобы повар сначала прошёл по пунктам физической работы (разобрать,
 * промыть, продезинфицировать), потом заполнил числовые замеры формы.
 *
 * Auto-save каждой галочки в /api/task-fill/[taskId]/checklist (через
 * HMAC-token). Каждое нажатие = `JournalChecklistCheck` запись + AuditLog
 * для ROOT'а.
 *
 * Required-пункты блокируют submit (через onReadyChange).
 */
export function TaskFillChecklist({ taskId, token, onReadyChange }: Props) {
  const t = useTranslations("taskFill");
  const currentTranslations = useRef(t);
  useEffect(() => { currentTranslations.current = t; }, [t]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  // Загружаем при mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/task-fill/${taskId}/checklist?token=${encodeURIComponent(token)}`,
        );
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = (await res.json()) as {
          items: ChecklistItem[];
          checks: Record<string, boolean>;
        };
        if (cancelled) return;
        setItems(data.items);
        setChecks(data.checks);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, token]);

  // Сообщаем родителю о ready-состоянии.
  useEffect(() => {
    if (loading) return;
    const requiredItems = items.filter((i) => i.required);
    const allRequiredChecked = requiredItems.every((i) => checks[i.id] === true);
    onReadyChange?.(allRequiredChecked);
  }, [items, checks, loading, onReadyChange]);

  async function toggle(item: ChecklistItem) {
    const newValue = !checks[item.id];
    // Optimistic UI.
    setChecks((c) => ({ ...c, [item.id]: newValue }));
    setSavingItemId(item.id);
    try {
      const res = await fetch(`/api/task-fill/${taskId}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          itemId: item.id,
          checked: newValue,
        }),
      });
      if (!res.ok) {
        // Откатываем optimistic update.
        setChecks((c) => ({ ...c, [item.id]: !newValue }));
        toast.error(currentTranslations.current("checklist.saveError"));
      }
    } catch {
      setChecks((c) => ({ ...c, [item.id]: !newValue }));
      toast.error(currentTranslations.current("checklist.networkError"));
    } finally {
      setSavingItemId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#ececf4] bg-white p-5">
        <div className="flex items-center gap-3 text-[13px] text-[#9b9fb3]">
          <Loader2 className="size-4 animate-spin" />
          {t("checklist.loading")}</div>
      </div>
    );
  }

  if (items.length === 0) {
    // Чек-листа нет — компонент молчит, не занимая места.
    return null;
  }

  const requiredItems = items.filter((i) => i.required);
  const totalCount = items.length;
  const checkedCount = items.filter((i) => checks[i.id] === true).length;
  const requiredCheckedCount = requiredItems.filter(
    (i) => checks[i.id] === true,
  ).length;
  const allRequiredChecked = requiredCheckedCount === requiredItems.length;

  const progressPercent =
    totalCount === 0 ? 100 : Math.round((checkedCount / totalCount) * 100);

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_8px_24px_-16px_rgba(11,16,36,0.15)] sm:p-6">
      <div className="flex items-start gap-3">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-2xl transition-colors ${
            allRequiredChecked
              ? "bg-emerald-100 text-emerald-700"
              : "bg-[#eef1ff] text-[#3848c7]"
          }`}
        >
          {allRequiredChecked ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <ListChecks className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight text-[#0b1024] sm:text-[16px]">
            {t("checklist.title")}</div>
          <p className="mt-1 text-[12.5px] leading-snug text-[#6f7282] sm:text-[13px]">
            {allRequiredChecked
              ? t("checklist.complete", { completed: checkedCount, total: totalCount })
              : t("checklist.progress", { completed: requiredCheckedCount, total: requiredItems.length })}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#ececf4]">
        <div
          className={`h-full transition-all duration-300 ${
            allRequiredChecked
              ? "bg-emerald-500"
              : "bg-gradient-to-r from-[#5566f6] to-[#7a5cff]"
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Items */}
      <ul className="mt-4 space-y-2">
        {items.map((item) => {
          const checked = checks[item.id] === true;
          const saving = savingItemId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={checked}
                onClick={() => toggle(item)}
                disabled={saving}
                className={`flex w-full cursor-pointer items-start gap-3 rounded-2xl border p-3.5 text-left transition-all sm:p-4 ${
                  checked
                    ? "border-emerald-300 bg-emerald-50/60"
                    : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                }`}
              >
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full transition-all ${
                    checked
                      ? "bg-emerald-500 text-white"
                      : "border-2 border-[#dcdfed] bg-white"
                  }`}
                >
                  {checked ? <CheckCircle2 className="size-4" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={`text-[14.5px] font-medium leading-snug transition-all sm:text-[15px] ${
                        checked
                          ? "text-emerald-900 line-through decoration-emerald-400/70"
                          : "text-[#0b1024]"
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.required ? (
                      <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-700">
                        {t("field.required")}</span>
                    ) : null}
                  </div>
                  {item.hint ? (
                    <p className="mt-0.5 text-[12.5px] leading-snug text-[#6f7282] sm:text-[13px]">
                      {item.hint}
                    </p>
                  ) : null}
                </div>
                {saving ? (
                  <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-[#9b9fb3]" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Pending warning */}
      {!allRequiredChecked ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[12.5px] leading-snug text-amber-900 sm:text-[13px]">
          {t("checklist.requiredHint")}
        </div>
      ) : null}
    </div>
  );
}
