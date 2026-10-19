"use client";

import { useState } from "react";
import { useSubmitLock } from "@/lib/use-submit-lock";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Building2, ArrowRight } from "lucide-react";
import { getEquipmentTypeLabel } from "@/lib/equipment-type-label";
import { FillerPicker, type FillerOption } from "@/components/settings/filler-picker";
import { LAMP_PRESETS, UV_LAMP_TYPE, formatHours, lampRemainingHours, lampWarnLevel } from "@/lib/uv-lamp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// Все типы, которые реально встречаются в данных: заведённые руками,
// из шаблонов онбординга и справочника журналов. Раньше в списке не было
// «Датчика» — у датчика поле «Тип» открывалось пустым, а любой выбор
// перетирал тип.
const equipmentTypes = [
  { value: "refrigerator", label: "Холодильник" },
  { value: "freezer", label: "Морозильник" },
  { value: "sensor", label: "Датчик температуры" },
  { value: "thermometer", label: "Термометр" },
  { value: "oven", label: "Печь" },
  { value: "fryer", label: "Фритюрница" },
  { value: "dishwasher", label: "Посудомоечная машина" },
  { value: "uv_lamp", label: "УФ-лампа" },
  { value: "other", label: "Другое" },
];

/** Синонимы старых кодов: «fridge» — тот же холодильник. */
const TYPE_ALIASES: Record<string, string> = { fridge: "refrigerator" };

