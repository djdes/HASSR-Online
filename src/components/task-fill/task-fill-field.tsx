"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskFormField } from "@/lib/tasksflow-adapters/task-form";
import { fieldIcon, fieldIconTone } from "./field-icons";
import { PhotoField } from "@/components/journals/photo-field";

/**
 * Live-валидация числовых полей: возвращает статус и текст подсказки.
 * Используется в TaskFillField чтобы показать «в норме» зелёным или
 * «выходит за границы» красным сразу при вводе. Юзер видит статус
 * до сабмита и может поправить сразу.
 */
function validateNumberField(
  field: Extract<TaskFormField, { type: "number" }>,
  value: unknown,
): {
  status: "neutral" | "ok" | "warn" | "error";
  hint: string | null;
} {
  if (value === null || value === undefined || value === "") {
    return { status: "neutral", hint: null };
  }
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(num)) {
    return { status: "error", hint: "Не похоже на число — введите цифрами" };
  }
  const min = field.min;
  const max = field.max;
  if (typeof min === "number" && num < min) {
    return {
      status: "error",
      hint: `Меньше нормы (минимум ${min}${field.unit ? " " + field.unit : ""}). Это нарушение — нужно действие.`,
    };
  }
  if (typeof max === "number" && num > max) {
    return {
      status: "error",
      hint: `Выше нормы (максимум ${max}${field.unit ? " " + field.unit : ""}). Это нарушение — нужно действие.`,
    };
  }
  if (typeof min === "number" && typeof max === "number") {
    return {
      status: "ok",
      hint: `В норме (диапазон ${min}–${max}${field.unit ? " " + field.unit : ""})`,
    };
  }
  return { status: "neutral", hint: null };
}

type Props = {
  field: TaskFormField;
  value: unknown;
  onChange: (v: unknown) => void;
};

/**
 * Унифицированная обёртка вокруг одного поля формы task-fill.
 *
 * Дизайн (TF + WeSetup hybrid):
 *   • Каждое поле — карточка `rounded-2xl border bg-white p-4` чтобы
 *     зрительно разделить даже без внешних разделителей.
 *   • Шапка карточки — иконка-tile (цвет по теме поля: тёплая для
 *     температуры, прохладная для холода, фиолет для химии, индиго
 *     для времени) + большой label 14.5px semibold + required-pill
 *     «обязательно» вместо красной звёздочки (понятнее бабушкам).
 *   • Поле-input — крупное (h-14), rounded-2xl, индиго focus-ring.
 *   • Под input'ом место для assistive-text (placeholder/hint из
 *     адаптера), `text-[12.5px] text-[#9b9fb3]`.
 *
 * Разные типы полей (text/number/boolean/select/date) обёрнуты
 * единообразно — у boolean карточка слегка другая (на всю площадь
 * кликабельная toggle), но визуально та же.
 */
