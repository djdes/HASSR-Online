"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, QrCode, Thermometer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeviationCorrection } from "@/components/qr-fill/deviation-correction";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Employee = { id: string; name: string; positionTitle: string | null };

type Props = {
  token: string;
  equipment: {
    id: string;
    name: string;
    tempMin: number | null;
    tempMax: number | null;
    areaName: string;
    /** True если у оборудования есть sensorMapping на climate_control
     *  с humidity — тогда форма показывает дополнительное поле. */
    hasHumidityField: boolean;
  };
  /** На сегодня есть активный журнал с этим оборудованием — иначе писать некуда. */
  hasActiveDocument: boolean;
  /** Норма влажности цеха из климат-журнала; null — норма не задана. */
  humidityNorm: { min: number | null; max: number | null } | null;
  employees: Employee[];
  /** Режим QR-форм организации (Настройки → Соответствие). */
  mode?: "public" | "pin" | "auth";
  /** В режиме «auth» — вошедший сотрудник; линейный не выбирает имя. */
  sessionEmployee?: { id: string; name: string; canPickOthers: boolean } | null;
};

const LS_EMPLOYEE_KEY = "wesetup.equipment-fill.employeeId";
/** Общий ключ всех QR-страниц: имя, выбранное у журнала, помнится и здесь. */
const LS_SHARED_EMPLOYEE_KEY = "wesetup.qr-fill.employeeId";

/**
 * Worker scans the sticker → lands here. First scan: pick your name
 * (stored in localStorage so every subsequent scan skips the picker).
 * Enter temperature → hit «Сохранить». Done in 8 seconds.
 */
