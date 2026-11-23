"use client";

import { useState } from "react";
import { useSubmitLock } from "@/lib/use-submit-lock";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, Building2, ArrowRight } from "lucide-react";
import { getEquipmentTypeLabel } from "@/lib/equipment-type-label";
import { FillerPicker, type FillerOption } from "@/components/settings/filler-picker";
import { LAMP_PRESETS, UV_LAMP_TYPE, formatHours, isUvLampEquipment, lampRemainingHours, lampWarnLevel } from "@/lib/uv-lamp";
import {
  equipmentFieldProfile,
  fillersForObject,
  initialTemperatureToggles,
  keepFillersOfObject,
  sensorFieldVisible,
  visibleTemperatureFields,
  type TemperatureToggles,
} from "@/lib/equipment-type-fields";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlaceOption } from "@/lib/area-building";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTariffLimitToast } from "@/lib/billing-limit-toast";
import { SectionJump } from "@/components/shared/section-jump";
import { FloatingLabelField } from "@/components/journals/journal-dialog-field";
import {
  JOURNAL_DIALOG_FIELD_CLASS,
  JOURNAL_DIALOG_FIELD_CONTROL_CLASS,
  JOURNAL_DIALOG_FIELD_LABEL_CLASS,
  JOURNAL_DIALOG_FIELD_TRIGGER_CLASS,
} from "@/components/journals/journal-responsive";

/** Синонимы старых кодов: «fridge» — тот же холодильник. */
const TYPE_ALIASES: Record<string, string> = { fridge: "refrigerator" };

function initialType(type: string | undefined, name?: string): string {
  const value = (type ?? "").trim();
  // Старые лампы сохранены как «Другое» или словами — открываем как «УФ-лампа»,
  // тогда окно не просит температуру, а сохранение исправит тип.
  if (value && isUvLampEquipment({ type: value, name })) return UV_LAMP_TYPE;
  return TYPE_ALIASES[value.toLowerCase()] ?? value;
}

type AreaOption = {
  id: string;
  name: string;
};

/** Помещения по точкам — `buildPlaceOptions` (src/lib/area-building.ts). */
export type EquipmentPlaces = {
  byBuilding: Record<string, PlaceOption[]>;
  loose: PlaceOption[];
};

/** «Без точки» в выпадающем списке точек (Select не принимает пустую строку). */
const NO_BUILDING = "__none__";

interface EquipmentData {
  id: string;
  name: string;
  type: string;
  areaId: string;
  serialNumber: string | null;
  tempMin: number | null;
  tempMax: number | null;
  tuyaDeviceId: string | null;
  fillerUserIds?: string[];
  lampModel?: string | null;
  lampLifetimeHours?: number | null;
  lampInstalledAt?: string | null;
  lampUsedHours?: number | null;
}

interface EquipmentDialogProps {
  /** Цеха организации — когда точек нет (выбор без группировки). */
  areas: AreaOption[];
  /** Точки организации (2026-10-17): оборудование → помещение → точка. */
  buildings?: Array<{ id: string; name: string }>;
  /** Помещения каждой точки и цеха без точки. */
  places?: EquipmentPlaces;
  /** Точка нового оборудования: выбранная в шапке или единственная. */
  defaultBuildingId?: string | null;
  /** Точка цеха редактируемого оборудования. */
  equipmentBuildingId?: string | null;
  /** Все объекты организации — для правила «где работает» в «Кто заполняет по QR». */
  orgBuildingIds?: string[];
  equipment?: EquipmentData;
  /// Названия уже заведённых единиц — чтобы предупредить о дубле. Два
  /// холодильника с одним именем невозможно различить ни в журнале, ни
  /// на QR-плакате.
  existingNames?: string[];
  /** Сотрудники для «Кто заполняет». */
  fillerOptions?: FillerOption[];
  /** Тип нового оборудования по умолчанию (блок «УФ-лампы» страницы точки). */
  defaultType?: string;
  /** Подпись кнопки «Добавить …» вместо «Добавить оборудование». */
  triggerLabel?: string;
}

