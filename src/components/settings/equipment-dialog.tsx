"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Building2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const equipmentTypes = [
  { value: "refrigerator", label: "Холодильник" },
  { value: "freezer", label: "Морозильник" },
  { value: "oven", label: "Печь" },
  { value: "other", label: "Другое" },
];

type AreaOption = {
  id: string;
  name: string;
};

interface EquipmentData {
  id: string;
  name: string;
  type: string;
  areaId: string;
  serialNumber: string | null;
  tempMin: number | null;
  tempMax: number | null;
  tuyaDeviceId: string | null;
}

interface EquipmentDialogProps {
  areas: AreaOption[];
  equipment?: EquipmentData;
  /// Названия уже заведённых единиц — чтобы предупредить о дубле. Два
  /// холодильника с одним именем невозможно различить ни в журнале, ни
  /// на QR-плакате.
  existingNames?: string[];
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
  equipment,
  existingNames = [],
}: EquipmentDialogProps) {
  const router = useRouter();
  const isEdit = !!equipment;
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(equipment?.name ?? "");
  const [type, setType] = useState(equipment?.type ?? "");
  const [areaId, setAreaId] = useState(equipment?.areaId ?? "");
  const [serialNumber, setSerialNumber] = useState(equipment?.serialNumber ?? "");
  const [tempMin, setTempMin] = useState(equipment?.tempMin?.toString() ?? "");
  const [tempMax, setTempMax] = useState(equipment?.tempMax?.toString() ?? "");
  const [tuyaDeviceId, setTuyaDeviceId] = useState(equipment?.tuyaDeviceId ?? "");

  function resetForm() {
    setName(equipment?.name ?? "");
    setType(equipment?.type ?? "");
    setAreaId(equipment?.areaId ?? "");
    setSerialNumber(equipment?.serialNumber ?? "");
    setTempMin(equipment?.tempMin?.toString() ?? "");
    setTempMax(equipment?.tempMax?.toString() ?? "");
    setTuyaDeviceId(equipment?.tuyaDeviceId ?? "");
    setError(null);
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

    setIsSubmitting(true);
    setError(null);

    try {
      const url = isEdit ? `/api/equipment/${equipment.id}` : "/api/equipment";
      const response = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          areaId,
          serialNumber: serialNumber || undefined,
          tempMin: parsedMin ?? undefined,
          tempMax: parsedMax ?? undefined,
          tuyaDeviceId: tuyaDeviceId || undefined,
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
      setIsSubmitting(false);
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
          <Button variant="ghost" size="sm"><Pencil className="size-4" /></Button>
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
        {!isEdit && areas.length === 0 ? (
          <div className="space-y-3 rounded-2xl border border-[#ffe1c1] bg-[#fff8eb] p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ffd28a] text-[#7a4900]">
                <Building2 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[14px] font-semibold text-[#7a4900]">
                  Сначала нужно создать цех
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[#7a4900]/80">
                  Оборудование привязывается к конкретному <strong>цеху</strong> (горячий цех,
                  склад, бар). Откройте раздел «Цеха и зоны» и заведите хотя бы один цех —
                  потом возвращайтесь сюда. Раздел «Здания и помещения» — это другое
                  (помещения для журнала уборки), его сейчас не нужно.
                </p>
              </div>
            </div>
            <Link
              href="/settings/areas"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-2.5 text-[14px] font-medium text-white shadow-[0_8px_24px_-10px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
            >
              Открыть «Цеха и зоны»
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
                {equipmentTypes.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="eq-area">
              Цех / участок <span className="text-destructive">*</span>
            </Label>
            <Select value={areaId} onValueChange={setAreaId} required>
              <SelectTrigger id="eq-area" className="w-full">
                <SelectValue placeholder="Выберите цех" />
              </SelectTrigger>
              <SelectContent>
                {areas.map((area) => (
                  <SelectItem key={area.id} value={area.id}>
                    {area.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              disabled={isSubmitting || (!isEdit && areas.length === 0)}
              title={
                !isEdit && areas.length === 0
                  ? "Сначала создайте хотя бы один цех в разделе «Здания и помещения»"
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
