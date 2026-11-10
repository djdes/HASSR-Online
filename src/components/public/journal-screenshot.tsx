"use client";

import { useState } from "react";

const CLEANING_PREVIEW_DAYS = [
  { day: 1, wd: "СР", weekend: false },
  { day: 2, wd: "ЧТ", weekend: false },
  { day: 3, wd: "ПТ", weekend: false, general: true },
  { day: 4, wd: "СБ", weekend: true },
  { day: 5, wd: "ВС", weekend: true },
  { day: 6, wd: "ПН", weekend: false },
  { day: 7, wd: "ВТ", weekend: false },
  { day: 8, wd: "СР", weekend: false },
  { day: 9, wd: "ЧТ", weekend: false },
  { day: 10, wd: "ПТ", weekend: false, general: true, today: true },
  { day: 11, wd: "СБ", weekend: true, future: true },
  { day: 12, wd: "ВС", weekend: true, future: true },
  { day: 13, wd: "ПН", weekend: false, future: true },
  { day: 14, wd: "ВТ", weekend: false, future: true },
];

const CLEANING_PREVIEW_ROOMS = [
  {
    name: "Горячий цех",
    code: "С1",
    detergent: "Ника-Супер 1,0 %, Део-Хлор 0,05 %",
    skipWeekend: false,
  },
  {
    name: "Холодный цех",
    code: "С2",
    detergent: "Прогресс 0,5 %, Аламинол 1,0 %",
    skipWeekend: false,
  },
  {
    name: "Моечная",
    code: "С1",
    detergent: "Ника-Экстра М 1,0 %, Хлорамин Б 0,5 %",
    skipWeekend: false,
  },
  {
    name: "Склад сухих продуктов",
    code: "С2",
    detergent: "Прогресс 0,5 %, Ника-Экстра М 0,5 %",
    skipWeekend: true,
  },
];

