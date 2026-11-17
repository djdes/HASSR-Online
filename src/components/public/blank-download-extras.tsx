"use client";

import { useTranslations } from "next-intl";
import { ChevronDown, Plus, X } from "lucide-react";

import {
  BLANK_EXTRAS_FIELD_MAX,
  BLANK_EXTRAS_MAX_ROWS,
  blankExtrasSections,
  type BlankEquipmentKind,
} from "@/lib/blank-download-extras";
import { cn } from "@/lib/utils";

/**
 * «Дополнительно» в окне скачивания шаблона (спека
 * blank-download-extras-2026-11): кнопка под полем компании раскрывает
 * поля под конкретный журнал. Всё необязательное — по умолчанию свёрнуто,
 * чтобы не пугать человека, который пришёл просто за файлом.
 */

export type BlankExtrasDraft = {
  responsible: { name: string; position: string };
  employees: Array<{ name: string; position: string }>;
  equipment: Array<{ name: string; kind: BlankEquipmentKind }>;
  rooms: string[];
};

export function emptyBlankExtrasDraft(): BlankExtrasDraft {
  return {
    responsible: { name: "", position: "" },
    employees: [{ name: "", position: "" }],
    equipment: [{ name: "", kind: "fridge" }],
    rooms: [""],
  };
}

/** Черновик окна → тело запроса (сервер всё равно чистит и режет сам). */
export function blankExtrasPayload(draft: BlankExtrasDraft, code: string | null) {
  const sections = blankExtrasSections(code);
  const trim = (value: string) => value.trim();
  const responsible = trim(draft.responsible.name)
    ? { name: trim(draft.responsible.name), ...(trim(draft.responsible.position) ? { position: trim(draft.responsible.position) } : {}) }
    : null;
  const employees = sections.employees
    ? draft.employees
        .filter((row) => trim(row.name))
        .map((row) => ({ name: trim(row.name), ...(trim(row.position) ? { position: trim(row.position) } : {}) }))
    : [];
  const equipment = sections.equipment
    ? draft.equipment
        .filter((row) => trim(row.name))
        .map((row) => (sections.equipment === "cold" ? { name: trim(row.name), kind: row.kind } : { name: trim(row.name) }))
    : [];
  const rooms = sections.rooms ? draft.rooms.map(trim).filter(Boolean) : [];
  const payload = {
    ...(responsible ? { responsible } : {}),
    ...(employees.length ? { employees } : {}),
    ...(equipment.length ? { equipment } : {}),
    ...(rooms.length ? { rooms } : {}),
  };
  return Object.keys(payload).length ? payload : null;
}

/** Сколько строк заполнено — счётчик на свёрнутой кнопке. */
export function blankExtrasFilledCount(draft: BlankExtrasDraft, code: string | null): number {
  const payload = blankExtrasPayload(draft, code);
  if (!payload) return 0;
  return (
    (payload.responsible ? 1 : 0) +
    (payload.employees?.length ?? 0) +
    (payload.equipment?.length ?? 0) +
    (payload.rooms?.length ?? 0)
  );
}

const INPUT_CLASS =
  "h-11 w-full min-w-0 rounded-xl border border-[#dcdfed] bg-white px-3 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const SECTION_TITLE = "text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6f7282]";
const ADD_BUTTON =
  "inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50";
