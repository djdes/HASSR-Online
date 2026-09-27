"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import {
  CATEGORY_LABELS,
  STAFF_ACCESS_PRESETS,
  getJournalResponsibilityMeta,
  presetJournalCodes,
  type JournalCategory,
} from "@/lib/journal-responsible-presets";
import { sortJournalsByName } from "@/lib/journal-sort";
import { cn } from "@/lib/utils";

/**
 * Выбор журналов, к которым сотруднику открывают доступ.
 *
 * Тридцать с лишним чекбоксов подряд — это не выбор, а работа. Поэтому
 * здесь три способа не отмечать их по одному: готовые наборы, «выбрать
 * все» и выделение протягиванием мыши.
 */

export type JournalOption = { code: string; name: string };

type Props = {
  options: JournalOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Набор, уже настроенный для должности сотрудника. Пусто — чипа нет. */
  positionPresetCodes?: string[];
  positionTitle?: string | null;
  disabled?: boolean;
};

export function JournalMultiSelect({
  options,
  value,
  onChange,
  positionPresetCodes = [],
  positionTitle,
  disabled = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const selected = useMemo(() => new Set(value), [value]);
  const allCodes = useMemo(() => options.map((item) => item.code), [options]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((item) => item.name.toLowerCase().includes(q));
  }, [options, query]);

  /**
   * Группировка по категориям: тридцать журналов сплошным списком человек
   * не читает, а ищет глазами знакомое слово. Внутри группы — по алфавиту.
   */
  const groups = useMemo(() => {
    const map = new Map<JournalCategory, JournalOption[]>();
    for (const item of visible) {
      const category =
        getJournalResponsibilityMeta(item.code)?.category ?? "other";
      const bucket = map.get(category);
      if (bucket) bucket.push(item);
      else map.set(category, [item]);
    }
    return [...map.entries()].map(
      ([category, items]) => [category, sortJournalsByName(items, (item) => item.name)] as const
    );
  }, [visible]);

  /** Плоский порядок строк — по нему считается диапазон при протягивании. */
  const flatCodes = useMemo(
    () => groups.flatMap(([, items]) => items.map((item) => item.code)),
    [groups]
  );

  function apply(next: Set<string>, preset: string | null = null) {
    setActivePreset(preset);
    onChange([...next]);
  }

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    apply(next);
  }

  /* ---------------------------------------------------------------- *
   * Выделение протягиванием
   *
   * Модель со снапшотом: на старте запоминаем выбор целиком и целевое
   * состояние, а при движении переприменяем его к диапазону от якоря.
   * Так протягивание вверх и возврат назад работают сами собой — строки,
   * из которых «уехали», откатываются к исходному, а не мигают.
   * ---------------------------------------------------------------- */
  const drag = useRef<{
    anchor: number;
    target: boolean;
    snapshot: Set<string>;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const stop = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  /** Мышь уже переключила строку на pointerdown — клик не должен повторять. */
  const handledByPointer = useRef(false);

  function startDrag(index: number, code: string, pointerType: string) {
    // Только мышь: на таче протягивание — это скролл, и отбирать его у
    // человека ради мультивыбора нельзя. Там строка переключается тапом
    // (onClick ниже), плюс работают пресеты и «выбрать все».
    if (pointerType !== "mouse" || disabled) return;
    handledByPointer.current = true;
    const target = !selected.has(code);
    drag.current = { anchor: index, target, snapshot: new Set(selected) };
    setDragging(true);

    const next = new Set(selected);
    if (target) next.add(code);
    else next.delete(code);
    apply(next);
  }

  function extendDrag(index: number) {
    const state = drag.current;
    if (!state) return;
    const from = Math.min(state.anchor, index);
    const to = Math.max(state.anchor, index);
    const next = new Set(state.snapshot);
    for (let i = from; i <= to; i += 1) {
      const code = flatCodes[i];
      if (!code) continue;
      if (state.target) next.add(code);
      else next.delete(code);
    }
    apply(next);
  }

  const presets = [
    ...(positionPresetCodes.length > 0
      ? [
          {
            id: "position",
            label: positionTitle
              ? `Как для «${positionTitle}»`
              : "Как для должности",
            codes: positionPresetCodes,
          },
        ]
      : []),
    ...STAFF_ACCESS_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      codes: presetJournalCodes(preset, allCodes),
    })).filter((preset) => preset.codes.length > 0),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={disabled}
            onClick={() => apply(new Set(preset.codes), preset.id)}
            className={cn(
              "h-8 rounded-full border px-3 text-[12.5px] transition-colors disabled:opacity-50",
              activePreset === preset.id
                ? "border-[#5566f6] bg-[#5566f6] text-white"
                : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff]"
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск журнала"
            disabled={disabled}
            className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white pl-9 pr-8 text-[13.5px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-50"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить поиск"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[#9b9fb3] hover:text-[#0b1024]"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => apply(new Set(allCodes))}
          className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:bg-[#f5f6ff] disabled:opacity-50"
        >
          Выбрать все
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => apply(new Set())}
          className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#6f7282] transition-colors hover:bg-[#f5f6ff] disabled:opacity-50"
        >
          Снять все
        </button>
      </div>

      <div className="max-h-[40vh] select-none overflow-y-auto rounded-2xl border border-[#ececf4] bg-[#fafbff] p-2 [touch-action:pan-y]">
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-[#9b9fb3]">
            Ничего не нашлось
          </p>
        ) : (
          groups.map(([category, items]) => (
            <div key={category} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                {CATEGORY_LABELS[category]}
              </div>
              {items.map((item) => {
                const index = flatCodes.indexOf(item.code);
                const checked = selected.has(item.code);
                return (
                  <div
                    key={item.code}
                    role="checkbox"
                    aria-checked={checked}
                    tabIndex={disabled ? -1 : 0}
                    onPointerDown={(event) =>
                      startDrag(index, item.code, event.pointerType)
                    }
                    onPointerEnter={() => extendDrag(index)}
                    onClick={() => {
                      // Мышь уже переключила строку на pointerdown — иначе
                      // отметка снялась бы сразу после установки. Тап на
                      // телефоне сюда доходит нетронутым.
                      if (handledByPointer.current) {
                        handledByPointer.current = false;
                        return;
                      }
                      if (!disabled) toggle(item.code);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Enter") {
                        event.preventDefault();
                        if (!disabled) toggle(item.code);
                      }
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13.5px] transition-colors",
                      checked
                        ? "bg-[#eef1ff] text-[#0b1024]"
                        : "text-[#3c4053] hover:bg-white",
                      disabled && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors",
                        checked
                          ? "border-[#5566f6] bg-[#5566f6] text-white"
                          : "border-[#dcdfed] bg-white"
                      )}
                    >
                      {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1 leading-snug">{item.name}</span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <p className="text-[12px] text-[#6f7282]">
        Выбрано: {selected.size} из {options.length}. Мышью можно вести по
        списку, отмечая подряд.
      </p>
    </div>
  );
}
