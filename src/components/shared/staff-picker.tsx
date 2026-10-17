"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MENU_ITEM_ACTIVE_CLASS,
  MENU_ITEM_CLASS,
  MENU_ITEM_MUTED_CLASS,
  MENU_INDICATOR_CLASS,
  MENU_LABEL_CLASS,
} from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";

/** Сотрудник для выбора — та же форма, что `PpkStaffOption` на сервере. */
export type StaffPickerOption = { id: string; name: string; title: string; isManager: boolean };

type StaffPickerProps = {
  value: string | null;
  onChange: (id: string | null) => void;
  staff: StaffPickerOption[];
  /** Сотрудники, которых стоит выбрать первыми (например, руководитель группы). */
  recommendedIds?: string[];
  placeholder: string;
  disabled?: boolean;
};

/** Инициалы для аватара: первые буквы первых двух слов имени. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.slice(0, 1).toUpperCase()).join("") || "?";
}

/**
 * Выбор одного сотрудника: кнопка-поле и поповер с поиском и группами
 * «Рекомендуем» / «Руководство» / «Сотрудники». Native `<select>` для людей не используем.
 */
export function StaffPicker({
  value,
  onChange,
  staff,
  recommendedIds,
  placeholder,
  disabled = false,
}: StaffPickerProps) {
  const t = useTranslations("productionControl");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = value ? staff.find((item) => item.id === value) ?? null : null;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (item: StaffPickerOption) =>
      !q || item.name.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
    const recommended = new Set(recommendedIds ?? []);
    const filtered = staff.filter(matches);
    const recommendedItems = filtered.filter((item) => recommended.has(item.id));
    const managers = filtered.filter((item) => !recommended.has(item.id) && item.isManager);
    const rest = filtered.filter((item) => !recommended.has(item.id) && !item.isManager);
    return { recommendedItems, managers, rest };
  }, [staff, recommendedIds, query]);

  const hasAny = groups.recommendedItems.length + groups.managers.length + groups.rest.length > 0;

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || staff.length === 0}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-left text-[14px] transition-colors duration-150 hover:border-[#5566f6]/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-60",
            !selected && "text-[#9b9fb3]",
          )}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            {selected ? (
              <>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[11px] font-semibold text-[#3848c7]">
                  {initials(selected.name)}
                </span>
                <span className="min-w-0 truncate">
                  <span className="font-medium text-[#0b1024]">{selected.name}</span>
                  {selected.title ? <span className="text-[#9b9fb3]">{` · ${selected.title}`}</span> : null}
                </span>
              </>
            ) : (
              <span className="truncate">{placeholder}</span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 transition-transform duration-150",
              open ? "rotate-180 text-[#5566f6]" : "text-[#9b9fb3]",
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="max-h-[420px] w-(--radix-popover-trigger-width) min-w-[260px] overflow-hidden p-0"
      >
        <div className="border-b border-[#ececf4] bg-[#fafbff] p-2">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-[#9b9fb3]" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("staffPicker.search")}
              className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white pl-8 pr-2 text-[13px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
        </div>

        <div className="max-h-[340px] overflow-y-auto p-1.5">
          {selected ? (
            <button
              type="button"
              onClick={() => pick(null)}
              className={cn(MENU_ITEM_CLASS, MENU_ITEM_MUTED_CLASS)}
            >
              {t("staffPicker.clear")}
            </button>
          ) : null}

          {groups.recommendedItems.length > 0 ? (
            <StaffGroup title={t("staffPicker.recommended")} items={groups.recommendedItems} selectedId={value} onPick={pick} />
          ) : null}
          {groups.managers.length > 0 ? (
            <StaffGroup title={t("staffPicker.managers")} items={groups.managers} selectedId={value} onPick={pick} />
          ) : null}
          {groups.rest.length > 0 ? (
            <StaffGroup title={t("staffPicker.staff")} items={groups.rest} selectedId={value} onPick={pick} />
          ) : null}

          {!hasAny ? (
            <div className="px-3 py-6 text-center text-[13px] text-[#9b9fb3]">{t("staffPicker.empty")}</div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StaffGroup({
  title,
  items,
  selectedId,
  onPick,
}: {
  title: string;
  items: StaffPickerOption[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <div className={MENU_LABEL_CLASS}>{title}</div>
      {items.map((item) => {
        const active = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.id)}
            className={cn(MENU_ITEM_CLASS, active && MENU_ITEM_ACTIVE_CLASS)}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[11px] font-semibold text-[#3848c7]">
              {initials(item.name)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{item.name}</span>
              {item.title ? <span className="text-[#9b9fb3]">{` · ${item.title}`}</span> : null}
            </span>
            {active ? <Check className={cn("size-4", MENU_INDICATOR_CLASS)} /> : null}
          </button>
        );
      })}
    </div>
  );
}
