"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { SuccessCheck } from "@/components/qr-fill/success-check";
import { Button } from "@/components/ui/button";
import { DeviationCorrection } from "@/components/qr-fill/deviation-correction";
import { QrPageShell } from "@/components/qr-fill/qr-page-shell";
import { WhoRow } from "@/components/qr-fill/who-row";
import { EmployeePicker } from "@/components/qr-fill/employee-picker";
import { ReadingField } from "@/components/qr-fill/reading-field";
import { PinPrompt } from "@/components/qr-fill/pin-prompt";
import { draftKeyFor, useFormDraft } from "@/components/qr-fill/use-form-draft";

type Employee = { id: string; name: string; positionTitle: string | null; hasPin?: boolean };

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
  /** Уже записанная сегодня температура этого оборудования — подставляется для правки. */
  todayValues?: { temperature?: number | null; humidity?: number | null } | null;
  /** «20.09.2026» и «18:31» по часовому поясу организации — подпись «за какой момент вносится». */
  stamp?: { date: string; time: string } | null;
  /** Шапка в две строки: организация и название журнала. */
  organizationName: string;
  journalTitle: string;
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
  todayValues = null,
  stamp = null,
  organizationName,
  journalTitle,
}: Props) {
  const [employeeId, setEmployeeId] = useState<string>("");
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
  // Морозилка (норма ниже нуля) — минус стоит сразу: на цифровой клавиатуре
  // телефона его не набрать.
  const hasToday = typeof todayValues?.temperature === "number";
  const [temperature, setTemperature] = useState<string>(
    typeof todayValues?.temperature === "number" ? String(todayValues.temperature) : equipment.tempMax != null && equipment.tempMax < 0 ? "-" : ""
  );
  const [humidity, setHumidity] = useState<string>("");
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
  const [done, setDone] = useState(false);
  // Черновик: обновил страницу или пропал интернет — введённое на месте; после записи стирается.
  const draft = useFormDraft(
    draftKeyFor(`equipment-fill:${equipment.id}`, stamp?.date),
    { temperature, humidity, correction },
    (saved) => {
      if (typeof saved.temperature === "string") setTemperature(saved.temperature);
      if (typeof saved.humidity === "string") setHumidity(saved.humidity);
      if (typeof saved.correction === "string") setCorrection(saved.correction);
    },
    Boolean(done)
  );
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
            ...(pin ? { pin } : {}),
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

  const selectedEmployee = employees.find((item) => item.id === employeeId) ?? null;
  // PIN спрашиваем всегда, когда он у выбранного сотрудника задан (или режим «имя + PIN»).
  const pinRequired = mode === "pin" || Boolean(selectedEmployee?.hasPin);

  return (
    <QrPageShell orgName={organizationName} title={journalTitle}>
        {/* Смены оборудования на наклейке нет (владелец, 2026-09-22): каждый
            холодильник — своей наклейкой, чтобы замер делали у него. */}
        <WhoRow label="Оборудование" value={equipment.name} />
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
            <SuccessCheck />
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
          <div>
            <div className="space-y-5">
              <EmployeePicker
                employees={employees.map((employee) => ({ id: employee.id, name: employee.name, position: employee.positionTitle, hasPin: employee.hasPin }))}
                value={employeeId}
                onChange={rememberEmployee}
                fixedName={fixedEmployee ? sessionEmployee?.name ?? null : null}
                hint={rememberedName ? "Запомнили с прошлого раза — можно сразу вводить показания." : null}
              />

              {hasToday ? (
                <p className="rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-2.5 text-[13px] leading-snug text-[#3848c7]">
                  Сегодня уже записано — значение подставлено, проверьте и измените, что нужно.
                </p>
              ) : null}
              {draft.restored ? (
                <p className="flex items-center justify-between gap-3 rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-2.5 text-[13px] leading-snug text-[#3848c7]">
                  <span>Восстановили введённое после обновления страницы.</span>
                  <button type="button" className="shrink-0 font-semibold underline" onClick={() => { draft.reset(); window.location.reload(); }}>
                    Начать заново
                  </button>
                </p>
              ) : null}
              <ReadingField id="equipment-fill-temperature" label="Температура" unit="°C" stamp={stampLabel} value={temperature} onChange={setTemperature} min={equipment.tempMin} max={equipment.tempMax} required />

              {/* Дополнительное поле для оборудования с climate-mapping
                  на humidity (например, кондиционер в кондитерской цехе). */}
              {equipment.hasHumidityField ? (
                <ReadingField id="equipment-fill-humidity" label="Влажность" unit="%" stamp={stampLabel} value={humidity} onChange={setHumidity} min={humidityNorm?.min} max={humidityNorm?.max} invalidText={humidity.trim() && parsedHumidity === null ? "Влажность — число от 0 до 100, можно оставить пустым." : null} />
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

              {error && !/PIN/.test(error) ? (
                <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] text-[#a13a32]">
                  {error}
                </div>
              ) : null}

              {pinRequired ? <PinPrompt value={pin} onChange={setPin} error={error && /PIN/.test(error) ? error : null} /> : null}
              <Button
                type="button"
                onClick={save}
                disabled={
                  submitting ||
                  !employeeId ||
                  parsedTemp === null ||
                  !hasActiveDocument ||
                  correctionMissing ||
                  (pinRequired && pin.length < 4)
                }
                className="h-14 w-full rounded-2xl bg-[#5566f6] px-5 text-[18px] font-semibold text-white hover:bg-[#4a5bf0] shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] disabled:bg-[#c8cbe0]"
              >
                {submitting ? "Сохраняем…" : "Сохранить замер"}
              </Button>
            </div>
          </div>
        )}
    </QrPageShell>
  );
}
