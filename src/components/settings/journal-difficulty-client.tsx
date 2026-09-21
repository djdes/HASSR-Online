"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_DESCRIPTIONS,
  DIFFICULTY_LABELS,
  FREQUENCY_PER_MONTH,
  LINES_PER_ENTRY,
  type Difficulty,
} from "@/lib/journal-workload";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Journal = {
  code: string;
  name: string;
};

type Props = {
  journals: Journal[];
  initialDifficulty: Record<string, number>;
};

const ALL_LEVELS: Difficulty[] = [1, 2, 3, 4, 5];

const LEVEL_TONE: Record<Difficulty, string> = {
  1: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  2: "bg-emerald-50 text-emerald-700 ring-emerald-200/60",
  3: "bg-amber-50 text-amber-700 ring-amber-200",
  4: "bg-orange-50 text-orange-700 ring-orange-200",
  5: "bg-rose-50 text-rose-700 ring-rose-200",
};

function frequencyLabel(perMonth: number): string {
  if (perMonth >= 28) return "ежедневно";
  if (perMonth >= 18) return "по будням";
  if (perMonth >= 6) return `${Math.round(perMonth)} раз/мес`;
  if (perMonth >= 3) return "еженедельно";
  if (perMonth >= 0.9) return "ежемесячно";
  if (perMonth >= 0.3) return "ежеквартально";
  return "редко";
}

