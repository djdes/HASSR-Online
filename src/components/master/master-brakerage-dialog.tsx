"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, FilePlus2, ListChecks, Send, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

import {
  FinishedProductBulkDialog,
  FinishedProductBulkTable,
  emptyBulkDishRows,
  type BulkDishRow,
} from "@/components/journals/finished-product-bulk-dialog";
import { TimeEntryField, isBadTypedTime } from "@/components/journals/time-entry-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { BrakerageDateInput } from "@/components/journals/brakerage-time-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeTypedTime, setTimeForAll } from "@/lib/finished-product-bulk";
import { FINISHED_PRODUCT_ORGANOLEPTIC_DISH } from "@/lib/finished-product-document";
import type { MasterBrakerageResult } from "@/lib/master-brakerage";
import type { MasterBrakerageHistoryBatch } from "@/lib/master-brakerage-history";
import type { SharedItem } from "@/lib/master-directory";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";
import { brakerageCommentRequired, brakerageRelease } from "@/lib/brakerage-assessment";

/** Как MASTER_BRAKERAGE_ROWS_MAX на сервере: меню одного дня. */
const ROWS_MAX = 200;
const START_ROWS = 5;
const ORGANOLEPTIC_DEFAULT = "__journal_default__";

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

function menuToRows(menu: SharedItem[]): BulkDishRow[] {
  const rows = menu.slice(0, ROWS_MAX).map((item) => ({ name: item.name, yield: item.portion ?? "", time: item.time ?? "" }));
  // Пустая строка в конце — сразу дописать блюдо или вставить из Excel.
  return rows.length < ROWS_MAX ? [...rows, ...emptyBulkDishRows(1)] : rows;
}

/**
 * «Добавить в журналы на дату» мастер-кабинета: то же окно, что «Добавить
 * изделия списком» в БЖГП пищеблока (общий компонент), только строки
 * уходят в БЖГП всех пищеблоков пула на выбранную дату. Порядок: окно →
 * предпросмотр «куда и сколько» → запись → итог по каждому пищеблоку.
 */
