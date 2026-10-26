"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, FilePlus2, FileSpreadsheet, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
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

/** `useTranslations("masterUi.masterBrakerageDialog")` of the calling component. */
export type MasterBrakerageTranslator = ReturnType<typeof useTranslations<"masterUi.masterBrakerageDialog">>;

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
export async function readMenuFile(file: File, t: MasterBrakerageTranslator): Promise<BulkDishRow[] | null> {
  const form = new FormData();
  form.set("kind", "dish");
  form.set("file", file);
  const response = await fetch("/api/master/directory/preview", { method: "POST", body: form }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as { error?: string; items?: SharedItem[] } | null;
  if (!response?.ok || !json?.items) {
    toast.error(json?.error ?? t("readFailed"));
    return null;
  }
  if (json.items.length === 0) {
    toast.error(t("noDishes"));
    return null;
  }
  if (json.items.length > MASTER_EXPORT_ROWS_MAX) {
    toast.warning(t("tooManyDishes", { count: json.items.length, max: MASTER_EXPORT_ROWS_MAX }));
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
  const t = useTranslations("masterUi.masterBrakerageDialog");
  const tc = useTranslations("common");
  const tGrades = useTranslations("finishedProduct.grades");
  const kitchens = (count: number) => t("kitchens", { count });
  const rowsLabel = (count: number) => t("rows", { count });
  const gradeLabel = (option: string): string => {
    switch (option) {
      case "Отлично": return tGrades("excellent");
      case "Хорошо": return tGrades("good");
      case "Удовлетворительно": return tGrades("satisfactory");
      case "Неудовлетворительно": return tGrades("unsatisfactory");
      case "Доброкачественно": return tGrades("sound");
      case "Недоброкачественно": return tGrades("unsound");
      default: return option;
    }
  };
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
    if (organoleptic !== ORGANOLEPTIC_DEFAULT && brakerageCommentRequired(organoleptic) && !note.trim()) { toast.error(t("commentRequired")); return; }
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
      if (!response.ok) throw new Error(body.error || t("saveInputFailed"));
      setHistoryVersion(body.batch.updatedAt);
      window.dispatchEvent(new Event("master-brakerage-changed"));
      toast.success(t("historySaved", { count: body.changed.length }));
      onOpenChange(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : t("saveInputFailed")); }
    finally { setBusy(false); }
  }

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const fromFile = await readMenuFile(file, t);
      if (!fromFile) return;
      // Уже вписанное остаётся, блюда из файла — следом.
      setRows((prev) => {
        const filled = prev.filter((row) => row.name.trim() !== "");
        return [...filled, ...fromFile].slice(0, MASTER_EXPORT_ROWS_MAX);
      });
      toast.success(t("fromFile", { file: file.name, rows: rowsLabel(fromFile.filter((row) => row.name.trim()).length) }));
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
      toast.error(json?.error ?? t("serverFailed"));
      return null;
    }
    return json;
  }

  async function openPreview() {
    if (organoleptic !== ORGANOLEPTIC_DEFAULT && brakerageCommentRequired(organoleptic) && !note.trim()) { toast.error(t("commentRequired")); return; }
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
    const text = t("added", { rows: rowsLabel(added), kitchens: kitchens(reached) });
    if (failed > 0) toast.warning(t("addedWithFailures", { text, kitchens: kitchens(failed) }));
    else toast.success(text);
    if (added > 0) setRows(emptyBulkDishRows(START_ROWS));
  }

  const top = editingBatch ? null : (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[12.5px] leading-[1.5] text-[#3c4053]">
        {t("topHint")}
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
        {t("uploadFile")}
      </button>
    </div>
  );

  const allTargets = targetIds.length === organizations.length;
  const targetsBlock = editingBatch ? null : (
    <div className="space-y-2" data-testid="master-brakerage-targets">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">{t("targetsQuestion")}</Label>
        {organizations.length > 1 ? (
          <button
            type="button"
            onClick={() => setTargets(allTargets ? [] : organizations.map((org) => org.id))}
            className="rounded-lg px-2 py-1 text-[12.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            data-testid="master-brakerage-targets-toggle"
          >
            {allTargets ? t("deselectAll") : t("selectAll")}
          </button>
        ) : null}
      </div>
      {organizations.length === 0 ? (
        <p className="rounded-xl bg-[#fff4f2] px-3 py-2 text-[12.5px] leading-snug text-[#a13a32]">
          {t("noKitchens")}
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
          {t("selectAtLeastOne")}
        </p>
      ) : null}
    </div>
  );

  const commonFields = (
    <div className="min-w-0 space-y-5">
      {editingBatch ? <div className="space-y-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
        <p className="text-[14px] font-medium text-[#0b1024]">{t("scopeQuestion")}</p>
        <div role="radiogroup" aria-label={t("scopeQuestion")} className="space-y-2 text-[13px] text-[#3c4053]">{([
          ["all", t("scopeAll")],
          ["selected", t("scopeSelected")],
          ["history", t("scopeHistory")],
        ] as const).map(([value, label]) => <label key={value} className="flex items-start gap-2"><input type="radio" name="master-correction-scope" value={value} checked={scope === value} disabled={busy || (value !== "history" && !recipients.length)} onChange={() => setScope(value)} className="mt-0.5 accent-[#5566f6]" />{label}</label>)}</div>
        {scope === "selected" ? <div className="max-h-48 space-y-2 overflow-auto rounded-2xl border border-[#ececf4] bg-white p-3">{recipients.map(org => { const key = org.targetId ?? org.organizationId; return <label key={key} className="flex items-start gap-2 text-[13px]"><input type="checkbox" checked={selectedOrganizations.includes(key)} disabled={busy} onChange={event => setSelectedOrganizations(ids => event.target.checked ? [...ids, key] : ids.filter(id => id !== key))} className="mt-0.5 accent-[#5566f6]" /><span className="break-words">{org.organizationName}</span></label>; })}</div> : null}
        <p className="text-[12.5px] leading-relaxed text-[#6f7282]">{t("correctionsNote")}</p>
      </div> : null}
      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">{t("dateQuestion")}</Label>
        <BrakerageDateInput
          aria-label={t("dateAria")}
          className="block h-11 w-full min-w-0 appearance-none rounded-xl border-[#dcdfed] px-3 text-left text-[15px] sm:max-w-[280px]"
          value={date}
          onChange={setDate}
          data-testid="master-brakerage-date"
          required
        />
        {withoutTime > 0 ? (
          <p className="text-[12px] leading-snug text-[#a13a32]" data-testid="master-brakerage-time-missing">
            {t("timeMissing", { rows: rowsLabel(withoutTime) })}
          </p>
        ) : null}
        <p className="rounded-xl bg-[#f5f6ff] px-3 py-2 text-[12.5px] leading-snug text-[#3848c7]">
          {t("timingNote")}
        </p>
      </div>

      {targetsBlock}

      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">{t("organolepticLabel")}</Label>
        <Select value={organoleptic} onValueChange={setOrganoleptic}>
          <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]" aria-label={t("organolepticLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ORGANOLEPTIC_DEFAULT}>{t("organolepticDefault")}</SelectItem>
            {FINISHED_PRODUCT_ORGANOLEPTIC_DISH.map((option) => (
              <SelectItem key={option} value={option}>
                {gradeLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-[13px] text-[#3c4053]">{t("releaseAllowed", { state: brakerageRelease(organoleptic) === "no" ? t("releaseNo") : t("releaseYes") })}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-[13px] font-medium text-[#3c4053]">{t("tempLabel")}</Label>
          <Input
            className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            value={productTemp}
            maxLength={20}
            placeholder={t("optional")}
            aria-label={t("tempLabel")}
            onChange={(event) => setProductTemp(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[13px] font-medium text-[#3c4053]">{t("noteLabel")}{organoleptic !== ORGANOLEPTIC_DEFAULT && brakerageCommentRequired(organoleptic) ? " *" : ""}</Label>
          <Input
            className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            value={note}
            maxLength={500}
            placeholder={t("optional")}
            aria-label={t("noteLabel")}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <p className="text-[11.5px] leading-snug text-[#6f7282] sm:col-span-2">
          {t("fieldsHint")}
        </p>
      </div>
    </div>
  );

  const submitLabel = editingBatch
    ? t("submitSave")
    : organizations.length === 0
      ? t("submitNoKitchens")
      : targetIds.length === 0
        ? t("submitSelectKitchens")
        : t("submitExport", { kitchens: kitchens(targetIds.length) });

  return (
    <>
      <FinishedProductBulkDialog
        open={open}
        onOpenChange={onOpenChange}
        title={editingBatch ? t("titleCorrect") : t("titleExport")}
        description={<>{t("description")}</>}
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
        title={t("previewTitle")}
        icon={Send}
        description={preview ? <>{t("previewDescription", { date: formatDate(preview.date) })}</> : null}
        confirmLabel={
          preview ? t("confirmAdd", { rows: rowsLabel(preview.totals.added), kitchens: kitchens(preview.organizations.filter((org) => org.added > 0).length) }) : t("add")
        }
        cancelLabel={t("backToList")}
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
            ? t("added", { rows: rowsLabel(result.totals.added), kitchens: kitchens(result.totals.organizations) })
            : t("done")
        }
        variant="info"
        icon={CheckCircle2}
        description={result ? <>{t("resultDescription", { date: formatDate(result.date) })}</> : null}
        confirmLabel={t("done")}
        cancelLabel={tc("close")}
      >
        {result ? <OrgResults result={result} /> : null}
      </ConfirmDialog>
    </>
  );
}

function OrgResults({ result }: { result: MasterBrakerageResult }) {
  const t = useTranslations("masterUi.masterBrakerageDialog");
  const dry = result.dryRun;
  return (
    <ul
      className="max-h-[46vh] divide-y divide-[#ececf4] overflow-y-auto rounded-2xl border border-[#ececf4]"
      data-testid={dry ? "master-brakerage-preview" : "master-brakerage-result"}
    >
      {result.organizations.map((org) => (
        <li key={org.targetId ?? org.organizationId} className="flex items-start gap-3 px-3.5 py-3" data-testid="master-brakerage-org">
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
                {dry ? t("willAdd") : t("addedLabel")} <b className="font-semibold tabular-nums text-[#0b1024]">{org.added}</b>
                {org.skipped > 0 ? (
                  <>
                    {" "}
                    {dry ? t("skippedDry") : t("skippedDone")} <span className="tabular-nums">{org.skipped}</span>
                  </>
                ) : null}
                {org.documentCreated ? (
                  <span className="mt-1 flex items-center gap-1 text-[#3848c7]">
                    <FilePlus2 className="size-3.5 shrink-0" />
                    {dry ? t("documentWillCreate") : t("documentCreated", { title: org.documentTitle ?? t("defaultJournalTitle") })}
                  </span>
                ) : org.documentTitle ? (
                  <span className="mt-1 block truncate">{t("intoDocument", { title: org.documentTitle })}</span>
                ) : null}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
