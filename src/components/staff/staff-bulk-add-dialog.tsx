"use client";
import { phoneInputProps } from "@/lib/phone-input";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { toastApiError } from "@/lib/billing-limit-toast";
import { cn } from "@/lib/utils";
import { WEEKDAY_LABELS, DEFAULT_WEEKLY_DAYS_OFF } from "@/lib/staff-days-off";
import { parseStaffRows } from "@/lib/staff-bulk-parse";

/**
 * Добавление сотрудников таблицей.
 *
 * Ради одного человека открывать эту таблицу незачем — для этого есть
 * обычная форма. Здесь другой сценарий: завести смену целиком, когда
 * список уже лежит в Excel или в голове. Отсюда и решения:
 *
 * — Строк сразу пять и они пустые: пустая таблица с кнопкой «добавить
 *   строку» заставляет сделать лишний клик прежде, чем начать работу.
 * — Вставка из Excel по Ctrl+V разбирает буфер тем же кодом, что и
 *   сервер (`staff-bulk-parse`), — расхождений между «вставил» и
 *   «загрузил файлом» быть не может.
 * — Журналы по умолчанию НЕ указываются: доступ наследуется от
 *   должности, как при добавлении по одному. Это ответ на вопрос «по
 *   журналам хз как указать» — в подавляющем большинстве случаев их и
 *   не надо указывать, набор уже настроен у должности.
 */

export type BulkPosition = { id: string; name: string; categoryKey: string };

type Row = {
  id: string;
  fullName: string;
  positionId: string;
  phone: string;
  weeklyDaysOff: number[];
  telegramInvite: boolean;
  error?: string;
};

function emptyRow(): Row {
  return {
    id: Math.random().toString(36).slice(2),
    fullName: "",
    positionId: "",
    phone: "",
    weeklyDaysOff: [...DEFAULT_WEEKLY_DAYS_OFF],
    telegramInvite: false,
  };
}

