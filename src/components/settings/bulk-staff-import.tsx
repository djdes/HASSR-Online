"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { toastApiError } from "@/lib/billing-limit-toast";
import { toastPlanUpgraded } from "@/lib/plan-upgraded-toast";
import { Button } from "@/components/ui/button";

const PLACEHOLDER = `ФИО\tДолжность\tТелефон
Иван Петров\tПовар\t+7 985 123-45-67
Сергей Поваров\tШеф-повар\t+7 925 555-12-34
Мария Чайкова\tОфициант\t+7 999 444-22-11`;

const ACCEPTED_EXT = [".csv", ".tsv", ".xlsx", ".xls"];
const ACCEPTED_MIME = new Set([
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

type ColumnRole = "fullName" | "position" | "phone" | null;

/**
 * Bulk staff import — три способа подачи данных:
 *   1. Drag-and-drop файл (.xlsx / .xls / .csv / .tsv) — парсим клиентом,
 *      показываем превью + UI маппинга колонок.
 *   2. Кнопка «Выбрать файл» — то же самое через file picker.
 *   3. Paste textarea — fallback для тех, кто копирует прямо из Excel.
 *
 * После маппинга колонок (auto-detect по заголовкам + ручная коррекция)
 * собираем TSV в формате «ФИО\tДолжность\tТелефон» и шлём на /api/staff/bulk.
 * Бэкенд использует fuzzy-match (см. job-position-match.ts) для
 * распознавания должностей с опечатками — менеджер не должен писать
 * точно «Шеф-повар», достаточно «шеф повар».
 */
export function BulkStaffImport() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);

  // File-based import state
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [allRows, setAllRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<ColumnRole & string, number | null>>({
    fullName: null,
    position: null,
    phone: null,
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);

  function reset() {
    setCsv("");
    setHeaders([]);
    setPreviewRows([]);
    setAllRows([]);
    setColumnMap({ fullName: null, position: null, phone: null });
    setFileName(null);
  }

  /**
   * Авто-маппинг по заголовкам: ищем «фио»/«ФИО»/«фамилия» → fullName,
   * «должность»/«роль»/«позиция» → position, «телефон»/«номер»/«phone» →
   * phone. Возвращает индексы или -1 если не нашли.
   */
  function autoMapHeaders(hs: string[]): typeof columnMap {
    const idxMatch = (patterns: string[]) => {
      for (let i = 0; i < hs.length; i++) {
        const norm = hs[i].toLowerCase().trim();
        for (const p of patterns) {
          if (norm.includes(p)) return i;
        }
      }
      return -1;
    };
    return {
      fullName:
        idxMatch(["фио", "имя", "фамилия", "name", "сотрудник"]) >= 0
          ? idxMatch(["фио", "имя", "фамилия", "name", "сотрудник"])
          : null,
      position:
        idxMatch(["должн", "позиц", "роль", "position", "job", "title"]) >= 0
          ? idxMatch(["должн", "позиц", "роль", "position", "job", "title"])
          : null,
      phone:
        idxMatch(["телеф", "номер", "phone", "tel", "моб"]) >= 0
          ? idxMatch(["телеф", "номер", "phone", "tel", "моб"])
          : null,
    };
  }

  /** Auto-detect разделителя для CSV: пробуем `,` `;` `\t`. */
  function detectSeparator(line: string): string {
    const counts = {
      "\t": (line.match(/\t/g) ?? []).length,
      ";": (line.match(/;/g) ?? []).length,
      ",": (line.match(/,/g) ?? []).length,
    };
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0][1] > 0 ? sorted[0][0] : "\t";
  }

  async function handleFile(file: File) {
    setParsing(true);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const lower = file.name.toLowerCase();

      let rows: string[][] = [];

      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        // Lazy-import xlsx — bundle ~400KB, не нужен пока юзер не
        // загрузил Excel-файл.
        const xlsx = await import("xlsx");
        const wb = xlsx.read(buf, { type: "array" });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) {
          throw new Error("Файл не содержит листов");
        }
        const ws = wb.Sheets[firstSheet];
        const aoa = xlsx.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          defval: "",
          blankrows: false,
        });
        rows = aoa.map((row) =>
          (row as unknown[]).map((cell) =>
            cell === null || cell === undefined ? "" : String(cell).trim()
          )
        );
      } else {
        // CSV/TSV/text
        const text = new TextDecoder("utf-8").decode(buf);
        const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
        if (lines.length === 0) {
          throw new Error("Файл пустой");
        }
        const sep = lower.endsWith(".tsv")
          ? "\t"
          : detectSeparator(lines[0]);
        rows = lines.map((line) =>
          line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""))
        );
      }

      if (rows.length < 2) {
        throw new Error(
          "В файле меньше 2 строк (нужны заголовок + хотя бы одна строка данных)"
        );
      }

      const hs = rows[0];
      const dataRows = rows.slice(1).filter((r) => r.some((c) => c !== ""));
      setHeaders(hs);
      setAllRows(dataRows);
      setPreviewRows(dataRows.slice(0, 5));
      setColumnMap(autoMapHeaders(hs));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не смог разобрать файл"
      );
      reset();
    } finally {
      setParsing(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    const okExt = ACCEPTED_EXT.some((e) => lower.endsWith(e));
    const okMime = ACCEPTED_MIME.has(file.type);
    if (!okExt && !okMime) {
      toast.error(
        `Файл «${file.name}» не поддерживается. Используйте .xlsx / .xls / .csv / .tsv`
      );
      return;
    }
    void handleFile(file);
  }

  /** Собирает TSV из allRows + columnMap, возвращает строку для API. */
  function buildTsvFromMapping(): string {
    const { fullName, position, phone } = columnMap;
    if (fullName === null || position === null || phone === null) {
      return "";
    }
    const lines: string[] = [];
    for (const r of allRows) {
      const name = r[fullName] ?? "";
      const pos = r[position] ?? "";
      const ph = r[phone] ?? "";
      if (!name && !pos && !ph) continue;
      lines.push([name, pos, ph].join("\t"));
    }
    return lines.join("\n");
  }

  async function submit() {
    const payload = allRows.length > 0 ? buildTsvFromMapping() : csv;
    if (!payload.trim()) {
      toast.error(
        allRows.length > 0
          ? "Сначала укажите соответствие колонок"
          : "Вставьте данные или загрузите файл"
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/staff/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Ошибка импорта");
      const errCount = (data.errors ?? []).length;
      const autoMatched = data.autoMatched ?? 0;
      toast.success(
        `Создано: ${data.created}, пропущено (дубли): ${data.skipped}` +
          (autoMatched > 0
            ? `, авто-распознано должностей: ${autoMatched}`
            : "") +
          (errCount > 0 ? `, ошибок: ${errCount}` : "")
      );
      if (data.planUpgraded) toastPlanUpgraded();
      if (data.billingLimit) toastApiError(data.billingLimit, "Лимит тарифа");
      if (errCount > 0) {
        for (const e of data.errors.slice(0, 3)) {
          toast.warning(`Строка ${e.line}: ${e.message}`);
        }
      }
      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-10 rounded-xl border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3a3f55] hover:bg-[#f5f6ff]"
      >
        <Upload className="mr-2 size-4" />
        Импорт CSV / Excel
      </Button>
    );
  }

  const mappingComplete =
    columnMap.fullName !== null &&
    columnMap.position !== null &&
    columnMap.phone !== null;

  return (
    <div className="space-y-4 rounded-2xl border border-[#dcdfed] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold text-[#0b1024]">
          Импорт сотрудников
        </div>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-[13px] text-[#6f7282] hover:text-[#0b1024]"
        >
          Отмена
        </button>
      </div>

      {/* File picker / drop zone */}
      {allRows.length === 0 ? (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
              dragOver
                ? "border-[#5566f6] bg-[#f5f6ff]"
                : "border-[#dcdfed] bg-[#fafbff] hover:border-[#5566f6]/50 hover:bg-[#f5f6ff]"
            }`}
          >
            {parsing ? (
              <>
                <Loader2 className="mb-2 size-7 animate-spin text-[#5566f6]" />
                <div className="text-[13px] font-medium text-[#0b1024]">
                  Разбираю файл…
                </div>
              </>
            ) : (
              <>
                <FileSpreadsheet className="mb-2 size-7 text-[#5566f6]" />
                <div className="text-[14px] font-semibold text-[#0b1024]">
                  Перетащите Excel или CSV сюда
                </div>
                <div className="mt-1 text-[12px] text-[#6f7282]">
                  или кликните, чтобы выбрать файл (.xlsx, .xls, .csv, .tsv)
                </div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXT.join(",")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = ""; // allow re-uploading same file
              }}
              className="hidden"
            />
          </div>

          {/* Paste fallback */}
          <details className="rounded-xl border border-[#ececf4] bg-[#fafbff] px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-[#3a3f55]">
              Или вставьте текстом из Excel / Google Sheets
            </summary>
            <p className="mt-2 text-[12px] leading-snug text-[#6f7282]">
              Колонки: <strong>ФИО</strong> / <strong>Должность</strong> /{" "}
              <strong>Телефон</strong>. Разделитель — табуляция или запятая.
            </p>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={6}
              spellCheck={false}
              className="mt-2 w-full rounded-xl border border-[#dcdfed] bg-white px-3 py-2 font-mono text-[12px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
              placeholder={PLACEHOLDER}
            />
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                onClick={submit}
                disabled={busy || !csv.trim()}
                className="h-10 rounded-xl bg-[#5566f6] px-4 text-[13px] font-medium text-white hover:bg-[#4a5bf0]"
              >
                {busy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 size-4" />
                )}
                Импортировать paste
              </Button>
            </div>
          </details>
        </>
      ) : (
        <>
          {/* File loaded — column mapping + preview */}
          <div className="flex items-center justify-between rounded-xl border border-[#dcdfed] bg-[#fafbff] px-3 py-2">
            <div className="flex items-center gap-2 text-[13px] text-[#0b1024]">
              <FileSpreadsheet className="size-4 text-[#5566f6]" />
              <span className="font-medium">{fileName}</span>
              <span className="text-[#6f7282]">
                · {allRows.length} строк · {headers.length} колонок
              </span>
            </div>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg p-1.5 text-[#6f7282] hover:bg-white"
              aria-label="Сбросить"
            >
              <X className="size-4" />
            </button>
          </div>

          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6f7282]">
              Соответствие колонок
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <ColumnSelector
                label="ФИО *"
                value={columnMap.fullName}
                headers={headers}
                onChange={(idx) =>
                  setColumnMap((m) => ({ ...m, fullName: idx }))
                }
              />
              <ColumnSelector
                label="Должность *"
                value={columnMap.position}
                headers={headers}
                onChange={(idx) =>
                  setColumnMap((m) => ({ ...m, position: idx }))
                }
              />
              <ColumnSelector
                label="Телефон *"
                value={columnMap.phone}
                headers={headers}
                onChange={(idx) =>
                  setColumnMap((m) => ({ ...m, phone: idx }))
                }
              />
            </div>
          </div>

          {/* Preview table */}
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6f7282]">
              Предпросмотр (первые 5 строк)
            </div>
            <div className="overflow-x-auto rounded-xl border border-[#dcdfed]">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-[#fafbff]">
                    {headers.map((h, i) => {
                      const role = (Object.keys(columnMap) as ColumnRole[]).find(
                        (k) =>
                          k && columnMap[k as Exclude<ColumnRole, null>] === i
                      );
                      const labelByRole: Record<string, string> = {
                        fullName: "ФИО",
                        position: "Должность",
                        phone: "Телефон",
                      };
                      return (
                        <th
                          key={i}
                          className="px-2.5 py-1.5 text-left font-medium text-[#3a3f55]"
                        >
                          {h || `Колонка ${i + 1}`}
                          {role ? (
                            <span className="ml-1 rounded-full bg-[#eef1ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#3848c7]">
                              → {labelByRole[role]}
                            </span>
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="border-t border-[#ececf4]">
                      {headers.map((_, ci) => (
                        <td key={ci} className="px-2.5 py-1.5 text-[#0b1024]">
                          {row[ci] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            {!mappingComplete ? (
              <span className="text-[12px] text-[#a13a32]">
                Укажите все три колонки
              </span>
            ) : (
              <span className="text-[12px] text-[#116b2a]">
                Готово к импорту: {allRows.length} строк
              </span>
            )}
            <Button
              type="button"
              onClick={submit}
              disabled={busy || !mappingComplete}
              className="h-11 rounded-xl bg-[#5566f6] px-4 text-[13px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              Импортировать {allRows.length} строк
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ColumnSelector({
  label,
  value,
  headers,
  onChange,
}: {
  label: string;
  value: number | null;
  headers: string[];
  onChange: (idx: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-[#3a3f55]">
        {label}
      </span>
      <select
        value={value === null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        className="mt-1 h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-2 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
      >
        <option value="">— выберите колонку —</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Колонка ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
