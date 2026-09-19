"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Droplets, QrCode, Thermometer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeviationCorrection } from "@/components/qr-fill/deviation-correction";

type Metric = { enabled: boolean; min: number | null; max: number | null };

type Props = {
  token: string;
  room: { id: string; name: string; buildingName: string; organizationName: string };
  norms: { temperature: Metric; humidity: Metric };
  /** На сегодня есть активный журнал температуры — иначе записать некуда. */
  hasActiveDocument: boolean;
  /** Срок контроля, в который попадёт замер, если сохранить сейчас. */
  nextSlot: string | null;
  employees: Array<{ id: string; name: string; position: string }>;
};

const LS_EMPLOYEE_KEY = "wesetup.room-fill.employeeId";

function normLabel(metric: Metric, unit: string): string {
  if (metric.min !== null && metric.max !== null) return `норма ${metric.min}…${metric.max} ${unit}`;
  if (metric.min !== null) return `норма от ${metric.min} ${unit}`;
  if (metric.max !== null) return `норма до ${metric.max} ${unit}`;
  return "норма не задана";
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function isOutside(value: number | null, metric: Metric): boolean {
  if (value === null || !metric.enabled) return false;
  return (metric.min !== null && value < metric.min) || (metric.max !== null && value > metric.max);
}

/**
 * Три шага, как на плакате: выбрать себя → ввести показания → «Сохранить».
 * Имя запоминается на телефоне, со второго раза остаётся ввести числа.
 */
export function RoomFillClient({ token, room, norms, hasActiveDocument, nextSlot, employees }: Props) {
  const [employeeId, setEmployeeId] = useState("");
  // Холодный склад с нормой ниже нуля — минус стоит сразу.
  const [temperature, setTemperature] = useState(
    norms.temperature.max !== null && norms.temperature.max < 0 ? "-" : ""
  );
  const [humidity, setHumidity] = useState("");
  // «Что сделали» — обязательно, когда замер вышел за норму.
  const [correction, setCorrection] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ slot: string; outOfRange: boolean } | null>(null);

  useEffect(() => {
    try {
      const remembered = localStorage.getItem(LS_EMPLOYEE_KEY);
      if (remembered && employees.some((employee) => employee.id === remembered)) {
        setEmployeeId(remembered);
      }
    } catch {
      /* приватный режим — выберут имя вручную */
    }
  }, [employees]);

  const temperatureValue = useMemo(() => parseNumber(temperature), [temperature]);
  const humidityValue = useMemo(() => parseNumber(humidity), [humidity]);
  const humidityInvalid = humidityValue !== null && (humidityValue < 0 || humidityValue > 100);
  const temperatureOutside = isOutside(temperatureValue, norms.temperature);
  const humidityOutside = !humidityInvalid && isOutside(humidityValue, norms.humidity);
  const rememberedName = employees.find((employee) => employee.id === employeeId)?.name ?? null;
  const hasValue =
    (norms.temperature.enabled && temperatureValue !== null) ||
    (norms.humidity.enabled && humidityValue !== null && !humidityInvalid);
  // Сервер проверяет то же самое и вернёт 400 — здесь только чтобы
  // человек не жал «Сохранить» вслепую.
  const needsCorrection = temperatureOutside || humidityOutside;
  const correctionMissing = needsCorrection && correction.trim() === "";

  async function save() {
    if (submitting) return;
    setError(null);
    if (!employeeId) {
      setError("Выберите своё имя");
      return;
    }
    if (!hasValue) {
      setError("Введите показания");
      return;
    }
    if (correctionMissing) {
      setError("Замер вне нормы — напишите, что вы сделали");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/room-fill/${room.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          employeeId,
          ...(norms.temperature.enabled && temperatureValue !== null ? { temperature: temperatureValue } : {}),
          ...(norms.humidity.enabled && humidityValue !== null && !humidityInvalid ? { humidity: humidityValue } : {}),
          ...(correction.trim() ? { correction: correction.trim() } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Не удалось сохранить");
      try {
        localStorage.setItem(LS_EMPLOYEE_KEY, employeeId);
      } catch {
        /* не запомнили — не страшно */
      }
      setSaved({
        slot: typeof data?.slot === "string" ? data.slot : nextSlot ?? "",
        outOfRange: Boolean(data?.temperatureOutOfRange || data?.humidityOutOfRange),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
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
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
              <QrCode className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/70">
                Температура и влажность
              </div>
              <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{room.name}</h1>
              <p className="mt-2 text-[14px] text-white/75">
                {room.organizationName} · {room.buildingName}
              </p>
              <p className="mt-1 text-[13px] text-white/60">
                {[
                  norms.temperature.enabled ? normLabel(norms.temperature, "°C") : null,
                  norms.humidity.enabled ? normLabel(norms.humidity, "%") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-xl px-5 py-8">
        {!hasActiveDocument ? (
          <div className="mb-5 flex gap-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4 text-[14px] leading-relaxed text-[#7a4a00]">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <span>
              На сегодня нет активного журнала температуры. Попросите управляющего создать документ — после этого
              замер можно будет сохранить.
            </span>
          </div>
        ) : null}

        {saved ? (
          <div className="rounded-3xl border border-[#ececf4] bg-white p-8 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#ecfdf5] text-[#116b2a]">
              <CheckCircle2 className="size-7" />
            </div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">Записано</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
              Записано в бланк за сегодня{saved.slot ? `, ${saved.slot}` : ""}
              {rememberedName ? ` — на имя ${rememberedName}` : ""}.
            </p>
            {saved.outOfRange ? (
              <p className="mt-3 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#a13a32]">
                Показание вне нормы — руководителю уже отправлено уведомление. Проветрите или сообщите о поломке.
              </p>
            ) : null}
            <Button
              type="button"
              onClick={() => {
                setSaved(null);
                setTemperature(norms.temperature.max !== null && norms.temperature.max < 0 ? "-" : "");
                setHumidity("");
                setCorrection("");
                setError(null);
              }}
              className="mt-6 h-12 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              Записать ещё замер
            </Button>
          </div>
        ) : (
          <div className="rounded-3xl border border-[#ececf4] bg-white p-6">
            <div className="space-y-6">
              <div>
                <label className="text-[13px] font-medium text-[#0b1024]">1. Кто снимает показания</label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger className="mt-1 h-12 rounded-2xl border-[#dcdfed]">
                    <SelectValue placeholder="Выберите своё имя" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name}
                        {employee.position ? ` · ${employee.position}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rememberedName ? (
                  <p className="mt-1.5 text-[12px] text-[#9b9fb3]">Запомнили с прошлого раза — можно сразу вводить показания.</p>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="text-[13px] font-medium text-[#0b1024]">2. Показания</div>
                {norms.temperature.enabled ? (
                  <div>
                    <label htmlFor="room-fill-temperature" className="text-[13px] text-[#3c4053]">
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
                        id="room-fill-temperature"
                        type="text"
                        inputMode="decimal"
                        value={temperature}
                        onChange={(event) => setTemperature(event.target.value)}
                        placeholder={
                          norms.temperature.min !== null && norms.temperature.max !== null
                            ? `${norms.temperature.min}…${norms.temperature.max}`
                            : "0"
                        }
                        className="h-12 flex-1 rounded-2xl border-[#dcdfed] text-[18px]"
                      />
                    </div>
                  </div>
                ) : null}

                {norms.humidity.enabled ? (
                  <div>
                    <label htmlFor="room-fill-humidity" className="text-[13px] text-[#3c4053]">
                      Влажность, %
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-[#f5f6ff] text-[#5566f6]">
                        <Droplets className="size-5" />
                      </span>
                      <Input
                        id="room-fill-humidity"
                        type="text"
                        inputMode="decimal"
                        value={humidity}
                        onChange={(event) => setHumidity(event.target.value)}
                        placeholder={
                          norms.humidity.min !== null && norms.humidity.max !== null
                            ? `${norms.humidity.min}…${norms.humidity.max}`
                            : "0–100"
                        }
                        className="h-12 flex-1 rounded-2xl border-[#dcdfed] text-[18px]"
                      />
                    </div>
                    {humidityInvalid ? (
                      <p className="mt-1.5 text-[12px] text-[#a13a32]">Влажность — число от 0 до 100.</p>
                    ) : null}
                  </div>
                ) : null}

                {/* Вне нормы — «Что сделали» обязательно: комментарий ложится
                    в журнал рядом с замером и виден в печати. */}
                {needsCorrection ? (
                  <DeviationCorrection
                    title={
                      temperatureOutside && humidityOutside
                        ? "Температура и влажность вне нормы"
                        : temperatureOutside
                          ? "Температура вне нормы"
                          : "Влажность вне нормы"
                    }
                    hint="Руководитель получит уведомление."
                    value={correction}
                    onChange={setCorrection}
                  />
                ) : null}
              </div>

              {error ? (
                <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#a13a32]">{error}</div>
              ) : null}

              <div>
                <Button
                  type="button"
                  onClick={save}
                  disabled={submitting || !employeeId || !hasValue || !hasActiveDocument || correctionMissing}
                  className="h-12 w-full rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
                >
                  {submitting ? "Сохраняем…" : "3. Сохранить"}
                </Button>
                {hasActiveDocument && nextSlot ? (
                  <p className="mt-2 text-center text-[12px] text-[#9b9fb3]">
                    Запись попадёт в журнал за сегодня, срок контроля {nextSlot}.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
