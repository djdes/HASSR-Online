"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { WheelDatePicker } from "@/components/ui/wheel-date-picker";
import { cn } from "@/lib/utils";
import {
  JOURNAL_DIALOG_ERROR_CLASS,
  JOURNAL_DIALOG_FIELD_CLASS,
  JOURNAL_DIALOG_FIELD_CONTROL_CLASS,
  JOURNAL_DIALOG_FIELD_INVALID_CLASS,
  JOURNAL_DIALOG_FIELD_LABEL_CLASS,
  JOURNAL_DIALOG_FIELD_TEXTAREA_CLASS,
  JOURNAL_DIALOG_HINT_CLASS,
} from "@/components/journals/journal-responsive";

/**
 * ЕДИНОЕ поле диалогов «Создание документа» / «Настройки журнала».
 *
 * Эталон lk.haccp-online.ru: рамка на всю ширину, подпись мелким кеглем
 * внутри рамки сверху (floating label, не исчезает при заполнении),
 * значение под ней. Один и тот же контейнер для input / textarea / select /
 * даты — поэтому правый край колонки полей всегда ровный.
 *
 * Используется во ВСЕХ 13 обязательных журналах: create-document-dialog.tsx
 * и пер-журнальные *-documents-client.tsx.
 */
export function FloatingLabelField({
  label,
  htmlFor,
  children,
  className,
  hint,
  error,
  invalid,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  /** Заметная (amber) подсказка под полем. */
  hint?: ReactNode;
  /** Текст ошибки под полем — «Поле не заполнено». */
  error?: ReactNode;
  invalid?: boolean;
}) {
  return (
    <div className={className}>
      <div
        className={cn(
          JOURNAL_DIALOG_FIELD_CLASS,
          (invalid || error) && JOURNAL_DIALOG_FIELD_INVALID_CLASS
        )}
      >
        <label htmlFor={htmlFor} className={JOURNAL_DIALOG_FIELD_LABEL_CLASS}>
          {label}
        </label>
        {children}
      </div>
      {error ? <p className={JOURNAL_DIALOG_ERROR_CLASS}>{error}</p> : null}
      {hint ? <div className={JOURNAL_DIALOG_HINT_CLASS}>{hint}</div> : null}
    </div>
  );
}

/** Текстовое поле с floating label. */
export function FloatingInputField({
  label,
  value,
  onChange,
  placeholder,
  id,
  required,
  disabled,
  className,
  hint,
  error,
  inputMode,
  selectOnFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  hint?: ReactNode;
  error?: ReactNode;
  inputMode?: "text" | "numeric";
  /**
   * Выделить всё содержимое при фокусе. Нужно полям с автоподстановкой
   * (название документа = дата-время): человек кликает, чтобы заменить
   * значение целиком, а не дописать к нему.
   */
  selectOnFocus?: boolean;
}) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <FloatingLabelField
      label={label}
      htmlFor={fieldId}
      className={className}
      hint={hint}
      error={error}
    >
      <Input
        id={fieldId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        inputMode={inputMode}
        onFocus={
          selectOnFocus ? (event) => event.currentTarget.select() : undefined
        }
        className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
      />
    </FloatingLabelField>
  );
}

/** Многострочное поле с floating label (периодичность, примечание). */
export function FloatingTextareaField({
  label,
  value,
  onChange,
  placeholder,
  id,
  disabled,
  maxLength,
  className,
  textareaClassName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
  textareaClassName?: string;
}) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <FloatingLabelField label={label} htmlFor={fieldId} className={className}>
      <Textarea
        id={fieldId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        className={cn(JOURNAL_DIALOG_FIELD_TEXTAREA_CLASS, textareaClassName)}
      />
    </FloatingLabelField>
  );
}

/* ------------------------------------------------------------------ *
 * Дата: русский формат ДД.ММ.ГГГГ + свой попап-календарь
 * ------------------------------------------------------------------ *
 *
 * Нативный <input type="date"> рисуется браузером в локали ОС и на
 * рабочих машинах показывал MM/DD/YYYY — американский формат в русском
 * журнале. Сторонней библиотеки календаря в проекте нет
 * (react-day-picker/shadcn calendar не установлены), поэтому здесь
 * компактный собственный календарь: недели Пн-Вс, русские месяцы,
 * сегодняшний день — кружком, стрелки переключения месяца.
 */

const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Date → «YYYY-MM-DD» по ЛОКАЛЬНОМУ времени (не UTC — иначе сдвиг дня). */
export function toIsoDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** «YYYY-MM-DD» → Date | null. */
export function parseIsoDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «YYYY-MM-DD» → «ДД.ММ.ГГГГ» (пустая строка, если даты нет). */
export function formatRuDateValue(value: string) {
  const date = parseIsoDateValue(value);
  if (!date) return "";
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** «ДД.ММ.ГГГГ» → «YYYY-MM-DD» | null. */
export function parseRuDateValue(value: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return toIsoDateValue(date);
}

/** Сетка месяца: 6 недель по 7 дней, начиная с понедельника. */
function buildMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Пн = 0
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { date, outside: date.getMonth() !== month };
  });
}

