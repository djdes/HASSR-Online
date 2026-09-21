"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeviationCorrection } from "@/components/qr-fill/deviation-correction";
import { QuickSwitchNext, QuickSwitchStrip, type QuickSwitchItem } from "@/components/qr-fill/quick-switch";
import { ReadingField } from "@/components/qr-fill/reading-field";
import { PinPrompt } from "@/components/qr-fill/pin-prompt";
import { draftKeyFor, useFormDraft } from "@/components/qr-fill/use-form-draft";

type Metric = { enabled: boolean; min: number | null; max: number | null };

type Props = {
  token: string;
  room: { id: string; name: string; buildingName: string; organizationName: string };
  norms: { temperature: Metric; humidity: Metric };
  /** На сегодня есть активный журнал температуры — иначе записать некуда. */
  hasActiveDocument: boolean;
  /** Срок контроля, в который попадёт замер, если сохранить сейчас. */
  nextSlot: string | null;
  employees: Array<{ id: string; name: string; position: string; hasPin?: boolean }>;
  /** Режим QR-форм организации (Настройки → Соответствие). */
  mode?: "public" | "pin" | "auth";
  /** В режиме «auth» — вошедший сотрудник; линейный не выбирает имя. */
  sessionEmployee?: { id: string; name: string; canPickOthers: boolean } | null;
  /** Соседние объекты для быстрой смены (см. lib/qr-fill-siblings). */
  siblings?: QuickSwitchItem[];
  /** Уже записанные сегодня показания этого помещения — подставляются для правки. */
  todayValues?: { temperature?: number | null; humidity?: number | null } | null;
  /** «20.09.2026» и «18:31» по часовому поясу организации — подпись «за какой момент вносится». */
  stamp?: { date: string; time: string } | null;
};

