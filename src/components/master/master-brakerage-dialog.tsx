"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Check, CheckCircle2, FilePlus2, ListChecks, Send, UtensilsCrossed } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeTypedTime, setTimeForAll } from "@/lib/finished-product-bulk";
import { FINISHED_PRODUCT_ORGANOLEPTIC_DISH } from "@/lib/finished-product-document";
import type { MasterBrakerageResult } from "@/lib/master-brakerage";
import type { SharedItem } from "@/lib/master-directory";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";

/** Как MASTER_BRAKERAGE_ROWS_MAX на сервере: меню одного дня. */
const ROWS_MAX = 200;
const START_ROWS = 5;
const ORGANOLEPTIC_DEFAULT = "__journal_default__";

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return y && m && d ? `${d}.${m}.${y}` : date;
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menu: SharedItem[];
  organizationsCount: number;
}) {
  const [rows, setRows] = useState<BulkDishRow[]>(() => emptyBulkDishRows(START_ROWS));
  const [date, setDate] = useState(todayKey);
  const [commonTime, setCommonTime] = useState("");
  const [organoleptic, setOrganoleptic] = useState(ORGANOLEPTIC_DEFAULT);
  const [releaseAllowed, setReleaseAllowed] = useState<"yes" | "no">("yes");
  const [productTemp, setProductTemp] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<MasterBrakerageResult | null>(null);
  const [result, setResult] = useState<MasterBrakerageResult | null>(null);

  // Каждое открытие — свежая дата «сегодня», если её не меняли в этом окне.
  useEffect(() => {
    if (open && !date) setDate(todayKey());
  }, [open, date]);

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
  const canSubmit = named.length > 0 && Boolean(date) && withoutTime === 0 && badTimes === 0 && organizationsCount > 0;

  function payload(dryRun: boolean) {
    return {
      date,
      dryRun,
      rows: named.map((row) => ({ name: row.name, yield: row.yield, time: normalizeTypedTime(row.time) })),
      common: {
        time: commonNormalized,
        organoleptic: organoleptic === ORGANOLEPTIC_DEFAULT ? "" : organoleptic,
        releaseAllowed,
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
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const next = await send(true);
      if (!next) return;
      setPreview(next);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const done = await send(false);
    if (!done) return;
    setPreview(null);
    setResult(done);
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
          : "Меню кабинета пустое — впишите блюда или вставьте из Excel."}
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
        Взять меню
      </button>
    </div>
  );

  const commonFields = (
    <div className="min-w-0 space-y-5">
      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">Дата и время изготовления</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Input
            type="date"
            aria-label="Дата изготовления"
            className="block h-11 w-full min-w-0 appearance-none rounded-xl border-[#dcdfed] px-3 text-left text-[15px]"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            data-testid="master-brakerage-date"
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

      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">Разрешение к реализации</Label>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Разрешение к реализации">
          {(
            [
              ["yes", "Разрешено", "#136b2a", "rgba(19,107,42,0.18)"],
              ["no", "Не разрешено", "#d2453d", "rgba(210,69,61,0.18)"],
            ] as const
          ).map(([value, label, fg, ring]) => {
            const active = releaseAllowed === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setReleaseAllowed(value)}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-[14px] font-medium transition-all duration-150 ${active ? "border-transparent text-white shadow-[0_8px_20px_-10px_rgba(11,16,36,0.35)]" : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]"}`}
                style={active ? { backgroundColor: fg, boxShadow: `0 0 0 4px ${ring}` } : undefined}
              >
                {active ? <Check className="size-4" strokeWidth={3} /> : null}
                {label}
              </button>
            );
          })}
        </div>
      </div>

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
          <Label className="text-[13px] font-medium text-[#3c4053]">Примечание</Label>
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
        title="Добавить в журналы на дату"
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
        submitLabel={organizationsCount > 0 ? `Добавить в ${kitchens(organizationsCount)}` : "Нет подключённых пищеблоков"}
        submitDisabled={!canSubmit}
        submitting={busy}
        onSubmit={() => void openPreview()}
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