export function JournalDifficultyClient({ journals, initialDifficulty }: Props) {
  const router = useRouter();
  const [base, setBase] = useState<Record<string, number>>(
    () => ({ ...initialDifficulty }),
  );
  const [curr, setCurr] = useState<Record<string, number>>(
    () => ({ ...initialDifficulty }),
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const dirty = useMemo(() => {
    const set = new Set<string>();
    const allCodes = new Set([
      ...Object.keys(base),
      ...Object.keys(curr),
    ]);
    for (const code of allCodes) {
      const a = base[code] ?? null;
      const b = curr[code] ?? null;
      if (a !== b) set.add(code);
    }
    return set;
  }, [base, curr]);

  function getEffective(code: string): Difficulty {
    const v = curr[code];
    if (typeof v === "number" && v >= 1 && v <= 5) {
      return Math.round(v) as Difficulty;
    }
    return (DEFAULT_DIFFICULTY[code] ?? 2) as Difficulty;
  }

  function setLevel(code: string, level: Difficulty) {
    setCurr((prev) => {
      const next = { ...prev };
      const def = DEFAULT_DIFFICULTY[code] ?? 2;
      if (level === def) {
        delete next[code]; // вернулись к дефолту — убираем override
      } else {
        next[code] = level;
      }
      return next;
    });
  }

  function requestResetAll() {
    setResetOpen(true);
  }
  function resetAll() {
    setCurr({});
  }

  function discard() {
    setCurr({ ...base });
  }

  async function save() {
    if (saving || dirty.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/journal-difficulty", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ difficulty: curr }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Не удалось сохранить");
        return;
      }
      const saved = (data?.difficulty as Record<string, number>) ?? {};
      setBase({ ...saved });
      setCurr({ ...saved });
      toast.success(`Сохранено: ${Object.keys(saved).length} переопределений`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return journals;
    return journals.filter(
      (j) =>
        j.name.toLowerCase().includes(q) || j.code.toLowerCase().includes(q),
    );
  }, [journals, query]);

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white p-4">
        <div className="relative flex items-center">
          <Search className="absolute left-3 size-4 text-[#9b9fb3]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск журнала…"
            className="h-11 w-[280px] rounded-2xl border border-[#dcdfed] bg-[#fafbff] pl-9 pr-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>

        <button
          type="button"
          onClick={requestResetAll}
          disabled={saving}
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
          title="Удалить все переопределения и вернуться к дефолтам"
        >
          <RotateCcw className="size-4 text-[#5566f6]" />
          Сбросить к значениям по умолчанию
        </button>

        {dirty.size > 0 ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-[#a13a32]">
              Несохранённых: {dirty.size}
            </span>
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#3c4053] hover:bg-[#fafbff] disabled:opacity-60"
            >
              Отменить
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Сохранить
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        {filtered.map((j) => {
          const level = getEffective(j.code);
          const def = (DEFAULT_DIFFICULTY[j.code] ?? 2) as Difficulty;
          const isOverridden = curr[j.code] !== undefined && curr[j.code] !== def;
          const isDirty = dirty.has(j.code);
          const freq = FREQUENCY_PER_MONTH[j.code] ?? 1;
          const lines = LINES_PER_ENTRY[j.code] ?? 1;
          const monthlyWeight = level * freq * lines;
          return (
            <div
              key={j.code}
              className={`rounded-2xl border bg-white p-4 transition-colors ${
                isDirty
                  ? "border-[#ffe9b0] bg-[#fff8eb]/40"
                  : "border-[#ececf4]"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[15px] font-semibold leading-tight text-[#0b1024]">
                      {j.name}
                    </div>
                    {isOverridden ? (
                      <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[10px] font-medium text-[#3848c7]">
                        переопределено
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-[#6f7282]">
                    <span>{frequencyLabel(freq)}</span>
                    <span className="text-[#dcdfed]">·</span>
                    <span>~{lines} стр./раз</span>
                    <span className="text-[#dcdfed]">·</span>
                    <span title="Эмпирическая нагрузка в месяц = сложность × частота × строк">
                      Нагрузка ≈ <strong>{Math.round(monthlyWeight)}</strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {ALL_LEVELS.map((lvl) => {
                    const active = level === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setLevel(j.code, lvl)}
                        title={`${DIFFICULTY_LABELS[lvl]} — ${DIFFICULTY_DESCRIPTIONS[lvl]}`}
                        className={`flex size-9 items-center justify-center rounded-xl text-[13px] font-semibold ring-1 transition-all ${
                          active
                            ? `${LEVEL_TONE[lvl]} scale-105 shadow-[0_4px_12px_-4px_rgba(11,16,36,0.15)]`
                            : "bg-white text-[#9b9fb3] ring-[#ececf4] hover:bg-[#fafbff] hover:text-[#0b1024]"
                        }`}
                      >
                        {lvl}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-2 text-[11px] text-[#9b9fb3]">
                <span className="text-[#3c4053]">{DIFFICULTY_LABELS[level]}</span>
                {" — "}
                {DIFFICULTY_DESCRIPTIONS[level]}
                {" · по умолчанию: "}
                <span className="text-[#3c4053]">{def}</span>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-8 text-center text-[14px] text-[#6f7282]">
            Не найдено журналов под «{query}».
          </div>
        ) : null}
      </div>

      {dirty.size > 0 ? (
        <div className="sticky bottom-3 z-20 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#0b1024] px-4 py-2 text-[12px] text-white shadow-lg">
            <Sparkles className="size-3.5 text-[#7a5cff]" />
            Не забудь сохранить — {dirty.size} измен.
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="ml-2 inline-flex h-7 items-center gap-1 rounded-full bg-[#5566f6] px-3 text-[12px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Save className="size-3" />
              )}
              Сохранить
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => {
          resetAll();
          setResetOpen(false);
        }}
        title="Сбросить сложность всех журналов?"
        description="Все ваши переопределения будут удалены, журналы вернутся к дефолтам по семантике (1 — отметка, 5 — аналитический документ)."
        bullets={[
          {
            label:
              "Сами заполненные журналы и записи не трогаются — это только настройки расчёта нагрузки.",
            tone: "info",
          },
        ]}
        confirmLabel="Сбросить"
        cancelLabel="Не сбрасывать"
        variant="warn"
        icon={RotateCcw}
      />
    </div>
  );
}
