"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronLeft,
  Circle,
  ClipboardList,
  KeyRound,
  QrCode,
  Search,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SuggestInput } from "@/components/journals/suggest-input";
import { TaskFillField } from "@/components/task-fill/task-fill-field";
import { DeviationCorrection } from "@/components/qr-fill/deviation-correction";
import {
  TIME_OFFSET_CHIPS,
  journalFillHints,
  timeMinutesAgo,
  type JournalFillHints,
} from "@/lib/journal-fill-hints";
import { mergeSuggestions, normalizeSuggestionMeta, suggestionKey, type NameSuggestionMeta } from "@/lib/name-suggestions";
import type { TaskFormField, TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

/** Один ключ на все QR-страницы: имя, выбранное у холодильника, помнится и у журналов. */
export const QR_FILL_EMPLOYEE_KEY = "wesetup.qr-fill.employeeId";

type Employee = { id: string; name: string; positionTitle: string | null };
type Doc = { id: string; title: string; building: string | null; dateFrom: string; dateTo: string };
type Row = { rowKey: string; label: string; sublabel?: string; mine: boolean };
type Mode = "public" | "pin" | "auth";

type Props = {
  token: string;
  orgId: string;
  orgName: string;
  code: string;
  journalName: string;
  isHub: boolean;
  hubJournals: Array<{ code: string; name: string }>;
  mode: Mode;
  sessionEmployee: Employee & { canPickOthers: boolean } | null;
  documents: Doc[];
  employees: Employee[];
  todayKey: string;
  journalDisabled: boolean;
};

type FormPayload = {
  rows: Row[];
  rowKey: string | null;
  form: TaskFormSchema | null;
  taskScope?: string;
  hints?: JournalFillHints;
};

const CORRECTION_KEY_RE = /(correct|comment|note|remark|measure|action|коммент|действ)/i;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* приватный режим */
  }
}

function initialValues(form: TaskFormSchema, hints: JournalFillHints, employeeName: string): Record<string, unknown> {
  const init: Record<string, unknown> = {};
  const todayISO = new Date().toISOString().slice(0, 10);
  for (const field of form.fields) {
    const dv = (field as { defaultValue?: unknown }).defaultValue;
    const hinted = hints.defaults?.[field.key];
    if (field.type === "boolean") init[field.key] = typeof dv === "boolean" ? dv : typeof hinted === "boolean" ? hinted : false;
    else if (field.type === "number") init[field.key] = typeof dv === "number" ? dv : typeof dv === "string" && dv.trim() ? Number(dv) : hinted ?? "";
    else if (field.type === "date") init[field.key] = typeof dv === "string" && dv.trim() ? dv : todayISO;
    else if (field.type === "time") {
      const offset = hints.timeDefaults?.[field.key] ?? 0;
      init[field.key] = typeof dv === "string" && dv.trim() ? dv : timeMinutesAgo(offset);
    } else if (field.type === "select") init[field.key] = typeof dv === "string" ? dv : typeof hinted === "string" ? hinted : "";
    else {
      const looksLikeName = /(^|[^а-я])(фио|подпис|исполнител|ответствен|повар|работник|имя\b)/i.test(`${field.key} ${field.label}`.toLowerCase());
      init[field.key] = typeof dv === "string" || typeof dv === "number" ? String(dv) : typeof hinted === "string" ? hinted : looksLikeName ? employeeName : "";
    }
  }
  return init;
}

function numberOutOfRange(field: TaskFormField, value: unknown): boolean {
  if (field.type !== "number") return false;
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n) || String(value ?? "").trim() === "") return false;
  if (field.min != null && n < field.min) return true;
  if (field.max != null && n > field.max) return true;
  return false;
}