export function StaffBulkAddDialog({
  positions,
  onClose,
  onDone,
}: {
  positions: BulkPosition[];
  onClose: () => void;
  onDone: (createdCount: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => [
    emptyRow(),
    emptyRow(),
    emptyRow(),
    emptyRow(),
    emptyRow(),
  ]);
  const [busy, setBusy] = useState(false);
  const pasteRef = useRef<HTMLDivElement | null>(null);

  const positionByName = useMemo(
    () => new Map(positions.map((item) => [item.name.toLowerCase(), item])),
    [positions]
  );

  const filled = rows.filter(
    (row) => row.fullName.trim() !== "" || row.positionId !== ""
  );

  function patch(id: string, next: Partial<Row>) {
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, ...next, error: undefined } : row
      )
    );
  }

  function toggleDayOff(id: string, day: number) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const has = row.weeklyDaysOff.includes(day);
        return {
          ...row,
          weeklyDaysOff: has
            ? row.weeklyDaysOff.filter((item) => item !== day)
            : [...row.weeklyDaysOff, day].sort((a, b) => a - b),
        };
      })
    );
  }

  /**
   * Вставка из буфера. Ловим на контейнере, а не на каждом поле: человек
   * копирует блок ячеек из Excel и вставляет куда попал курсор.
   */
  function handlePaste(event: React.ClipboardEvent) {
    const text = event.clipboardData.getData("text/plain");
    if (!text || !text.includes("\t")) return;
    event.preventDefault();

    const parsed = parseStaffRows(text);
    if (parsed.rows.length === 0) {
      toast.error("Не нашёл ни одной строки. Нужны ФИО и должность.");
      return;
    }

    const next: Row[] = parsed.rows.map((row) => {
      const position = positionByName.get(row.positionName.toLowerCase());
      return {
        ...emptyRow(),
        fullName: row.fullName,
        positionId: position?.id ?? "",
        phone: row.phone,
        weeklyDaysOff:
          row.weeklyDaysOff.length > 0
            ? row.weeklyDaysOff
            : [...DEFAULT_WEEKLY_DAYS_OFF],
        telegramInvite: row.telegramInvite,
        error: position
          ? undefined
          : `Должность «${row.positionName}» не найдена — выберите из списка`,
      };
    });

    // Уже заполненные строки не затираем: человек мог что-то ввести
    // руками, а потом довставить остальных из таблицы.
    setRows((current) => [...current.filter((row) => row.fullName.trim()), ...next]);
    const unknown = next.filter((row) => row.error).length;
    toast.success(
      unknown > 0
        ? `Вставлено ${next.length}, из них ${unknown} без должности`
        : `Вставлено строк: ${next.length}`
    );
  }

  async function submit() {
    const payload = filled.map((row) => ({
      row,
      data: {
        fullName: row.fullName.trim(),
        positionName:
          positions.find((item) => item.id === row.positionId)?.name ?? "",
        jobPositionId: row.positionId,
        phone: row.phone.trim(),
        weeklyDaysOff: row.weeklyDaysOff,
        telegramInvite: row.telegramInvite,
      },
    }));

    const invalid = payload.filter(
      (item) => item.data.fullName.length < 2 || !item.data.jobPositionId
    );
    if (invalid.length > 0) {
      setRows((current) =>
        current.map((row) =>
          invalid.some((item) => item.row.id === row.id)
            ? {
                ...row,
                error:
                  row.fullName.trim().length < 2
                    ? "Укажите ФИО"
                    : "Выберите должность",
              }
            : row
        )
      );
      toast.error("Проверьте подсвеченные строки");
      return;
    }
    if (payload.length === 0) {
      toast.error("Заполните хотя бы одну строку");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/staff/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload.map((item) => item.data) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Не удалось добавить");

      const serverErrors: Array<{ line: number; message: string }> =
        data?.errors ?? [];

      if (serverErrors.length > 0) {
        // Успешные строки убираем, ошибочные оставляем для правки —
        // иначе человеку пришлось бы набирать всю таблицу заново
        // из-за одной опечатки в должности.
        const failedIndexes = new Set(serverErrors.map((item) => item.line - 1));
        const failedRows: Row[] = [];
        payload.forEach((item, index) => {
          if (!failedIndexes.has(index)) return;
          failedRows.push({
            ...item.row,
            error:
              serverErrors.find((error) => error.line - 1 === index)?.message ??
              "Не удалось добавить",
          });
        });
        setRows(failedRows.length > 0 ? failedRows : [emptyRow()]);
        toast.error(
          `Добавлено ${data?.created ?? 0}, не прошло ${serverErrors.length}`
        );
        // Часть строк упёрлась в лимит бесплатного тарифа — отдельно, с
        // кнопкой «Оплатить».
        if (data?.billingLimit) toastApiError(data.billingLimit, "Лимит тарифа");
        onDone(data?.created ?? 0);
        return;
      }

      const skipped = data?.skipped ?? 0;
      toast.success(
        skipped > 0
          ? `Добавлено ${data?.created ?? 0}, пропущено как уже заведённых ${skipped}`
          : `Добавлено сотрудников: ${data?.created ?? 0}`
      );
      onDone(data?.created ?? 0);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[13.5px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0b1024]/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <BodyScrollLock />
      <div className="flex max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-full max-w-[1100px] flex-col overflow-hidden rounded-t-3xl border border-[#ececf4] bg-white shadow-[0_40px_100px_-30px_rgba(11,16,36,0.5)] sm:rounded-3xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#eef0f6] px-6 py-5">
          <div>
            <h2 className="text-[18px] font-semibold text-[#0b1024]">
              Добавить несколько сотрудников
            </h2>
            <p className="mt-1 max-w-[720px] text-[13px] leading-[1.55] text-[#6f7282]">
              Заполните строки или вставьте их из Excel — скопируйте столбцы
              «ФИО», «Должность», «Телефон» и нажмите Ctrl+V прямо здесь.
              Доступ к журналам сотрудник получит от своей должности.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
            aria-label="Закрыть"
          >
            <X className="size-5" />
          </button>
        </div>

        <div
          ref={pasteRef}
          onPaste={handlePaste}
          className="flex-1 overflow-auto px-6 py-4"
        >
          <table className="w-full border-separate border-spacing-y-1.5">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                <th className="w-[26%] pb-1">ФИО</th>
                <th className="w-[20%] pb-1">Должность</th>
                <th className="w-[18%] pb-1">Телефон</th>
                <th className="w-[24%] pb-1">Выходные</th>
                <th className="w-[8%] pb-1 text-center">Telegram</th>
                <th className="w-[4%] pb-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="pr-2">
                    <input
                      value={row.fullName}
                      onChange={(event) =>
                        patch(row.id, { fullName: event.target.value })
                      }
                      placeholder="Иванова Мария Петровна"
                      className={cn(
                        field,
                        row.error && "border-[#d2453d] ring-4 ring-[#d2453d]/10"
                      )}
                    />
                    {row.error ? (
                      <div className="mt-1 text-[12px] leading-snug text-[#a13a32]">
                        {row.error}
                      </div>
                    ) : null}
                  </td>
                  <td className="pr-2">
                    {/* Здесь намеренно нативный список, а не поповер как
                        в остальном интерфейсе: это таблица «как в
                        Excel», и десять поповеров подряд в ней
                        неработоспособны. Гадать не приходится —
                        варианты те же должности, что заведены. */}
                    <select
                      value={row.positionId}
                      onChange={(event) =>
                        patch(row.id, { positionId: event.target.value })
                      }
                      className={cn(field, "cursor-pointer")}
                    >
                      <option value="">Выберите…</option>
                      {positions.map((position) => (
                        <option key={position.id} value={position.id}>
                          {position.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="pr-2">
                    <input
                      {...phoneInputProps(row.phone, (value) => patch(row.id, { phone: value }))}
                      placeholder="можно не указывать"
                      className={field}
                    />
                  </td>
                  <td className="pr-2">
                    <div className="flex flex-wrap gap-1">
                      {WEEKDAY_LABELS.map((label, day) => {
                        const active = row.weeklyDaysOff.includes(day);
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() => toggleDayOff(row.id, day)}
                            className={cn(
                              "h-8 w-8 rounded-lg border text-[12px] font-medium transition-colors",
                              active
                                ? "border-[#5566f6] bg-[#5566f6] text-white"
                                : "border-[#dcdfed] bg-white text-[#6f7282] hover:bg-[#f5f6ff]"
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={row.telegramInvite}
                      onChange={(event) =>
                        patch(row.id, { telegramInvite: event.target.checked })
                      }
                      className="mt-2.5 size-4 accent-[#5566f6]"
                      aria-label="Пригласить в Telegram"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        setRows((current) =>
                          current.length > 1
                            ? current.filter((item) => item.id !== row.id)
                            : [emptyRow()]
                        )
                      }
                      className="mt-1.5 rounded-lg p-2 text-[#9b9fb3] transition-colors hover:bg-[#fff4f2] hover:text-[#a13a32]"
                      aria-label="Убрать строку"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            type="button"
            onClick={() => setRows((current) => [...current, emptyRow()])}
            className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <Plus className="size-4" />
            Ещё строка
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#eef0f6] px-6 py-4">
          <div className="text-[13px] text-[#6f7282]">
            Заполнено строк: <span className="tabular-nums">{filled.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:bg-[#f5f6ff]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || filled.length === 0}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Добавить {filled.length > 0 ? filled.length : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