/**
 * Поле даты с floating label и русским календарём.
 * `value`/`onChange` работают в ISO «YYYY-MM-DD» — тот же формат, что
 * отправляется в API, поэтому вызывающий код не меняется.
 *
 * `picker="wheel"` — вместо сетки календаря барабан «день | месяц | год»
 * (`WheelDatePicker`): удобнее пальцем и для дат далеко от сегодняшней.
 * Ввод ДД.ММ.ГГГГ с клавиатуры работает в обоих вариантах.
 */
export function DateField({
  label,
  value,
  onChange,
  id,
  disabled,
  className,
  error,
  picker = "calendar",
}: {
  label: string;
  value: string;
  onChange: (isoDate: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  error?: ReactNode;
  picker?: "calendar" | "wheel";
}) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => formatRuDateValue(value));
  const [lastValue, setLastValue] = useState(value);

  // Синхронизация с внешним значением без useEffect: если снаружи
  // значение поменялось (переоткрыли диалог) — перерисовываем текст.
  if (value !== lastValue) {
    setLastValue(value);
    setText(formatRuDateValue(value));
  }

  const selected = useMemo(() => parseIsoDateValue(value), [value]);
  const [viewDate, setViewDate] = useState(() => selected || new Date());
  const todayIso = toIsoDateValue(new Date());

  const grid = useMemo(
    () => buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()),
    [viewDate]
  );

  function commitText(next: string) {
    setText(next);
    const iso = parseRuDateValue(next);
    if (iso) {
      onChange(iso);
      setLastValue(iso);
      const parsed = parseIsoDateValue(iso);
      if (parsed) setViewDate(parsed);
    }
  }

  /** Дата с барабана: сразу в поле и наружу. */
  function commitIso(iso: string) {
    onChange(iso);
    setLastValue(iso);
    setText(formatRuDateValue(iso));
  }

  return (
    <FloatingLabelField
      label={label}
      htmlFor={fieldId}
      className={className}
      error={error}
    >
      <div className="flex items-center gap-2">
        <Input
          id={fieldId}
          value={text}
          onChange={(event) => commitText(event.target.value)}
          onBlur={() => setText(formatRuDateValue(value))}
          placeholder="ДД.ММ.ГГГГ"
          inputMode="numeric"
          disabled={disabled}
          className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
        />
        <Popover
          open={open}
          onOpenChange={(next) => {
            if (next) setViewDate(parseIsoDateValue(value) || new Date());
            setOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={picker === "wheel" ? "Выбрать дату" : "Открыть календарь"}
              className="shrink-0 rounded-lg p-1 text-[#6f7282] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50"
            >
              <CalendarDays className="size-5" />
            </button>
          </PopoverTrigger>
          {picker === "wheel" ? (
            <PopoverContent
              align="end"
              className="w-[300px] rounded-[18px] border-[#ececf4] p-3 shadow-[0_16px_48px_rgba(40,45,86,0.14)]"
            >
              <WheelDatePicker
                value={value || todayIso}
                onChange={commitIso}
                todayKey={todayIso}
                onDone={() => {
                  // Открыли и сразу «Готово» — берём показанную дату.
                  if (!value) commitIso(todayIso);
                  setOpen(false);
                }}
              />
            </PopoverContent>
          ) : (
          <PopoverContent
            align="end"
            className="w-[292px] rounded-[18px] border-[#ececf4] p-3 shadow-[0_16px_48px_rgba(40,45,86,0.14)]"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Предыдущий месяц"
                onClick={() =>
                  setViewDate(
                    new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)
                  )
                }
                className="rounded-lg p-1 text-[#5566f6] transition-colors duration-150 hover:bg-[#f3f4fe]"
              >
                <ChevronLeft className="size-4" />
              </button>
              <div className="text-[14px] font-semibold text-[#0b1024]">
                {MONTHS_RU[viewDate.getMonth()]} {viewDate.getFullYear()}
              </div>
              <button
                type="button"
                aria-label="Следующий месяц"
                onClick={() =>
                  setViewDate(
                    new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)
                  )
                }
                className="rounded-lg p-1 text-[#5566f6] transition-colors duration-150 hover:bg-[#f3f4fe]"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-1">
              {WEEKDAYS_RU.map((day) => (
                <div
                  key={day}
                  className="py-1 text-center text-[12px] font-semibold text-[#0b1024]"
                >
                  {day}
                </div>
              ))}
              {grid.map(({ date, outside }) => {
                const iso = toIsoDateValue(date);
                const isSelected = iso === value;
                const isToday = iso === todayIso;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => {
                      onChange(iso);
                      setLastValue(iso);
                      setText(formatRuDateValue(iso));
                      setOpen(false);
                    }}
                    className={cn(
                      "mx-auto flex size-8 items-center justify-center rounded-full text-[13px] transition-colors duration-150",
                      outside ? "text-[#c3c6d4]" : "text-[#3d4bf3]",
                      !outside && "hover:bg-[#f3f4fe]",
                      isToday && !isSelected && "ring-1 ring-[#5566f6]",
                      isSelected && "bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
                    )}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
          )}
        </Popover>
      </div>
    </FloatingLabelField>
  );
}