export function MasterBrakerageDialog({
  open,
  onOpenChange,
  menu,
  organizationsCount,
  editingBatch = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menu: SharedItem[];
  organizationsCount: number;
  editingBatch?: MasterBrakerageHistoryBatch | null;
}) {
  const [rows, setRows] = useState<BulkDishRow[]>(() => emptyBulkDishRows(START_ROWS));
  const [date, setDate] = useState("");
  const [commonTime, setCommonTime] = useState("");
  const [organoleptic, setOrganoleptic] = useState(ORGANOLEPTIC_DEFAULT);
  const [productTemp, setProductTemp] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<MasterBrakerageResult | null>(null);
  const [result, setResult] = useState<MasterBrakerageResult | null>(null);
  const [historyVersion, setHistoryVersion] = useState("");
  const [scope, setScope] = useState<"" | "history" | "all" | "selected">("");
  const [selectedOrganizations, setSelectedOrganizations] = useState<string[]>([]);
  const returningFromPreview = useRef(false);
  const recipients = editingBatch?.result?.organizations.filter(org => org.added > 0 && org.documentId) ?? [];

  useEffect(() => {
    if (!open) return;
    if (returningFromPreview.current) { returningFromPreview.current = false; return; }
    setScope("");
    setSelectedOrganizations([]);
    if (!editingBatch) {
      setRows(menuToRows(menu)); setDate(""); setCommonTime("");
      setOrganoleptic(ORGANOLEPTIC_DEFAULT); setProductTemp(""); setNote("");
      return;
    }
    const input = editingBatch.input;
    setRows(input.rows);
    setDate(input.date);
    setCommonTime(input.common.time);
    setOrganoleptic(input.common.organoleptic || ORGANOLEPTIC_DEFAULT);

    setProductTemp(input.common.productTemp);
    setNote(input.common.note);
    setHistoryVersion(editingBatch.updatedAt);
  }, [open, editingBatch, menu]);

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

  /** Пустой выход строки — из меню мастера по наименованию (как у пищеблока). */
  const menuByName = useMemo(() => new Map(menu.map((item) => [item.name.trim().toLowerCase(), item])), [menu]);
  const fillYields = (list: BulkDishRow[]) =>
    list.map((row) => {
      if (row.yield.trim() !== "" && !row.yieldAuto) return row;
      const fromMenu = row.name.trim() ? menuByName.get(row.name.trim().toLowerCase())?.portion ?? "" : "";
      if (fromMenu) return row.yield === fromMenu && row.yieldAuto ? row : { ...row, yield: fromMenu, yieldAuto: true };
      return row.yieldAuto ? { ...row, yield: "", yieldAuto: false } : row;
    });

  const named = rows.filter((row) => row.name.trim() !== "");
  const commonNormalized = normalizeTypedTime(commonTime);
  const withoutTime = named.filter((row) => !normalizeTypedTime(row.time) && !commonNormalized).length;
  const badTimes = rows.filter((row) => isBadTypedTime(row.time)).length + (isBadTypedTime(commonTime) ? 1 : 0);
  const canSubmit = named.length > 0 && Boolean(date) && withoutTime === 0 && badTimes === 0 && (editingBatch !== null || organizationsCount > 0);

  function payload(dryRun: boolean) {
    return {
      date,
      dryRun,
      rows: named.map((row) => ({ name: row.name, yield: row.yield, time: normalizeTypedTime(row.time) })),
      common: {
        time: commonNormalized,
        organoleptic: organoleptic === ORGANOLEPTIC_DEFAULT ? "" : organoleptic,
        releaseAllowed: brakerageRelease(organoleptic),
        productTemp,
        note,
      },
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
    const { added, organizations, failed } = done.totals;
    const text = `Добавлено ${rowsLabel(added)} в ${kitchens(organizations)}`;
    if (failed > 0) toast.warning(`${text}; не удалось — ${kitchens(failed)}`);
    else toast.success(text);
    if (added > 0) setRows(emptyBulkDishRows(START_ROWS));
  }

  const top = (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[12.5px] leading-[1.5] text-[#3c4053]">
        {menu.length > 0
          ? `Взять ${menu.length} ${pluralRu(menu.length, "блюдо", "блюда", "блюд")} из меню кабинета — с выходом и временем, потом уберите лишнее.`
          : "Справочник кабинета пуст — впишите блюда или вставьте из Excel."}
        {menu.length > ROWS_MAX ? ` За одну выгрузку — не более ${ROWS_MAX} блюд; сейчас выбраны первые ${ROWS_MAX}. Остальные выгрузите отдельно.` : ""}
      </p>
      <button
        type="button"
        onClick={() => {
          setRows(menuToRows(menu));
          toast.success(`В таблице ${menu.length > ROWS_MAX ? `первые ${ROWS_MAX}` : menu.length} из меню`);
        }}
        disabled={menu.length === 0}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="master-brakerage-take-menu"
      >
        <UtensilsCrossed className="size-4" />
        Взять из справочника
      </button>
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <BrakerageDateInput
            aria-label="Дата изготовления"
            className="block h-11 w-full min-w-0 appearance-none rounded-xl border-[#dcdfed] px-3 text-left text-[15px]"
            value={date}
            onChange={setDate}
            data-testid="master-brakerage-date"
            required
          />
          <TimeEntryField
            value={commonTime}
            onChange={setCommonTime}
            ariaLabel="Время для всех строк"
            placeholder="Время для всех строк"
            testId="master-brakerage-time-all"
            inputClassName="h-11"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!commonNormalized || named.length === 0}
            onClick={() => {
              setRows((prev) => setTimeForAll(prev, commonNormalized));
              toast.success(`Время ${commonNormalized} — всем строкам`);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#dcdfed] bg-white px-3 text-[12.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="master-brakerage-time-apply-all"
          >
            <ListChecks className="size-3.5" />
            Проставить всем строкам
          </button>
          <span className="text-[12px] leading-snug text-[#6f7282]">
            Строки без своего времени получат это время. Можно без двоеточия: 0830 → 08:30.
          </span>
        </div>
        {withoutTime > 0 ? (
          <p className="text-[12px] leading-snug text-[#a13a32]" data-testid="master-brakerage-time-missing">
            У {rowsLabel(withoutTime)} нет времени — укажите «Время для всех строк» или время в строке.
          </p>
        ) : null}
        <p className="rounded-xl bg-[#f5f6ff] px-3 py-2 text-[12.5px] leading-snug text-[#3848c7]">
          Время бракеража и разрешения к реализации посчитается у каждого пищеблока по его настройкам журнала
          (обычно +5 и +5 минут от изготовления). Ответственный и проверяющий — из документа пищеблока.
        </p>
      </div>

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

  return (
    <>
      <FinishedProductBulkDialog
        open={open}
        onOpenChange={onOpenChange}
        title={editingBatch ? "Исправить выгрузку" : "Выгрузить справочник в журналы"}
        description={
          <>
            Блюда из таблицы появятся строками в журнале бракеража готовой продукции (БЖГП) каждого пищеблока на
            выбранную дату. Нет документа на эту дату — он создастся. Повторное добавление тех же блюд с тем же
            временем не задвоит строки.
          </>
        }
        top={top}
        table={
          <FinishedProductBulkTable
            rows={rows}
            onRowsChange={setRows}
            maxRows={ROWS_MAX}
            showYield
            showTime
            fillYields={fillYields}
            timePlaceholder={commonNormalized || "Время"}
          />
        }
        commonFields={commonFields}
        submitLabel={editingBatch ? "Сохранить исправления" : organizationsCount > 0 ? `Выгрузить в ${kitchens(organizationsCount)}` : "Нет подключённых пищеблоков"}
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