export function JournalFillClient(props: Props) {
  const { token, orgId, code, mode } = props;
  const hints = useMemo(() => journalFillHints(code), [code]);
  const openedAt = useRef(Date.now());

  // ---- выбор документа / сотрудника
  const docKey = `wesetup.journal-fill.doc:${orgId}:${code}`;
  const [documentId, setDocumentId] = useState<string | null>(props.documents.length === 1 ? props.documents[0].id : null);
  const [employeeId, setEmployeeId] = useState<string | null>(
    mode === "auth" && props.sessionEmployee && !props.sessionEmployee.canPickOthers ? props.sessionEmployee.id : null
  );
  const [employeeConfirmed, setEmployeeConfirmed] = useState(mode === "auth" && !!props.sessionEmployee && !props.sessionEmployee.canPickOthers);
  const [pin, setPin] = useState("");
  const [query, setQuery] = useState("");
  /** Кто выбирался на этом телефоне — ставим первым; читается после mount (SSR-разметка одинакова). */
  const [rememberedEmployeeId, setRememberedEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId && props.documents.length > 1) {
      const remembered = readStorage(docKey);
      if (remembered && props.documents.some((doc) => doc.id === remembered)) setDocumentId(remembered);
    }
    if (!employeeId && mode !== "auth") {
      const remembered = readStorage(QR_FILL_EMPLOYEE_KEY);
      if (remembered && props.employees.some((employee) => employee.id === remembered)) {
        setEmployeeId(remembered);
        setRememberedEmployeeId(remembered);
      }
    }
    if (mode === "auth" && props.sessionEmployee && !employeeId) setEmployeeId(props.sessionEmployee.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const employee = props.employees.find((item) => item.id === employeeId) ?? null;

  // ---- строки / форма
  const [payload, setPayload] = useState<FormPayload | null>(null);
  const [rowKey, setRowKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId || !employeeId || !employeeConfirmed || props.isHub) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const search = new URLSearchParams({ token, documentId, employeeId });
    if (rowKey) search.set("rowKey", rowKey);
    fetch(`/api/journal-fill/${orgId}/${code}?${search.toString()}`)
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error ?? "Не удалось загрузить форму");
        if (!cancelled) setPayload(data as FormPayload);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить форму");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, orgId, code, documentId, employeeId, employeeConfirmed, rowKey, props.isHub]);

  const form = payload?.form ?? null;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [correction, setCorrection] = useState("");
  const [tempAuto, setTempAuto] = useState(false);
  const formSeeded = useRef<string | null>(null);
  useEffect(() => {
    if (!form || !employee) return;
    const seedKey = `${documentId}:${payload?.rowKey}`;
    if (formSeeded.current === seedKey) return;
    formSeeded.current = seedKey;
    setValues(initialValues(form, payload?.hints ?? hints, employee.name));
    setCorrection("");
    setTempAuto(false);
  }, [form, employee, documentId, payload?.rowKey, payload?.hints, hints]);

  // ---- подсказки наименований (по областям из карты)
  const [suggestions, setSuggestions] = useState<Record<string, { values: string[]; meta: Record<string, NameSuggestionMeta> }>>({});
  useEffect(() => {
    const scopes = Array.from(new Set(Object.values(hints.nameFields ?? {})));
    scopes.forEach((scope) => {
      fetch(`/api/journal-fill/${orgId}/${code}?token=${encodeURIComponent(token)}&scope=${scope}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!data || !Array.isArray(data.values)) return;
          const meta: Record<string, NameSuggestionMeta> = {};
          for (const [key, value] of Object.entries((data.meta ?? {}) as Record<string, unknown>)) {
            const normalized = normalizeSuggestionMeta(value);
            if (normalized) meta[key] = normalized;
          }
          setSuggestions((current) => ({ ...current, [scope]: { values: data.values as string[], meta } }));
        })
        .catch(() => {});
    });
  }, [hints.nameFields, orgId, code, token]);

  function setFieldValue(key: string, next: unknown) {
    setValues((current) => ({ ...current, [key]: next }));
    if (hints.tempField && key === hints.tempField.tempKey) setTempAuto(false);
    if (hints.tempField && key === hints.tempField.nameKey && typeof next === "string") {
      const scope = hints.nameFields?.[key];
      const meta = scope ? suggestions[scope]?.meta[suggestionKey(next)] : null;
      const tempField = form?.fields.find((field) => field.key === hints.tempField!.tempKey);
      if (tempField && meta?.productTemp) {
        setValues((current) => {
          const currentTemp = String(current[hints.tempField!.tempKey] ?? "").trim();
          if (currentTemp !== "" && !tempAuto) return current;
          return { ...current, [hints.tempField!.tempKey]: meta.productTemp };
        });
        setTempAuto(true);
      }
    }
  }

  // ---- отклонение
  const outOfRangeFields = useMemo(() => (form ? form.fields.filter((field) => numberOutOfRange(field, values[field.key])) : []), [form, values]);
  const correctionField = useMemo(
    () => form?.fields.find((field) => field.type === "text" && CORRECTION_KEY_RE.test(`${field.key} ${field.label}`)) ?? null,
    [form]
  );
  const correctionMissing = outOfRangeFields.length > 0 && correctionField !== null && correction.trim() === "";

  // ---- отправка
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ mode: "appended" | "updated"; documentTitle: string; employeeName: string } | null>(null);
  const [daily, setDaily] = useState<Array<{ code: string; name: string; filled: boolean }> | null>(null);

  async function submit() {
    if (!documentId || !employeeId || !payload?.rowKey || !form) return;
    if (correctionMissing) {
      setSubmitError("Значение вне нормы — напишите, что вы сделали");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const outgoing = { ...values };
    if (correctionField && correction.trim()) {
      const existing = String(outgoing[correctionField.key] ?? "").trim();
      outgoing[correctionField.key] = existing ? `${existing}. ${correction.trim()}` : correction.trim();
    }
    try {
      const response = await fetch(`/api/journal-fill/${orgId}/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, documentId, employeeId, rowKey: payload.rowKey, values: outgoing, pin: mode === "pin" ? pin : undefined, openedAt: openedAt.current }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Не удалось сохранить");
      writeStorage(QR_FILL_EMPLOYEE_KEY, employeeId);
      if (props.documents.length > 1) writeStorage(docKey, documentId);
      // Сохранённые наименования сразу в чипы «недавних» (как сделает сервер) — для «Добавить ещё».
      const savedNames = Object.entries(hints.nameFields ?? {})
        .map(([key, scope]) => ({ scope, value: String(outgoing[key] ?? "").trim() }))
        .filter((item) => item.value !== "");
      if (savedNames.length > 0) {
        const temp = hints.tempField ? String(outgoing[hints.tempField.tempKey] ?? "").trim() : "";
        setSuggestions((current) => {
          const next = { ...current };
          for (const item of savedNames) {
            const bucket = next[item.scope] ?? { values: [], meta: {} };
            const values = [item.value, ...bucket.values.filter((v) => suggestionKey(v) !== suggestionKey(item.value))];
            const meta = { ...bucket.meta };
            if (hints.tempField && hints.nameFields?.[hints.tempField.nameKey] === item.scope && temp) meta[suggestionKey(item.value)] = { productTemp: temp };
            next[item.scope] = { values, meta };
          }
          return next;
        });
      }
      setDone(data);
      fetch(`/api/journal-fill/${orgId}/${code}?token=${encodeURIComponent(token)}&daily=1&employeeId=${employeeId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((res) => setDaily(res?.daily ?? null))
        .catch(() => setDaily(null));
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setSubmitting(false);
    }
  }

  function addAnother() {
    if (!form || !employee) return;
    const fresh = initialValues(form, payload?.hints ?? hints, employee.name);
    // Время и решения оставляем, наименование/температуру — с чистого листа.
    const keep = { ...values };
    for (const key of Object.keys(hints.nameFields ?? {})) delete keep[key];
    if (hints.tempField) delete keep[hints.tempField.tempKey];
    setValues({ ...fresh, ...keep });
    setCorrection("");
    setTempAuto(false);
    setDone(null);
    setDaily(null);
    openedAt.current = Date.now();
  }

  // ---- вспомогательное
  const hubHref = (journalCode: string) => `/journal-fill/${orgId}/${journalCode}?token=${encodeURIComponent(token)}`;
  const filteredEmployees = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? props.employees.filter((item) => `${item.name} ${item.positionTitle ?? ""}`.toLowerCase().includes(q)) : props.employees;
    const remembered = rememberedEmployeeId;
    if (!remembered) return list;
    return [...list].sort((a, b) => (a.id === remembered ? -1 : b.id === remembered ? 1 : 0));
  }, [props.employees, query, rememberedEmployeeId]);

  const shell = (children: React.ReactNode, subtitle?: string) => (
    <main className="min-h-screen bg-[#fafbff]">
      <section className="relative overflow-hidden bg-[#0b1024] text-white">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
          <div className="absolute -bottom-40 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
        </div>
        <div className="relative z-10 mx-auto max-w-xl px-5 py-8">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
              <QrCode className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/70">{props.orgName}</div>
              <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{props.journalName}</h1>
              {subtitle ? <p className="mt-2 text-[14px] text-white/75">{subtitle}</p> : null}
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-xl px-5 py-6">{children}</section>
    </main>
  );

  const card = "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
  const bigButton = "flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl border border-[#dcdfed] bg-white px-4 text-left text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";

  // ---- хаб
  if (props.isHub) {
    return shell(
      <div className={card}>
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Что заполнить</div>
        {props.hubJournals.length === 0 ? (
          <p className="text-[14px] text-[#6f7282]">На сегодня нет активных журналов. Попросите управляющего создать документ.</p>
        ) : (
          <div className="space-y-2">
            {props.hubJournals.map((journal) => (
              <a key={journal.code} href={hubHref(journal.code)} className={bigButton}>
                <span className="flex items-center gap-3"><ClipboardList className="size-5 text-[#5566f6]" />{journal.name}</span>
                <ArrowRight className="size-4 text-[#9b9fb3]" />
              </a>
            ))}
          </div>
        )}
      </div>,
      "Выберите журнал — дальше два-три касания."
    );
  }

  if (props.journalDisabled) {
    return shell(<div className={card}><p className="text-[14px] text-[#6f7282]">Этот журнал отключён в организации.</p></div>);
  }

  if (props.documents.length === 0) {
    return shell(
      <div className="flex gap-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4 text-[14px] leading-relaxed text-[#7a4a00]">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <span>На сегодня нет активного документа этого журнала. Попросите управляющего создать его — после этого записи по QR заработают.</span>
      </div>
    );
  }

  // ---- шаг: документ
  if (!documentId) {
    return shell(
      <div className={card}>
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Какой документ</div>
        <div className="space-y-2">
          {props.documents.map((doc) => (
            <button key={doc.id} type="button" className={bigButton} onClick={() => setDocumentId(doc.id)}>
              <span className="min-w-0">
                <span className="block truncate">{doc.building ?? doc.title}</span>
                <span className="block text-[12.5px] font-normal text-[#6f7282]">{doc.building ? doc.title : `${doc.dateFrom} — ${doc.dateTo}`}</span>
              </span>
              <Building2 className="size-4 shrink-0 text-[#9b9fb3]" />
            </button>
          ))}
        </div>
      </div>,
      "Несколько точек — выберите свою. Выбор запомнится."
    );
  }

  // ---- шаг: сотрудник (+PIN)
  if (!employeeConfirmed || !employee) {
    return shell(
      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Кто заполняет</div>
          {props.documents.length > 1 ? (
            <button type="button" onClick={() => setDocumentId(null)} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#3848c7]"><ChevronLeft className="size-3.5" />Документ</button>
          ) : null}
        </div>
        {props.employees.length > 12 ? (
          <label className="mb-3 flex h-12 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 focus-within:border-[#5566f6] focus-within:ring-4 focus-within:ring-[#5566f6]/15">
            <Search className="size-4 shrink-0 text-[#9b9fb3]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти по фамилии" className="h-full w-full bg-transparent text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none" />
          </label>
        ) : null}
        <div className="space-y-2">
          {filteredEmployees.map((item) => {
            const active = item.id === employeeId;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setEmployeeId(item.id)}
                className={`${bigButton} ${active ? "border-[#5566f6] bg-[#eef1ff]" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <UserRound className={`size-5 shrink-0 ${active ? "text-[#3848c7]" : "text-[#9b9fb3]"}`} />
                  <span className="min-w-0">
                    <span className="block truncate">{item.name}</span>
                    {item.positionTitle ? <span className="block text-[12.5px] font-normal text-[#6f7282]">{item.positionTitle}</span> : null}
                  </span>
                </span>
                {active ? <CheckCircle2 className="size-5 shrink-0 text-[#3848c7]" /> : null}
              </button>
            );
          })}
        </div>
        {mode === "pin" ? (
          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2 text-[13px] font-medium text-[#3c4053]"><KeyRound className="size-4 text-[#5566f6]" />Ваш PIN</label>
            <Input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" className="h-12 rounded-2xl border-[#dcdfed] text-center text-[20px] tracking-[0.4em]" />
            <p className="text-[12px] text-[#9b9fb3]">PIN выдаёт руководитель. Он подтверждает, что запись сделали именно вы.</p>
          </div>
        ) : null}
        <Button
          type="button"
          disabled={!employeeId || (mode === "pin" && pin.length < 4)}
          onClick={() => setEmployeeConfirmed(true)}
          className="mt-4 h-12 w-full rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
        >
          Продолжить
        </Button>
      </div>,
      mode === "auth" ? "Вы вошли в кабинет — запись будет подписана вашим аккаунтом." : "Имя запомнится на этом телефоне."
    );
  }

  // ---- результат
  if (done) {
    const pending = (daily ?? []).filter((item) => !item.filled && item.code !== code);
    return shell(
      <div className="space-y-4">
        <div className={`${card} text-center`}>
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#ecfdf5] text-[#116b2a]"><CheckCircle2 className="size-7" /></div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">{done.mode === "appended" ? "Строка добавлена" : "Отметка записана"}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">{done.documentTitle} · {done.employeeName} · {new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</p>
          {done.mode === "appended" ? (
            <Button type="button" onClick={addAnother} className="mt-5 h-12 w-full rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white hover:bg-[#4a5bf0]">Добавить ещё</Button>
          ) : null}
        </div>
        {daily && daily.length > 0 ? (
          <div className={card}>
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Сегодня у вас</div>
            <div className="space-y-2">
              {daily.map((item) => (
                <a key={item.code} href={item.filled ? undefined : hubHref(item.code)} className={`${bigButton} ${item.filled ? "border-[#d4f5e3] bg-[#f3fdf7] text-[#116b2a]" : ""}`}>
                  <span className="flex items-center gap-3">
                    {item.filled ? <CheckCircle2 className="size-5 text-[#116b2a]" /> : <Circle className="size-5 text-[#9b9fb3]" />}
                    {item.name}
                  </span>
                  {!item.filled ? <ArrowRight className="size-4 text-[#9b9fb3]" /> : <span className="text-[12.5px] font-normal">отмечено</span>}
                </a>
              ))}
            </div>
            {pending.length > 0 ? (
              <a href={hubHref(pending[0].code)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#5566f6]/30 bg-[#f5f6ff] text-[15px] font-medium text-[#3848c7]">
                Дальше: {pending[0].name} <ArrowRight className="size-4" />
              </a>
            ) : (
              <p className="mt-3 text-center text-[13px] text-[#116b2a]">Все ежедневные отметки на сегодня сделаны.</p>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ---- шаг: строка (для сущностных адаптеров)
  if (payload && !payload.rowKey && payload.rows.length > 0) {
    return shell(
      <div className={card}>
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Что именно</div>
        <div className="space-y-2">
          {payload.rows.map((row) => (
            <button key={row.rowKey} type="button" className={`${bigButton} ${row.mine ? "border-[#5566f6]/40" : ""}`} onClick={() => setRowKey(row.rowKey)}>
              <span className="min-w-0"><span className="block truncate">{row.label}</span>{row.sublabel ? <span className="block text-[12.5px] font-normal text-[#6f7282]">{row.sublabel}</span> : null}</span>
              <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
            </button>
          ))}
        </div>
      </div>,
      `${employee.name}${employee.positionTitle ? ` · ${employee.positionTitle}` : ""}`
    );
  }

  // ---- шаг: форма
  return shell(
    <div className="space-y-4">
      <div className="flex items-center justify-between text-[13px] text-[#6f7282]">
        <span className="inline-flex items-center gap-1.5"><UserRound className="size-4 text-[#5566f6]" />{employee.name}</span>
        {mode !== "auth" || props.sessionEmployee?.canPickOthers ? (
          <button type="button" onClick={() => { setEmployeeConfirmed(false); setPayload(null); setRowKey(null); formSeeded.current = null; }} className="font-medium text-[#3848c7]">Сменить</button>
        ) : null}
      </div>
      {loading || !form ? (
        <div className={card}>
          {loadError ? (
            <p className="text-[14px] text-[#a13a32]">{loadError}</p>
          ) : payload && !form ? (
            // Документ без строк для этого сотрудника (уборка без помещений и т.п.) — честно сказать, а не крутить скелет.
            <p className="text-[14px] leading-relaxed text-[#6f7282]">В этом документе пока нет строк, которые можно заполнить от вашего имени. Попросите руководителя назначить вас в журнале.</p>
          ) : (
            <div className="space-y-3"><div className="h-14 animate-pulse rounded-2xl bg-[#eef1ff]" /><div className="h-14 animate-pulse rounded-2xl bg-[#eef1ff]" /></div>
          )}
        </div>
      ) : form.fields.length === 0 ? (
        <div className={card}>
          <p className="text-[14px] leading-relaxed text-[#6f7282]">В документе пока нечего заполнять: список оборудования или строк пуст. Попросите руководителя настроить журнал.</p>
        </div>
      ) : (
        <>
          {form.intro ? <p className="text-[14px] leading-relaxed text-[#3c4053]">{form.intro}</p> : null}
          <div className="space-y-3">
            {form.fields.map((field) => {
              const scope = hints.nameFields?.[field.key];
              if (field.type === "text" && scope) {
                const list = suggestions[scope]?.values ?? [];
                const value = String(values[field.key] ?? "");
                return (
                  <div key={field.key} className="rounded-2xl border border-[#dcdfed] bg-white p-4">
                    <div className="mb-2 text-[14.5px] font-semibold text-[#0b1024]">{field.label}</div>
                    <SuggestInput ariaLabel={field.label} value={value} options={mergeSuggestions(list)} placeholder={field.placeholder} onChange={(next) => setFieldValue(field.key, next)} />
                    {list.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Недавние наименования">
                        {list.slice(0, 6).map((name) => (
                          <button key={name} type="button" aria-pressed={value === name} onClick={() => setFieldValue(field.key, name)} className={`inline-flex h-8 max-w-full items-center truncate rounded-full border px-3 text-[12.5px] font-medium ${value === name ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#3c4053]"}`}>{name}</button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }
              const isTempField = hints.tempField?.tempKey === field.key;
              return (
                <div key={field.key} className="space-y-2">
                  <TaskFillField field={field} value={values[field.key]} onChange={(next) => setFieldValue(field.key, next)} />
                  {field.type === "time" && hints.timeOffsetFields?.includes(field.key) ? (
                    <div className="flex flex-wrap gap-1.5 px-1">
                      {[...TIME_OFFSET_CHIPS, { minutes: 0, label: "Сейчас" }].map((chip) => {
                        const target = timeMinutesAgo(chip.minutes);
                        const active = values[field.key] === target;
                        return (
                          <button key={chip.label} type="button" aria-pressed={active} onClick={() => setFieldValue(field.key, target)} className={`inline-flex h-8 items-center rounded-full border px-3 text-[12.5px] font-medium tabular-nums ${active ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#3c4053]"}`}>{chip.label}</button>
                        );
                      })}
                    </div>
                  ) : null}
                  {isTempField && tempAuto ? <p className="px-1 text-[12px] text-[#9b9fb3]">Подставлено по прошлой записи этого блюда — поправьте, если сегодня иначе.</p> : null}
                </div>
              );
            })}
          </div>
          {outOfRangeFields.length > 0 ? (
            <DeviationCorrection
              title={`${outOfRangeFields.map((field) => field.label).join(", ")} — вне нормы`}
              hint={correctionField ? undefined : "Запись сохранится с пометкой об отклонении."}
              value={correction}
              onChange={setCorrection}
            />
          ) : null}
          {submitError ? <p className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#a13a32]">{submitError}</p> : null}
          <Button type="button" disabled={submitting} onClick={() => void submit()} className="h-14 w-full rounded-2xl bg-[#5566f6] text-[16px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]">
            {submitting ? "Сохраняем…" : form.submitLabel ?? "Сохранить"}
          </Button>
        </>
      )}
    </div>,
    payload?.rows.find((row) => row.rowKey === payload.rowKey)?.label
  );
}

