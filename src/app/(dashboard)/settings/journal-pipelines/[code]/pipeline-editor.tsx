"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Camera,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { confirmAsync } from "@/components/ui/confirm-async";

type Step = {
  id: string;
  title: string;
  instruction?: string;
  checklist?: string[];
  requirePhoto?: boolean;
};

type Pipeline = {
  intro?: string;
  steps: Step[];
};

function newStepId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function PipelineEditor({
  code,
  initial,
}: {
  code: string;
  initial: Pipeline | null;
}) {
  const router = useRouter();
  const [intro, setIntro] = useState(initial?.intro ?? "");
  const [steps, setSteps] = useState<Step[]>(
    initial?.steps ?? [{ id: newStepId(), title: "Шаг 1" }]
  );
  const [saving, setSaving] = useState(false);

  function update(idx: number, patch: Partial<Step>) {
    setSteps((s) =>
      s.map((st, i) => (i === idx ? { ...st, ...patch } : st))
    );
  }

  function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= steps.length) return;
    setSteps((s) => {
      const arr = [...s];
      const [m] = arr.splice(idx, 1);
      arr.splice(next, 0, m);
      return arr;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/journal-pipelines/${code}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intro: intro.trim() || undefined, steps }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Pipeline сохранён");
      router.push("/settings/journal-pipelines");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    const ok = await confirmAsync({
      title: "Вернуть стандартные шаги?",
      description:
        "Порядок шагов и их описания станут такими, какими были изначально.",
      bullets: [
        { label: "Шаги, которые вы добавили или изменили, удалятся", tone: "warn" },
        { label: "Вернуть их обратно нельзя — придётся вписать заново", tone: "warn" },
        { label: "Записи журнала это не затрагивает", tone: "default" },
      ],
      confirmLabel: "Вернуть стандартные",
      variant: "danger",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/journal-pipelines/${code}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Вернули стандартные шаги");
      router.push("/settings/journal-pipelines");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: редактор шагов — рабочий экран, баннер только
          отодвигал форму вниз. Код журнала оставляем в заголовке. */}
      <PageHeader
        title={
          <>
            Pipeline · <span className="font-mono text-[18px]">{code}</span>
          </>
        }
        description="Шаги, которые увидит сотрудник при открытии задачи. Чем понятнее каждый шаг — тем меньше вопросов от новой уборщицы / повара."
      />

      <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <label className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
          Подсказка наверху pipeline&apos;а (опц.)
        </label>
        <input
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          placeholder="Например: «Уборка помещения. Следуй шагам по порядку»"
          className="mt-2 h-11 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] focus:border-[#5566f6] focus:outline-none"
        />
      </div>

      <div className="space-y-3">
        {steps.map((step, idx) => (
          <div
            key={step.id}
            className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#5566f6] text-[12px] font-semibold text-white">
                {idx + 1}
              </span>
              <input
                value={step.title}
                onChange={(e) => update(idx, { title: e.target.value })}
                placeholder="Название шага (например, «Возьми инвентарь»)"
                className="h-10 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] font-medium focus:border-[#5566f6] focus:outline-none"
              />
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  className="inline-flex size-9 items-center justify-center rounded-xl border border-[#dcdfed] bg-white text-[#6f7282] disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, 1)}
                  disabled={idx === steps.length - 1}
                  className="inline-flex size-9 items-center justify-center rounded-xl border border-[#dcdfed] bg-white text-[#6f7282] disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSteps((s) => s.filter((_, i) => i !== idx))
                  }
                  className="inline-flex size-9 items-center justify-center rounded-xl border border-[#ffd2cd] bg-[#fff4f2] text-[#a13a32]"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>

            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
              Инструкция
            </label>
            <textarea
              value={step.instruction ?? ""}
              onChange={(e) => update(idx, { instruction: e.target.value })}
              placeholder="Например: «На стенде в раздевалке должны быть тряпки, ведро, моющее средство. Перчатки обязательно.»"
              rows={3}
              className="mt-1 w-full rounded-xl border border-[#dcdfed] bg-white px-3 py-2 text-[13px] focus:border-[#5566f6] focus:outline-none"
            />

            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
              Чек-лист (по одному пункту в строке)
            </label>
            <textarea
              value={(step.checklist ?? []).join("\n")}
              onChange={(e) =>
                update(idx, {
                  checklist: e.target.value
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Тряпки взяты\nВедро готово\nПерчатки"
              rows={4}
              className="mt-1 w-full rounded-xl border border-[#dcdfed] bg-white px-3 py-2 font-mono text-[12px] focus:border-[#5566f6] focus:outline-none"
            />

            <label className="mt-3 inline-flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={Boolean(step.requirePhoto)}
                onChange={(e) =>
                  update(idx, { requirePhoto: e.target.checked })
                }
                className="size-4 accent-[#5566f6]"
              />
              <Camera className="size-4 text-[#3848c7]" />
              Требовать фото
            </label>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            setSteps((s) => [
              ...s,
              { id: newStepId(), title: `Шаг ${s.length + 1}` },
            ])
          }
          className="inline-flex h-11 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
        >
          <Plus className="size-4" />
          Добавить шаг
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="inline-flex h-11 items-center gap-1.5 rounded-2xl border border-[#ffd2cd] bg-white px-4 text-[13px] font-medium text-[#a13a32] hover:bg-[#fff4f2]"
        >
          Вернуть стандартные шаги
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] hover:bg-[#4a5bf0] disabled:opacity-50"
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
