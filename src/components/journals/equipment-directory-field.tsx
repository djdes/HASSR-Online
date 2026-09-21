"use client";

import { useState } from "react";
import { Link2, Link2Off, Plus } from "lucide-react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { SuggestInput } from "@/components/journals/suggest-input";
import type { EquipmentDirectoryOption } from "@/lib/equipment-directory-link";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * Поле «наименование оборудования» для окон журналов ППР, поверки и
 * поломок.
 *
 * ПОЧЕМУ не просто текст: раньше оборудование хранилось строкой и со
 * справочником `/settings/equipment` не было связано — добавленное в
 * справочник не появлялось в графике, а добавленное в журнале не получало
 * QR. Здесь строка либо ссылается на единицу справочника (имя тогда
 * берётся оттуда), либо остаётся своим текстом, который по кнопке можно
 * завести в справочник.
 */
export function EquipmentDirectoryField({
  label = "Наименование оборудования",
  value,
  sourceEquipmentId,
  directory,
  onChange,
  documentId,
  disabled = false,
}: {
  label?: string;
  value: string;
  sourceEquipmentId: string | null;
  /** Весь справочник организации. */
  directory: readonly EquipmentDirectoryOption[];
  onChange: (name: string, sourceEquipmentId: string | null) => void;
  /** Нужен ручке «добавить в справочник»; без него кнопка не показывается. */
  documentId?: string;
  disabled?: boolean;
}) {
  const [isLinking, setIsLinking] = useState(false);
  const linked = sourceEquipmentId
    ? directory.find((item) => item.id === sourceEquipmentId)
    : undefined;

  const trimmed = value.trim();
  const matchedByName = directory.find(
    (item) => item.name.trim().toLowerCase() === trimmed.toLowerCase()
  );

  async function addToDirectory() {
    if (!documentId || !trimmed) return;
    setIsLinking(true);
    try {
      const response = await fetch(
        `/api/journal-documents/${documentId}/equipment-directory`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        }
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "Не удалось добавить в справочник");
      }
      onChange(result.equipment.name, result.equipment.id);
      toast.success(
        result.created
          ? "Добавлено в справочник «Оборудование» — у единицы появился QR-код"
          : "Единица уже была в справочнике — строка связана с ней"
      );
    } catch (error) {
      toast.error(
        humanizeFetchError(error, "Не удалось добавить в справочник")
      );
    } finally {
      setIsLinking(false);
    }
  }

  if (linked) {
    return (
      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">{label}</Label>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 py-3">
          <Link2 className="size-4 shrink-0 text-[#5566f6]" />
          <span className="min-w-0 flex-1 text-[15px] text-[#0b1024]">
            {linked.name}
          </span>
          {!disabled ? (
            <button
              type="button"
              onClick={() => onChange(linked.name, null)}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#3c4053] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#5566f6]"
            >
              <Link2Off className="size-3.5" />
              Отвязать
            </button>
          ) : null}
        </div>
        <p className="text-[12px] leading-[1.5] text-[#6f7282]">
          Название берётся из справочника «Оборудование»: переименуете там —
          изменится и здесь.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-[13px] font-medium text-[#3c4053]">{label}</Label>
      <SuggestInput
        ariaLabel={label}
        value={value}
        options={directory.map((item) => item.name)}
        placeholder="Выберите из справочника или впишите своё"
        onChange={(next) => {
          const found = directory.find(
            (item) => item.name.trim().toLowerCase() === next.trim().toLowerCase()
          );
          onChange(next, found?.id ?? null);
        }}
      />
      {documentId && trimmed && !matchedByName && !disabled ? (
        <button
          type="button"
          onClick={() => void addToDirectory()}
          disabled={isLinking}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] disabled:opacity-60"
        >
          <Plus className="size-3.5" />
          Добавить в справочник «Оборудование»
        </button>
      ) : null}
      <p className="text-[12px] leading-[1.5] text-[#6f7282]">
        {trimmed && !matchedByName
          ? "Своё название сохранится в журнале. В справочнике единица получит QR-код для заполнения с телефона."
          : "Список — оборудование из /settings/equipment. Своё название тоже можно вписать."}
      </p>
    </div>
  );
}
