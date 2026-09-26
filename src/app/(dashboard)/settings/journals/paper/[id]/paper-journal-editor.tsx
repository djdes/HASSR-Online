"use client";

import { useEffect, useState } from "react";
import {
  Download,
  Eraser,
  Plus,
  Printer,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { saveBlob } from "@/lib/native-bridge";
import type { PaperJournal } from "@/lib/sphere-journal-rules";
import {
  fillRowForStaff,
  formatPaperDate,
  hasSubjectColumn,
  type PaperStaffMember,
} from "@/lib/paper-journal-columns";

type Organization = {
  name: string;
  inn: string | null;
  address: string | null;
};

export type PaperPeriod = { from: string | null; to: string | null };

const START_ROWS = 5;

/** Сегодняшняя дата в том виде, в каком её пишут в бланке. */
function todayLabel(): string {
  return new Date().toLocaleDateString("ru-RU");
}

function emptyRows(journal: PaperJournal): string[][] {
  return Array.from({ length: START_ROWS }, () => journal.columns.map(() => ""));
}

/**
 * Редактор бланка бумажного журнала.
 *
 * Два режима:
 * - `draft` — черновик на странице журнала: пустые строки, кнопка
 *   «Подставить сотрудников», ничего не сохраняется. Нужен, чтобы быстро
 *   вбить пару строк, скачать и распечатать.
 * - `document` — открытый документ: строки хранятся в БД и сохраняются
 *   сами через полсекунды после правки. Ответственный, проверяющий и
 *   период выбраны при создании и приходят пропсами; при первом открытии
 *   пустого документа сотрудники подставляются в строки сразу.
 *
 * Подписи, год рождения и вид инструктажа не трогаем: в бумажном журнале
 * они живые, в этом весь его смысл.
 */
export function PaperJournalEditor({
  mode,
  journal,
  organization,
  staff = [],
  documentId,
  initialRows,
  responsible = "",
  verifier = "",
  period = { from: null, to: null },
  readOnly = false,
}: {
  mode: "draft" | "document";
  journal: PaperJournal;
  organization: Organization;
  /** Активные сотрудники — ими заполняются строки бланка. */
  staff?: PaperStaffMember[];
  /** Открытый документ (только в режиме `document`). */
  documentId?: string;
  initialRows?: string[][];
  /** Кто инструктирует / отвечает — из документа. */
  responsible?: string;
  /** Кто проверяет — из документа, есть не у всех журналов. */
  verifier?: string;
  /** Период документа `YYYY-MM-DD`; в черновике — пусто. */
  period?: PaperPeriod;
  /** Документ закрыт — смотреть можно, править нельзя. */
  readOnly?: boolean;
}) {
  const isDocument = mode === "document";
  const canFillStaff = staff.length > 0 && hasSubjectColumn(journal);
  // Дата в строках: у документа — начало периода, у черновика — сегодня.
  const rowDateLabel = period.from ? formatPaperDate(period.from) : todayLabel();

  function staffRows(): string[][] {
    return staff.map((person) =>
      fillRowForStaff(journal.columns, person, {
        responsible,
        verifier,
        dateLabel: rowDateLabel,
      }),
    );
  }

  const [rows, setRows] = useState<string[][]>(() => {
    if (initialRows && initialRows.length > 0) return initialRows;
    // Новый документ: сразу с сотрудниками, как просили при создании.
    // Черновик стартует пустым — это быстрый бланк, а не заготовка.
    if (isDocument && canFillStaff) return staffRows();
    return emptyRows(journal);
  });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Сохранение через полсекунды после последней правки — только у
   * документа. Кнопки «Сохранить» нет намеренно: человек заполняет бланк
   * ячейка за ячейкой, и терять всё из-за закрытой вкладки он не должен.
   */
  useEffect(() => {
    if (!isDocument || !documentId || readOnly) return;
    const timer = setTimeout(() => {
      setSaving(true);
      fetch(
        `/api/settings/journals/paper/${journal.id}/documents/${documentId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        },
      )
        .catch(() => toast.error("Не удалось сохранить"))
        .finally(() => setSaving(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [rows, isDocument, documentId, journal.id, readOnly]);

  function setCell(rowIndex: number, columnIndex: number, value: string) {
    setRows((prev) =>
      prev.map((row, index) =>
        index === rowIndex
          ? row.map((cell, column) => (column === columnIndex ? value : cell))
          : row,
      ),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, journal.columns.map(() => "")]);
  }

  function clearRows() {
    setRows(emptyRows(journal));
  }

  function removeRow(rowIndex: number) {
    setRows((prev) => prev.filter((_, index) => index !== rowIndex));
  }

  /** «Подставить сотрудников»: пустые строки заменяем, заполненные оставляем. */
  function fillStaff() {
    setRows((prev) => {
      const kept = prev.filter((row) => row.some((cell) => cell.trim()));
      return [...kept, ...staffRows()];
    });
  }

  /**
   * PDF собирается на сервере: там уже лежит шрифт с кириллицей и общая
   * вёрстка бланка, дублировать её на клиенте незачем.
   */
  async function download(withRows: boolean) {
    setBusy(true);
    try {
      const filled = rows.filter((row) => row.some((cell) => cell.trim()));
      const response = await fetch(
        `/api/settings/journals/paper/${journal.id}/pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: withRows ? filled : [],
            dateFrom: isDocument ? period.from : null,
            dateTo: isDocument ? period.to : null,
          }),
        },
      );
      if (!response.ok) throw new Error("Не удалось собрать бланк");
      const blob = await response.blob();
      // В браузере — скачивание, в приложении WeSetup — «Поделиться».
      await saveBlob(blob, `${journal.id}.pdf`);
      toast.success("Бланк готов — откройте файл и распечатайте");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const startedLabel = period.from ? formatPaperDate(period.from) : todayLabel();
  const finishedLabel = period.to ? formatPaperDate(period.to) : "__________";

  return (
    <div className="space-y-5">
      {/* Шапка бланка — так же, как в электронных журналах: человек видит,
          что именно уйдёт в печать. Разметка повторяет верх PDF:
          организация слева, система по центру, даты справа. */}
      {/* Шапка и таблица строк — ОДИН горизонтальный скроллер: на телефоне
          они едут вместе, как единый лист (раньше у каждой был свой
          overflow-x-auto, и шапка уезжала отдельно от колонок).
          `data-journal-doc-pan` — та же pan-зона, что у электронных
          документов: выключает blanket-правило globals.css, которое на
          мобильном делает скроллером КАЖДЫЙ div вокруг широкой таблицы. */}
      <div
        data-journal-doc-pan
        className="overflow-x-auto max-sm:-mx-4 max-sm:px-4"
      >
      {/* `w-fit min-w-full`: обе таблицы растягиваются до ширины самой
          широкой из них — правая вертикаль шапки совпадает с краем таблицы. */}
      <div className="w-fit min-w-full">
      <section>
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <tbody>
            <tr>
              <td
                rowSpan={2}
                className="w-[34%] border border-[#0b1024] px-3 py-2 text-center align-middle font-semibold"
              >
                {organization.name}
                {organization.inn ? (
                  <div className="mt-0.5 text-[11px] font-normal text-[#3c4053]">
                    ИНН {organization.inn}
                  </div>
                ) : null}
                {organization.address ? (
                  <div className="text-[11px] font-normal text-[#3c4053]">
                    {organization.address}
                  </div>
                ) : null}
              </td>
              <td className="border border-[#0b1024] px-3 py-2 text-center">
                СИСТЕМА ХАССП
              </td>
              <td className="w-[22%] border border-[#0b1024] px-3 py-2 text-[12px]">
                Начат&nbsp;&nbsp;{startedLabel}
                <div className="mt-1">Окончен&nbsp;&nbsp;{finishedLabel}</div>
              </td>
            </tr>
            <tr>
              <td className="border border-[#0b1024] px-3 py-2 text-center italic">
                {journal.name}
              </td>
              <td className="border border-[#0b1024] px-3 py-2 text-center text-[12px]">
                СТР. 1 ИЗ 1
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="mt-3 rounded-2xl border border-[#ececf4] bg-white">
        <table className="w-full min-w-[720px] text-[14px]">
          <thead className="bg-[#f6f7fb] text-[13px] text-[#6f7282]">
            <tr>
              <th className="w-[46px] px-3 py-2 text-center font-medium">№</th>
              {journal.columns.map((column) => (
                <th key={column} className="px-3 py-2 text-left font-medium">
                  {column}
                </th>
              ))}
              <th className="w-[52px] px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-[#eef0f6]">
                <td className="px-3 py-1.5 text-center text-[13px] text-[#9b9fb3]">
                  {rowIndex + 1}
                </td>
                {journal.columns.map((column, columnIndex) => (
                  <td key={column} className="px-1.5 py-1.5">
                    <input
                      value={row[columnIndex] ?? ""}
                      readOnly={readOnly}
                      onChange={(e) =>
                        setCell(rowIndex, columnIndex, e.target.value)
                      }
                      className="h-9 w-full min-w-[120px] rounded-xl border border-transparent bg-transparent px-2 text-[14px] text-[#0b1024] hover:border-[#dcdfed] focus:border-[#5566f6] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 read-only:hover:border-transparent"
                    />
                  </td>
                ))}
                <td className="px-3 py-1.5 text-center">
                  {readOnly ? null : (
                    <button
                      type="button"
                      onClick={() => removeRow(rowIndex)}
                      aria-label="Удалить строку"
                      className="inline-flex size-8 items-center justify-center rounded-xl text-[#9b9fb3] transition-colors hover:bg-[#fff4f2] hover:text-[#d2453d]"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
      </div>

      {isDocument ? (
        <p className="text-[12px] text-[#6f7282]">
          {readOnly
            ? "Документ закрыт — правка недоступна."
            : saving
              ? "Сохраняю…"
              : "Изменения сохраняются сами"}
        </p>
      ) : null}

      {isDocument && canFillStaff && !readOnly ? (
        <p className="rounded-2xl bg-[#f5f6ff] px-4 py-2.5 text-[13px] leading-snug text-[#3c4053]">
          Сотрудники и дата подставлены из карточек — остаётся собрать
          подписи на распечатке. Подписи специально пустые: бумажный журнал
          тем и ценен, что они живые.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {readOnly ? null : (
          <>
            <button
              type="button"
              onClick={addRow}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <Plus className="size-4 text-[#5566f6]" />
              Строка
            </button>
            {canFillStaff ? (
              <button
                type="button"
                onClick={fillStaff}
                title="Добавить строку на каждого активного сотрудника"
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <UserPlus className="size-4 text-[#5566f6]" />
                Подставить сотрудников
              </button>
            ) : null}
            <button
              type="button"
              onClick={clearRows}
              title="Убрать все строки и начать с пустого бланка"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#6f7282] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <Eraser className="size-4" />
              Очистить
            </button>
          </>
        )}
        <div className="flex-1" />
        <button
          type="button"
          disabled={busy}
          onClick={() => download(false)}
          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
        >
          <Download className="size-4 text-[#5566f6]" />
          Пустой бланк
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => download(true)}
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_12px_36px_-16px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
        >
          <Printer className="size-4" />
          {busy ? "Готовлю…" : "Скачать и распечатать"}
        </button>
      </div>

      <p className="text-[13px] text-[#9b9fb3]">
        {isDocument
          ? "Оригинал — распечатанный лист с живыми подписями. Здесь хранится подготовка к печати."
          : "Черновик не сохраняется — чтобы вести журнал с историей, создайте документ."}
      </p>
    </div>
  );
}
