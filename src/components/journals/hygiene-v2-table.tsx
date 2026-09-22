"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, QrCode } from "lucide-react";
import { HYGIENE_V2_COLUMNS, buildHygieneV2Rows, type HygieneV2Row } from "@/lib/hygiene-v2";

/**
 * Гигиенический журнал по форме Приложения №1 СанПиН (документы с
 * `config.hygieneFormVersion = 2`). Только чтение: три графы подписывает
 * сам сотрудник по QR журнала, допуск и подпись ставит ответственный по
 * QR «Гигиенический журнал — допуск». Строка — сотрудник в день.
 */

type Props = {
  dateKeys: string[];
  todayKey?: string;
  employees: { id: string; name: string; position: string | null }[];
  entries: { employeeId: string; dateKey: string; data: unknown }[];
};

const ALL = "all";

function shortDay(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${day}.${month}`;
}

function SignatureCell({ mark }: { mark: string }) {
  if (mark === "✓") {
    return (
      <span className="text-[15px] font-semibold text-[#116b2a]" aria-label="подписано">
        ✓
      </span>
    );
  }
  if (mark === "✗") {
    return (
      <span className="text-[15px] font-semibold text-[#a13a32]" aria-label="не подтверждено">
        ✗
      </span>
    );
  }
  return <span className="text-[#9b9fb3]">—</span>;
}

function ResultCell({ row }: { row: HygieneV2Row }) {
  if (row.resultKind === "admitted") {
    return (
      <span className="inline-flex rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] font-medium text-[#116b2a]">
        {row.result}
      </span>
    );
  }
  if (row.resultKind === "suspended") {
    return (
      <span className="inline-flex rounded-full bg-[#fff4f2] px-2.5 py-1 text-[12px] font-medium text-[#a13a32]">
        {row.result}
      </span>
    );
  }
  return <span className="text-[12px] text-[#9b9fb3]">ждёт проверки</span>;
}

export function HygieneV2Table({ dateKeys, todayKey = "", employees, entries }: Props) {
  const rows = useMemo(
    () => buildHygieneV2Rows({ employees, entries, dateKeys }),
    [employees, entries, dateKeys]
  );
  const [day, setDay] = useState<string>(ALL);

  // Дни-фильтры: дни с отметками + сегодня (если в периоде документа).
  const dayOptions = useMemo(() => {
    const days = new Set(rows.map((row) => row.dateKey));
    if (todayKey && dateKeys.includes(todayKey)) days.add(todayKey);
    return [...days].sort();
  }, [rows, todayKey, dateKeys]);

  const visibleRows = day === ALL ? rows : rows.filter((row) => row.dateKey === day);

  const chipClass = (active: boolean) =>
    `inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
      active
        ? "bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
        : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
    }`;

  return (
    <div className="space-y-4">
      <div className="screen-only flex flex-col gap-3 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 sm:flex-row sm:items-center print:hidden">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <QrCode className="size-5" />
        </div>
        <p className="flex-1 text-[14px] leading-[1.55] text-[#3c4053]">
          Сотрудники подписывают три графы по QR-коду журнала, ответственный ставит допуск по QR
          «Гигиенический журнал — допуск» (Настройки → QR-плакаты).
        </p>
        <Link
          href="/settings/qr-posters?kind=journal"
          className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:self-auto"
        >
          QR-плакаты
          <ArrowRight className="size-4 text-[#5566f6]" />
        </Link>
      </div>

      {dayOptions.length > 0 ? (
        <div className="screen-only -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 print:hidden" role="tablist" aria-label="День">
          <button type="button" role="tab" aria-selected={day === ALL} className={chipClass(day === ALL)} onClick={() => setDay(ALL)}>
            Весь период
          </button>
          {dayOptions.map((dateKey) => (
            <button
              key={dateKey}
              type="button"
              role="tab"
              aria-selected={day === dateKey}
              className={chipClass(day === dateKey)}
              onClick={() => setDay(dateKey)}
            >
              {dateKey === todayKey ? `Сегодня, ${shortDay(dateKey)}` : shortDay(dateKey)}
            </button>
          ))}
        </div>
      ) : null}

      {visibleRows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">
            {day === ALL ? "Пока нет отметок" : "В этот день отметок нет"}
          </div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
            Строка появится, когда сотрудник отсканирует QR-код журнала перед сменой и подпишет три
            графы. Выходные, отпуска и больничные в бланк не попадают.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full min-w-[980px] border-collapse text-[14px] text-[#0b1024]">
            <thead>
              <tr className="bg-[#fafbff]">
                {HYGIENE_V2_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="border-b border-[#ececf4] px-3 py-3 text-left align-bottom text-[12px] font-medium leading-[1.35] text-[#6f7282]"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr
                  key={`${row.employeeId}:${row.dateKey}`}
                  className="border-b border-[#ececf4] transition-colors duration-150 last:border-b-0 hover:bg-[#f5f6ff]"
                >
                  <td className="px-3 py-2.5 tabular-nums text-[#6f7282]">{day === ALL ? row.n : index + 1}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{row.date}</td>
                  <td className="px-3 py-2.5 font-medium">{row.name}</td>
                  <td className="px-3 py-2.5 text-[#3c4053]">{row.position || "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    <SignatureCell mark={row.temperature} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <SignatureCell mark={row.infection} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <SignatureCell mark={row.respiratorySkin} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ResultCell row={row} />
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-[#3c4053]">{row.verifier || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
