"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Coins,
  Loader2,
  Save,
  Search,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Item = {
  code: string;
  name: string;
  bonusKopecks: number;
  suggestNoBonus: boolean;
};

type Props = { items: Item[] };

const PRESETS_RUB = [0, 30, 50, 100, 200] as const;

function kopecksToRub(k: number): number {
  return Math.round(k / 100);
}

export function JournalBonusesEditor({ items }: Props) {
  const router = useRouter();
  const [base] = useState(() =>
    new Map(items.map((i) => [i.code, kopecksToRub(i.bonusKopecks)]))
  );
  const [curr, setCurr] = useState(() =>
    new Map(items.map((i) => [i.code, kopecksToRub(i.bonusKopecks)]))
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "with-bonus" | "no-bonus">(
    "all"
  );
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    const out = new Set<string>();
    for (const [code, v] of curr) {
      if ((base.get(code) ?? 0) !== v) out.add(code);
    }
    return out;
  }, [base, curr]);

  const totalActive = useMemo(() => {
    let sum = 0;
    for (const v of curr.values()) sum += v;
    return sum;
  }, [curr]);

  const q = query.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    return items.filter((i) => {
      if (
        q &&
        !i.name.toLowerCase().includes(q) &&
        !i.code.toLowerCase().includes(q)
      ) {
        return false;
      }
      const v = curr.get(i.code) ?? 0;
      if (filter === "with-bonus" && v <= 0) return false;
      if (filter === "no-bonus" && v > 0) return false;
      return true;
    });
  }, [items, q, filter, curr]);

  function setRubFor(code: string, value: number) {
    setCurr((prev) => {
      const next = new Map(prev);
      next.set(code, Math.max(0, Math.floor(value || 0)));
      return next;
    });
  }

  function applyToAllVisible(value: number) {
    setCurr((prev) => {
      const next = new Map(prev);
      for (const i of filteredItems) {
        // Не перетираем «обычно без премии» если ставим всем — оставляем
        // 0, чтобы менеджер сознательно решал ставить ли бонус на
        // личные журналы.
        if (i.suggestNoBonus && value > 0) continue;
        next.set(i.code, value);
      }
      return next;
    });
    toast.success(
      value > 0
        ? `Поставлено ${value} ₽ всем подходящим в фильтре`
        : "Бонус снят со всех в фильтре"
    );
  }

  async function save() {
    if (saving || dirty.size === 0) return;
    setSaving(true);
    try {
      let ok = 0;
      let failed = 0;
      for (const code of dirty) {
        const rubles = curr.get(code) ?? 0;
        const res = await fetch(
          `/api/settings/journals/${code}/bonus`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rubles }),
          }
        );
        if (res.ok) ok += 1;
        else failed += 1;
      }
      if (failed > 0) toast.error(`Сохранено ${ok}, ошибок ${failed}`);
      else toast.success(`Сохранено по ${ok} журналам`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Presets */}
      <section className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4 dark:border-white/10 dark:bg-white/5 sm:p-5">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282] dark:text-white/60">
          <Sparkles className="size-3.5 text-[#5566f6]" />
          Быстрая установка
        </div>
        <p className="mt-1 text-[12px] text-[#6f7282] dark:text-white/60">
          Применить одну сумму ко всем журналам в текущем фильтре. Личные
          журналы (гигиена, медкнижки) пропускаются — для них ставьте
          бонус вручную, если действительно нужно.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS_RUB.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => applyToAllVisible(v)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#dcdfed] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] dark:border-white/15 dark:bg-white/10 dark:text-white/90 dark:hover:border-[#7a87ff]/60 dark:hover:bg-white/15"
            >
              {v === 0 ? "Снять у всех" : `+${v} ₽ всем`}
            </button>
          ))}
        </div>
      </section>

      {/* Filters */}
      <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
        <div className="relative w-full flex-1 sm:w-auto sm:min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3] dark:text-white/50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Фильтр журналов"
            className="h-10 rounded-2xl border-[#dcdfed] pl-9 dark:border-white/15"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ["all", "Все"],
            ["with-bonus", "С премией"],
            ["no-bonus", "Без премии"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                filter === k
                  ? "border-[#5566f6] bg-[#5566f6] text-white"
                  : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff] dark:border-white/15 dark:bg-white/10 dark:text-white/90 dark:hover:bg-white/15"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto rounded-full bg-gradient-to-r from-[#fde68a]/70 to-[#fbbf24]/60 px-3 py-1 text-[12px] font-semibold text-[#7c2d12] dark:from-[#fbbf24]/30 dark:to-[#f59e0b]/30 dark:text-[#fde68a]">
          Сумма всех: {totalActive} ₽
        </div>
      </section>

      {/* List */}
      <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
        <div className="flex items-center gap-2 border-b border-[#ececf4] p-4 dark:border-white/10">
          <Coins className="size-4 text-[#fbbf24]" />
          <h2 className="text-[15px] font-semibold text-[#0b1024] dark:text-white">
            {filteredItems.length} журнал
            {filteredItems.length === 1
              ? ""
              : [2, 3, 4].includes(filteredItems.length % 10) &&
                  ![12, 13, 14].includes(filteredItems.length % 100)
                ? "а"
                : "ов"}
          </h2>
        </div>

        <ul className="divide-y divide-[#ececf4] dark:divide-white/5">
          {filteredItems.map((i) => {
            const value = curr.get(i.code) ?? 0;
            const isDirty = dirty.has(i.code);
            const hasBonus = value > 0;
            return (
              <li
                key={i.code}
                className={cn(
                  "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5",
                  isDirty && "bg-[#fff8eb] dark:bg-amber-500/10"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[15px] font-medium text-[#0b1024] dark:text-white">
                      {i.name}
                    </div>
                    {i.suggestNoBonus ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f2] px-2 py-0.5 text-[11px] font-medium text-[#a13a32] dark:bg-rose-500/15 dark:text-rose-200">
                        <ShieldAlert className="size-3" />
                        обычно без премии
                      </span>
                    ) : null}
                    {hasBonus ? (
                      <span className="rounded-full bg-gradient-to-r from-[#fde68a] to-[#fbbf24] px-2 py-0.5 text-[11px] font-semibold text-[#7c2d12]">
                        +{value} ₽
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESETS_RUB.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRubFor(i.code, v)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        value === v
                          ? "border-[#5566f6] bg-[#5566f6] text-white"
                          : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] dark:border-white/15 dark:bg-white/10 dark:text-white/85 dark:hover:bg-white/15"
                      )}
                    >
                      {v === 0 ? "0" : `+${v}`}
                    </button>
                  ))}
                  <div className="relative">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={10}
                      value={value === 0 ? "" : value}
                      onChange={(e) =>
                        setRubFor(i.code, parseInt(e.target.value || "0", 10))
                      }
                      placeholder="0"
                      className="h-8 w-[88px] rounded-xl border-[#dcdfed] pr-7 text-right text-[13px] tabular-nums dark:border-white/15"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[#9b9fb3] dark:text-white/50">
                      ₽
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
          {filteredItems.length === 0 ? (
            <li className="px-4 py-12 text-center text-[13px] text-[#9b9fb3] dark:text-white/50">
              Ничего не найдено под фильтр
            </li>
          ) : null}
        </ul>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white/95 px-4 py-3 shadow-[0_12px_32px_-16px_rgba(11,16,36,0.18)] backdrop-blur dark:border-white/10 dark:bg-[#0b1024]/85 dark:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)] sm:px-5">
        <div className="text-[13px] text-[#3c4053] dark:text-white/80">
          {dirty.size === 0
            ? "Изменений нет"
            : `Изменено: ${dirty.size}`}
        </div>
        <Button
          type="button"
          onClick={save}
          disabled={saving || dirty.size === 0}
          className="ml-auto h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Сохранить
        </Button>
      </div>
    </div>
  );
}
