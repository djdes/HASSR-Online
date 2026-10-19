"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, FilePlus2, FileSpreadsheet, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import {
  FinishedProductBulkDialog,
  FinishedProductBulkTable,
  emptyBulkDishRows,
  type BulkDishRow,
} from "@/components/journals/finished-product-bulk-dialog";
import { isBadTypedTime } from "@/components/journals/time-entry-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { BrakerageDateInput } from "@/components/journals/brakerage-time-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeTypedTime } from "@/lib/finished-product-bulk";
import { FINISHED_PRODUCT_ORGANOLEPTIC_DISH } from "@/lib/finished-product-document";
import type { MasterBrakerageResult } from "@/lib/master-brakerage";
import type { MasterBrakerageHistoryBatch } from "@/lib/master-brakerage-history";
import type { SharedItem } from "@/lib/master-directory";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";
import { brakerageCommentRequired, brakerageRelease } from "@/lib/brakerage-assessment";

/** Как MASTER_BRAKERAGE_ROWS_MAX на сервере: меню одного дня. */
export const MASTER_EXPORT_ROWS_MAX = 200;
const START_ROWS = 5;
const ORGANOLEPTIC_DEFAULT = "__journal_default__";
const FILE_ACCEPT =
  ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return y && m && d ? `${d}-${m}-${y}` : date;
}

function kitchens(count: number): string {
  return `${count} ${pluralRu(count, "пищеблок", "пищеблока", "пищеблоков")}`;
}

function rowsLabel(count: number): string {
  return `${count} ${pluralRu(count, "строка", "строки", "строк")}`;
}

/** Блюда из файла или с фото → строки выгрузки (не больше одного дня меню) + пустая строка в конце. */
export function itemsToExportRows(items: Array<Pick<SharedItem, "name" | "portion" | "time">>): BulkDishRow[] {
  const rows = items
    .slice(0, MASTER_EXPORT_ROWS_MAX)
    .map((item) => ({ name: item.name, yield: item.portion ?? "", time: normalizeTypedTime(item.time ?? "") || (item.time ?? "") }));
  return rows.length < MASTER_EXPORT_ROWS_MAX ? [...rows, ...emptyBulkDishRows(1)] : rows;
}

/**
 * Excel/CSV с блюдами → строки выгрузки. Разбор — тот же, что у справочника
 * (`/api/master/directory/preview`, колонки «Наименование», «Выход»,
 * «Время»), но ничего не сохраняется: строки идут только в эту выгрузку.
 */
