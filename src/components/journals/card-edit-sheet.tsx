"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { NumberField } from "@/components/journals/number-field";
import { PhotoField, parsePhotoValue } from "@/components/journals/photo-field";
import { TimeField } from "@/components/journals/time-field";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";

/**
 * Лист правки одной записи из карточного режима.
 *
 * Зачем отдельный компонент: восемь журналов рисовали карточки вообще без
 * обработчиков — `finished_product`, `perishable_rejection`,
 * `climate_control`, `uv_lamp_runtime`, `training_plan`,
 * `sanitary_day_control`, `cleaning_ventilation_checklist` и generic-
 * `tracked`. Значение можно было вписать только в таблице шириной
 * 1100–1280px. У части журналов уже была модалка добавления строки, и там
 * её хватило переиспользовать; остальным нужен компактный лист на два-пять
 * полей, и городить восемь разных диалогов ради этого незачем.
 *
 * Схема полей намеренно узкая — тот же набор, что у
 * `TaskFormField` в `tasksflow-adapters/task-form.ts`: всё должно
 * работать на дешёвом Android без модных виджетов.
 */
export type CardEditFieldDef =
  | {
      type: "text";
      key: string;
      label: string;
      placeholder?: string;
      multiline?: boolean;
    }
  | {
      type: "number";
      key: string;
      label: string;
      unit?: string;
      min?: number;
      max?: number;
      step?: number;
      norm?: { min?: number | null; max?: number | null } | null;
      hint?: string;
    }
  | { type: "time"; key: string; label: string; showNow?: boolean }
  | { type: "date"; key: string; label: string }
  | {
      type: "select";
      key: string;
      label: string;
      options: Array<{ value: string; label: string; code?: string }>;
    }
  | { type: "boolean"; key: string; label: string }
  | { type: "photo"; key: string; label: string; required?: boolean }
  | { type: "signature"; key: string; label: string };

export type CardEditValues = Record<string, string | boolean | null>;

