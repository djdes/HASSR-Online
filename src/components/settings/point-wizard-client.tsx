"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Check, Copy, LayoutList, Loader2, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import { roomKindLabel } from "@/lib/room-kinds";
import { LAMP_PRESETS, UV_LAMP_TYPE } from "@/lib/uv-lamp";
import {
  TYPICAL_EQUIPMENT,
  TYPICAL_ROOMS,
  WIZARD_LAMP_HOURS,
  WIZARD_MAX_QUANTITY,
  addCustomRoom,
  guessRoom,
  planEquipment,
  type TypicalRoomKey,
  type WizardEquipmentType,
  type WizardRoom,
} from "@/lib/point-wizard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTariffLimitToast } from "@/lib/billing-limit-toast";

const STEPS = ["head", "rooms", "equipment", "summary"] as const;
type StepKey = (typeof STEPS)[number];

const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60 " +
  FOCUS;
const SECONDARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60 " +
  FOCUS;

export type WizardDonor = { id: string; name: string; rooms: WizardRoom[] };

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("ru-RU") === b.trim().toLocaleLowerCase("ru-RU");
}

/**
 * Мастер «+ Добавить точку» (`/settings/buildings/new`): 1) название и адрес;
 * 2) помещения — типовой набор галочками или «как в другой точке»;
 * 3) оборудование типового набора с количеством и помещением; 4) итог.
 * Создаёт существующими API: точка → помещения → оборудование. Ошибка
 * отдельного шага не отменяет уже созданное: после создания открывается
 * страница точки, недостающее — там.
 */
