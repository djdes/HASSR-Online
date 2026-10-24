"use client";

/**
 * Shared editors for cleaning per-room configuration:
 *   • <ScopeListEditor>  — drag/drop bullet-list (currentScope/generalScope)
 *   • <WeekdayMaskPicker> — Mon-Sun chips + presets (currentDays/generalDays)
 *
 * Cleaning unification 2026-05-08: эти компоненты раньше жили в
 * cleaning-document-client.tsx (~2000 строк). Извлечены чтобы
 * /settings/buildings и журнал уборки могли пользоваться одним и тем же
 * UI (см. docs/superpowers/specs/2026-05-08-cleaning-unification.md
 * stages 2-3).
 */

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Camera, CameraOff, GripVertical, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import type { ScopeStep } from "@/lib/cleaning-document";
import {
  WEEKDAY_MASK_ALL,
  WEEKDAY_MASK_NONE,
  WEEKDAY_MASK_WEEKENDS,
  WEEKDAY_MASK_WORKDAYS,
  describeMask,
  isMaskedWeekday,
  normalizeMask,
  toggleWeekdayBit,
} from "@/lib/weekday-mask";

type ScopeListItem = {
  uid: string;
  text: string;
  /**
   * Per-step photo override:
   *   true  — обязательное фото для этого шага
   *   false — фото не требуется (даже если room.requirePhoto=true)
   *   undefined — наследует room.requirePhoto
   */
  requirePhoto?: boolean;
};

const SCOPE_UID_PREFIX = "scope-uid-";
let SCOPE_UID_COUNTER = 0;
function nextScopeUid() {
  SCOPE_UID_COUNTER += 1;
  return `${SCOPE_UID_PREFIX}${SCOPE_UID_COUNTER}-${Math.random().toString(36).slice(2, 7)}`;
}

function SortableScopeRow(props: {
  item: ScopeListItem;
  index: number;
  total: number;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (text: string) => void;
  onRemove: () => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  placeholder?: string;
  /**
   * Когда задан — рядом с шагом отрисовывается camera-toggle.
   * effectiveRequirePhoto показывает текущее реальное состояние
   * (учитывая fallback на room-master). onCyclePhoto вызывается при
   * клике для переключения per-step override (3-state cycle).
   */
  effectiveRequirePhoto?: boolean;
  onCyclePhoto?: () => void;
}) {
  const t = useTranslations("cleaningUi.scopeAndScheduleEditors");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.item.uid });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 rounded-2xl border bg-white pl-1 pr-2 py-1.5 transition-colors ${
        isDragging
          ? "border-[#5566f6] bg-[#f5f6ff] shadow-[0_16px_40px_-24px_rgba(85,102,246,0.55)]"
          : "border-[#ececf4] focus-within:border-[#5566f6] focus-within:ring-4 focus-within:ring-[#5566f6]/15"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("dragStep")}
        className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-[#9b9fb3] hover:bg-[#f5f6ff] hover:text-[#5566f6] active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[12px] font-semibold text-[#3848c7] tabular-nums">
        {props.index + 1}
      </span>
      <Input
        ref={props.inputRef}
        value={props.item.text}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            props.onEnter();
          }
          if (
            event.key === "Backspace" &&
            props.item.text === "" &&
            props.total > 1
          ) {
            event.preventDefault();
            props.onBackspaceEmpty();
          }
        }}
        placeholder={props.placeholder}
        className="h-9 flex-1 rounded-xl border-0 bg-transparent px-2 text-[14px] shadow-none focus-visible:ring-0"
      />
      {props.onCyclePhoto ? (
        <button
          type="button"
          onClick={props.onCyclePhoto}
          aria-label={t("requirePhotoStep")}
          title={
            props.item.requirePhoto === true
              ? t("photoRequired")
              : props.item.requirePhoto === false
                ? t("photoNotRequired")
                : props.effectiveRequirePhoto
                  ? t("inheritOn")
                  : t("inheritOff")
          }
          className={`flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
            props.item.requirePhoto === true
              ? "bg-[#5566f6] text-white"
              : props.item.requirePhoto === false
                ? "bg-[#fff4f2] text-[#a13a32]"
                : props.effectiveRequirePhoto
                  ? "bg-[#eef1ff] text-[#3848c7]"
                  : "text-[#9b9fb3] hover:bg-[#f5f6ff] hover:text-[#5566f6]"
          }`}
        >
          {props.item.requirePhoto === false ? (
            <CameraOff className="size-4" />
          ) : (
            <Camera className="size-4" />
          )}
        </button>
      ) : null}
      <button
        type="button"
        onClick={props.onRemove}
        className="flex size-8 shrink-0 items-center justify-center rounded-xl text-[#9b9fb3] transition-colors hover:bg-[#fff4f2] hover:text-[#a13a32]"
        aria-label={t("removeStep")}
      >
        <X className="size-4" />
      </button>
    </li>
  );
}