export function CardEditSheet({
  open,
  title,
  subtitle,
  fields,
  values,
  onClose,
  onSubmit,
  saving = false,
  submitLabel,
  copy,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  fields: CardEditFieldDef[];
  /** Значения на момент открытия. Читаются заново при каждом открытии. */
  values: CardEditValues;
  onClose: () => void;
  onSubmit: (next: CardEditValues) => void | Promise<void>;
  saving?: boolean;
  submitLabel?: string;
  copy?: { cancel: string; saving: string; missingPhoto: string };
}) {
  const t = useTranslations("journalUi.cardEdit");
  const tc = useTranslations("common");
  const [draft, setDraft] = useState<CardEditValues>(values);
  const keyboardInset = useKeyboardInset();

  // Сид формы — эффектом по `open`, а не в обработчике открытия: Radix
  // (и vaul поверх него) не зовёт `onOpenChange` при программном
  // открытии, и лист, открытый второй раз, показывал бы прошлые значения.
  useEffect(() => {
    if (open) setDraft(values);
    // `values` намеренно вне зависимостей: объект пересоздаётся на каждом
    // рендере родителя, и с ним эффект затирал бы ввод пользователя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function setValue(key: string, next: string | boolean | null) {
    setDraft((prev) => ({ ...prev, [key]: next }));
  }

  // Фото, объявленное обязательным, блокирует сохранение — иначе
  // требование из `journal-specs.ts` остаётся декларацией.
  const missingPhoto = fields.some(
    (field) =>
      field.type === "photo" &&
      field.required &&
      parsePhotoValue(draft[field.key]).length === 0
  );

  function textOf(key: string): string {
    const value = draft[key];
    if (value == null || value === false) return "";
    if (value === true) return "true";
    return String(value);
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        // Подвал поднимается над экранной клавиатурой: без этого
        // «Сохранить» на iOS оказывается ровно под ней.
        <div style={{ paddingBottom: keyboardInset }}>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-12 flex-1 rounded-2xl border border-[#dcdfed] bg-white text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#fafbff]"
            >
              {copy?.cancel ?? tc("cancel")}
            </button>
            <button
              type="button"
              disabled={saving || missingPhoto}
              onClick={() => {
                void onSubmit(draft);
              }}
              className="h-12 flex-[1.4] rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60"
            >
              {saving
                ? (copy?.saving ?? tc("saving"))
                : missingPhoto
                  ? (copy?.missingPhoto ?? t("missingPhoto"))
                  : (submitLabel ?? tc("save"))}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 px-1 py-2">
        {fields.map((field) => {
          if (field.type === "boolean") {
            const checked = draft[field.key] === true;
            return (
              <label
                key={field.key}
                className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors duration-150 hover:bg-[#f5f6ff]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setValue(field.key, event.target.checked)}
                  className="size-5 accent-[#5566f6]"
                />
                <span className="text-[15px] text-[#0b1024]">{field.label}</span>
              </label>
            );
          }

          if (field.type === "photo") {
            return (
              <PhotoField
                key={field.key}
                label={field.label}
                value={textOf(field.key)}
                onChange={(next) => setValue(field.key, next)}
                required={field.required}
              />
            );
          }

          if (field.type === "signature") {
            return (
              <div key={field.key} className="min-w-0">
                <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                  {field.label}
                </label>
                <input
                  type="text"
                  value={textOf(field.key)}
                  placeholder={t("signaturePlaceholder")}
                  autoComplete="name"
                  onChange={(event) => setValue(field.key, event.target.value)}
                  className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
              </div>
            );
          }

          if (field.type === "number") {
            return (
              <NumberField
                key={field.key}
                label={field.label}
                value={textOf(field.key)}
                onChange={(next) => setValue(field.key, next)}
                unit={field.unit}
                min={field.min}
                max={field.max}
                step={field.step ?? 0.1}
                norm={field.norm}
                hint={field.hint}
              />
            );
          }

          if (field.type === "time") {
            return (
              <TimeField
                key={field.key}
                label={field.label}
                value={textOf(field.key)}
                onChange={(next) => setValue(field.key, next)}
                showNow={field.showNow ?? true}
              />
            );
          }

          if (field.type === "date") {
            return (
              <div key={field.key} className="min-w-0">
                <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                  {field.label}
                </label>
                <input
                  type="date"
                  value={textOf(field.key)}
                  onChange={(event) => setValue(field.key, event.target.value)}
                  className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[16px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
              </div>
            );
          }

          if (field.type === "select") {
            const current = textOf(field.key);
            // До пяти вариантов — segmented control: все видны сразу, без
            // раскрытия списка (Luke Wroblewski: dropdown — крайняя мера).
            if (field.options.length > 0 && field.options.length <= 5) {
              return (
                <div key={field.key} className="min-w-0">
                  <div className="mb-1 text-[12px] font-medium text-[#6f7282]">
                    {field.label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {field.options.map((option) => {
                      const active = current === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setValue(field.key, option.value)}
                          className={`min-h-[44px] flex-1 basis-[calc(50%-0.375rem)] rounded-2xl border px-3 py-2 text-[14px] font-medium transition-colors duration-150 ${
                            active
                              ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                              : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                          }`}
                        >
                          {option.code ? (
                            <span className="mr-1.5 font-semibold tabular-nums">
                              {option.code}
                            </span>
                          ) : null}
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }
            return (
              <div key={field.key} className="min-w-0">
                <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                  {field.label}
                </label>
                <select
                  value={current}
                  onChange={(event) => setValue(field.key, event.target.value)}
                  className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[16px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                >
                  <option value="">—</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          return (
            <div key={field.key} className="min-w-0">
              <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                {field.label}
              </label>
              {field.multiline ? (
                <textarea
                  rows={4}
                  value={textOf(field.key)}
                  placeholder={field.placeholder}
                  onChange={(event) => setValue(field.key, event.target.value)}
                  className="w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-3 text-[16px] leading-[1.5] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
              ) : (
                <input
                  type="text"
                  value={textOf(field.key)}
                  placeholder={field.placeholder}
                  onChange={(event) => setValue(field.key, event.target.value)}
                  className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
              )}
            </div>
          );
        })}
      </div>
    </BottomSheet>
  );
}