export async function readMenuFile(file: File): Promise<BulkDishRow[] | null> {
  const form = new FormData();
  form.set("kind", "dish");
  form.set("file", file);
  const response = await fetch("/api/master/directory/preview", { method: "POST", body: form }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as { error?: string; items?: SharedItem[] } | null;
  if (!response?.ok || !json?.items) {
    toast.error(json?.error ?? "Не удалось прочитать файл. Проверьте интернет и попробуйте ещё раз.");
    return null;
  }
  if (json.items.length === 0) {
    toast.error("В файле не нашлось блюд — нужна колонка «Наименование» (или первая колонка с названиями).");
    return null;
  }
  if (json.items.length > MASTER_EXPORT_ROWS_MAX) {
    toast.warning(`В файле ${json.items.length} блюд — за одну выгрузку берём первые ${MASTER_EXPORT_ROWS_MAX}.`);
  }
  return itemsToExportRows(json.items);
}

/**
 * «Выгрузить в журналы» мастер-кабинета: то же окно, что «Добавить изделия
 * списком» в БЖГП пищеблока (общий компонент). Каждая выгрузка — с чистой
 * таблицы: вписать, вставить из Excel, загрузить файл или распознать фото,
 * поставить дату, отметить пищеблоки → предпросмотр «куда и сколько» →
 * запись → итог по каждому пищеблоку. Список блюд не сохраняется.
 */
export function MasterBrakerageDialog({
  open,
  onOpenChange,
  organizations,
  initialRows = null,
  editingBatch = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Подключённые пищеблоки — галочки «куда выгрузить». */
  organizations: Array<{ id: string; name: string }>;
  /** Строки из файла или с фото, с которыми открыть окно. */
  initialRows?: BulkDishRow[] | null;
  editingBatch?: MasterBrakerageHistoryBatch | null;
}) {
  const [rows, setRows] = useState<BulkDishRow[]>(() => emptyBulkDishRows(START_ROWS));
  const [date, setDate] = useState("");
  const [organoleptic, setOrganoleptic] = useState(ORGANOLEPTIC_DEFAULT);
  const [productTemp, setProductTemp] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<MasterBrakerageResult | null>(null);
  const [result, setResult] = useState<MasterBrakerageResult | null>(null);
  const [historyVersion, setHistoryVersion] = useState("");
  const [scope, setScope] = useState<"" | "history" | "all" | "selected">("");
  const [selectedOrganizations, setSelectedOrganizations] = useState<string[]>([]);
  /** Галочки «в какие пищеблоки» новой выгрузки — по умолчанию все. */
  const [targets, setTargets] = useState<string[]>(() => organizations.map((org) => org.id));
  const returningFromPreview = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const recipients = editingBatch?.result?.organizations.filter(org => org.added > 0 && org.documentId) ?? [];

  useEffect(() => {
    if (!open) return;
    if (returningFromPreview.current) { returningFromPreview.current = false; return; }
    setScope("");
    setSelectedOrganizations([]);
    if (!editingBatch) {
      setRows(initialRows && initialRows.length > 0 ? initialRows : emptyBulkDishRows(START_ROWS));
      setDate("");
      setTargets(organizations.map((org) => org.id));
      setOrganoleptic(ORGANOLEPTIC_DEFAULT); setProductTemp(""); setNote("");
      return;
    }
    const input = editingBatch.input;
    // Старые выгрузки могли брать общее «время для всех строк» — теперь оно в самих строках.
    setRows(input.rows.map((row) => (row.time.trim() || !input.common.time ? row : { ...row, time: input.common.time })));
    setDate(input.date);
    setOrganoleptic(input.common.organoleptic || ORGANOLEPTIC_DEFAULT);

    setProductTemp(input.common.productTemp);
    setNote(input.common.note);
    setHistoryVersion(editingBatch.updatedAt);
    // Новые строки и галочки — при каждом открытии, не при каждом обновлении списка пищеблоков.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingBatch, initialRows]);

  async function saveHistoryInput() {
    if (organoleptic !== ORGANOLEPTIC_DEFAULT && brakerageCommentRequired(organoleptic) && !note.trim()) { toast.error("Добавьте комментарий к оценке блюда"); return; }
    const dateInput = document.querySelector<HTMLInputElement>('[data-testid="master-brakerage-date"]');
    if (dateInput && !dateInput.reportValidity()) return;
    if (!editingBatch || !canSubmit || !scope || (scope === "selected" && !selectedOrganizations.length) || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/master/brakerage/history/${editingBatch.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: payload(false), updatedAt: historyVersion, scope, organizationIds: selectedOrganizations }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить ввод");
      setHistoryVersion(body.batch.updatedAt);
      window.dispatchEvent(new Event("master-brakerage-changed"));
      toast.success(`Изменения сохранены. Обновлено журналов: ${body.changed.length}. Предыдущая версия осталась в истории.`);
      onOpenChange(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить ввод"); }
    finally { setBusy(false); }
  }

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const fromFile = await readMenuFile(file);
      if (!fromFile) return;
      // Уже вписанное остаётся, блюда из файла — следом.
      setRows((prev) => {
        const filled = prev.filter((row) => row.name.trim() !== "");
        return [...filled, ...fromFile].slice(0, MASTER_EXPORT_ROWS_MAX);
      });
      toast.success(`Из файла «${file.name}»: ${rowsLabel(fromFile.filter((row) => row.name.trim()).length)}`);
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const named = rows.filter((row) => row.name.trim() !== "");
  const withoutTime = named.filter((row) => !normalizeTypedTime(row.time)).length;
  const badTimes = rows.filter((row) => isBadTypedTime(row.time)).length;
  const targetIds = organizations.map((org) => org.id).filter((id) => targets.includes(id));
  const canSubmit =
    named.length > 0 &&
    Boolean(date) &&
    withoutTime === 0 &&
    badTimes === 0 &&
    (editingBatch !== null || targetIds.length > 0);

  function payload(dryRun: boolean) {
    return {
      date,
      dryRun,
      rows: named.map((row) => ({ name: row.name, yield: row.yield, time: normalizeTypedTime(row.time) })),
      common: {
        time: "",
        organoleptic: organoleptic === ORGANOLEPTIC_DEFAULT ? "" : organoleptic,
        releaseAllowed: brakerageRelease(organoleptic),
        productTemp,
        note,
      },
      // Исправление прошлой выгрузки идёт по своим получателям (scope).
      ...(editingBatch ? {} : { organizationIds: targetIds }),
    };
  }

  async function send(dryRun: boolean): Promise<MasterBrakerageResult | null> {
    const response = await fetch("/api/master/brakerage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(dryRun)),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as (MasterBrakerageResult & { error?: string }) | null;
    if (!response?.ok || !json?.organizations) {
      toast.error(json?.error ?? "Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.");
      return null;
    }
    return json;
  }

  async function openPreview() {
    if (organoleptic !== ORGANOLEPTIC_DEFAULT && brakerageCommentRequired(organoleptic) && !note.trim()) { toast.error("Добавьте комментарий к оценке блюда"); return; }
    const dateInput = document.querySelector<HTMLInputElement>('[data-testid="master-brakerage-date"]');
    if (dateInput && !dateInput.reportValidity()) return;
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const next = await send(true);
      if (!next) return;
      returningFromPreview.current = true;
      setPreview(next);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const done = await send(false);
    if (!done) return;
    returningFromPreview.current = false;
    setPreview(null);
    setResult(done);
    window.dispatchEvent(new Event("master-brakerage-changed"));
    const { added, organizations: reached, failed } = done.totals;
    const text = `Добавлено ${rowsLabel(added)} в ${kitchens(reached)}`;
    if (failed > 0) toast.warning(`${text}; не удалось — ${kitchens(failed)}`);
    else toast.success(text);
    if (added > 0) setRows(emptyBulkDishRows(START_ROWS));
  }

  const top = editingBatch ? null : (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[12.5px] leading-[1.5] text-[#3c4053]">
        Впишите блюда или встаньте в ячейку и нажмите Ctrl+V — из Excel можно вставить сразу наименование, выход и
        время. Меню в файле — «Загрузить Excel/CSV», на бумаге — «С фото» под таблицей.
      </p>
      <input
        ref={fileInput}
        type="file"
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={(event) => void onFileChosen(event.target.files?.[0])}
        data-testid="master-brakerage-file-input"
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={reading}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="master-brakerage-upload"
      >
        {reading ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
        Загрузить Excel/CSV
      </button>
    </div>
  );

  const allTargets = targetIds.length === organizations.length;
  const targetsBlock = editingBatch ? null : (
    <div className="space-y-2" data-testid="master-brakerage-targets">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">В какие пищеблоки выгрузить?</Label>
        {organizations.length > 1 ? (
          <button
            type="button"
            onClick={() => setTargets(allTargets ? [] : organizations.map((org) => org.id))}
            className="rounded-lg px-2 py-1 text-[12.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            data-testid="master-brakerage-targets-toggle"
          >
            {allTargets ? "Снять все" : "Отметить все"}
          </button>
        ) : null}
      </div>
      {organizations.length === 0 ? (
        <p className="rounded-xl bg-[#fff4f2] px-3 py-2 text-[12.5px] leading-snug text-[#a13a32]">
          Пищеблоков пока нет — подключите их во вкладке «Подключённые объекты».
        </p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-2xl border border-[#ececf4] bg-white p-2">
          {organizations.map((org) => {
            const checked = targets.includes(org.id);
            return (
              <li key={org.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 text-[13.5px] transition-colors duration-150 hover:bg-[#f5f6ff]",
                    checked ? "text-[#0b1024]" : "text-[#6f7282]"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(event) =>
                      setTargets((ids) => (event.target.checked ? [...ids, org.id] : ids.filter((id) => id !== org.id)))
                    }
                    className="mt-0.5 size-4 shrink-0 accent-[#5566f6]"
                    data-testid="master-brakerage-target"
                  />
                  <span className="min-w-0 break-words">{org.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {organizations.length > 0 && targetIds.length === 0 ? (
        <p className="text-[12px] leading-snug text-[#a13a32]" data-testid="master-brakerage-targets-empty">
          Отметьте хотя бы один пищеблок.
        </p>
      ) : null}
    </div>
  );

  const commonFields = (
    <div className="min-w-0 space-y-5">
      {editingBatch ? <div className="space-y-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
        <p className="text-[14px] font-medium text-[#0b1024]">Где применить исправления?</p>
        <div role="radiogroup" aria-label="Где применить исправления" className="space-y-2 text-[13px] text-[#3c4053]">{([
          ["all", "Во всех пищеблоках, получивших эту выгрузку"],
          ["selected", "В выбранных пищеблоках"],
          ["history", "Только в истории мастер-кабинета"],
        ] as const).map(([value, label]) => <label key={value} className="flex items-start gap-2"><input type="radio" name="master-correction-scope" value={value} checked={scope === value} disabled={busy || (value !== "history" && !recipients.length)} onChange={() => setScope(value)} className="mt-0.5 accent-[#5566f6]" />{label}</label>)}</div>
        {scope === "selected" ? <div className="max-h-48 space-y-2 overflow-auto rounded-2xl border border-[#ececf4] bg-white p-3">{recipients.map(org => <label key={org.organizationId} className="flex items-start gap-2 text-[13px]"><input type="checkbox" checked={selectedOrganizations.includes(org.organizationId)} disabled={busy} onChange={event => setSelectedOrganizations(ids => event.target.checked ? [...ids, org.organizationId] : ids.filter(id => id !== org.organizationId))} className="mt-0.5 accent-[#5566f6]" /><span className="break-words">{org.organizationName}</span></label>)}</div> : null}
        <p className="text-[12.5px] leading-relaxed text-[#6f7282]">Подписанные и проверенные записи, а также закрытые журналы изменять нельзя. Если данные в пищеблоке конфликтуют с исправлениями, сохранение остановится без частичного обновления.</p>
      </div> : null}
      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">На какую дату выгрузить блюда?</Label>
        <BrakerageDateInput
          aria-label="Дата изготовления"
          className="block h-11 w-full min-w-0 appearance-none rounded-xl border-[#dcdfed] px-3 text-left text-[15px] sm:max-w-[280px]"
          value={date}
          onChange={setDate}
          data-testid="master-brakerage-date"
          required
        />
        {withoutTime > 0 ? (
          <p className="text-[12px] leading-snug text-[#a13a32]" data-testid="master-brakerage-time-missing">
            У {rowsLabel(withoutTime)} нет времени изготовления — впишите его в строке. Стрелка ↓ у времени проставит
            его всем строкам ниже.
          </p>
        ) : null}
        <p className="rounded-xl bg-[#f5f6ff] px-3 py-2 text-[12.5px] leading-snug text-[#3848c7]">
          Время бракеража и разрешения к реализации посчитается у каждого пищеблока по его настройкам журнала
          (обычно +5 и +5 минут от изготовления). Ответственный и проверяющий — из документа пищеблока.
        </p>
      </div>

      {targetsBlock}

      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">Органолептическая оценка</Label>
        <Select value={organoleptic} onValueChange={setOrganoleptic}>
          <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]" aria-label="Органолептическая оценка">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ORGANOLEPTIC_DEFAULT}>Как в журнале пищеблока (первая оценка)</SelectItem>
            {FINISHED_PRODUCT_ORGANOLEPTIC_DISH.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-[13px] text-[#3c4053]">Разрешение к реализации: {brakerageRelease(organoleptic) === "no" ? "Не разрешено" : "Разрешено"}. Определяется оценкой автоматически.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-[13px] font-medium text-[#3c4053]">T°C внутри продукта</Label>
          <Input
            className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            value={productTemp}
            maxLength={20}
            placeholder="Необязательно"
            aria-label="T°C внутри продукта"
            onChange={(event) => setProductTemp(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[13px] font-medium text-[#3c4053]">Примечание{organoleptic !== ORGANOLEPTIC_DEFAULT && brakerageCommentRequired(organoleptic) ? " *" : ""}</Label>
          <Input
            className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            value={note}
            maxLength={500}
            placeholder="Необязательно"
            aria-label="Примечание"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <p className="text-[11.5px] leading-snug text-[#6f7282] sm:col-span-2">
          Выход, T° и примечание попадут в журнал пищеблока, если эти колонки у него включены.
        </p>
      </div>
    </div>
  );

  const submitLabel = editingBatch
    ? "Сохранить исправления"
    : organizations.length === 0
      ? "Нет подключённых пищеблоков"
      : targetIds.length === 0
        ? "Отметьте пищеблоки"
        : `Выгрузить в ${kitchens(targetIds.length)}`;

  return (
    <>
      <FinishedProductBulkDialog
        open={open}
        onOpenChange={onOpenChange}
        title={editingBatch ? "Исправить выгрузку" : "Выгрузить в журналы"}
        description={
          <>
            Блюда из таблицы появятся строками в журнале бракеража готовой продукции отмеченных пищеблоков на
            выбранную дату. Нет документа на эту дату — он создастся. Повторная выгрузка тех же блюд с тем же
            временем строки не задвоит. Таблица не сохраняется: следующая выгрузка начнётся с чистого листа.
          </>
        }
        top={top}
        table={
          <FinishedProductBulkTable
            rows={rows}
            onRowsChange={setRows}
            maxRows={MASTER_EXPORT_ROWS_MAX}
            showYield
            showTime
          />
        }
        commonFields={commonFields}
        submitLabel={submitLabel}
        submitDisabled={!canSubmit || (editingBatch !== null && (!scope || (scope === "selected" && !selectedOrganizations.length)))}
        submitting={busy}
        onSubmit={() => void (editingBatch ? saveHistoryInput() : openPreview())}
        testId="master-brakerage-dialog"
      />

      <ConfirmDialog
        open={preview !== null}
        onClose={() => {
          setPreview(null);
          onOpenChange(true);
        }}
        onConfirm={commit}
        title="Проверьте, куда уйдут строки"
        icon={Send}
        description={preview ? <>Бракераж на {formatDate(preview.date)}. Ничего ещё не записано.</> : null}
        confirmLabel={
          preview ? `Добавить ${rowsLabel(preview.totals.added)} в ${kitchens(preview.organizations.filter((org) => org.added > 0).length)}` : "Добавить"
        }
        cancelLabel="Назад к списку"
        confirmDisabled={!preview || preview.totals.added === 0}
      >
        {preview ? <OrgResults result={preview} /> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={result !== null}
        onClose={() => setResult(null)}
        onConfirm={() => setResult(null)}
        title={
          result
            ? `Добавлено ${rowsLabel(result.totals.added)} в ${kitchens(result.totals.organizations)}`
            : "Готово"
        }
        variant="info"
        icon={CheckCircle2}
        description={result ? <>Бракераж на {formatDate(result.date)}. Итог по каждому пищеблоку:</> : null}
        confirmLabel="Готово"
        cancelLabel="Закрыть"
      >
        {result ? <OrgResults result={result} /> : null}
      </ConfirmDialog>
    </>
  );
}

function OrgResults({ result }: { result: MasterBrakerageResult }) {
  const dry = result.dryRun;
  return (
    <ul
      className="max-h-[46vh] divide-y divide-[#ececf4] overflow-y-auto rounded-2xl border border-[#ececf4]"
      data-testid={dry ? "master-brakerage-preview" : "master-brakerage-result"}
    >
      {result.organizations.map((org) => (
        <li key={org.organizationId} className="flex items-start gap-3 px-3.5 py-3" data-testid="master-brakerage-org">
          <span
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl",
              org.error ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#eef1ff] text-[#5566f6]"
            )}
          >
            {org.error ? <AlertTriangle className="size-4" /> : <Building2 className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-[14px] font-medium text-[#0b1024]">{org.organizationName}</span>
            {org.error ? (
              <span className="mt-0.5 block text-[12.5px] leading-snug text-[#a13a32]">{org.error}</span>
            ) : (
              <span className="mt-0.5 block text-[12.5px] leading-snug text-[#6f7282]">
                {dry ? "Будет добавлено" : "Добавлено"}: <b className="font-semibold tabular-nums text-[#0b1024]">{org.added}</b>
                {org.skipped > 0 ? (
                  <>
                    {" "}
                    · уже есть, {dry ? "пропустим" : "пропущено"}: <span className="tabular-nums">{org.skipped}</span>
                  </>
                ) : null}
                {org.documentCreated ? (
                  <span className="mt-1 flex items-center gap-1 text-[#3848c7]">
                    <FilePlus2 className="size-3.5 shrink-0" />
                    {dry ? "Документа на эту дату нет — создадим новый" : `Создан документ «${org.documentTitle ?? "Бракеражный журнал"}»`}
                  </span>
                ) : org.documentTitle ? (
                  <span className="mt-1 block truncate">в документ «{org.documentTitle}»</span>
                ) : null}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
