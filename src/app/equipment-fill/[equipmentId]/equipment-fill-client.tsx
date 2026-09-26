"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { SuccessCheck } from "@/components/qr-fill/success-check";
import { Button } from "@/components/ui/button";
import { DeviationCorrection } from "@/components/qr-fill/deviation-correction";
import { QrPageShell } from "@/components/qr-fill/qr-page-shell";
import { WhoRow } from "@/components/qr-fill/who-row";
import { EmployeePicker } from "@/components/qr-fill/employee-picker";
import { ReadingField } from "@/components/qr-fill/reading-field";
import { ReadingPhoto } from "@/components/qr-fill/reading-photo";
import { READING_PHOTO_TEXT, isReadingPhotoUrl } from "@/lib/reading-photos";
import { NextQrButton } from "@/components/qr-fill/next-qr-button";
import { QrPassNote, QrPinOk, QrPinStep, QrPinUiStyles, QrRememberToggle, forgetQrPass, rememberQrEmployee } from "@/components/qr-fill/qr-pin-step";
import { draftKeyFor, useFormDraft } from "@/components/qr-fill/use-form-draft";
import { EquipmentStatusChoice } from "@/components/qr-fill/equipment-status-choice";
import { SaveBlockedReason } from "@/components/qr-fill/save-blocked-reason";
import { COLD_EQUIPMENT_STATUS_SHORT, COLD_EQUIPMENT_STATUS_TITLE, parseColdEquipmentStatus, type ColdEquipmentStatus } from "@/lib/cold-equipment-document";

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
  todayValues?: { temperature?: number | null; humidity?: number | null; status?: ColdEquipmentStatus | null } | null;
  /** «20.09.2026» и «18:31» по часовому поясу организации — подпись «за какой момент вносится». */
  stamp?: { date: string; time: string } | null;
  /** Шапка в две строки: организация и название журнала. */
  organizationName: string;
  journalTitle: string;
  /** «Запомнить выбор на этом оборудовании» — сотрудник из cookie организации. */
  rememberedEmployeeId?: string | null;
  /** Чей пропуск после PIN лежит в cookie организации (30 минут) — ему PIN не спрашиваем. */
  passEmployeeId?: string | null;
  /** Платный тариф: показание со снимка («Фото» у температуры) заполняется само. */
  photoAutofill?: boolean;
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
  rememberedEmployeeId = null,
  passEmployeeId = null,
  photoAutofill = false,
}: Props) {
  const [employeeId, setEmployeeId] = useState<string>("");
  // Кого восстановили из памяти при входе: «Запомнили с прошлого раза» — только ему
  // и только пока выбор не меняли руками.
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const hydratedRef = useRef(false);
  // Единые правила QR (2026-09-22): PIN — шагом до формы, дальше пропуск визита.
  const [pass, setPass] = useState<string | null>(null);
  const [pinOk, setPinOk] = useState(false);
  const [remember, setRemember] = useState(true);
  // Пропуск в cookie (F5, соседняя наклейка): действует для этого сотрудника.
  const [cookiePassFor, setCookiePassFor] = useState<string | null>(passEmployeeId);
  // Имя запоминаем сразу при выборе, а не только после записи: обновление страницы или обрыв связи не заставят выбирать заново.
  const rememberEmployee = (id: string) => {
    setEmployeeId(id);
    setRestoredId(null);
    setPass(null);
    setPinOk(false);
    const next = employees.find((item) => item.id === id);
    // Без PIN выбор запоминаем сразу; с PIN — на шаге PIN.
    if (mode !== "auth" && !(mode === "pin" || next?.hasPin)) {
      rememberQrEmployee({ kind: "equipment", objectId: equipment.id, token, employeeId: id, remember });
    }
    try {
      localStorage.setItem(LS_EMPLOYEE_KEY, id);
      localStorage.setItem(LS_SHARED_EMPLOYEE_KEY, id);
    } catch {
      /* приватный режим */
    }
  };
  const fixedEmployee = mode === "auth" && sessionEmployee && !sessionEmployee.canPickOthers;
  // Морозилка (норма ниже нуля) — минус стоит сразу: на цифровой клавиатуре
  // телефона его не набрать.
  const hasToday = typeof todayValues?.temperature === "number" || Boolean(todayValues?.status);
  // «Обслуживание»/«Ремонт» вместо температуры — в журнале «обсл»/«рем».
  const [status, setStatus] = useState<ColdEquipmentStatus | null>(todayValues?.status ?? null);
  const [temperature, setTemperature] = useState<string>(
    typeof todayValues?.temperature === "number" ? String(todayValues.temperature) : equipment.tempMax != null && equipment.tempMax < 0 ? "-" : ""
  );
  const [humidity, setHumidity] = useState<string>("");
  // «Фото» у температуры: снимок дисплея прикрепляется к замеру (всем),
  // на платном тарифе показание со снимка подставляется в поле.
  const [photo, setPhoto] = useState<string | null>(null);
  const [recognizedTemperature, setRecognizedTemperature] = useState<string | null>(null);
  const [photoAttached, setPhotoAttached] = useState(false);
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
    { temperature, humidity, correction, status: status ?? "", photo: photo ?? "" },
    (saved) => {
      if (typeof saved.temperature === "string") setTemperature(saved.temperature);
      if (typeof saved.status === "string") setStatus(parseColdEquipmentStatus(saved.status));
      if (typeof saved.humidity === "string") setHumidity(saved.humidity);
      if (typeof saved.correction === "string") setCorrection(saved.correction);
      if (isReadingPhotoUrl(saved.photo)) setPhoto(saved.photo);
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
    const remembered = passEmployeeId ?? rememberedEmployeeId ?? localStorage.getItem(LS_SHARED_EMPLOYEE_KEY) ?? localStorage.getItem(LS_EMPLOYEE_KEY);
    if (remembered && employees.some((e) => e.id === remembered)) {
      setEmployeeId(remembered);
      // «Запомнили…» — только за восстановление при входе, не за позднее обновление пропсов.
      if (!hydratedRef.current) setRestoredId(remembered);
    }
    hydratedRef.current = true;
  }, [employees, mode, sessionEmployee, rememberedEmployeeId, passEmployeeId]);

  // «Не вы? Сменить»: снять пропуск и запомненный выбор — телефон общий.
  function logout() {
    void forgetQrPass({ kind: "equipment", objectId: equipment.id, token });
    setCookiePassFor(null);
    setPass(null);
    setPinOk(false);
    setEmployeeId("");
    setRestoredId(null);
    try {
      localStorage.removeItem(LS_EMPLOYEE_KEY);
      localStorage.removeItem(LS_SHARED_EMPLOYEE_KEY);
    } catch {
      /* приватный режим */
    }
  }


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
    if (status || parsedTemp === null) return false;
    if (equipment.tempMin != null && parsedTemp < equipment.tempMin) return true;
    if (equipment.tempMax != null && parsedTemp > equipment.tempMax) return true;
    return false;
  }, [parsedTemp, equipment, status]);

  const humidityOutOfRange = useMemo(() => {
    if (status || parsedHumidity === null || !humidityNorm) return false;
    if (humidityNorm.min != null && parsedHumidity < humidityNorm.min) return true;
    if (humidityNorm.max != null && parsedHumidity > humidityNorm.max) return true;
    return false;
  }, [parsedHumidity, humidityNorm, status]);

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
    if (!status && parsedTemp === null) {
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
            ...(status ? { status } : { temperature: parsedTemp }),
            ...(!status && parsedHumidity !== null
              ? { humidity: parsedHumidity }
              : {}),
            // Комментарий — только к отклонению: вернули в норму — не отправляем.
            ...(needsCorrection && correction.trim() ? { correction: correction.trim() } : {}),
            // Снимок дисплея — к числу; у «обсл»/«рем» поля температуры нет.
            ...(!status && photo ? { photo } : {}),
            ...(pass ? { pass } : {}),
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Ошибка сохранения");
      }
      localStorage.setItem(LS_EMPLOYEE_KEY, employeeId);
      localStorage.setItem(LS_SHARED_EMPLOYEE_KEY, employeeId);
      setPhotoAttached(data?.photoAttached === true);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedEmployee = employees.find((item) => item.id === employeeId) ?? null;
  // PIN спрашиваем шагом до формы, когда он у сотрудника задан (или режим «имя + PIN»); вход в кабинет — без PIN.
  const pinRequired = mode !== "auth" && (mode === "pin" || Boolean(selectedEmployee?.hasPin));
  const hasPass = Boolean(pass) || (cookiePassFor !== null && cookiePassFor === employeeId);
  const pinStepNeeded = Boolean(employeeId) && pinRequired && !hasPass;
  // Почему «Сохранить» неактивна — пишем под кнопкой, а не оставляем серой загадкой.
  const blockedReason = !hasActiveDocument
    ? "Нет журнала на сегодня — запись некуда сохранить"
    : !employeeId
      ? "Не выбран сотрудник"
      : pinRequired && !hasPass
        ? "Не введён PIN"
        : !status && parsedTemp === null
          ? "Не указана температура"
          : correctionMissing
            ? "Опишите, что сделали"
            : null;

  return (
    <QrPageShell orgName={organizationName} title={journalTitle}>
        <QrPinUiStyles />
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
              {status
                ? `${COLD_EQUIPMENT_STATUS_TITLE[status]}: в журнале «${COLD_EQUIPMENT_STATUS_SHORT[status]}»`
                : `Температура ${parsedTemp}°C сохранена в журнал`}{" "}
              {rememberedName ? `на имя ${rememberedName}` : ""}.
              {photoAttached ? " Фото дисплея — в журнале рядом со значением." : ""}
            </p>
            {/* Раньше предупреждение о выходе за норму исчезало вместе с
                формой, и человек уходил, не зная, что делать дальше. */}
            {outOfRange ? (
              <p className="mt-3 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#a13a32]">
                Показание вне нормы — руководителю отправлено уведомление.
                Проверьте оборудование и сообщите начальнику.
              </p>
            ) : null}
            {/* «Следующий QR» — главное действие: обход холодильников подряд
                без повторного PIN. Ссылок на другие объекты нет — только камера. */}
            <div className="mt-6">
              <NextQrButton withoutPin={cookiePassFor === employeeId || !pinRequired} />
            </div>
            <button
              type="button"
              onClick={() => {
                setDone(false);
                setTemperature(equipment.tempMax != null && equipment.tempMax < 0 ? "-" : "");
                setHumidity("");
                setCorrection("");
                setStatus(null);
                setPhoto(null);
                setRecognizedTemperature(null);
                setPhotoAttached(false);
                setError(null);
              }}
              className="mt-3 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Записать ещё замер
            </button>
          </div>
        ) : (
          <div>
            <div className="space-y-5">
              <EmployeePicker
                employees={employees.map((employee) => ({ id: employee.id, name: employee.name, position: employee.positionTitle, hasPin: employee.hasPin }))}
                value={employeeId}
                onChange={rememberEmployee}
                fixedName={fixedEmployee ? sessionEmployee?.name ?? null : null}
                hint={restoredId !== null && restoredId === employeeId ? (!pinStepNeeded ? "Запомнили с прошлого раза — можно сразу вводить показания." : selectedEmployee?.hasPin ? "Запомнили с прошлого раза — введите свой PIN." : null) : null}
              />
              {pinRequired && hasPass && !fixedEmployee ? (
                <QrPassNote remembered={cookiePassFor === employeeId} onLogout={logout} />
              ) : null}
              {!fixedEmployee && mode !== "auth" && !(pinRequired && hasPass) ? <QrRememberToggle checked={remember} onChange={setRemember} /> : null}

              {pinStepNeeded && selectedEmployee ? (
                <QrPinStep
                  kind="equipment"
                  objectId={equipment.id}
                  token={token}
                  employeeId={selectedEmployee.id}
                  employeeName={selectedEmployee.name}
                  hasPin={Boolean(selectedEmployee.hasPin)}
                  remember={remember}
                  onPass={(value) => {
                    setPass(value);
                    setPinOk(true);
                    setCookiePassFor(remember ? selectedEmployee.id : null);
                  }}
                />
              ) : null}
              {pinOk ? <QrPinOk /> : null}
              {pinStepNeeded ? null : (
              <div className={pinOk ? "qp-rise space-y-5" : "space-y-5"}>

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
              {status ? null : (
                <ReadingField
                  id="equipment-fill-temperature"
                  label="Температура"
                  unit="°C"
                  stamp={stampLabel}
                  value={temperature}
                  onChange={setTemperature}
                  min={equipment.tempMin}
                  max={equipment.tempMax}
                  required
                  // Число подставлено со снимка и не правилось — пусть человек сверит.
                  mark={recognizedTemperature !== null && temperature.trim() === recognizedTemperature ? READING_PHOTO_TEXT.checkMark : null}
                  footer={
                    <ReadingPhoto
                      kind="equipment"
                      objectId={equipment.id}
                      token={token}
                      employeeId={employeeId}
                      pass={pass}
                      autofill={photoAutofill}
                      photoUrl={photo}
                      onPhotoChange={setPhoto}
                      value={temperature}
                      onRecognized={(text) => {
                        setTemperature(text);
                        setRecognizedTemperature(text);
                      }}
                      disabledReason={employeeId ? null : "Сначала выберите своё имя"}
                    />
                  }
                />
              )}
              <EquipmentStatusChoice value={status} onChange={setStatus} />

              {/* Дополнительное поле для оборудования с climate-mapping
                  на humidity (например, кондиционер в кондитерской цехе). */}
              {equipment.hasHumidityField && !status ? (
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

              {error ? (
                <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] text-[#a13a32]">
                  {error}
                </div>
              ) : null}

              <div>
                <Button
                  type="button"
                  onClick={save}
                  disabled={submitting || blockedReason !== null}
                  className="h-14 w-full rounded-2xl bg-[#5566f6] px-5 text-[18px] font-semibold text-white hover:bg-[#4a5bf0] shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] disabled:bg-[#c8cbe0]"
                >
                  {submitting ? "Сохраняем…" : "Сохранить замер"}
                </Button>
                <SaveBlockedReason reason={submitting ? null : blockedReason} />
              </div>
              </div>
              )}
            </div>
          </div>
        )}
    </QrPageShell>
  );
}
