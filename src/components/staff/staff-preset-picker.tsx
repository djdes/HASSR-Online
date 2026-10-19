"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Info, Lock, ShieldCheck } from "lucide-react";
import type { MessageContract } from "@/i18n/message-contract";
import type { Capability, PermissionPreset } from "@/lib/permission-presets";
import { cn } from "@/lib/utils";

/**
 * Блок «Набор прав» в окне доступа сотрудника: «По должности
 * (автоматически)» или один из пресетов. У каждого — описание и что он
 * даёт (возможности с учётом настроек организации). Свёрнут до текущего
 * выбора: чаще всего набор не меняют, а открывают окно ради журналов.
 */

export const AUTO_PRESET = "auto" as const;
export type PresetChoice = PermissionPreset | typeof AUTO_PRESET;

type PresetKey = keyof MessageContract["staffManagement"]["access"]["presets"];
type CapabilityKey = keyof MessageContract["staffManagement"]["access"]["capabilities"];

export type PresetOption = { value: PermissionPreset; capabilities: Capability[] };

function capabilityKey(capability: Capability): CapabilityKey {
  return capability.replace(".", "_") as CapabilityKey;
}

export function StaffPresetPicker(props: {
  presets: PresetOption[];
  value: PresetChoice;
  /** Сохранённый выбор — помечается «сейчас». */
  saved: PresetChoice;
  /** Пресет «по должности» (из роли). */
  defaultPreset: PermissionPreset;
  onChange: (value: PresetChoice) => void;
  /** Менять может только администратор. */
  readOnly: boolean;
  /** Окно открыто на себе: варианты без «Администратора» недоступны. */
  isSelf: boolean;
}) {
  const t = useTranslations("staffManagement.access");
  const [open, setOpen] = useState(false);
  const capabilitiesOf = (choice: PresetChoice): Capability[] =>
    props.presets.find((option) => option.value === (choice === AUTO_PRESET ? props.defaultPreset : choice))
      ?.capabilities ?? [];
  const labelOf = (preset: PermissionPreset) => t(`presets.${preset as PresetKey}.label`);
  const keepsAdmin = (choice: PresetChoice) => capabilitiesOf(choice).includes("admin.full");
  const choices: PresetChoice[] = [AUTO_PRESET, ...props.presets.map((option) => option.value)];

  const title = (choice: PresetChoice) => (choice === AUTO_PRESET ? t("presetAuto") : labelOf(choice));
  const description = (choice: PresetChoice) =>
    choice === AUTO_PRESET
      ? t("presetAutoHint", { preset: labelOf(props.defaultPreset) })
      : t(`presets.${choice as PresetKey}.description`);

  // span, а не ul/li: список стоит и внутри кнопки-варианта (там допустим
  // только строчный контент); роль list сохраняет смысл для экранных чтецов.
  const chips = (choice: PresetChoice) => (
    <span
      role="list"
      className="mt-2 flex flex-wrap gap-1.5"
      aria-label={t("presetGives", { preset: title(choice) })}
    >
      {capabilitiesOf(choice).map((capability) => (
        <span
          role="listitem"
          key={capability}
          className="inline-flex items-center gap-1 rounded-full border border-[#dfe3ff] bg-white px-2.5 py-0.5 text-[11.5px] leading-5 text-[#3848c7]"
        >
          <Check className="size-3" aria-hidden />
          {t(`capabilities.${capabilityKey(capability)}`)}
        </span>
      ))}
    </span>
  );

  const selectedLocked = props.isSelf && props.value !== props.saved && !keepsAdmin(props.value);

  return (
    <section className="space-y-2" data-testid="staff-preset-picker">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
          {t("presetTitle")}
        </div>
        {!props.readOnly ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            data-testid="staff-preset-toggle"
            className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[12.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {open ? t("presetCollapse") : t("presetChange")}
            <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
          </button>
        ) : null}
      </div>
      <p className="text-[12.5px] leading-snug text-[#6f7282]">{t("presetHint")}</p>

      {!open ? (
        <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3" data-testid="staff-preset-summary">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
            <span className="text-[14px] font-medium text-[#0b1024]">{title(props.value)}</span>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[#6f7282]">{description(props.value)}</p>
          {chips(props.value)}
        </div>
      ) : (
        <div role="radiogroup" aria-label={t("presetTitle")} className="space-y-1.5">
          {choices.map((choice) => {
            const selected = props.value === choice;
            const locked = props.isSelf && choice !== props.saved && !keepsAdmin(choice);
            return (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={locked}
                data-testid={`staff-preset-option-${choice}`}
                onClick={() => props.onChange(choice)}
                className={cn(
                  "w-full rounded-2xl border px-4 py-3 text-left transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                  selected
                    ? "border-[#5566f6] bg-[#f5f6ff] shadow-[0_8px_24px_-16px_rgba(85,102,246,0.45)]"
                    : "border-[#ececf4] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]",
                  locked && "cursor-not-allowed opacity-55 hover:border-[#ececf4] hover:bg-white"
                )}
              >
                <span className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-[#5566f6] bg-[#5566f6]" : "border-[#c9cde0] bg-white"
                    )}
                  >
                    {selected ? <span className="size-1.5 rounded-full bg-white" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[14px] font-medium text-[#0b1024]">{title(choice)}</span>
                      {choice === props.saved ? (
                        <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[10.5px] font-medium text-[#3848c7]">
                          {t("presetCurrent")}
                        </span>
                      ) : null}
                      {locked ? <Lock className="size-3.5 text-[#9b9fb3]" aria-hidden /> : null}
                      <span className="ml-auto text-[11.5px] tabular-nums text-[#9b9fb3]">
                        {t("presetCapabilitiesCount", { count: capabilitiesOf(choice).length })}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-[#6f7282]">{description(choice)}</span>
                    {selected ? chips(choice) : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {props.value === "control_group" ? (
        <p className="flex items-start gap-2 rounded-2xl bg-[#fff8eb] px-3.5 py-2.5 text-[12.5px] leading-snug text-[#8a4b00]">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("presetControlGroupNote")}
        </p>
      ) : null}
      {props.isSelf && (open || selectedLocked) ? (
        <p className="flex items-start gap-2 text-[12px] leading-snug text-[#6f7282]">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("presetSelfLocked")}
        </p>
      ) : null}
      {props.readOnly ? <p className="text-[12px] text-[#9b9fb3]">{t("presetReadOnly")}</p> : null}
    </section>
  );
}