function initialType(type: string | undefined): string {
  const value = (type ?? "").trim();
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
  equipment?: EquipmentData;
  /// Названия уже заведённых единиц — чтобы предупредить о дубле. Два
  /// холодильника с одним именем невозможно различить ни в журнале, ни
  /// на QR-плакате.
  existingNames?: string[];
  /** Сотрудники для «Кто заполняет». */
  fillerOptions?: FillerOption[];
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
  equipment,
  existingNames = [],
  fillerOptions = [],
}: EquipmentDialogProps) {
  const router = useRouter();
  const isEdit = !!equipment;
  const [open, setOpen] = useState(false);
  // Двойной тап по кнопке успевал отправить два одинаковых запроса:
  // setState применяется только к следующему рендеру. Замок синхронный.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(equipment?.name ?? "");
  const [type, setType] = useState(initialType(equipment?.type));
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
  const isLamp = type === UV_LAMP_TYPE;

  function resetForm() {
    setName(equipment?.name ?? "");
    setType(initialType(equipment?.type));
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

  function changeBuilding(next: string) {
    setBuildingId(next);
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

    const parsedMin = parseTempInput(tempMin);
    const parsedMax = parseTempInput(tempMax);
    if (parsedMin === "invalid" || parsedMax === "invalid") {
      setError("Температура должна быть числом, например 2 или -18,5");
      return;
    }
    if (parsedMin !== null && parsedMax !== null && parsedMin > parsedMax) {
      setError(
        "Минимальная температура больше максимальной — поменяйте значения местами"
      );
      return;
    }

    const lifetimeNumber = lampLifetime.trim() ? Number(lampLifetime.trim()) : null;
    const usedNumber = lampUsed.trim() ? Number(lampUsed.trim().replace(",", ".")) : 0;
    if (isLamp && (lifetimeNumber === null || !Number.isFinite(lifetimeNumber) || lifetimeNumber <= 0)) {
      setError("Укажите ресурс лампы в часах — он есть в паспорте лампы");
      return;
    }
    if (isLamp && (!Number.isFinite(usedNumber) || usedNumber < 0)) {
      setError("«Уже отработала» — число часов, 0 для новой лампы");
      return;
    }

    if (!selectedPlace && !(isEdit && placeKey === `area:${equipment?.areaId}`)) {
      setError("Выберите помещение, где стоит оборудование");
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
          tuyaDeviceId: tuyaDeviceId || undefined,
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
        throw new Error(result.error || "Ошибка при создании");
      }

      if (!isEdit) resetForm();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
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
                ? `Изменить оборудование «${equipment.name}»`
                : "Изменить оборудование"
            }
            title="Изменить"
          >
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button><Plus className="size-4" />Добавить оборудование</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать оборудование" : "Добавить оборудование"}</DialogTitle>
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
                  Сначала нужно помещение
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[#7a4900]/80">
                  Оборудование стоит в <strong>помещении точки</strong> (горячий цех, склад,
                  бар). Заведите помещение в «Точках и помещениях» — оно сразу появится здесь
                  в выборе помещения.
                </p>
              </div>
            </div>
            <Link
              href="/settings/buildings"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-2.5 text-[14px] font-medium text-white shadow-[0_8px_24px_-10px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              Открыть «Точки и помещения»
              <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="eq-name">
              Название <span className="text-destructive">*</span>
            </Label>
            <Input
              id="eq-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Холодильник Samsung"
              required
            />
            {duplicateName ? (
              <p className="text-[13px] text-[#b45309]">
                Единица с таким названием уже есть. В журналах и на QR-плакатах их
                будет не различить — добавьте цех или номер, например «Холодильник
                Samsung (бар)».
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="eq-type">
              Тип <span className="text-destructive">*</span>
            </Label>
            <Select value={type} onValueChange={setType} required>
              <SelectTrigger id="eq-type" className="w-full">
                <SelectValue placeholder="Выберите тип" />
              </SelectTrigger>
              <SelectContent>
                {(type && !equipmentTypes.some((t) => t.value === type)
                  ? // Тип не из списка (введён иначе) — показываем как есть,
                    // чтобы поле не было пустым и тип не терялся.
                    [...equipmentTypes, { value: type, label: getEquipmentTypeLabel(type) }]
                  : equipmentTypes
                ).map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {byPoints && (buildings.length >= 2 || loosePlaces.length > 0) ? (
            <div className="space-y-2">
              <Label htmlFor="eq-building">
                Точка <span className="text-destructive">*</span>
              </Label>
              <Select value={buildingId} onValueChange={changeBuilding}>
                <SelectTrigger id="eq-building" className="w-full">
                  <SelectValue placeholder="Выберите точку" />
                </SelectTrigger>
                <SelectContent>
                  {buildings.map((building) => (
                    <SelectItem key={building.id} value={building.id}>
                      {building.name}
                    </SelectItem>
                  ))}
                  {loosePlaces.length > 0 ? (
                    <SelectItem value={NO_BUILDING}>Без точки</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="eq-area">
              Помещение <span className="text-destructive">*</span>
            </Label>
            <Select value={placeKey} onValueChange={setPlaceKey} required>
              <SelectTrigger id="eq-area" className="w-full">
                <SelectValue placeholder="Выберите помещение" />
              </SelectTrigger>
              <SelectContent>
                {byPoints ? (
                  <>
                    {pointPlaces.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>
                          {buildings.find((building) => building.id === buildingId)?.name ?? "Точка"}
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
                        <SelectLabel>Без точки</SelectLabel>
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
            {byPoints && pointPlaces.length === 0 && buildingId !== NO_BUILDING ? (
              <p className="text-[12.5px] text-[#b45309]">
                В этой точке пока нет помещений — добавьте их в «Точках и помещениях».
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="eq-serial">Серийный номер</Label>
            <Input
              id="eq-serial"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              placeholder="Серийный номер"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="eq-temp-min">Мин. температура</Label>
              <Input
                id="eq-temp-min"
                type="text"
                inputMode="decimal"
                value={tempMin}
                onChange={(e) => setTempMin(e.target.value)}
                placeholder="например 2 или -18"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eq-temp-max">Макс. температура</Label>
              <Input
                id="eq-temp-max"
                type="text"
                inputMode="decimal"
                value={tempMax}
                onChange={(e) => setTempMax(e.target.value)}
                placeholder="например 6 или -15"
              />
            </div>
          </div>
          {isLamp ? (
            <div className="space-y-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-testid="lamp-section">
              <div className="text-[14px] font-semibold text-[#0b1024]">Ресурс лампы</div>
              <div className="space-y-2">
                <Label htmlFor="eq-lamp-model">Модель лампы или облучателя</Label>
                <Select
                  value={lampModel}
                  onValueChange={(value) => {
                    setLampModel(value);
                    const preset = LAMP_PRESETS.find((item) => item.label === value);
                    if (preset) setLampLifetime(String(preset.hours));
                  }}
                >
                  <SelectTrigger id="eq-lamp-model" className="w-full">
                    <SelectValue placeholder="Выберите — ресурс подставится сам" />
                  </SelectTrigger>
                  <SelectContent>
                    {LAMP_PRESETS.map((preset) => (
                      <SelectItem key={preset.key} value={preset.label}>
                        {preset.label} — {preset.hours.toLocaleString("ru-RU")} ч
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="eq-lamp-life">Ресурс по паспорту, ч</Label>
                  <Input id="eq-lamp-life" inputMode="numeric" value={lampLifetime} onChange={(e) => setLampLifetime(e.target.value)} placeholder="например 8000" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="eq-lamp-used">Уже отработала, ч</Label>
                  <Input id="eq-lamp-used" inputMode="decimal" value={lampUsed} onChange={(e) => setLampUsed(e.target.value)} placeholder="0 — новая лампа" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-lamp-installed">Дата установки лампы</Label>
                <Input id="eq-lamp-installed" type="date" value={lampInstalledAt} onChange={(e) => setLampInstalledAt(e.target.value)} />
              </div>
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
                      <span className="text-[#6f7282]">Осталось ресурса</span>
                      <span className={level ? "font-semibold text-[#b42318]" : "font-semibold text-[#116b2a]"}>
                        {formatHours(remaining)} ({Math.round(share * 100)} %)
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#ececf4]">
                      <div className={level ? "h-full bg-[#e0445a]" : "h-full bg-[#16a34a]"} style={{ width: `${share * 100}%` }} />
                    </div>
                    {level ? (
                      <p className="text-[12.5px] text-[#b42318]">
                        {level === "over" ? "Ресурс исчерпан — замените лампу." : "Ресурс почти исчерпан — пора заказать лампу."}
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
                  Заменили лампу — начать отсчёт заново
                </button>
              ) : null}
              <p className="text-[12px] leading-[1.5] text-[#6f7282]">
                Наработка считается сама по кнопкам «Я включил / Я выключил» на наклейке лампы. Когда ресурса останется 10 %,
                ответственный за журнал получит уведомление.
              </p>
            </div>
          ) : null}
          {fillerOptions.length > 0 ? (
            <FillerPicker value={fillerUserIds} onChange={setFillerUserIds} options={fillerOptions} objectNoun={isLamp ? "лампу" : "оборудование"} />
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="eq-tuya">Tuya Device ID (IoT-датчик)</Label>
            <Input
              id="eq-tuya"
              value={tuyaDeviceId}
              onChange={(e) => setTuyaDeviceId(e.target.value)}
              placeholder="например: bf397860f79b0963a0nakc"
            />
            <p className="text-xs text-muted-foreground">
              Если подключён WiFi-датчик температуры Tuya, укажите его Device ID
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || (!isEdit && placeCount === 0)}
              title={
                !isEdit && placeCount === 0
                  ? "Сначала заведите помещение в «Точках и помещениях»"
                  : undefined
              }
            >
              {isSubmitting ? "Сохранение..." : isEdit ? "Сохранить" : "Создать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