const LS_EMPLOYEE_KEY = "wesetup.room-fill.employeeId";
const LS_SHARED_EMPLOYEE_KEY = "wesetup.qr-fill.employeeId";

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
export function RoomFillClient({ token, room, norms, hasActiveDocument, nextSlot, employees, mode = "public", sessionEmployee = null, siblings = [], todayValues = null, stamp = null }: Props) {
  const [employeeId, setEmployeeId] = useState("");
  // Имя запоминаем сразу при выборе, а не только после записи: обновление страницы или обрыв связи не заставят выбирать заново.
  const rememberEmployee = (id: string) => {
    setEmployeeId(id);
    try {
      localStorage.setItem(LS_EMPLOYEE_KEY, id);
      localStorage.setItem(LS_SHARED_EMPLOYEE_KEY, id);
    } catch {
      /* приватный режим */
    }
  };
  const [pin, setPin] = useState("");
  const fixedEmployee = mode === "auth" && sessionEmployee && !sessionEmployee.canPickOthers;
  // Холодный склад с нормой ниже нуля — минус стоит сразу.
  const hasToday = typeof todayValues?.temperature === "number" || typeof todayValues?.humidity === "number";
  const [temperature, setTemperature] = useState(
    typeof todayValues?.temperature === "number" ? String(todayValues.temperature) : norms.temperature.max !== null && norms.temperature.max < 0 ? "-" : ""
  );
  const [humidity, setHumidity] = useState(typeof todayValues?.humidity === "number" ? String(todayValues.humidity) : "");
  // «Что сделали» — обязательно, когда замер вышел за норму.
  const [correction, setCorrection] = useState("");
  // Время в подписи идёт по часам телефона: страницу могут держать открытой долго.
  const [stampTime, setStampTime] = useState(stamp?.time ?? "");
  useEffect(() => {
    if (!stamp) return;
    const id = window.setInterval(() => {
      const now = new Date();
      setStampTime(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [stamp]);
  const stampLabel = stamp ? `${stamp.date} ${stampTime}` : "";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ slot: string; outOfRange: boolean } | null>(null);
  // Черновик: обновил страницу или пропал интернет — введённое на месте; после записи стирается.
  const draft = useFormDraft(
    draftKeyFor(`room-fill:${room.id}`, stamp?.date),
    { temperature, humidity, correction },
    (saved) => {
      if (typeof saved.temperature === "string") setTemperature(saved.temperature);
      if (typeof saved.humidity === "string") setHumidity(saved.humidity);
      if (typeof saved.correction === "string") setCorrection(saved.correction);
    },
    Boolean(saved)
  );

  useEffect(() => {
    try {
      if (mode === "auth" && sessionEmployee) {
        setEmployeeId(sessionEmployee.id);
        return;
      }
      const remembered = localStorage.getItem(LS_SHARED_EMPLOYEE_KEY) ?? localStorage.getItem(LS_EMPLOYEE_KEY);
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
          ...(pin ? { pin } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Не удалось сохранить");
      try {
        localStorage.setItem(LS_EMPLOYEE_KEY, employeeId);
        localStorage.setItem(LS_SHARED_EMPLOYEE_KEY, employeeId);
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

  const selectedEmployee = employees.find((item) => item.id === employeeId) ?? null;
  // PIN спрашиваем всегда, когда он у выбранного сотрудника задан (или режим «имя + PIN»).
  const pinRequired = mode === "pin" || Boolean(selectedEmployee?.hasPin);
  // После сохранения текущий объект в списке сразу «снят» — с введёнными значениями.
  const siblingsView = siblings.map((item) =>
    item.current && saved ? { ...item, filled: true, summary: [temperatureValue !== null ? `${temperatureValue} °C` : null, humidityValue !== null && !humidityInvalid ? `${humidityValue} %` : null].filter(Boolean).join(" · ") || item.summary } : item
  );

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

        {!saved ? <QuickSwitchStrip items={siblingsView} title="Помещения" /> : null}
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
            <QuickSwitchNext items={siblingsView} title="Помещения" />
          </div>
        ) : (
          <div className="rounded-3xl border border-[#ececf4] bg-white p-6">
            <div className="space-y-6">
              <div>
                <label className="text-[16px] font-semibold text-[#0b1024]">1. Кто снимает показания</label>
                {fixedEmployee ? (
                  <div className="mt-1 flex h-12 items-center rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 text-[15px] font-medium text-[#0b1024]">{sessionEmployee?.name}</div>
                ) : (
                  <Select value={employeeId} onValueChange={rememberEmployee}>
                  <SelectTrigger className="mt-1 h-auto min-h-12 w-full rounded-2xl border-[#dcdfed] py-2 text-left *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:whitespace-normal *:data-[slot=select-value]:items-start">
                    <SelectValue placeholder="Выберите своё имя">
                      {selectedEmployee ? (
                        <span className="block min-w-0">
                          <span className="block text-[17px] font-medium leading-snug text-[#0b1024]">{selectedEmployee.name}</span>
                          {selectedEmployee.position ? <span className="block text-[14px] leading-snug text-[#6f7282]">{selectedEmployee.position}</span> : null}
                        </span>
                      ) : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        <span className="block">
                          <span className="block text-[16px]">{employee.name}</span>
                          {employee.position ? <span className="block text-[12px] text-[#6f7282]">{employee.position}</span> : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                )}
                {rememberedName ? (
                  <p className="mt-1.5 text-[14px] text-[#9b9fb3]">Запомнили с прошлого раза — можно сразу вводить показания.</p>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="text-[16px] font-semibold text-[#0b1024]">2. Показания</div>
                {draft.restored ? (
                  <p className="-mt-2 flex items-center justify-between gap-3 rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-2.5 text-[13px] leading-snug text-[#3848c7]">
                    <span>Восстановили введённое после обновления страницы.</span>
                    <button type="button" className="shrink-0 font-semibold underline" onClick={() => { draft.reset(); window.location.reload(); }}>
                      Начать заново
                    </button>
                  </p>
                ) : null}
                {hasToday ? (
                  <p className="-mt-2 rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-2.5 text-[13px] leading-snug text-[#3848c7]">
                    Сегодня уже записано — значения подставлены, проверьте и измените, что нужно.
                  </p>
                ) : null}
                {norms.temperature.enabled ? (
                  <ReadingField id="room-fill-temperature" label="Температура" unit="°C" stamp={stampLabel} value={temperature} onChange={setTemperature} min={norms.temperature.min} max={norms.temperature.max} required />
                ) : null}

                {norms.humidity.enabled ? (
                  <ReadingField id="room-fill-humidity" label="Влажность" unit="%" stamp={stampLabel} value={humidity} onChange={setHumidity} min={norms.humidity.min} max={norms.humidity.max} invalidText={humidityInvalid ? "Влажность — число от 0 до 100." : null} />
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

              {error && !/PIN/.test(error) ? (
                <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] text-[#a13a32]">{error}</div>
              ) : null}

              {pinRequired ? <PinPrompt value={pin} onChange={setPin} error={error && /PIN/.test(error) ? error : null} /> : null}
              <div>
                <Button
                  type="button"
                  onClick={save}
                  disabled={submitting || !employeeId || !hasValue || !hasActiveDocument || correctionMissing || (pinRequired && pin.length < 4)}
                  className="h-14 w-full rounded-2xl bg-[#5566f6] px-5 text-[18px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
                >
                  {submitting ? "Сохраняем…" : "3. Сохранить"}
                </Button>
                {hasActiveDocument && nextSlot ? (
                  <p className="mt-2 text-center text-[14px] text-[#9b9fb3]">
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
