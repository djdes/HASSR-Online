"use client";

import { Hammer, Wrench } from "lucide-react";

import {
  COLD_EQUIPMENT_STATUSES,
  COLD_EQUIPMENT_STATUS_SHORT,
  COLD_EQUIPMENT_STATUS_TITLE,
  type ColdEquipmentStatus,
} from "@/lib/cold-equipment-document";

const ICONS = { service: Wrench, repair: Hammer } as const;

/**
 * «Обслуживание» / «Ремонт» вместо температуры (2026-09-25): холодильник
 * на обслуживании или в ремонте — замера нет, в журнал ляжет «обсл»/«рем».
 * Повторное нажатие снимает выбор и возвращает поле температуры.
 */
export function EquipmentStatusChoice({
  value,
  onChange,
}: {
  value: ColdEquipmentStatus | null;
  onChange: (next: ColdEquipmentStatus | null) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 ml-[3px] text-[13px] text-[#6f7282]">Или вместо температуры:</div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Вместо температуры">
        {COLD_EQUIPMENT_STATUSES.map((status) => {
          const active = value === status;
          const Icon = ICONS[status];
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              data-testid={`equipment-status-${status}`}
              onClick={() => onChange(active ? null : status)}
              className={`flex h-14 items-center justify-center gap-2 rounded-2xl border text-[17px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                active
                  ? "border-[#5566f6] bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]"
                  : "border-[#dcdfed] bg-white text-[#3848c7] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              }`}
            >
              <Icon className="size-5" />
              {COLD_EQUIPMENT_STATUS_TITLE[status]}
            </button>
          );
        })}
      </div>
      {value ? (
        <p className="mt-2 rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-2.5 text-[14px] leading-snug text-[#3848c7]" data-testid="equipment-status-note">
          В журнал вместо температуры запишем «{COLD_EQUIPMENT_STATUS_SHORT[value]}». Норма не проверяется.
        </p>
      ) : null}
    </div>
  );
}