export function PointWizard({
  takenNames,
  sortOrder,
  donors,
  equipmentNames,
}: {
  /** Названия точек организации — повтор API не примет. */
  takenNames: string[];
  /** Порядок новой точки — после существующих. */
  sortOrder: number;
  donors: WizardDonor[];
  /** Названия оборудования организации — новые номера не повторяют их. */
  equipmentNames: string[];
}) {
  const t = useTranslations("settingsManagement.points.wizard");
  const tTypes = useTranslations("settingsManagement.points.equipmentTypes");
  const tEquipment = useTranslations("settingsManagement.points.equipment");
  const tUv = useTranslations("settingsManagement.points.uv");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const tariffLimit = useTariffLimitToast();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [roomMode, setRoomMode] = useState<"typical" | "copy">("typical");
  const [checked, setChecked] = useState<Record<TypicalRoomKey, boolean>>(
    () => Object.fromEntries(TYPICAL_ROOMS.map((room) => [room.key, room.checked])) as Record<TypicalRoomKey, boolean>,
  );
  const [customRooms, setCustomRooms] = useState<WizardRoom[]>([]);
  const [customName, setCustomName] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [donorId, setDonorId] = useState(donors[0]?.id ?? "");
  const [quantities, setQuantities] = useState<Record<WizardEquipmentType, number>>(
    () => Object.fromEntries(TYPICAL_EQUIPMENT.map((item) => [item.type, item.quantity])) as Record<WizardEquipmentType, number>,
  );
  const [roomChoice, setRoomChoice] = useState<Partial<Record<WizardEquipmentType, string>>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const typicalRooms: WizardRoom[] = TYPICAL_ROOMS.map((room) => ({ name: t(`roomNames.${room.key}`), kind: room.kind }));
  const donor = donors.find((item) => item.id === donorId) ?? null;
  const rooms: WizardRoom[] =
    roomMode === "copy" && donor
      ? donor.rooms
      : [...TYPICAL_ROOMS.flatMap((room, index) => (checked[room.key] ? [typicalRooms[index]] : [])), ...customRooms];

  const labels = Object.fromEntries(
    TYPICAL_EQUIPMENT.map((item) => [item.type, tTypes(item.type)]),
  ) as Record<WizardEquipmentType, string>;
  // Помещение строки: выбранное, если оно ещё в списке, иначе — угаданное.
  const roomFor = (type: WizardEquipmentType) => {
    const chosen = roomChoice[type];
    return chosen && rooms.some((room) => sameName(room.name, chosen)) ? chosen : guessRoom(type, rooms);
  };
  const plan = planEquipment({
    rows: TYPICAL_EQUIPMENT.map((item) => ({ type: item.type, quantity: quantities[item.type], roomName: roomFor(item.type) })),
    rooms,
    labels,
    takenNames: equipmentNames,
  });
  const taken = useMemo(() => new Set(takenNames.map((value) => value.trim().toLocaleLowerCase("ru-RU"))), [takenNames]);

  const rangeOf = (min?: number, max?: number) =>
    min !== undefined && max !== undefined ? tEquipment("rangeBoth", { min: String(min), max: String(max) }) : null;
  const hours = (value: number) => tUv("hours", { value: new Intl.NumberFormat(FORMAT_LOCALES[locale]).format(value) });

  function goNext() {
    if (STEPS[step] === "head") {
      const clean = name.trim();
      if (!clean) {
        setNameError(t("head.nameRequired"));
        return;
      }
      if (taken.has(clean.toLocaleLowerCase("ru-RU"))) {
        setNameError(t("head.nameTaken"));
        return;
      }
      setNameError(null);
    }
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
  }

  function addCustom() {
    // Повтор типового (даже не отмеченного) или своего — не добавляем: его отмечают галочкой.
    const next = addCustomRoom([...typicalRooms, ...customRooms], customName);
    if (!next) {
      setCustomError(customName.trim() ? t("rooms.customExists") : null);
      return;
    }
    setCustomRooms((prev) => [...prev, next[next.length - 1]]);
    setCustomName("");
    setCustomError(null);
  }

  async function create() {
    const pointName = name.trim();
    const copying = roomMode === "copy" && donor !== null;
    const total = 1 + (copying ? 1 : rooms.length) + plan.length;
    const failed: string[] = [];
    let done = 0;
    setProgress({ done, total });
    const tick = () => {
      done += 1;
      setProgress({ done, total });
    };

    // 1. Точка. Без неё дальше идти некуда — ошибку показываем и остаёмся.
    let pointId: string;
    try {
      const response = await fetch("/api/settings/buildings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pointName, address: address.trim() || null, sortOrder }),
      });
      const data = (await response.json().catch(() => ({}))) as { building?: { id: string }; error?: string };
      if (!response.ok || !data.building) {
        // Точки тарифа заняты — toast с кнопкой «Выбрать тариф».
        if (tariffLimit(data)) {
          setProgress(null);
          return;
        }
        if (response.status === 409) {
          setNameError(t("head.nameTaken"));
          setStep(0);
        }
        throw new Error(data.error ?? t("failed"));
      }
      pointId = data.building.id;
      tick();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
      setProgress(null);
      return;
    }

    // 2. Помещения: копия из другой точки или по одному.
    if (copying) {
      const response = await fetch(`/api/settings/buildings/${pointId}/copy-rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromBuildingId: donor.id }),
      }).catch(() => null);
      if (!response?.ok) failed.push(t("summary.rooms"));
      tick();
    } else {
      for (const room of rooms) {
        const response = await fetch("/api/settings/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ buildingId: pointId, name: room.name, kind: room.kind }),
        }).catch(() => null);
        // 409 — такое помещение уже есть: это не ошибка.
        if (!response || (!response.ok && response.status !== 409)) failed.push(room.name);
        tick();
      }
    }

    // 3. Оборудование — в помещения новой точки (сервер заведёт цех точки).
    if (plan.length > 0) {
      const roomIds = new Map<string, string>();
      const list = await fetch("/api/settings/buildings")
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null) as { buildings?: Array<{ id: string; rooms: Array<{ id: string; name: string }> }> } | null;
      for (const room of list?.buildings?.find((building) => building.id === pointId)?.rooms ?? []) {
        roomIds.set(room.name.trim().toLocaleLowerCase("ru-RU"), room.id);
      }
      for (const item of plan) {
        const roomId = roomIds.get(item.roomName.trim().toLocaleLowerCase("ru-RU"));
        const response = roomId
          ? await fetch("/api/equipment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: item.name,
                type: item.type,
                roomId,
                ...(item.tempMin !== undefined ? { tempMin: item.tempMin } : {}),
                ...(item.tempMax !== undefined ? { tempMax: item.tempMax } : {}),
                ...(item.type === UV_LAMP_TYPE
                  ? { lampModel: LAMP_PRESETS[0].label, lampLifetimeHours: WIZARD_LAMP_HOURS, lampUsedHours: 0 }
                  : {}),
              }),
            }).catch(() => null)
          : null;
        if (!response?.ok) failed.push(item.name);
        tick();
      }
    }

    if (failed.length > 0) toast.warning(t("partial", { name: pointName, items: failed.join(", ") }));
    else toast.success(t("done", { name: pointName }));
    // Новая точка — новый пункт меню: открываем её страницу и пересобираем разметку.
    router.push(`/settings/buildings/${pointId}`);
    router.refresh();
  }

  const stepKey: StepKey = STEPS[step];
  const busy = progress !== null;

  return (
    <div className="space-y-4" data-point-wizard data-wizard-step={stepKey}>
      <ol className="grid grid-cols-4 gap-2" aria-label={t("progress", { step: String(step + 1), total: String(STEPS.length) })}>
        {STEPS.map((key, index) => {
          const state = index < step ? "done" : index === step ? "current" : "next";
          return (
            <li key={key} className="min-w-0" aria-current={state === "current" ? "step" : undefined}>
              <div
                className={cn(
                  "h-1.5 rounded-full transition-colors duration-200",
                  state === "next" ? "bg-[#ececf4]" : "bg-[#5566f6]",
                )}
              />
              <div className="mt-2 flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums",
                    state === "current"
                      ? "bg-[#5566f6] text-white"
                      : state === "done"
                        ? "bg-[#eef1ff] text-[#3848c7]"
                        : "bg-[#f5f6fa] text-[#9b9fb3]",
                  )}
                >
                  {state === "done" ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "truncate text-[13px] font-medium max-sm:hidden",
                    state === "next" ? "text-[#9b9fb3]" : "text-[#0b1024]",
                  )}
                >
                  {t(`steps.${key}`)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
          {t("progress", { step: String(step + 1), total: String(STEPS.length) })} · {t(`steps.${stepKey}`)}
        </div>

        {stepKey === "head" ? (
          <div className="mt-2 space-y-4">
            <StepTitle title={t("head.title")} hint={t("head.hint")} />
            <div className="space-y-1.5">
              <Label htmlFor="wizard-name">
                {t("head.name")} <span className="text-[#a13a32]">*</span>
              </Label>
              <Input
                id="wizard-name"
                value={name}
                maxLength={120}
                autoFocus
                placeholder={t("head.namePlaceholder")}
                aria-invalid={nameError ? true : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    goNext();
                  }
                }}
              />
              {nameError ? <p className="text-[13px] text-[#a13a32]" role="alert">{nameError}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wizard-address">{t("head.address")}</Label>
              <Input
                id="wizard-address"
                value={address}
                maxLength={200}
                placeholder={t("head.addressPlaceholder")}
                onChange={(event) => setAddress(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    goNext();
                  }
                }}
              />
            </div>
          </div>
        ) : null}

        {stepKey === "rooms" ? (
          <div className="mt-2 space-y-4">
            <StepTitle title={t("rooms.title")} hint={t("rooms.hint")} />
            {donors.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                <ModeCard
                  active={roomMode === "typical"}
                  onClick={() => setRoomMode("typical")}
                  icon={<LayoutList className="size-4" />}
                  title={t("rooms.typical")}
                  hint={t("rooms.typicalHint")}
                />
                <ModeCard
                  active={roomMode === "copy"}
                  onClick={() => setRoomMode("copy")}
                  icon={<Copy className="size-4" />}
                  title={t("rooms.copy")}
                  hint={t("rooms.copyHint")}
                />
              </div>
            ) : null}

            {roomMode === "copy" && donor ? (
              <div className="space-y-3">
                <div className="space-y-1.5 sm:max-w-[360px]">
                  <Label htmlFor="wizard-donor">{t("rooms.copyFrom")}</Label>
                  <Select value={donorId} onValueChange={setDonorId}>
                    <SelectTrigger id="wizard-donor" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {donors.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} · {item.rooms.length}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[13.5px] font-medium text-[#3848c7]">{t("rooms.copyCount", { count: donor.rooms.length })}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {donor.rooms.map((room) => (
                    <li key={room.name} className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] text-[#3848c7]">
                      {room.name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-3">
                <ul className="grid gap-2 sm:grid-cols-2">
                  {TYPICAL_ROOMS.map((room, index) => (
                    <li key={room.key}>
                      <label
                        className={cn(
                          "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-2.5 transition-colors duration-150",
                          checked[room.key]
                            ? "border-[#5566f6]/40 bg-[#f5f6ff]"
                            : "border-[#ececf4] bg-white hover:border-[#dcdfed] hover:bg-[#fafbff]",
                        )}
                      >
                        <input
                          type="checkbox"
                          data-wizard-room={room.key}
                          checked={checked[room.key]}
                          onChange={(event) => setChecked((prev) => ({ ...prev, [room.key]: event.target.checked }))}
                          className="size-5 shrink-0 rounded border-[#dcdfed] accent-[#5566f6]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-medium text-[#0b1024]">{typicalRooms[index].name}</span>
                          <span className="block text-[12px] text-[#6f7282]">{roomKindLabel(room.kind, locale)}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                  {customRooms.map((room) => (
                    <li key={room.name}>
                      <div className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-[#5566f6]/40 bg-[#f5f6ff] px-3.5 py-2.5">
                        <Check className="size-5 shrink-0 text-[#5566f6]" />
                        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-[#0b1024]">{room.name}</span>
                        <button
                          type="button"
                          aria-label={room.name}
                          onClick={() => setCustomRooms((prev) => prev.filter((item) => item !== room))}
                          className={cn("inline-flex size-8 items-center justify-center rounded-xl text-[#9b9fb3] transition-colors duration-150 hover:bg-white hover:text-[#a13a32]", FOCUS)}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1.5">
                  <Label htmlFor="wizard-custom-room">{t("rooms.custom")}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="wizard-custom-room"
                      value={customName}
                      maxLength={120}
                      placeholder={t("rooms.customPlaceholder")}
                      onChange={(event) => {
                        setCustomName(event.target.value);
                        if (customError) setCustomError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addCustom();
                        }
                      }}
                    />
                    <button type="button" className={cn(SECONDARY, "h-10 shrink-0")} onClick={addCustom} disabled={!customName.trim()}>
                      <Plus className="size-4 text-[#5566f6]" />
                      {t("rooms.customAdd")}
                    </button>
                  </div>
                  {customError ? <p className="text-[13px] text-[#a13a32]">{customError}</p> : null}
                </div>
                {rooms.length === 0 ? <p className="text-[13px] text-[#a16d32]">{t("rooms.none")}</p> : null}
              </div>
            )}
          </div>
        ) : null}

        {stepKey === "equipment" ? (
          <div className="mt-2 space-y-4">
            <StepTitle title={t("equipment.title")} hint={t("equipment.hint")} />
            {rooms.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-5 text-[13.5px] text-[#6f7282]">
                {t("equipment.noRooms")}
              </p>
            ) : (
              <ul className="space-y-2">
                {TYPICAL_EQUIPMENT.map((item) => {
                  const quantity = quantities[item.type];
                  const range = rangeOf(item.tempMin, item.tempMax);
                  const note =
                    item.type === UV_LAMP_TYPE
                      ? t("equipment.lamp", { hours: hours(WIZARD_LAMP_HOURS) })
                      : range
                        ? t("equipment.norm", { range })
                        : null;
                  return (
                    <li
                      key={item.type}
                      data-wizard-equipment={item.type}
                      className={cn(
                        "flex flex-col gap-3 rounded-2xl border px-3.5 py-3 sm:flex-row sm:items-center",
                        quantity > 0 ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-white",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[14.5px] font-medium text-[#0b1024]">{labels[item.type]}</div>
                        {note ? <div className="text-[12.5px] text-[#6f7282]">{note}</div> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex h-10 items-center rounded-2xl border border-[#dcdfed] bg-white">
                          <button
                            type="button"
                            aria-label={t("equipment.decrease", { name: labels[item.type] })}
                            disabled={quantity === 0}
                            onClick={() => setQuantities((prev) => ({ ...prev, [item.type]: Math.max(0, prev[item.type] - 1) }))}
                            className={cn("inline-flex size-10 items-center justify-center rounded-l-2xl text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] disabled:text-[#c7ccea]", FOCUS)}
                          >
                            <Minus className="size-4" />
                          </button>
                          <span className="w-8 text-center text-[15px] font-semibold tabular-nums text-[#0b1024]" data-wizard-quantity>
                            {quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={t("equipment.increase", { name: labels[item.type] })}
                            disabled={quantity >= WIZARD_MAX_QUANTITY}
                            onClick={() =>
                              setQuantities((prev) => ({ ...prev, [item.type]: Math.min(WIZARD_MAX_QUANTITY, prev[item.type] + 1) }))
                            }
                            className={cn("inline-flex size-10 items-center justify-center rounded-r-2xl text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] disabled:text-[#c7ccea]", FOCUS)}
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                        <Select
                          value={roomFor(item.type) ?? undefined}
                          onValueChange={(value) => setRoomChoice((prev) => ({ ...prev, [item.type]: value }))}
                        >
                          <SelectTrigger className="h-10 min-w-0 flex-1 sm:w-[220px] sm:flex-none" aria-label={`${t("equipment.room")}: ${labels[item.type]}`}>
                            <SelectValue placeholder={t("equipment.room")} />
                          </SelectTrigger>
                          <SelectContent>
                            {rooms.map((room) => (
                              <SelectItem key={room.name} value={room.name}>
                                {room.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {stepKey === "summary" ? (
          <div className="mt-2 space-y-4" data-wizard-summary>
            <StepTitle title={t("summary.title")} />
            <dl className="space-y-4">
              <div>
                <dt className="text-[12.5px] text-[#6f7282]">{t("summary.point")}</dt>
                <dd className="mt-0.5 text-[15px] font-medium text-[#0b1024]">
                  {name.trim()}
                  {address.trim() ? <span className="font-normal text-[#6f7282]"> · {address.trim()}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-[#6f7282]">
                  {t("summary.rooms")}
                  {roomMode !== "copy" && rooms.length > 0 ? <span className="tabular-nums"> · {rooms.length}</span> : null}
                </dt>
                <dd className="mt-1">
                  {roomMode === "copy" && donor ? (
                    <span className="text-[14px] text-[#0b1024]">
                      {t("summary.copy", { name: donor.name })} · {t("rooms.copyCount", { count: donor.rooms.length })}
                    </span>
                  ) : rooms.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {rooms.map((room) => (
                        <li key={room.name} className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] text-[#3848c7]">
                          {room.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-[14px] text-[#9b9fb3]">{t("summary.nothing")}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-[#6f7282]">
                  {t("summary.equipment")}
                  {plan.length > 0 ? <span className="tabular-nums"> · {plan.length}</span> : null}
                </dt>
                <dd className="mt-1">
                  {plan.length > 0 ? (
                    <ul className="grid gap-1.5 sm:grid-cols-2">
                      {plan.map((item) => (
                        <li key={item.name} className="flex min-w-0 items-center gap-2 rounded-xl bg-[#fafbff] px-3 py-2 text-[13.5px]">
                          <span className="min-w-0 truncate font-medium text-[#0b1024]">{item.name}</span>
                          <ArrowRight className="size-3.5 shrink-0 text-[#9b9fb3]" />
                          <span className="min-w-0 truncate text-[#6f7282]">{item.roomName}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-[14px] text-[#9b9fb3]">{t("summary.nothing")}</span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[13.5px] leading-[1.5] text-[#3848c7]">{t("summary.note")}</p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-[#ececf4] pt-5 sm:flex-row sm:justify-between">
          {step > 0 ? (
            <button type="button" className={SECONDARY} onClick={() => setStep((value) => value - 1)} disabled={busy}>
              <ArrowLeft className="size-4" />
              {t("back")}
            </button>
          ) : (
            <span />
          )}
          {stepKey === "summary" ? (
            <button type="button" className={PRIMARY} onClick={() => void create()} disabled={busy} data-wizard-create>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {busy && progress ? t("creating", { done: String(progress.done), total: String(progress.total) }) : t("create")}
            </button>
          ) : (
            <button type="button" className={PRIMARY} onClick={goNext} data-wizard-next>
              {t("next")}
              <ArrowRight className="size-4" />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function StepTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">{title}</h2>
      {hint ? <p className="mt-1 text-[14px] leading-[1.55] text-[#6f7282]">{hint}</p> : null}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors duration-150",
        active ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:border-[#dcdfed] hover:bg-[#fafbff]",
        FOCUS,
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-xl",
          active ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold text-[#0b1024]">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-[#6f7282]">{hint}</span>
      </span>
    </button>
  );
}