/**
 * «2,5» в поле `type="number"` браузер считает недопустимым и отдаёт
 * пустую строку — норма молча стиралась. Принимаем запятую как разделитель.
 */
function parseTempInput(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) ? n : "invalid";
}

export function EquipmentDialog({
  areas,
  buildings = [],
  places,
  defaultBuildingId = null,
  equipmentBuildingId = null,
  orgBuildingIds,
  equipment,
  existingNames = [],
  fillerOptions = [],
  defaultType,
  triggerLabel,
}: EquipmentDialogProps) {
  const t = useTranslations("settingsUi.equipmentDialog");
  const tc = useTranslations("common");
  const locale = useLocale();
  // Все типы, которые реально встречаются в данных: заведённые руками,
  // из шаблонов онбординга и справочника журналов. Раньше в списке не было
  // «Датчика» — у датчика поле «Тип» открывалось пустым, а любой выбор
  // перетирал тип.
  const equipmentTypes = [
    { value: "refrigerator", label: t("typeRefrigerator") },
    { value: "freezer", label: t("typeFreezer") },
    { value: "sensor", label: t("typeSensor") },
    { value: "thermometer", label: t("typeThermometer") },
    { value: "oven", label: t("typeOven") },
    { value: "fryer", label: t("typeFryer") },
    { value: "dishwasher", label: t("typeDishwasher") },
    { value: "uv_lamp", label: t("typeUvLamp") },
    { value: "other", label: t("typeOther") },
  ];
  const router = useRouter();
  const tariffLimit = useTariffLimitToast();
  const isEdit = !!equipment;
  const [open, setOpen] = useState(false);
  // Двойной тап по кнопке успевал отправить два одинаковых запроса:
  // setState применяется только к следующему рендеру. Замок синхронный.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(equipment?.name ?? "");
  const [type, setType] = useState(initialType(equipment?.type ?? defaultType, equipment?.name));
  // Точка → помещение. Без точек — прежний список цехов.
  const byPoints = buildings.length > 0 && Boolean(places);
  const initialBuilding = equipment
    ? equipmentBuildingId ?? NO_BUILDING
    : defaultBuildingId ?? buildings[0]?.id ?? NO_BUILDING;
  const [buildingId, setBuildingId] = useState(initialBuilding);
  const [placeKey, setPlaceKey] = useState(equipment?.areaId ? `area:${equipment.areaId}` : "");
  const [serialNumber, setSerialNumber] = useState(equipment?.serialNumber ?? "");
  const [tempMin, setTempMin] = useState(equipment?.tempMin?.toString() ?? "");
  const [tempMax, setTempMax] = useState(equipment?.tempMax?.toString() ?? "");
  const [tuyaDeviceId, setTuyaDeviceId] = useState(equipment?.tuyaDeviceId ?? "");
  const [fillerUserIds, setFillerUserIds] = useState<string[]>(equipment?.fillerUserIds ?? []);
  const [lampModel, setLampModel] = useState(equipment?.lampModel ?? "");
  const [lampLifetime, setLampLifetime] = useState(equipment?.lampLifetimeHours?.toString() ?? "");
  const [lampInstalledAt, setLampInstalledAt] = useState(equipment?.lampInstalledAt ?? "");
  const [lampUsed, setLampUsed] = useState(equipment?.lampUsedHours != null ? String(Math.round(equipment.lampUsedHours)) : "0");
  // Галочки «Мин. / Макс. температура» у типов, где норма не обязательна.
  const [tempToggles, setTempToggles] = useState<TemperatureToggles>(() =>
    initialTemperatureToggles(equipment?.tempMin?.toString() ?? "", equipment?.tempMax?.toString() ?? ""),
  );
  // Поле нормы, которое человек только что включил галочкой, — в фокус.
  const [focusTemp, setFocusTemp] = useState<"min" | "max" | null>(null);
  const isLamp = type === UV_LAMP_TYPE;
  const profile = equipmentFieldProfile(type);
  const visibleTemps = visibleTemperatureFields(profile, tempToggles);
  // «Уже записан» — сохранённый номер или набранный: поле не пропадает, пока его правят.
  const showSensor = sensorFieldVisible(profile, tempToggles, tuyaDeviceId || equipment?.tuyaDeviceId || "");
  const tempPlaceholder = (side: "min" | "max") =>
    profile.example
      ? t("tempExample", { value: profile.example[side] })
      : side === "min"
        ? t("tempMinPlaceholder")
        : t("tempMaxPlaceholder");

  function changeType(next: string) {
    setType(next);
    // Введённая норма не прячется: у типа с галочками они встают сами.
    setTempToggles((prev) => ({ min: prev.min || tempMin.trim() !== "", max: prev.max || tempMax.trim() !== "" }));
  }

  function resetForm() {
    setName(equipment?.name ?? "");
    setType(initialType(equipment?.type ?? defaultType, equipment?.name));
    setBuildingId(initialBuilding);
    setPlaceKey(equipment?.areaId ? `area:${equipment.areaId}` : "");
    setSerialNumber(equipment?.serialNumber ?? "");
    setTempMin(equipment?.tempMin?.toString() ?? "");
    setTempMax(equipment?.tempMax?.toString() ?? "");
    setTuyaDeviceId(equipment?.tuyaDeviceId ?? "");
    setFillerUserIds(equipment?.fillerUserIds ?? []);
    setLampModel(equipment?.lampModel ?? "");
    setLampLifetime(equipment?.lampLifetimeHours?.toString() ?? "");
    setLampInstalledAt(equipment?.lampInstalledAt ?? "");
    setLampUsed(equipment?.lampUsedHours != null ? String(Math.round(equipment.lampUsedHours)) : "0");
    setTempToggles(initialTemperatureToggles(equipment?.tempMin?.toString() ?? "", equipment?.tempMax?.toString() ?? ""));
    setFocusTemp(null);
    setError(null);
  }

  const pointPlaces: PlaceOption[] =
    byPoints && places && buildingId !== NO_BUILDING ? places.byBuilding[buildingId] ?? [] : [];
  const loosePlaces: PlaceOption[] = byPoints && places ? places.loose : [];
  const flatPlaces: PlaceOption[] = areas.map((area) => ({
    key: `area:${area.id}`,
    name: area.name,
    areaId: area.id,
    roomId: null,
  }));
  const placeCount = byPoints
    ? Object.values(places?.byBuilding ?? {}).reduce((sum, list) => sum + list.length, 0) + loosePlaces.length
    : flatPlaces.length;
  const availablePlaces = byPoints ? [...pointPlaces, ...loosePlaces] : flatPlaces;
  const selectedPlace = availablePlaces.find((place) => place.key === placeKey) ?? null;

  // «Кто заполняет по QR» — люди выбранного объекта: QR-страница всё равно
  // пускает только сотрудников точки оборудования.
  // Без `orgBuildingIds` (точки выключены или одна) — без фильтра, как на QR.
  const fillerOrgBuildingIds = orgBuildingIds ?? [];
  // Общее помещение (без точки) — у оборудования нет точки, QR пускает всех.
  const looseRoomChosen = loosePlaces.some((place) => place.key === placeKey);
  const fillerBuildingId = byPoints && buildingId !== NO_BUILDING && !looseRoomChosen ? buildingId : null;
  const visibleFillers = fillersForObject(fillerOptions, {
    orgBuildingIds: fillerOrgBuildingIds,
    buildingId: fillerBuildingId,
    selectedIds: fillerUserIds,
  });
  const fillerBuildingName = fillerBuildingId
    ? buildings.find((building) => building.id === fillerBuildingId)?.name ?? null
    : null;

  /** Помещение точки — из отметок уходят люди, которые на ней не работают. */
  function changePlace(next: string) {
    setPlaceKey(next);
    const loose = loosePlaces.some((place) => place.key === next);
    if (byPoints && buildingId !== NO_BUILDING && !loose) {
      setFillerUserIds((prev) =>
        keepFillersOfObject(prev, fillerOptions, { orgBuildingIds: fillerOrgBuildingIds, buildingId }),
      );
    }
  }

  function changeBuilding(next: string) {
    setBuildingId(next);
    setFillerUserIds((prev) =>
      keepFillersOfObject(prev, fillerOptions, {
        orgBuildingIds: fillerOrgBuildingIds,
        buildingId: byPoints && next !== NO_BUILDING ? next : null,
      }),
    );
    // Помещение другой точки не подходит — выбор помещения начинается заново.
    const stillThere =
      (next !== NO_BUILDING ? places?.byBuilding[next] ?? [] : []).some((place) => place.key === placeKey) ||
      loosePlaces.some((place) => place.key === placeKey);
    if (!stillThere) setPlaceKey("");
  }

  const duplicateName =
    name.trim() !== "" &&
    name.trim().toLowerCase() !== (equipment?.name ?? "").trim().toLowerCase() &&
    existingNames.some(
      (other) => other.trim().toLowerCase() === name.trim().toLowerCase()
    );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Скрытая норма (УФ-лампа, снятая галочка) не проверяется, а при
    // сохранении старая стирается (пустое значение — null на сервере).
    const parsedMin = visibleTemps.min ? parseTempInput(tempMin) : null;
    const parsedMax = visibleTemps.max ? parseTempInput(tempMax) : null;
    if (parsedMin === "invalid" || parsedMax === "invalid") {
      setError(t("tempNotNumber"));
      return;
    }
    if (parsedMin !== null && parsedMax !== null && parsedMin > parsedMax) {
      setError(t("tempMinGreater"));
      return;
    }

    const lifetimeNumber = lampLifetime.trim() ? Number(lampLifetime.trim()) : null;
    const usedNumber = lampUsed.trim() ? Number(lampUsed.trim().replace(",", ".")) : 0;
    if (isLamp && (lifetimeNumber === null || !Number.isFinite(lifetimeNumber) || lifetimeNumber <= 0)) {
      setError(t("lampLifetimeRequired"));
      return;
    }
    if (isLamp && (!Number.isFinite(usedNumber) || usedNumber < 0)) {
      setError(t("lampUsedInvalid"));
      return;
    }

    if (!selectedPlace && !(isEdit && placeKey === `area:${equipment?.areaId}`)) {
      setError(t("placeRequired"));
      return;
    }

    if (!acquire()) return;
    setError(null);

    try {
      const url = isEdit ? `/api/equipment/${equipment.id}` : "/api/equipment";
      const response = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          // Помещение точки без цеха — `roomId`: сервер создаст цех этой точки.
          ...(selectedPlace?.roomId
            ? { roomId: selectedPlace.roomId }
            : { areaId: selectedPlace?.areaId ?? equipment?.areaId }),
          serialNumber: serialNumber || undefined,
          tempMin: parsedMin ?? undefined,
          tempMax: parsedMax ?? undefined,
          tuyaDeviceId: showSensor ? tuyaDeviceId || undefined : undefined,
          fillerUserIds,
          ...(isLamp
            ? {
                lampModel: lampModel || undefined,
                lampLifetimeHours: lifetimeNumber ? Math.round(lifetimeNumber) : undefined,
                lampInstalledAt: lampInstalledAt || undefined,
                lampUsedHours: usedNumber,
              }
            : {}),
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        // IoT-датчик — в тарифе «Премиум»: toast с кнопкой «Выбрать тариф».
        if (tariffLimit(result)) return;
        throw new Error(result.error || t("createError"));
      }

      if (!isEdit) resetForm();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      release();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) resetForm();
      }}
    >
      <DialogTrigger asChild>
        {isEdit ? (
          // aria-label: кнопка состоит из одной иконки, и без подписи
          // скринридер читал её как «кнопка».
          <Button
            variant="ghost"
            size="sm"
            aria-label={
              equipment?.name
                ? t("editAriaNamed", { name: equipment.name })
                : t("editAria")
            }
            title={t("editTitle")}
          >
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button><Plus className="size-4" />{triggerLabel ?? t("addEquipment")}</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editEquipment") : t("addEquipment")}</DialogTitle>
        </DialogHeader>
        {/* Зависимость: Цех / участок — обязательное поле, и select
            берёт значения из props.areas. Если у орги нет ни одного
            цеха, форма НЕ заполнима. Раньше юзер видел пустой select
            «Выберите цех» без вариантов и не понимал что делать. Теперь
            явно показываем empty-state с CTA на /settings/buildings. */}
        {!isEdit && placeCount === 0 ? (
          <div className="space-y-3 rounded-2xl border border-[#ffe1c1] bg-[#fff8eb] p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ffd28a] text-[#7a4900]">
                <Building2 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[14px] font-semibold text-[#7a4900]">
                  {t("needRoomTitle")}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[#7a4900]/80">
                  {t.rich("needRoomBody", {
                    b: (chunks) => <strong>{chunks}</strong>,
                  })}
                </p>
              </div>
            </div>
            <Link
              href="/settings/buildings"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-2.5 text-[14px] font-medium text-white shadow-[0_8px_24px_-10px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              {t("openBuildings")}
              <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : null}
        {/* Поля — с подписью внутри рамки (`FloatingLabelField`), парные — в
            одну строку: окно ниже и на телефоне помещается без долгой прокрутки. */}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div>
            <FloatingLabelField label={t("nameLabel")} htmlFor="eq-name" required>
              <Input
                id="eq-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                required
                className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
              />
            </FloatingLabelField>
            {duplicateName ? (
              <p className="mt-1.5 text-[13px] text-[#b45309]">
                {t("duplicateName")}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
          <FloatingLabelField label={t("typeLabel")} htmlFor="eq-type" required>
            <Select value={type} onValueChange={changeType} required>
              <SelectTrigger id="eq-type" className={JOURNAL_DIALOG_FIELD_TRIGGER_CLASS}>
                <SelectValue placeholder={t("typePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {(type && !equipmentTypes.some((option) => option.value === type)
                  ? // Тип не из списка (введён иначе) — показываем как есть,
                    // чтобы поле не было пустым и тип не терялся.
                    [...equipmentTypes, { value: type, label: getEquipmentTypeLabel(type) }]
                  : equipmentTypes
                ).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FloatingLabelField>
          {byPoints && (buildings.length >= 2 || loosePlaces.length > 0) ? (
            <FloatingLabelField label={t("pointLabel")} htmlFor="eq-building" required>
              <Select value={buildingId} onValueChange={changeBuilding}>
                <SelectTrigger id="eq-building" className={JOURNAL_DIALOG_FIELD_TRIGGER_CLASS}>
                  <SelectValue placeholder={t("pointPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {buildings.map((building) => (
                    <SelectItem key={building.id} value={building.id}>
                      {building.name}
                    </SelectItem>
                  ))}
                  {loosePlaces.length > 0 ? (
                    <SelectItem value={NO_BUILDING}>{t("noPoint")}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </FloatingLabelField>
          ) : (
            // Объект один — пара к «Типу» — заводской номер.
            <FloatingLabelField label={t("serialLabel")} htmlFor="eq-serial">
              <Input
                id="eq-serial"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder={t("serialPlaceholder")}
                className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
              />
            </FloatingLabelField>
          )}
          </div>
          <div>
            <FloatingLabelField label={t("roomLabel")} htmlFor="eq-area" required>
            <Select value={placeKey} onValueChange={changePlace} required>
              <SelectTrigger id="eq-area" className={JOURNAL_DIALOG_FIELD_TRIGGER_CLASS}>
                <SelectValue placeholder={t("roomPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {byPoints ? (
                  <>
                    {pointPlaces.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>
                          {buildings.find((building) => building.id === buildingId)?.name ?? t("pointFallback")}
                        </SelectLabel>
                        {pointPlaces.map((place) => (
                          <SelectItem key={place.key} value={place.key}>
                            {place.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    {loosePlaces.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>{t("noPoint")}</SelectLabel>
                        {loosePlaces.map((place) => (
                          <SelectItem key={place.key} value={place.key}>
                            {place.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </>
                ) : (
                  flatPlaces.map((place) => (
                    <SelectItem key={place.key} value={place.key}>
                      {place.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            </FloatingLabelField>
            {byPoints && pointPlaces.length === 0 && buildingId !== NO_BUILDING ? (
              <p className="mt-1.5 text-[12.5px] text-[#b45309]">
                {t("noRoomsInPoint")}{" "}
                <SectionJump to="buildings" />
              </p>
            ) : null}
          </div>
          {byPoints && (buildings.length >= 2 || loosePlaces.length > 0) ? (
            <FloatingLabelField label={t("serialLabel")} htmlFor="eq-serial">
              <Input
                id="eq-serial"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder={t("serialPlaceholder")}
                className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
              />
            </FloatingLabelField>
          ) : null}
          {profile.temperature === "always" ? (
          <div className="grid grid-cols-2 gap-2.5">
            <FloatingLabelField label={t("tempMinLabel")} htmlFor="eq-temp-min">
              <Input
                id="eq-temp-min"
                type="text"
                inputMode="decimal"
                value={tempMin}
                onChange={(e) => setTempMin(e.target.value)}
                placeholder={tempPlaceholder("min")}
                className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
              />
            </FloatingLabelField>
            <FloatingLabelField label={t("tempMaxLabel")} htmlFor="eq-temp-max">
              <Input
                id="eq-temp-max"
                type="text"
                inputMode="decimal"
                value={tempMax}
                onChange={(e) => setTempMax(e.target.value)}
                placeholder={tempPlaceholder("max")}
                className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
              />
            </FloatingLabelField>
          </div>
          ) : profile.temperature === "optional" ? (
          <div className="space-y-1.5" data-testid="optional-temperature">
            <div className="grid grid-cols-2 items-start gap-2.5">
              {(["min", "max"] as const).map((side) => {
                const on = tempToggles[side];
                const inputId = side === "min" ? "eq-temp-min" : "eq-temp-max";
                return (
                  <div key={side} className={cn(JOURNAL_DIALOG_FIELD_CLASS, !on && "pb-1.5")}>
                    <label className="flex min-h-7 cursor-pointer items-center gap-2 text-[14px] text-[#0b1024]">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(checked) => {
                          setTempToggles((prev) => ({ ...prev, [side]: checked === true }));
                          setFocusTemp(checked === true ? side : null);
                        }}
                        aria-controls={on ? inputId : undefined}
                        data-testid={`temp-toggle-${side}`}
                      />
                      <span className={on ? JOURNAL_DIALOG_FIELD_LABEL_CLASS : undefined}>
                        {side === "min" ? t("tempMinLabel") : t("tempMaxLabel")}
                      </span>
                    </label>
                    {on ? (
                      <Input
                        id={inputId}
                        type="text"
                        inputMode="decimal"
                        autoFocus={focusTemp === side}
                        value={side === "min" ? tempMin : tempMax}
                        onChange={(e) => (side === "min" ? setTempMin(e.target.value) : setTempMax(e.target.value))}
                        placeholder={tempPlaceholder(side)}
                        aria-label={side === "min" ? t("tempMinLabel") : t("tempMaxLabel")}
                        className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="text-[12px] leading-[1.5] text-[#6f7282]">{t("tempOptionalHint")}</p>
          </div>
          ) : null}
          {isLamp ? (
            <div className="space-y-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-testid="lamp-section">
              <div className="text-[14px] font-semibold text-[#0b1024]">{t("lampSection")}</div>
              <FloatingLabelField label={t("lampModelLabel")} htmlFor="eq-lamp-model">
                <Select
                  value={lampModel}
                  onValueChange={(value) => {
                    setLampModel(value);
                    const preset = LAMP_PRESETS.find((item) => item.label === value);
                    if (preset) setLampLifetime(String(preset.hours));
                  }}
                >
                  <SelectTrigger id="eq-lamp-model" className={JOURNAL_DIALOG_FIELD_TRIGGER_CLASS}>
                    <SelectValue placeholder={t("lampModelPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {LAMP_PRESETS.map((preset) => (
                      <SelectItem key={preset.key} value={preset.label}>
                        {t("presetHours", { label: preset.label, hours: preset.hours.toLocaleString(locale) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FloatingLabelField>
              <div className="grid grid-cols-2 gap-2.5">
                <FloatingLabelField label={t("lampLifeLabel")} htmlFor="eq-lamp-life">
                  <Input id="eq-lamp-life" inputMode="numeric" value={lampLifetime} onChange={(e) => setLampLifetime(e.target.value)} placeholder={t("lampLifePlaceholder")} className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS} />
                </FloatingLabelField>
                <FloatingLabelField label={t("lampUsedLabel")} htmlFor="eq-lamp-used">
                  <Input id="eq-lamp-used" inputMode="decimal" value={lampUsed} onChange={(e) => setLampUsed(e.target.value)} placeholder={t("lampUsedPlaceholder")} className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS} />
                </FloatingLabelField>
              </div>
              <FloatingLabelField label={t("lampInstalledLabel")} htmlFor="eq-lamp-installed">
                <Input id="eq-lamp-installed" type="date" value={lampInstalledAt} onChange={(e) => setLampInstalledAt(e.target.value)} className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS} />
              </FloatingLabelField>
              {(() => {
                const life = Number(lampLifetime) || null;
                const used = Number(lampUsed.replace(",", ".")) || 0;
                const remaining = lampRemainingHours(life, used);
                if (remaining === null || !life) return null;
                const level = lampWarnLevel(life, used);
                const share = Math.max(0, Math.min(1, remaining / life));
                return (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[13px]">
                      <span className="text-[#6f7282]">{t("lampRemaining")}</span>
                      <span className={level ? "font-semibold text-[#b42318]" : "font-semibold text-[#116b2a]"}>
                        {formatHours(remaining)} ({Math.round(share * 100)} %)
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#ececf4]">
                      <div className={level ? "h-full bg-[#e0445a]" : "h-full bg-[#16a34a]"} style={{ width: `${share * 100}%` }} />
                    </div>
                    {level ? (
                      <p className="text-[12.5px] text-[#b42318]">
                        {level === "over" ? t("lampOver") : t("lampAlmost")}
                      </p>
                    ) : null}
                  </div>
                );
              })()}
              {isEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setLampUsed("0");
                    setLampInstalledAt(new Date().toISOString().slice(0, 10));
                  }}
                  className="text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#0b1024]"
                >
                  {t("lampReplaced")}
                </button>
              ) : null}
              <p className="text-[12px] leading-[1.5] text-[#6f7282]">
                {t("lampHint")}
              </p>
            </div>
          ) : null}
          {fillerOptions.length > 0 ? (
            <FillerPicker
              value={fillerUserIds}
              onChange={setFillerUserIds}
              options={visibleFillers}
              objectNoun={isLamp ? t("fillerNounLamp") : t("fillerNounEquipment")}
              scopeNote={fillerBuildingName ? t("fillersOfObject", { name: fillerBuildingName }) : undefined}
            />
          ) : null}
          {showSensor ? (
          <div>
            <FloatingLabelField label={t("tuyaLabel")} htmlFor="eq-tuya">
              <Input
                id="eq-tuya"
                value={tuyaDeviceId}
                onChange={(e) => setTuyaDeviceId(e.target.value)}
                placeholder={t("tuyaPlaceholder")}
                className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
              />
            </FloatingLabelField>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("tuyaHint")}
            </p>
          </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              {tc("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || (!isEdit && placeCount === 0)}
              title={
                !isEdit && placeCount === 0
                  ? t("needRoomFirst")
                  : undefined
              }
            >
              {isSubmitting ? tc("saving") : isEdit ? tc("save") : t("create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