function CleaningWebInterfacePreview() {
  return (
    <div
      className=" pointer-events-none overflow-hidden rounded-2xl border border-[#ececf4] bg-white select-none shadow-[0_16px_40px_-24px_rgba(11,16,36,0.18)]"
      data-testid="journal-ui-preview-cleaning"
      aria-hidden="true"
    >
      {/* Top Browser / App Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ececf4] bg-[#fafbff] px-4 py-2.5 text-[12px] text-[#6f7282]">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 rounded-md border border-[#e5e7f3] bg-white px-2.5 py-0.5 font-mono text-[11px] text-[#3c4053]">
            wesetup.ru/journals/cleaning
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[11px] font-medium text-[#116b2a]">
            <span className="size-1.5 rounded-full bg-[#16a34a]" />
            Смена заполнена · 4 из 4 зон
          </span>
          <span className="hidden rounded-full bg-[#f1f2f8] px-2.5 py-0.5 text-[11px] font-medium text-[#6f7282] sm:inline-block">
            СанПиН 2.3/2.4.4282-26
          </span>
        </div>
      </div>

      {/* App Workspace */}
      <div className="bg-[#f7f8fc] p-3 sm:p-5">
        {/* Header inside Cabinet (no fake clickable buttons) */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#e6e8f4] bg-white px-4 py-3 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-[#0b1024] sm:text-[16px]">
              Журнал учёта текущих и генеральных уборок
            </span>
            <span className="rounded-md bg-[#f1f2f8] px-2 py-0.5 text-[11px] font-medium text-[#3c4053]">
              Апрель 2026
            </span>
          </div>
          <div className="text-[12px] text-[#6f7282]">
            ООО «Ромашка» · 4 помещения
          </div>
        </div>

        {/* Interactive-looking Matrix Table */}
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[#e6e8f4] bg-white shadow-xs">
          <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#ececf4] bg-[#fafbff] text-[11px] font-semibold text-[#6f7282]">
                <th className="w-[190px] border-r border-[#ececf4] px-3 py-2.5">
                  Помещение и исполнитель
                </th>
                <th className="w-[185px] border-r border-[#ececf4] px-3 py-2.5">
                  Моющие и дезсредства
                </th>
                {CLEANING_PREVIEW_DAYS.map((d) => (
                  <th
                    key={d.day}
                    className={`border-r border-[#ececf4] px-1 py-1.5 text-center last:border-r-0 ${
                      d.today
                        ? "bg-[#eef1ff] text-[#3848c7]"
                        : d.weekend
                          ? "bg-[#f3f4f8] text-[#6f7282]"
                          : ""
                    }`}
                  >
                    <div className="text-[11px] font-semibold leading-tight">{d.day}</div>
                    <div className="text-[9px] font-normal opacity-75">{d.wd}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ececf4]">
              {CLEANING_PREVIEW_ROOMS.map((room) => (
                <tr key={room.name} className="hover:bg-[#fafbff]/60">
                  <td className="border-r border-[#ececf4] px-3 py-2 font-medium text-[#0b1024]">
                    <div className="flex items-center justify-between gap-1.5">
                      <span>{room.name}</span>
                      <span className="shrink-0 rounded bg-[#eef1ff] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#3848c7]">
                        {room.code}
                      </span>
                    </div>
                  </td>
                  <td className="border-r border-[#ececf4] px-3 py-2 text-[11px] leading-snug text-[#6f7282]">
                    {room.detergent}
                  </td>
                  {CLEANING_PREVIEW_DAYS.map((d) => {
                    const mark = d.future
                      ? ""
                      : d.general
                        ? "Г"
                        : d.weekend && room.skipWeekend
                          ? "/-/"
                          : "Т";
                    return (
                      <td
                        key={d.day}
                        className={`border-r border-[#ececf4] p-1 text-center last:border-r-0 ${
                          d.today
                            ? "bg-[#eef1ff]/50"
                            : d.weekend
                              ? "bg-[#f3f4f8]/70"
                              : ""
                        }`}
                      >
                        {mark === "Г" ? (
                          <span className="inline-flex size-6 items-center justify-center rounded-lg bg-[#5566f6] text-[11px] font-bold text-white shadow-2xs">
                            Г
                          </span>
                        ) : mark === "Т" ? (
                          <span className="inline-flex size-6 items-center justify-center rounded-lg bg-[#ecfdf5] text-[11px] font-semibold text-[#116b2a] ring-1 ring-[#bbf7d0]">
                            Т
                          </span>
                        ) : mark === "/-/" ? (
                          <span className="inline-flex size-6 items-center justify-center rounded-lg bg-[#f1f2f8] text-[10px] font-medium text-[#6f7282]">
                            /-/
                          </span>
                        ) : (
                          <span className="inline-flex size-6 items-center justify-center rounded-lg border border-dashed border-[#dcdfed] text-[10px] text-[#c4c8dc]">
                            ·
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Signature rows */}
              <tr className="bg-[#fafbff] text-[11px]">
                <td className="border-r border-[#ececf4] px-3 py-2 font-medium text-[#3c4053]">
                  Ответственный за уборку
                </td>
                <td className="border-r border-[#ececf4] px-3 py-2 text-[10.5px] leading-tight text-[#6f7282]">
                  С1 — Морозова Е. А. · С2 — Сидорова А. В.
                </td>
                {CLEANING_PREVIEW_DAYS.map((d, idx) => (
                  <td
                    key={d.day}
                    className={`border-r border-[#ececf4] px-1 py-2 text-center font-mono text-[10px] font-semibold text-[#3c4053] last:border-r-0 ${
                      d.weekend ? "bg-[#f3f4f8]/70" : ""
                    }`}
                  >
                    {d.future ? "" : idx % 2 === 0 ? "С1" : "С2"}
                  </td>
                ))}
              </tr>
              <tr className="bg-[#fafbff] text-[11px]">
                <td className="border-r border-[#ececf4] px-3 py-2 font-medium text-[#3c4053]">
                  Контролёр (проверил)
                </td>
                <td className="border-r border-[#ececf4] px-3 py-2 text-[10.5px] leading-tight text-[#6f7282]">
                  С1 — Иванова М. П. (зав. производством)
                </td>
                {CLEANING_PREVIEW_DAYS.map((d) => (
                  <td
                    key={d.day}
                    className={`border-r border-[#ececf4] px-1 py-2 text-center font-mono text-[10px] font-semibold text-[#116b2a] last:border-r-0 ${
                      d.weekend ? "bg-[#f3f4f8]/70" : ""
                    }`}
                  >
                    {d.future ? "" : "С1"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Bottom status bar inside interface */}
        <div className="mt-2.5 flex flex-wrap items-center gap-3 px-1 text-[11px] text-[#6f7282]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-xs bg-[#ecfdf5] ring-1 ring-[#bbf7d0]" />
            Т — текущая уборка
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-xs bg-[#5566f6]" />
            Г — генеральная уборка
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-xs bg-[#f1f2f8] ring-1 ring-[#dcdfed]" />
            /-/ — уборка не проводилась
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-xs bg-[#f3f4f8] ring-1 ring-[#dcdfed]" />
            Выходной или праздник
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a screenshot of the authenticated journal page if it was
 * captured by scripts/capture-screenshots.ts. When the live UI screenshot
 * is not present on disk, falls back to the rendered sample sheet
 * (`/journal-samples/<code>.png`) so public journal pages never show an
 * empty broken placeholder.
 */
export function JournalScreenshot({
  code,
  label,
  pendingLabel = "Скриншот будет готов после ближайшего автоматического обхода",
}: {
  code: string;
  label: string;
  pendingLabel?: string;
}) {
  const [stage, setStage] = useState<"screenshot" | "sample" | "failed">("sample");

  if (code === "cleaning") {
    return <CleaningWebInterfacePreview />;
  }

  if (stage === "failed") {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] text-center text-[12px] text-[#9b9fb3]">
        {pendingLabel}
      </div>
    );
  }

  if (stage === "sample") {
    return (
      <div className="overflow-hidden rounded-2xl border border-[#ececf4] bg-white shadow-[0_16px_40px_-24px_rgba(11,16,36,0.18)]">
        <div className="flex items-center justify-between border-b border-[#ececf4] bg-[#fafbff] px-4 py-2.5 text-[12px] text-[#6f7282]">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#e2e4f0]" />
            <span className="size-2.5 rounded-full bg-[#e2e4f0]" />
            <span className="size-2.5 rounded-full bg-[#e2e4f0]" />
            <span className="ml-2 font-mono text-[11px] text-[#6f7282]">
              wesetup.ru/journals/{code}
            </span>
          </div>
          <span className="rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[11px] font-medium text-[#116b2a]">
            СанПиН · ХАССП
          </span>
        </div>
        <picture>
          <source
            media="(max-width: 640px)"
            srcSet={`/journal-samples/${code}.webp`}
            type="image/webp"
          />
          <img
            src={`/journal-samples/${code}.png`}
            alt={label}
            loading="lazy"
            onError={() => setStage("failed")}
            className="aspect-[1228/862] w-full bg-white object-contain object-top p-2 sm:p-4"
          />
        </picture>
      </div>
    );
  }

  return (
    <picture>
      <source
        media="(max-width: 640px)"
        srcSet={`/screenshots/mobile/journals-${code}.png`}
      />
      <source
        media="(max-width: 1023px)"
        srcSet={`/screenshots/tablet/journals-${code}.png`}
      />
      <img
        src={`/screenshots/desktop/journals-${code}.png`}
        alt={label}
        loading="lazy"
        onError={() => setStage("sample")}
        className="aspect-[16/10] w-full rounded-2xl border border-[#ececf4] bg-white object-cover object-top shadow-[0_16px_40px_-24px_rgba(11,16,36,0.18)]"
      />
    </picture>
  );
}

