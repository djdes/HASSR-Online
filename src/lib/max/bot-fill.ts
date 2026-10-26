import type { TaskFormField, TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";
import { OFF_NOTE_EQUIPMENT, OFF_NOTE_READING } from "@/lib/tasksflow-adapters/task-form";
import { cleanLabel, isObjectField, metricOf, normRange } from "@/lib/journal-fill-html";
import { TIME_OFFSET_CHIPS, type JournalFillHints } from "@/lib/journal-fill-hints";
import { quickValues } from "@/lib/quick-values";
import { QR_FILL_CORRECTION_PRESETS } from "@/lib/qr-correction-presets";
import type { MaxButton, MaxView } from "./client";
import { wizardPayload, type MaxFillState, type MaxFillValue } from "./bot-state";

/**
 * Заполнение журнала в чате бота MAX: один вопрос — одно сообщение.
 * Поля — форма адаптера журнала (та же, что у QR-форм и TasksFlow); здесь
 * только вопросы, кнопки и разбор ответов. Чистые функции: состояние
 * сохраняет и запись делает `bot.ts`.
 */
export type FillContext = {
  form: TaskFormSchema;
  hints: JournalFillHints;
  /** Недавние наименования организации по ключу поля (память наименований). */
  suggestions: Record<string, string[]>;
  /** Сейчас по часовому поясу организации. */
  stamp: { date: string; time: string };
  todayKey: string;
  employeeName: string;
  /** «ЧЧ:ММ» n минут назад по часовому поясу организации. */
  timeAgo: (minutes: number) => string;
};

export type FillInput =
  | { kind: "pick"; index: number }
  | { kind: "text"; text: string }
  | { kind: "off" }
  | { kind: "back" }
  | { kind: "edit" }
  | { kind: "editField"; index: number };

export type FillTransition = { ok: true; state: MaxFillState } | { ok: false; error: string };

const cb = (text: string, payload: string): MaxButton => ({ type: "callback", text: text.length > 64 ? `${text.slice(0, 63)}…` : text, payload });
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Подпись поля для вопроса: у показаний объекта — «Кухня — температура». */
export function fieldTitle(field: TaskFormField): string {
  if (field.type === "number" && isObjectField(field)) {
    const { metric, base, slot } = metricOf(field.label);
    const what = metric === "замер" && slot ? slot : metric === "влажность" || field.unit === "%" ? "влажность" : "температура";
    return `${base} — ${what}`;
  }
  return cleanLabel(field.label) || field.label;
}

/** Норма показания: из подписи адаптера («· норма 2…6») или `normalRange`; пределы ввода нормой не считаются. */
function normOf(field: TaskFormField): { min: number | null; max: number | null } | null {
  if (field.type !== "number") return null;
  if (/норма/i.test(field.label)) return normRange(field);
  if (field.normalRange) return { min: field.normalRange.min ?? null, max: field.normalRange.max ?? null };
  return null;
}

function normText(field: TaskFormField): string | null {
  const norm = normOf(field);
  if (!norm || (norm.min == null && norm.max == null)) return null;
  const unit = field.type === "number" && field.unit ? ` ${field.unit}` : "";
  if (norm.min != null && norm.max != null) return `${norm.min}…${norm.max}${unit}`;
  return norm.min != null ? `не ниже ${norm.min}${unit}` : `не выше ${norm.max}${unit}`;
}

/** Показание вне нормы — нужен комментарий «что сделали». */
export function isOutOfNorm(field: TaskFormField, value: MaxFillValue | undefined): boolean {
  const norm = normOf(field);
  if (!norm || typeof value !== "number") return false;
  return (norm.min != null && value < norm.min) || (norm.max != null && value > norm.max);
}

function offNote(field: TaskFormField): string {
  return field.type === "number" && (metricOf(field.label).metric === "влажность" || field.unit === "%") ? OFF_NOTE_READING : OFF_NOTE_EQUIPMENT;
}

/** Значение по умолчанию: адаптер (уже записано сегодня), затем подсказки журнала. */
export function defaultFor(field: TaskFormField, ctx: Pick<FillContext, "hints" | "timeAgo">): MaxFillValue | undefined {
  if ("defaultValue" in field && field.defaultValue !== undefined && field.defaultValue !== "") {
    if (field.type === "number" && typeof field.defaultValue === "string") {
      const parsed = Number(field.defaultValue.replace(",", "."));
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return field.defaultValue;
  }
  if (field.type === "time") {
    const ago = ctx.hints.timeDefaults?.[field.key];
    return typeof ago === "number" ? ctx.timeAgo(ago) : undefined;
  }
  return ctx.hints.defaults?.[field.key];
}

function answered(state: MaxFillState, field: TaskFormField): MaxFillValue | undefined {
  return Object.prototype.hasOwnProperty.call(state.values, field.key) ? state.values[field.key] : undefined;
}

function isoToRu(value: string): string {
  const match = DATE_RE.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function shiftDay(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function selectLabel(field: Extract<TaskFormField, { type: "select" }>, value: string, hints: JournalFillHints): string {
  return hints.segmented?.[field.key]?.[value] ?? field.options.find((option) => option.value === value)?.label ?? value;
}

/** Значение для экрана проверки. */
export function formatFillValue(field: TaskFormField, state: MaxFillState, hints: JournalFillHints): string {
  if (state.off.includes(field.key)) return offNote(field);
  const value = answered(state, field);
  if (value === undefined || value === null || value === "") return "—";
  if (field.type === "boolean") return value === true ? "Да" : "Нет";
  if (field.type === "select") return selectLabel(field, String(value), hints);
  if (field.type === "date") return isoToRu(String(value));
  if (field.type === "number") return `${String(value).replace(".", ",")}${field.unit ? ` ${field.unit}` : ""}${isOutOfNorm(field, value) ? " ⚠️ вне нормы" : ""}`;
  return String(value);
}

/** Разбор ответа сообщением для поля. */
export function parseFieldText(
  field: TaskFormField,
  raw: string,
  ctx: Pick<FillContext, "todayKey" | "stamp" | "employeeName" | "hints">
): { ok: true; value: MaxFillValue } | { ok: false; error: string } {
  const text = raw.trim();
  const lower = text.toLowerCase();
  switch (field.type) {
    case "number": {
      const normalized = text.replace(/\s+/g, "").replace(",", ".").replace(/[°℃c%]+$/i, "");
      const value = /^[-+−]?\d+(\.\d+)?$/.test(normalized) ? Number(normalized.replace("−", "-")) : NaN;
      if (!Number.isFinite(value)) return { ok: false, error: "Нужно число — например, 4,5. Напишите его ещё раз." };
      if (typeof field.min === "number" && value < field.min) return { ok: false, error: `Число не может быть меньше ${field.min}. Проверьте показание.` };
      if (typeof field.max === "number" && value > field.max) return { ok: false, error: `Число не может быть больше ${field.max}. Проверьте показание.` };
      return { ok: true, value };
    }
    case "boolean": {
      if (["да", "yes", "+", "1", "есть", "ок", "ok"].includes(lower)) return { ok: true, value: true };
      if (["нет", "no", "-", "0"].includes(lower)) return { ok: true, value: false };
      return { ok: false, error: "Ответьте кнопкой «Да» или «Нет»." };
    }
    case "select": {
      const index = /^\d{1,2}$/.test(text) ? Number(text) - 1 : -1;
      const option =
        field.options[index] ??
        field.options.find((item) => item.label.toLowerCase() === lower || item.code?.toLowerCase() === lower || selectLabel(field, item.value, ctx.hints).toLowerCase() === lower);
      return option ? { ok: true, value: option.value } : { ok: false, error: "Выберите вариант кнопкой." };
    }
    case "date": {
      if (lower === "сегодня") return { ok: true, value: ctx.todayKey };
      if (lower === "вчера") return { ok: true, value: shiftDay(ctx.todayKey, -1) };
      const ru = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(text);
      const iso = DATE_RE.exec(text);
      const year = ru ? (ru[3] ? (ru[3].length === 2 ? `20${ru[3]}` : ru[3]) : ctx.todayKey.slice(0, 4)) : iso?.[1];
      const month = ru ? ru[2].padStart(2, "0") : iso?.[2];
      const day = ru ? ru[1].padStart(2, "0") : iso?.[3];
      const key = year && month && day ? `${year}-${month}-${day}` : "";
      const check = key ? new Date(`${key}T00:00:00.000Z`) : null;
      if (!check || Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== key) return { ok: false, error: "Напишите дату так: 26.10.2026 — или нажмите «Сегодня»." };
      return { ok: true, value: key };
    }
    case "time": {
      if (lower === "сейчас") return { ok: true, value: ctx.stamp.time };
      const match = /^(\d{1,2})(?:[:.\-\s]?(\d{2}))?$/.exec(text);
      const hours = match ? Number(match[1]) : NaN;
      const minutes = match ? Number(match[2] ?? "0") : NaN;
      if (!match || hours > 23 || minutes > 59) return { ok: false, error: "Напишите время так: 14:30 — или нажмите «Сейчас»." };
      return { ok: true, value: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}` };
    }
    case "photo":
      return { ok: false, error: "Фото в чате бота пока не принимаются." };
    case "signature":
    case "text": {
      if (!text) return { ok: false, error: "Напишите ответ текстом." };
      const max = field.type === "text" && field.maxLength ? field.maxLength : 500;
      if (text.length > max) return { ok: false, error: `Слишком длинно: до ${max} символов.` };
      return { ok: true, value: text };
    }
  }
}

function header(state: MaxFillState): string[] {
  const lines = [`✍️ ${state.name}`];
  // «Гигиенический журнал — 16–31 октября» под заголовком журнала — только период.
  const title = state.documentTitle?.startsWith(state.name) ? state.documentTitle.slice(state.name.length).replace(/^[\s—–-]+/, "") : state.documentTitle;
  const where = [title, state.rowLabel].filter(Boolean).join(" · ");
  if (where) lines.push(where);
  return lines;
}

function navRow(state: MaxFillState, back: boolean): MaxButton[] {
  const row: MaxButton[] = [];
  if (state.editing) row.push(cb("‹ К проверке", wizardPayload(state, "back")));
  else if (back) row.push(cb("‹ Назад", wizardPayload(state, "back")));
  row.push(cb("✖ Отменить", wizardPayload(state, "cancel")));
  return row;
}

function pickRows(state: MaxFillState, labels: string[]): MaxButton[][] {
  const buttons = labels.map((label, index) => cb(label, wizardPayload(state, "p", index)));
  const short = labels.every((label) => label.length <= 16);
  const perRow = short ? (labels.length === 4 ? 2 : 3) : 1;
  const rows: MaxButton[][] = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow));
  return rows;
}

function instructions(form: TaskFormSchema): string | null {
  const steps = (form.pipeline ?? []).map((step) => step.title.trim()).filter(Boolean);
  if (steps.length === 0) return null;
  const shown = steps.slice(0, 8).map((title, index) => `${index + 1}. ${title.slice(0, 140)}`);
  if (steps.length > 8) shown.push(`…и ещё ${steps.length - 8}`);
  return `Что сделать:\n${shown.join("\n")}`;
}

/** Экран текущего шага и готовые значения его кнопок (`picks` в состоянии). */
export function renderFill(state: MaxFillState, ctx: FillContext): { state: MaxFillState; view: MaxView } {
  const lines = header(state);
  if (state.notice) lines.push("", `⚠️ ${state.notice}`);
  const fields = ctx.form.fields;

  if (state.phase === "document" || state.phase === "row") {
    lines.push("", state.phase === "document" ? "Выберите документ:" : "Выберите строку журнала:");
    const buttons = state.choices.slice(0, 28).map((choice, index) => [cb(choice.label, wizardPayload(state, state.phase === "document" ? "doc" : "row", index))]);
    return { state: { ...state, picks: [] }, view: { text: lines.join("\n"), buttons: [...buttons, navRow(state, false)] } };
  }

  if (state.phase === "confirm" || fields.length === 0) {
    const guide = instructions(ctx.form);
    if (fields.length === 0 && guide) lines.push("", guide);
    if (fields.length > 0) {
      lines.push("", "Проверьте запись:");
      for (const field of fields) lines.push(`• ${fieldTitle(field)}: ${formatFillValue(field, state, ctx.hints)}`);
      if (state.correction && needsCorrection(state, fields)) lines.push(`• Что сделали: ${state.correction}`);
    }
    lines.push("", `Запись попадёт в журнал за ${ctx.stamp.date}.`);
    const submit = ctx.form.submitLabel ?? (fields.length ? "Сохранить" : "Отметить выполнение");
    const buttons: MaxButton[][] = [[cb(`✅ ${submit}`, wizardPayload(state, "save"))]];
    const tail: MaxButton[] = [];
    if (fields.length > 0) tail.push(cb("✏️ Изменить", wizardPayload(state, "edit")));
    tail.push(cb("✖ Отменить", wizardPayload(state, "cancel")));
    buttons.push(tail);
    return { state: { ...state, phase: "confirm", picks: [] }, view: { text: lines.join("\n"), buttons } };
  }

  if (state.phase === "edit") {
    lines.push("", "Что исправить? Выберите поле:");
    const buttons = fields.slice(0, 28).map((field, index) => [cb(`${fieldTitle(field)}: ${formatFillValue(field, state, ctx.hints)}`, wizardPayload(state, "ef", index))]);
    buttons.push([cb("‹ К проверке", wizardPayload(state, "back"))]);
    return { state: { ...state, picks: [] }, view: { text: lines.join("\n"), buttons } };
  }

  const field = fields[Math.min(state.step, fields.length - 1)];
  if (state.phase === "correction") {
    lines.push("", `${fieldTitle(field)}: ${formatFillValue(field, state, ctx.hints)}`, `Норма: ${normText(field) ?? "—"}.`, "", "Что вы сделали? Выберите ответ или напишите свой — он попадёт в журнал рядом с записью.");
    const picks = [...QR_FILL_CORRECTION_PRESETS];
    return { state: { ...state, picks }, view: { text: lines.join("\n"), buttons: [...pickRows(state, picks), navRow(state, true)] } };
  }

  if (state.step === 0 && !state.editing) {
    const guide = instructions(ctx.form);
    if (guide) lines.push("", guide);
  }
  lines.push("", `Шаг ${state.step + 1} из ${fields.length}`, `${fieldTitle(field)}${"required" in field && field.required ? "" : field.type === "boolean" ? "" : " (необязательно)"}`);
  const norm = normText(field);
  if (norm) lines.push(`Норма: ${norm}`);

  const current = answered(state, field);
  const fallback = current === undefined ? defaultFor(field, ctx) : current;
  const picks: MaxFillValue[] = [];
  const labels: string[] = [];
  const add = (value: MaxFillValue, label: string) => {
    if (picks.some((existing) => existing === value) || picks.length >= 12) return;
    picks.push(value);
    labels.push(label);
  };
  const keep = (value: MaxFillValue | undefined, label: (value: MaxFillValue) => string) => {
    if (value !== undefined && value !== null && value !== "" && !state.off.includes(field.key)) add(value, `Оставить: ${label(value)}`.slice(0, 60));
  };
  const extra: MaxButton[][] = [];
  let hint: string;

  switch (field.type) {
    case "boolean":
      add(true, `✅ Да${current === true ? " ✓" : ""}`);
      add(false, `❌ Нет${current === false ? " ✓" : ""}`);
      hint = "Ответьте кнопкой.";
      break;
    case "select":
      for (const option of field.options.slice(0, 12)) add(option.value, `${selectLabel(field, option.value, ctx.hints)}${fallback === option.value ? " ✓" : ""}`);
      hint = "Выберите вариант кнопкой.";
      break;
    case "number": {
      keep(fallback, (value) => String(value).replace(".", ","));
      const range = normOf(field);
      if (range) for (const quick of quickValues(range.min, range.max)) add(Number(quick), quick.replace(".", ","));
      if (isObjectField(field)) extra.push([cb(`${state.off.includes(field.key) ? "✓ " : ""}${offNote(field)}`, wizardPayload(state, "off"))]);
      hint = `Напишите число в ответ — например, 4,5${field.unit ? ` (${field.unit})` : ""}.`;
      if (isObjectField(field)) hint += ` Если оборудование выключено или показание снять нельзя — нажмите «${offNote(field)}».`;
      break;
    }
    case "text": {
      keep(fallback, (value) => String(value));
      for (const choice of ctx.hints.choices?.[field.key] ?? []) add(choice, choice.slice(0, 60));
      for (const name of (ctx.suggestions[field.key] ?? []).slice(0, 6)) add(name, name.slice(0, 60));
      hint = picks.length ? "Выберите кнопкой или напишите ответ сообщением." : "Напишите ответ сообщением.";
      break;
    }
    case "date":
      keep(fallback, (value) => isoToRu(String(value)));
      add(ctx.todayKey, "Сегодня");
      add(shiftDay(ctx.todayKey, -1), "Вчера");
      hint = "Нажмите кнопку или напишите дату: 26.10.2026.";
      break;
    case "time": {
      const chips: Array<[string, string]> = [[ctx.stamp.time, `Сейчас (${ctx.stamp.time})`], ...TIME_OFFSET_CHIPS.map((chip): [string, string] => [ctx.timeAgo(chip.minutes), chip.label])];
      // Значение по умолчанию совпало с кнопкой — отмечаем её, а не дублируем «Оставить».
      if (!chips.some(([value]) => value === fallback)) keep(fallback, (value) => String(value));
      for (const [value, label] of chips) add(value, `${label}${value === fallback ? " ✓" : ""}`);
      hint = "Нажмите кнопку или напишите время: 14:30.";
      break;
    }
    case "signature":
      if (ctx.employeeName) add(ctx.employeeName, `✍️ Подписать: ${ctx.employeeName}`.slice(0, 60));
      hint = "Нажмите «Подписать» — в журнал попадёт ваше ФИО. Или напишите ФИО сообщением.";
      break;
    case "photo":
      hint = field.required
        ? "Фото в чате бота пока не принимаются. Этот журнал заполните по QR-коду журнала."
        : "Фото в чате бота пока не принимаются — пропустите этот шаг.";
      break;
  }
  if (!("required" in field && field.required) && field.type !== "boolean" && field.type !== "select") add(null, "Пропустить");
  lines.push(hint);
  const buttons = [...pickRows(state, labels), ...extra, navRow(state, state.step > 0)];
  return { state: { ...state, phase: "field", picks }, view: { text: lines.join("\n"), buttons } };
}

function advance(state: MaxFillState, fields: TaskFormField[]): MaxFillState {
  if (state.editing || state.step + 1 >= fields.length) return { ...state, phase: "confirm", editing: false };
  return { ...state, phase: "field", step: state.step + 1 };
}

function applyValue(state: MaxFillState, field: TaskFormField, value: MaxFillValue, fields: TaskFormField[]): MaxFillState {
  const next: MaxFillState = { ...state, values: { ...state.values, [field.key]: value }, off: state.off.filter((key) => key !== field.key) };
  // «Что сделали» спрашиваем один раз — при первом показании вне нормы.
  if (isOutOfNorm(field, value) && !state.correction) return { ...next, phase: "correction" };
  return advance(next, fields);
}

/** Есть показание вне нормы — комментарий «что сделали» уходит в журнал. */
export function needsCorrection(state: MaxFillState, fields: TaskFormField[]): boolean {
  return fields.some((field) => !state.off.includes(field.key) && isOutOfNorm(field, answered(state, field)));
}

/** Ответ на текущий шаг: новое состояние или текст ошибки (шаг остаётся). */
export function answerFill(state: MaxFillState, ctx: FillContext, input: FillInput): FillTransition {
  const fields = ctx.form.fields;
  const base: MaxFillState = { ...state, notice: null };
  const field = fields[Math.min(state.step, Math.max(0, fields.length - 1))];

  if (input.kind === "back") {
    if (state.phase === "edit") return { ok: true, state: { ...base, phase: "confirm" } };
    if (state.phase === "correction") return { ok: true, state: { ...base, phase: "field" } };
    if (state.phase === "confirm") return { ok: true, state: fields.length ? { ...base, phase: "field", step: fields.length - 1 } : base };
    if (state.phase === "field" && state.editing) return { ok: true, state: { ...base, phase: "confirm", editing: false } };
    if (state.phase === "field" && state.step > 0) return { ok: true, state: { ...base, step: state.step - 1 } };
    return { ok: true, state: base };
  }
  if (input.kind === "edit") {
    return state.phase === "confirm" && fields.length ? { ok: true, state: { ...base, phase: "edit" } } : { ok: false, error: "Сейчас нечего исправлять." };
  }
  if (input.kind === "editField") {
    if (state.phase !== "edit" || !fields[input.index]) return { ok: false, error: "Выберите поле из списка." };
    return { ok: true, state: { ...base, phase: "field", step: input.index, editing: true } };
  }

  if (state.phase === "correction") {
    const text = input.kind === "pick" ? state.picks[input.index] : input.kind === "text" ? input.text.trim() : null;
    if (typeof text !== "string" || !text) return { ok: false, error: "Выберите ответ кнопкой или напишите, что сделали." };
    return { ok: true, state: advance({ ...base, correction: text.slice(0, 500) }, fields) };
  }
  if (state.phase !== "field" || !field) return { ok: false, error: "Этот шаг уже пройден. Продолжайте с последнего сообщения." };

  if (input.kind === "off") {
    if (!(field.type === "number" && isObjectField(field))) return { ok: false, error: "Для этого поля такой отметки нет." };
    const values = { ...base.values };
    delete values[field.key];
    return { ok: true, state: advance({ ...base, values, off: [...base.off.filter((key) => key !== field.key), field.key] }, fields) };
  }
  if (input.kind === "pick") {
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= state.picks.length) return { ok: false, error: "Кнопка устарела — выберите заново." };
    return { ok: true, state: applyValue(base, field, state.picks[input.index], fields) };
  }
  const parsed = parseFieldText(field, input.text, ctx);
  if (!parsed.ok) return parsed;
  return { ok: true, state: applyValue(base, field, parsed.value, fields) };
}

/** Значения для ядра записи: только поля формы, без отмеченных «Выключено». */
export function fillSubmission(state: MaxFillState, form: TaskFormSchema): { values: Record<string, MaxFillValue>; off: string[]; correction: string | null } {
  const keys = new Set(form.fields.map((field) => field.key));
  const values: Record<string, MaxFillValue> = {};
  for (const [key, value] of Object.entries(state.values)) if (keys.has(key) && !state.off.includes(key)) values[key] = value;
  return { values, off: state.off.filter((key) => keys.has(key)), correction: needsCorrection(state, form.fields) ? state.correction : null };
}