/**
 * Объединённый props-API. Можно передавать legacy-формат (string[])
 * без поддержки per-step photo, либо новый формат (ScopeStep[]) с
 * onChange отдающим структурированные шаги. Когда задан roomRequirePhoto —
 * каждая строка получает camera-toggle (3-state: true/false/inherit).
 */
type ScopeListEditorProps =
  | {
      mode?: "legacy";
      value: string[];
      onChange: (next: string[]) => void;
      placeholder?: string;
      addLabel?: string;
      emptyHint?: string;
      /** Список примеров-чипов над композером (эталон cleaning-05). */
      examples?: string[];
      roomRequirePhoto?: undefined;
    }
  | {
      mode: "with-photo";
      value: ScopeStep[];
      onChange: (next: ScopeStep[]) => void;
      placeholder?: string;
      addLabel?: string;
      emptyHint?: string;
      /** Список примеров-чипов над композером (эталон cleaning-05). */
      examples?: string[];
      /** Master-toggle помещения; используется для fallback в effective-state. */
      roomRequirePhoto: boolean;
    };

export function ScopeListEditor(props: ScopeListEditorProps) {
  const t = useTranslations("cleaningUi.scopeAndScheduleEditors");
  const isWithPhoto = props.mode === "with-photo";
  const [items, setItems] = useState<ScopeListItem[]>(() =>
    isWithPhoto
      ? (props.value as ScopeStep[]).map((step) => ({
          uid: nextScopeUid(),
          text: step.label,
          requirePhoto: step.requirePhoto,
        }))
      : (props.value as string[]).map((text) => ({
          uid: nextScopeUid(),
          text,
        })),
  );
  useEffect(() => {
    setItems((prev) => {
      if (isWithPhoto) {
        const incoming = props.value as ScopeStep[];
        if (
          prev.length === incoming.length &&
          prev.every(
            (it, i) =>
              it.text === incoming[i].label &&
              it.requirePhoto === incoming[i].requirePhoto,
          )
        ) {
          return prev;
        }
        return incoming.map((step, i) => ({
          uid: prev[i]?.uid ?? nextScopeUid(),
          text: step.label,
          requirePhoto: step.requirePhoto,
        }));
      }
      const incoming = props.value as string[];
      if (
        prev.length === incoming.length &&
        prev.every((it, i) => it.text === incoming[i])
      ) {
        return prev;
      }
      return incoming.map((text, i) => ({
        uid: prev[i]?.uid ?? nextScopeUid(),
        text,
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  const [draft, setDraft] = useState("");
  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function pushChange(next: ScopeListItem[]) {
    setItems(next);
    if (isWithPhoto) {
      const out: ScopeStep[] = next.map((it) => {
        const step: ScopeStep = { label: it.text };
        if (typeof it.requirePhoto === "boolean")
          step.requirePhoto = it.requirePhoto;
        return step;
      });
      (props.onChange as (n: ScopeStep[]) => void)(out);
    } else {
      (props.onChange as (n: string[]) => void)(next.map((it) => it.text));
    }
  }
  function update(uid: string, text: string) {
    pushChange(items.map((it) => (it.uid === uid ? { ...it, text } : it)));
  }
  function remove(uid: string) {
    pushChange(items.filter((it) => it.uid !== uid));
  }
  /**
   * Добавление названного шага — композер «инпут + квадратная синяя
   * кнопка +» и клик по чипу-примеру (эталон cleaning-05-add-room-dialog).
   */
  function addNamed(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    if (items.some((it) => it.text.trim().toLowerCase() === text.toLowerCase())) {
      setDraft("");
      return;
    }
    pushChange([...items, { uid: nextScopeUid(), text }]);
    setDraft("");
  }
  function add() {
    const newItem: ScopeListItem = { uid: nextScopeUid(), text: "" };
    const next = [...items, newItem];
    pushChange(next);
    setTimeout(() => {
      inputRefs.current.get(newItem.uid)?.focus();
    }, 0);
  }
  // 3-state cycle: undefined → true → false → undefined
  // Это даёт менеджеру явные «Inherit / Force-Yes / Force-No».
  function cyclePhoto(uid: string) {
    pushChange(
      items.map((it) => {
        if (it.uid !== uid) return it;
        if (it.requirePhoto === undefined) return { ...it, requirePhoto: true };
        if (it.requirePhoto === true) return { ...it, requirePhoto: false };
        // false → undefined (inherit)
        const { requirePhoto: _drop, ...rest } = it;
        void _drop;
        return rest;
      }),
    );
  }
  function focusPrev(uid: string) {
    const idx = items.findIndex((it) => it.uid === uid);
    const prev = items[Math.max(0, idx - 1)];
    if (prev) {
      setTimeout(() => inputRefs.current.get(prev.uid)?.focus(), 0);
    }
  }
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((it) => it.uid === active.id);
    const newIndex = items.findIndex((it) => it.uid === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    pushChange(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
          {props.emptyHint ?? t("emptyHint")}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((it) => it.uid)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2">
              {items.map((it, index) => (
                <SortableScopeRow
                  key={it.uid}
                  item={it}
                  index={index}
                  total={items.length}
                  inputRef={(el) => {
                    inputRefs.current.set(it.uid, el);
                  }}
                  onChange={(text) => update(it.uid, text)}
                  onRemove={() => remove(it.uid)}
                  onEnter={() => add()}
                  onBackspaceEmpty={() => {
                    focusPrev(it.uid);
                    remove(it.uid);
                  }}
                  placeholder={props.placeholder}
                  effectiveRequirePhoto={
                    isWithPhoto
                      ? typeof it.requirePhoto === "boolean"
                        ? it.requirePhoto
                        : (props.roomRequirePhoto ?? false)
                      : undefined
                  }
                  onCyclePhoto={
                    isWithPhoto ? () => cyclePhoto(it.uid) : undefined
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {props.examples && props.examples.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[12px] font-medium text-[#6f7282]">{t("examplesLabel")}</div>
          <div className="flex flex-wrap gap-1.5">
            {props.examples.map((example) => {
              const already = items.some(
                (it) => it.text.trim().toLowerCase() === example.toLowerCase(),
              );
              return (
                <button
                  key={example}
                  type="button"
                  disabled={already}
                  onClick={() => addNamed(example)}
                  title={already ? t("alreadyAdded") : t("addExample", { example })}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-150 ${
                    already
                      ? "cursor-default border-[#ececf4] bg-[#f5f6ff] text-[#9b9fb3]"
                      : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6] hover:bg-[#f5f6ff] hover:text-[#5566f6]"
                  }`}
                >
                  {example}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {/* Композер как на эталоне: инпут «Введите название нового предмета»
          + квадратная синяя кнопка «+» справа. */}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            addNamed(draft);
          }}
          placeholder={t("newItemPlaceholder")}
          aria-label={props.addLabel ?? t("addStep")}
          className="h-10 flex-1 rounded-xl border-[#dcdfed] bg-white px-3.5 text-[14px]"
        />
        <button
          type="button"
          onClick={() => (draft.trim() ? addNamed(draft) : add())}
          aria-label={props.addLabel ?? t("addStep")}
          title={props.addLabel ?? t("addStep")}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#5566f6] text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
        >
          <Plus className="size-5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

/**
 * Picker для monthly-расписания: грид 1-31 + спец-чип «Последний день месяца».
 * Хранится как string[] (числа стрингифицированы для гомогенности с "last").
 *
 * Cleaning unification stage 2026-05-08+: позволяет настроить уборку
 * например «1, 15, last» (раз-другой в месяц + последний день).
 */
export function MonthDaysPicker(props: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("cleaningUi.scopeAndScheduleEditors");
  const set = new Set(props.value);
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1));

  function toggle(day: string) {
    const next = new Set(set);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    props.onChange([...next].sort((a, b) => {
      if (a === "last") return 1;
      if (b === "last") return -1;
      return Number(a) - Number(b);
    }));
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const isOn = set.has(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggle(day)}
              className={`flex h-9 items-center justify-center rounded-xl border text-[12px] font-medium tabular-nums transition-colors ${
                isOn
                  ? "border-[#5566f6] bg-[#5566f6] text-white shadow-[0_4px_12px_-6px_rgba(85,102,246,0.55)]"
                  : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              }`}
              aria-pressed={isOn}
            >
              {day}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => toggle("last")}
        aria-pressed={set.has("last")}
        className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-medium transition-colors ${
          set.has("last")
            ? "border-[#a16d32] bg-[#fff8eb] text-[#a16d32]"
            : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#a16d32]/40 hover:bg-[#fff8eb]/40"
        }`}
      >
        {t("lastDay")}
      </button>
      {props.value.length > 0 ? (
        <div className="text-[11px] text-[#6f7282]">
          {t("daysSelected", { count: props.value.length })}
        </div>
      ) : (
        <div className="text-[11px] text-[#a13a32]">
          {t("noDaysSelected")}
        </div>
      )}
    </div>
  );
}

export function WeekdayMaskPicker(props: {
  value: number;
  onChange: (next: number) => void;
}) {
  const t = useTranslations("cleaningUi.scopeAndScheduleEditors");
  const weekdayLabels = [t("weekdayMon"), t("weekdayTue"), t("weekdayWed"), t("weekdayThu"), t("weekdayFri"), t("weekdaySat"), t("weekdaySun")];
  const mask = normalizeMask(props.value, 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {weekdayLabels.map((label, idx) => {
          const isOn = isMaskedWeekday(mask, idx);
          const isWeekendChip = idx >= 5;
          return (
            <button
              key={label}
              type="button"
              onClick={() => props.onChange(toggleWeekdayBit(mask, idx))}
              className={`flex h-9 min-w-10 items-center justify-center rounded-xl border px-2.5 text-[13px] font-medium transition-colors ${
                isOn
                  ? "border-[#5566f6] bg-[#5566f6] text-white shadow-[0_6px_16px_-8px_rgba(85,102,246,0.55)]"
                  : isWeekendChip
                    ? "border-[#fff4f2] bg-[#fff4f2] text-[#a13a32] hover:border-[#a13a32]/40"
                    : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              }`}
              aria-pressed={isOn}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[12px]">
        <button
          type="button"
          onClick={() => props.onChange(WEEKDAY_MASK_ALL)}
          className="rounded-full border border-[#dcdfed] bg-white px-2.5 py-1 text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          {t("everyDay")}
        </button>
        <button
          type="button"
          onClick={() => props.onChange(WEEKDAY_MASK_WORKDAYS)}
          className="rounded-full border border-[#dcdfed] bg-white px-2.5 py-1 text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          {t("workdays")}
        </button>
        <button
          type="button"
          onClick={() => props.onChange(WEEKDAY_MASK_WEEKENDS)}
          className="rounded-full border border-[#dcdfed] bg-white px-2.5 py-1 text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          {t("weekends")}
        </button>
        <button
          type="button"
          onClick={() => props.onChange(WEEKDAY_MASK_NONE)}
          className="rounded-full border border-[#dcdfed] bg-white px-2.5 py-1 text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          {t("clear")}
        </button>
        <span className="ml-auto text-[#6f7282]">{describeMask(mask)}</span>
      </div>
    </div>
  );
}