const REMOVE_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-xl text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f4f4f6] hover:text-[#0b1024]";

export function BlankDownloadExtras({
  code,
  open,
  onToggle,
  draft,
  onChange,
}: {
  code: string | null;
  open: boolean;
  onToggle: () => void;
  draft: BlankExtrasDraft;
  onChange: (next: BlankExtrasDraft) => void;
}) {
  const t = useTranslations("publicBlankDownload.extras");
  const sections = blankExtrasSections(code);
  const filled = blankExtrasFilledCount(draft, code);

  const setEmployee = (index: number, patch: Partial<BlankExtrasDraft["employees"][number]>) =>
    onChange({ ...draft, employees: draft.employees.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const setEquipment = (index: number, patch: Partial<BlankExtrasDraft["equipment"][number]>) =>
    onChange({ ...draft, equipment: draft.equipment.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const setRoom = (index: number, value: string) =>
    onChange({ ...draft, rooms: draft.rooms.map((row, i) => (i === index ? value : row)) });

  return (
    <div data-testid="blank-download-extras">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="blank-download-extras-panel"
        data-testid="blank-download-extras-toggle"
        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-1 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#0b1024]"
      >
        {t("toggle")}
        {filled > 0 ? (
          <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[12px] tabular-nums text-[#3848c7]">{filled}</span>
        ) : null}
        <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform duration-150", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          id="blank-download-extras-panel"
          className="mt-1 space-y-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3"
        >
          <p className="text-[13px] leading-[1.45] text-[#6f7282]">{t("lead")}</p>

          <section className="space-y-2">
            <div className={SECTION_TITLE}>{t("responsibleTitle")}</div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <input
                type="text"
                maxLength={BLANK_EXTRAS_FIELD_MAX}
                value={draft.responsible.name}
                onChange={(event) => onChange({ ...draft, responsible: { ...draft.responsible, name: event.target.value } })}
                placeholder={t("name")}
                aria-label={`${t("responsibleTitle")}: ${t("name")}`}
                autoComplete="name"
                data-testid="blank-extras-responsible-name"
                className={INPUT_CLASS}
              />
              <input
                type="text"
                maxLength={BLANK_EXTRAS_FIELD_MAX}
                value={draft.responsible.position}
                onChange={(event) => onChange({ ...draft, responsible: { ...draft.responsible, position: event.target.value } })}
                placeholder={t("position")}
                aria-label={`${t("responsibleTitle")}: ${t("position")}`}
                autoComplete="organization-title"
                className={INPUT_CLASS}
              />
            </div>
          </section>

          {sections.employees ? (
            <section className="space-y-2">
              <div className={SECTION_TITLE}>{t("employeesTitle")}</div>
              {draft.employees.map((row, index) => (
                <div key={index} className="flex items-start gap-1.5">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    <input
                      type="text"
                      maxLength={BLANK_EXTRAS_FIELD_MAX}
                      value={row.name}
                      onChange={(event) => setEmployee(index, { name: event.target.value })}
                      placeholder={t("employeeName")}
                      aria-label={`${t("employeeName")} ${index + 1}`}
                      data-testid={`blank-extras-employee-${index}`}
                      className={INPUT_CLASS}
                    />
                    <input
                      type="text"
                      maxLength={BLANK_EXTRAS_FIELD_MAX}
                      value={row.position}
                      onChange={(event) => setEmployee(index, { position: event.target.value })}
                      placeholder={t("position")}
                      aria-label={`${t("position")} ${index + 1}`}
                      className={INPUT_CLASS}
                    />
                  </div>
                  {draft.employees.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => onChange({ ...draft, employees: draft.employees.filter((_, i) => i !== index) })}
                      aria-label={t("remove")}
                      className={REMOVE_BUTTON}
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                disabled={draft.employees.length >= BLANK_EXTRAS_MAX_ROWS}
                onClick={() => onChange({ ...draft, employees: [...draft.employees, { name: "", position: "" }] })}
                className={ADD_BUTTON}
              >
                <Plus aria-hidden="true" className="size-4" />
                {t("addEmployee")}
              </button>
            </section>
          ) : null}

          {sections.equipment ? (
            <section className="space-y-2">
              <div className={SECTION_TITLE}>{t(sections.equipment === "cold" ? "coldEquipmentTitle" : "equipmentTitle")}</div>
              {draft.equipment.map((row, index) => (
                <div key={index} className="flex items-start gap-1.5">
                  <input
                    type="text"
                    maxLength={BLANK_EXTRAS_FIELD_MAX}
                    value={row.name}
                    onChange={(event) => setEquipment(index, { name: event.target.value })}
                    placeholder={t(sections.equipment === "cold" ? "coldEquipmentName" : "equipmentName")}
                    aria-label={`${t("equipmentTitle")} ${index + 1}`}
                    data-testid={`blank-extras-equipment-${index}`}
                    className={cn(INPUT_CLASS, "flex-1")}
                  />
                  {sections.equipment === "cold" ? (
                    <select
                      value={row.kind}
                      onChange={(event) => setEquipment(index, { kind: event.target.value === "freezer" ? "freezer" : "fridge" })}
                      aria-label={`${t("equipmentKind")} ${index + 1}`}
                      className={cn(INPUT_CLASS, "w-[150px] shrink-0 pl-3 pr-1")}
                    >
                      <option value="fridge">{t("fridge")}</option>
                      <option value="freezer">{t("freezer")}</option>
                    </select>
                  ) : null}
                  {draft.equipment.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => onChange({ ...draft, equipment: draft.equipment.filter((_, i) => i !== index) })}
                      aria-label={t("remove")}
                      className={REMOVE_BUTTON}
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                disabled={draft.equipment.length >= BLANK_EXTRAS_MAX_ROWS}
                onClick={() => onChange({ ...draft, equipment: [...draft.equipment, { name: "", kind: "fridge" }] })}
                className={ADD_BUTTON}
              >
                <Plus aria-hidden="true" className="size-4" />
                {t("addEquipment")}
              </button>
            </section>
          ) : null}

          {sections.rooms ? (
            <section className="space-y-2">
              <div className={SECTION_TITLE}>{t("roomsTitle")}</div>
              {draft.rooms.map((row, index) => (
                <div key={index} className="flex items-start gap-1.5">
                  <input
                    type="text"
                    maxLength={BLANK_EXTRAS_FIELD_MAX}
                    value={row}
                    onChange={(event) => setRoom(index, event.target.value)}
                    placeholder={t("roomName")}
                    aria-label={`${t("roomsTitle")} ${index + 1}`}
                    data-testid={`blank-extras-room-${index}`}
                    className={cn(INPUT_CLASS, "flex-1")}
                  />
                  {draft.rooms.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => onChange({ ...draft, rooms: draft.rooms.filter((_, i) => i !== index) })}
                      aria-label={t("remove")}
                      className={REMOVE_BUTTON}
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                disabled={draft.rooms.length >= BLANK_EXTRAS_MAX_ROWS}
                onClick={() => onChange({ ...draft, rooms: [...draft.rooms, ""] })}
                className={ADD_BUTTON}
              >
                <Plus aria-hidden="true" className="size-4" />
                {t("addRoom")}
              </button>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