export function EquipmentFillClient({
  token,
  equipment,
  hasActiveDocument,
  humidityNorm,
  employees,
  mode = "public",
  sessionEmployee = null,
}: Props) {
  const [employeeId, setEmployeeId] = useState<string>("");
  const [pin, setPin] = useState("");
  const fixedEmployee = mode === "auth" && sessionEmployee && !sessionEmployee.canPickOthers;
  // Морозилка (норма ниже нуля) — минус стоит сразу: на цифровой клавиатуре
  // телефона его не набрать.
  const [temperature, setTemperature] = useState<string>(
    equipment.tempMax != null && equipment.tempMax < 0 ? "-" : ""
  );
  const [humidity, setHumidity] = useState<string>("");
  // «Что сделали» — обязательно, когда замер вышел за норму.
  const [correction, setCorrection] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the remembered employee pick on mount.
  useEffect(() => {
    if (mode === "auth" && sessionEmployee) {
      setEmployeeId(sessionEmployee.id);
      return;
    }
    const remembered = localStorage.getItem(LS_SHARED_EMPLOYEE_KEY) ?? localStorage.getItem(LS_EMPLOYEE_KEY);
    if (remembered && employees.some((e) => e.id === remembered)) {
      setEmployeeId(remembered);
    }
  }, [employees, mode, sessionEmployee]);

  const rangeLabel = useMemo(() => {
    const { tempMin, tempMax } = equipment;
    if (tempMin != null && tempMax != null)
      return `норма ${tempMin}…${tempMax} °C`;
    if (tempMin != null) return `норма от ${tempMin} °C`;
    if (tempMax != null) return `норма до ${tempMax} °C`;
    return "норма не задана";
  }, [equipment]);

  const parsedTemp = useMemo(() => {
    // Пустое поле нельзя считать нулём: `Number("")` = 0, и «Сохранить»
    // записывал в журнал 0 °C, хотя человек ничего не ввёл.
    const raw = temperature.trim().replace(",", ".");
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [temperature]);

  const parsedHumidity = useMemo(() => {
    if (!equipment.hasHumidityField || !humidity.trim()) return null;
    const n = Number(humidity.replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }, [humidity, equipment.hasHumidityField]);

  const outOfRange = useMemo(() => {
    if (parsedTemp === null) return false;
    if (equipment.tempMin != null && parsedTemp < equipment.tempMin) return true;
    if (equipment.tempMax != null && parsedTemp > equipment.tempMax) return true;
    return false;
  }, [parsedTemp, equipment]);

  const humidityOutOfRange = useMemo(() => {
    if (parsedHumidity === null || !humidityNorm) return false;
    if (humidityNorm.min != null && parsedHumidity < humidityNorm.min) return true;
    if (humidityNorm.max != null && parsedHumidity > humidityNorm.max) return true;
    return false;
  }, [parsedHumidity, humidityNorm]);

  // Сервер проверяет то же самое и вернёт 400 — здесь только чтобы
  // человек не жал «Сохранить» вслепую.
  const needsCorrection = outOfRange || humidityOutOfRange;
  const correctionMissing = needsCorrection && correction.trim() === "";

  const rememberedName = employees.find((e) => e.id === employeeId)?.name ?? null;

  async function save() {
    if (submitting) return;
    setError(null);
    if (!employeeId) {
      setError("Выберите имя");
      return;
    }
    if (parsedTemp === null) {
      setError("Введите температуру");
      return;
    }
    if (correctionMissing) {
      setError("Замер вне нормы — напишите, что вы сделали");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/equipment-fill/${equipment.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            employeeId,
            temperature: parsedTemp,
            ...(parsedHumidity !== null
              ? { humidity: parsedHumidity }
              : {}),
            ...(correction.trim() ? { correction: correction.trim() } : {}),
            ...(mode === "pin" ? { pin } : {}),
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Ошибка сохранения");
      }
      localStorage.setItem(LS_EMPLOYEE_KEY, employeeId);
      localStorage.setItem(LS_SHARED_EMPLOYEE_KEY, employeeId);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fafbff]">
      <section className="relative overflow-hidden bg-[#0b1024] text-white">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
          <div className="absolute -bottom-40 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
        </div>
        <div className="relative z-10 mx-auto max-w-xl px-5 py-10">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
              <QrCode className="size-5" />
            </div>
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/70">
                Замер температуры
              </div>
              <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.02em]">
                {equipment.name}
              </h1>
              <p className="mt-2 text-[14px] text-white/75">
                {equipment.areaName} · {rangeLabel}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-xl px-5 py-8">
        {/* Раньше об отсутствии журнала сообщал только 409 после
            «Сохранить» — человек вводил замер впустую. */}
        {!hasActiveDocument ? (
          <div className="mb-5 flex gap-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4 text-[14px] leading-relaxed text-[#7a4a00]">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <span>
              Сегодня это оборудование не входит ни в один активный журнал
              температуры. Попросите управляющего создать документ или добавить
              в него оборудование — после этого замер можно будет сохранить.
            </span>
          </div>
        ) : null}

        {done ? (
          <div className="rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#ecfdf5] text-[#116b2a]">
              <CheckCircle2 className="size-7" />
            </div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              Записано
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
              Температура {parsedTemp}°C сохранена в журнал{" "}
              {rememberedName ? `на имя ${rememberedName}` : ""}.
            </p>
            {/* Раньше предупреждение о выходе за норму исчезало вместе с
                формой, и человек уходил, не зная, что делать дальше. */}
            {outOfRange ? (
              <p className="mt-3 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#a13a32]">
                Показание вне нормы — руководителю отправлено уведомление.
                Проверьте оборудование и сообщите начальнику.
              </p>
            ) : null}
            <Button
              type="button"
              onClick={() => {
                setDone(false);
                setTemperature(equipment.tempMax != null && equipment.tempMax < 0 ? "-" : "");
                setHumidity("");
                setCorrection("");
                setError(null);
              }}
              className="mt-6 h-12 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              Записать ещё замер
            </Button>
          </div>
        ) : (
          <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <div className="space-y-5">
              <div>
                <label className="text-[13px] font-medium text-[#0b1024]">
                  Кто снимает показания
                </label>
                {fixedEmployee ? (
                  <div className="mt-1 flex h-12 items-center rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 text-[15px] font-medium text-[#0b1024]">{sessionEmployee?.name}</div>
                ) : (
                  <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger className="mt-1 h-12 rounded-2xl border-[#dcdfed]">
                    <SelectValue placeholder="Выберите ваше имя" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                        {e.positionTitle ? ` · ${e.positionTitle}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                )}
                {mode === "pin" ? (
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="Ваш PIN"
                    aria-label="PIN для QR"
                    className="mt-2 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-center text-[20px] tracking-[0.4em] text-[#0b1024] placeholder:tracking-normal placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  />
                ) : null}
                {rememberedName ? (
                  <p className="mt-1.5 text-[11px] text-[#9b9fb3]">
                    Запомнили с прошлого раза — можно сразу вводить температуру.
                  </p>
                ) : null}
              </div>

              <div>
                <label className="text-[13px] font-medium text-[#0b1024]">
                  Температура, °C
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-[#f5f6ff] text-[#5566f6]">
                    <Thermometer className="size-5" />
                  </span>
                  {/* На цифровой клавиатуре телефона минуса нет — знак ставится кнопкой. */}
                  <button
                    type="button"
                    onClick={() =>
                      setTemperature((current) => {
                        const value = current.trim();
                        return value.startsWith("-") ? value.slice(1) : `-${value}`;
                      })
                    }
                    aria-label="Минус: отрицательная температура"
                    aria-pressed={temperature.trim().startsWith("-")}
                    className={`flex size-12 shrink-0 items-center justify-center rounded-2xl border text-[24px] font-semibold leading-none transition-colors duration-150 ${
                      temperature.trim().startsWith("-")
                        ? "border-[#5566f6] bg-[#5566f6] text-white"
                        : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#f5f6ff]"
                    }`}
                  >
                    −
                  </button>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    placeholder={
                      equipment.tempMin != null && equipment.tempMax != null
                        ? `${equipment.tempMin}…${equipment.tempMax}`
                        : "0"
                    }
                    className="h-12 flex-1 rounded-2xl border-[#dcdfed] text-[18px]"
                  />
                </div>
              </div>

              {/* Дополнительное поле для оборудования с climate-mapping
                  на humidity (например, кондиционер в кондитерской цехе). */}
              {equipment.hasHumidityField ? (
                <div>
                  <label className="text-[13px] font-medium text-[#0b1024]">
                    Влажность, % (опционально)
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-[#f5f6ff] text-[#5566f6]">
                      💧
                    </span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={humidity}
                      onChange={(e) => setHumidity(e.target.value)}
                      placeholder="0–100"
                      className="h-12 flex-1 rounded-2xl border-[#dcdfed] text-[18px]"
                    />
                  </div>
                  {humidity.trim() && parsedHumidity === null ? (
                    <p className="mt-1.5 text-[11px] text-[#a13a32]">
                      Влажность должна быть числом 0–100. Можно оставить
                      пустым, если не измеряли.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Вне нормы — «Что сделали» обязательно: комментарий ложится
                  в журнал рядом с замером и виден в печати. */}
              {needsCorrection ? (
                <DeviationCorrection
                  title={
                    outOfRange && humidityOutOfRange
                      ? "Температура и влажность вне нормы"
                      : outOfRange
                        ? "Температура вне нормы"
                        : "Влажность вне нормы"
                  }
                  hint="Руководитель получит уведомление."
                  value={correction}
                  onChange={setCorrection}
                />
              ) : null}

              {error ? (
                <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#a13a32]">
                  {error}
                </div>
              ) : null}

              <Button
                type="button"
                onClick={save}
                disabled={
                  submitting ||
                  !employeeId ||
                  parsedTemp === null ||
                  !hasActiveDocument ||
                  correctionMissing
                }
                className="h-12 w-full rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white hover:bg-[#4a5bf0] shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] disabled:bg-[#c8cbe0]"
              >
                {submitting ? "Сохраняем…" : "Сохранить замер"}
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
