"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Eye, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

type Position = {
  id: string;
  name: string;
  categoryKey: string;
  activeUsers: number;
  seesAllTasks: boolean;
};

type Props = {
  positions: Position[];
};

export function TaskVisibilityClient({ positions }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(positions.filter((p) => p.seesAllTasks).map((p) => p.id)),
  );
  const [saving, setSaving] = useState(false);
  const [originalIds] = useState<Set<string>>(
    () => new Set(positions.filter((p) => p.seesAllTasks).map((p) => p.id)),
  );

  // Сравниваем для dirty-state.
  const isDirty = (() => {
    if (selected.size !== originalIds.size) return true;
    for (const id of selected) if (!originalIds.has(id)) return true;
    return false;
  })();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (saving || !isDirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/task-visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionIds: [...selected] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Не удалось сохранить");
        return;
      }
      toast.success(
        selected.size === 0
          ? "Никто не видит чужие задачи. Сохранено."
          : `${selected.size} должность(и) видят чужие задачи. Сохранено.`,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  // Re-sync if server-state поменялся через router.refresh.
  useEffect(() => {
    const next = new Set(
      positions.filter((p) => p.seesAllTasks).map((p) => p.id),
    );
    setSelected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  const management = positions.filter((p) => p.categoryKey === "management");
  const staff = positions.filter((p) => p.categoryKey !== "management");

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] text-white">
            <Eye className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">
              Кто видит ЧУЖИЕ задачи в TasksFlow
            </h3>
            <p className="mt-1 text-[12.5px] leading-snug text-[#3c4053]">
              По умолчанию каждый сотрудник видит только свои задачи (так
              положено). Если на какой-то должности нужно видеть и
              проверять задачи других — отметь её здесь. На стороне
              TasksFlow юзеры этой должности получат флаг admin =
              «видит всё в компании».
            </p>
            <p className="mt-2 text-[12px] text-[#6f7282]">
              <strong className="text-[#0b1024]">Рекомендация:</strong>{" "}
              отметь только одну должность — обычно «Админ» или «Владелец».
              Заведующий производством и другие управляющие должны проверять только
              своих подчинённых через иерархию (
              <a
                href="/settings/staff-hierarchy"
                className="text-[#5566f6] hover:underline"
              >
                /settings/staff-hierarchy
              </a>
              ), а не видеть весь состав.
            </p>
          </div>
        </div>
      </div>

      {management.length > 0 ? (
        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#3848c7]">
            Руководство
          </div>
          <div className="space-y-2">
            {management.map((p) => (
              <PositionRow
                key={p.id}
                p={p}
                checked={selected.has(p.id)}
                onToggle={() => toggle(p.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {staff.length > 0 ? (
        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
            Сотрудники
          </div>
          <p className="mb-3 text-[12px] text-[#9b9fb3]">
            Сотрудники не должны видеть чужие задачи — только свои. Если
            кто-то проверяет других, переведи его в «Руководство» через
            настройку должностей.
          </p>
          <div className="space-y-2">
            {staff.map((p) => (
              <PositionRow
                key={p.id}
                p={p}
                checked={selected.has(p.id)}
                onToggle={() => toggle(p.id)}
                muted
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="sticky bottom-3 flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-white p-3 shadow-[0_10px_30px_-12px_rgba(11,16,36,0.15)]">
        <div className="text-[12.5px] text-[#3c4053]">
          {isDirty ? (
            <span className="text-[#a13a32]">
              Несохранённые изменения. Сохрани чтобы применить при следующей
              синхронизации с TasksFlow.
            </span>
          ) : selected.size === 0 ? (
            <span>Никто не видит чужие задачи. По умолчанию — твой выбор.</span>
          ) : (
            <span>
              <strong className="text-[#3848c7]">{selected.size}</strong>{" "}
              должность(и) видят чужие задачи в TasksFlow.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!isDirty || saving}
          className="inline-flex h-10 items-center gap-1.5 rounded-2xl bg-[#5566f6] px-4 text-[13px] font-medium text-white shadow-[0_8px_20px_-10px_rgba(85,102,246,0.5)] hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Сохранить
        </button>
      </div>
    </div>
  );
}

function PositionRow({
  p,
  checked,
  onToggle,
  muted,
}: {
  p: Position;
  checked: boolean;
  onToggle: () => void;
  muted?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${
        checked
          ? "border-[#5566f6] bg-[#f5f6ff]"
          : muted
            ? "border-[#ececf4] bg-[#fafbff]/60 opacity-80 hover:bg-[#fafbff]"
            : "border-[#ececf4] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4 cursor-pointer rounded border-[#dcdfed] text-[#5566f6] focus:ring-[#5566f6]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[14px] font-medium text-[#0b1024]">
          {p.name}
          {checked ? (
            <Crown
              className="size-3.5 text-[#a16d32]"
              aria-label="видит чужие"
            />
          ) : null}
        </div>
        <div className="text-[11px] text-[#9b9fb3]">
          {p.activeUsers}{" "}
          {p.activeUsers === 1
            ? "сотрудник"
            : p.activeUsers < 5
              ? "сотрудника"
              : "сотрудников"}
        </div>
      </div>
    </label>
  );
}