export function TaskFillField({ field, value, onChange }: Props) {
  const Icon = fieldIcon(field);
  const tone = fieldIconTone(field);

  // Boolean — особый случай, label-карточка + чекбокс справа.
  if (field.type === "boolean") {
    const checked = Boolean(value);
    return (
      <label
        className={`flex cursor-pointer items-center gap-4 rounded-2xl border p-4 transition-all sm:p-5 ${
          checked
            ? "border-emerald-300 bg-emerald-50/70 shadow-[0_8px_24px_-12px_rgba(34,197,94,0.35)]"
            : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
        }`}
      >
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-2xl transition-colors ${
            checked
              ? "bg-emerald-500 text-white"
              : `${tone.bg} ${tone.fg}`
          }`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-snug text-[#0b1024] sm:text-[15.5px]">
            {field.label}
          </div>
        </div>
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onChange(Boolean(v))}
          className="size-6 shrink-0"
        />
      </label>
    );
  }

  const required = "required" in field && field.required === true;

  // Live-валидация для number-полей.
  const numberStatus =
    field.type === "number" ? validateNumberField(field, value) : null;

  // Цвет рамки карточки по статусу.
  const cardBorder =
    numberStatus?.status === "error"
      ? "border-rose-300"
      : numberStatus?.status === "ok"
        ? "border-emerald-200"
        : "border-[#ececf4]";

  return (
    <div
      className={`rounded-2xl border bg-white p-4 transition-colors focus-within:border-[#5566f6]/45 focus-within:bg-white sm:p-5 ${cardBorder}`}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ${tone.bg} ${tone.fg}`}
        >
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <label
              htmlFor={`field-${field.key}`}
              className="text-[14.5px] font-semibold leading-snug text-[#0b1024] sm:text-[15.5px]"
            >
              {field.label}
            </label>
            {"unit" in field && field.unit ? (
              <span className="text-[12.5px] font-medium text-[#9b9fb3]">
                {field.unit}
              </span>
            ) : null}
            {required ? <RequiredPill /> : <OptionalPill />}
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="mt-3">{renderInput(field, value, onChange)}</div>

      {/* Live validation status (number-поля) — text/select/date не
          получают дубль placeholder'а под полем: он уже виден внутри
          input'а сам по себе и второй раз внизу выглядел как мусор. */}
      {numberStatus && numberStatus.hint ? (
        <div
          className={`mt-2 flex items-start gap-1.5 text-[12.5px] leading-snug sm:text-[13px] ${
            numberStatus.status === "error"
              ? "text-rose-700"
              : numberStatus.status === "ok"
                ? "text-emerald-700"
                : "text-[#9b9fb3]"
          }`}
        >
          {numberStatus.status === "error" ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          ) : numberStatus.status === "ok" ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          ) : null}
          <span>{numberStatus.hint}</span>
        </div>
      ) : null}
    </div>
  );
}

function renderInput(
  field: TaskFormField,
  value: unknown,
  onChange: (v: unknown) => void,
) {
  const id = `field-${field.key}`;
  const baseInputClass =
    "h-14 rounded-2xl border-[#dcdfed] px-4 text-[16px] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 focus-visible:border-[#5566f6]";

  switch (field.type) {
    case "text":
      return field.multiline ? (
        <Textarea
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          rows={3}
          className="min-h-[96px] rounded-2xl border-[#dcdfed] px-4 py-3.5 text-[15.5px] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 focus-visible:border-[#5566f6]"
        />
      ) : (
        <Input
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          className={baseInputClass}
        />
      );

    case "number":
      return (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(null);
            const normalized = raw.replace(",", ".");
            const parsed = Number(normalized);
            onChange(Number.isFinite(parsed) ? parsed : raw);
          }}
          min={field.min}
          max={field.max}
          step={field.step}
          className={`${baseInputClass} font-semibold tabular-nums`}
        />
      );

    case "select":
      return (
        <Select
          value={(value as string) ?? ""}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger
            id={id}
            className="h-14 rounded-2xl border-[#dcdfed] px-4 text-[15.5px] focus:ring-4 focus:ring-[#5566f6]/15 focus:border-[#5566f6]"
          >
            <SelectValue placeholder="Выбери из списка" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.code ? (
                  <span className="mr-2 inline-flex min-w-[36px] justify-center rounded-md bg-[#eef1ff] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#3848c7]">
                    {opt.code}
                  </span>
                ) : null}
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={baseInputClass}
        />
      );

    // Нативный time-picker: телефон показывает колёсики часов и минут,
    // «25:99» ввести нельзя. Значение — строка «ЧЧ:ММ».
    case "time":
      return (
        <Input
          id={id}
          type="time"
          step={60}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${baseInputClass} font-semibold tabular-nums`}
        />
      );

    case "photo":
      return (
        <PhotoField
          label={field.label}
          value={(value as string) ?? ""}
          onChange={(next) => onChange(next)}
          required={field.required}
        />
      );

    case "signature":
      return (
        <Input
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Фамилия и инициалы"
          autoComplete="name"
          className={baseInputClass}
        />
      );

    default:
      return null;
  }
}

function RequiredPill({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-rose-700 ${className}`}
    >
      обязательно
    </span>
  );
}

function OptionalPill() {
  return (
    <span className="inline-flex items-center rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[#9b9fb3]">
      по желанию
    </span>
  );
}
