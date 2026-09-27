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
import {
  DEFAULT_READING_PHOTO_SETTINGS,
  READING_PHOTO_FIXATION_TEXT,
  initialReadingEntry,
  isBlankReading,
  isReadingPhotoMissing,
  readingFormView,
  type ReadingEntry,
  type ReadingPhotoPhase,
  type ReadingPhotoSettings,
} from "@/lib/reading-photo-fixation";
import { NextQrButton } from "@/components/qr-fill/next-qr-button";
import { QrPassNote, QrPinOk, QrPinStep, QrPinUiStyles, QrRememberToggle, forgetQrPass, rememberQrEmployee } from "@/components/qr-fill/qr-pin-step";
import { draftKeyFor, useFormDraft } from "@/components/qr-fill/use-form-draft";
import { SaveBlockedReason } from "@/components/qr-fill/save-blocked-reason";

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
  /** Уже записанные сегодня показания этого помещения — подставляются для правки. */
  todayValues?: { temperature?: number | null; humidity?: number | null } | null;
  /** «20.09.2026» и «18:31» по часовому поясу организации — подпись «за какой момент вносится». */
  stamp?: { date: string; time: string } | null;
  /** Название журнала в шапке (вторая строка после организации). */
  journalTitle: string;
  /** «Запомнить выбор на этом оборудовании» — сотрудник из cookie организации. */
  rememberedEmployeeId?: string | null;
  /** Чей пропуск после PIN лежит в cookie организации (30 минут) — ему PIN не спрашиваем. */
  passEmployeeId?: string | null;
  /** Платный тариф: показание со снимка («Фото» у температуры) заполняется само. */
  photoAutofill?: boolean;
  /** «Фотофиксация показаний» организации: «Сфотографируйте показание» первым действием, фото обязательно. */
  photoFixation?: ReadingPhotoSettings;
};

const LS_EMPLOYEE_KEY = "wesetup.room-fill.employeeId";
const LS_SHARED_EMPLOYEE_KEY = "wesetup.qr-fill.employeeId";


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
export function RoomFillClient({ token, room, norms, hasActiveDocument, nextSlot, employees, mode = "public", sessionEmployee = null, todayValues = null, stamp = null, journalTitle, rememberedEmployeeId = null, passEmployeeId = null, photoAutofill = false, photoFixation = DEFAULT_READING_PHOTO_SETTINGS }: Props) {
  const [employeeId, setEmployeeId] = useState("");
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
      rememberQrEmployee({ kind: "room", objectId: room.id, token, employeeId: id, remember });
    }
    try {
      localStorage.setItem(LS_EMPLOYEE_KEY, id);
      localStorage.setItem(LS_SHARED_EMPLOYEE_KEY, id);
    } catch {
      /* приватный режим */
    }
  };
  const fixedEmployee = mode === "auth" && sessionEmployee && !sessionEmployee.canPickOthers;
  // Холодный склад с нормой ниже нуля — минус стоит сразу.
  const hasToday = typeof todayValues?.temperature === "number" || typeof todayValues?.humidity === "number";
  const blankTemperature = norms.temperature.max !== null && norms.temperature.max < 0 ? "-" : "";
  const [temperature, setTemperature] = useState(
    typeof todayValues?.temperature === "number" ? String(todayValues.temperature) : blankTemperature
  );
  const [humidity, setHumidity] = useState(typeof todayValues?.humidity === "number" ? String(todayValues.humidity) : "");
  // Фото — к температуре: у помещения без температуры фотофиксации нет.
  const photoSettings: ReadingPhotoSettings = norms.temperature.enabled ? photoFixation : { enabled: false, required: false };
  // Фотофиксация (2026-09-27): показаний ещё нет — первым делом «Сфотографируйте
  // показание»; «Ввести вручную» или любой ввод — обычная форма.
  const [entry, setEntry] = useState<ReadingEntry>(() =>
    hasToday ? "manual" : initialReadingEntry(photoSettings, typeof todayValues?.temperature === "number" ? String(todayValues.temperature) : blankTemperature)
  );
  const [photoPhase, setPhotoPhase] = useState<ReadingPhotoPhase>("idle");
  // «Фото» у температуры: снимок дисплея прикрепляется к замеру (всем),
  // на платном тарифе показание со снимка подставляется в поле.
  const [photo, setPhoto] = useState<string | null>(null);
  const [recognizedTemperature, setRecognizedTemperature] = useState<string | null>(null);
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
  const [saved, setSaved] = useState<{ slot: string; outOfRange: boolean; photoAttached: boolean } | null>(null);
  // Черновик: обновил страницу или пропал интернет — введённое на месте; после записи стирается.
  const draft = useFormDraft(
    draftKeyFor(`room-fill:${room.id}`, stamp?.date),
    { temperature, humidity, correction, photo: photo ?? "" },
    (saved) => {
      if (typeof saved.temperature === "string") {
        setTemperature(saved.temperature);
        if (!isBlankReading(saved.temperature)) setEntry("manual");
      }
      if (typeof saved.humidity === "string") {
        setHumidity(saved.humidity);
        if (saved.humidity.trim()) setEntry("manual");
      }
      if (typeof saved.correction === "string") setCorrection(saved.correction);
      if (isReadingPhotoUrl(saved.photo)) setPhoto(saved.photo);
    },
    Boolean(saved)
  );

  useEffect(() => {
    try {
      if (mode === "auth" && sessionEmployee) {
        setEmployeeId(sessionEmployee.id);
        return;
      }
      const remembered = passEmployeeId ?? rememberedEmployeeId ?? localStorage.getItem(LS_SHARED_EMPLOYEE_KEY) ?? localStorage.getItem(LS_EMPLOYEE_KEY);
      if (remembered && employees.some((employee) => employee.id === remembered)) {
        setEmployeeId(remembered);
        // «Запомнили…» — только за восстановление при входе, не за позднее обновление пропсов.
        if (!hydratedRef.current) setRestoredId(remembered);
      }
      hydratedRef.current = true;
    } catch {
      /* приватный режим — выберут имя вручную */
    }
  }, [employees, mode, sessionEmployee, rememberedEmployeeId, passEmployeeId]);

  // «Не вы? Сменить»: снять пропуск и запомненный выбор — телефон общий.
  function logout() {
    void forgetQrPass({ kind: "room", objectId: room.id, token });
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

  // Что показывать: главная кнопка снимка / поля / «Сохранить».
  const view = readingFormView({
    settings: photoSettings,
    entry,
    phase: photoPhase,
    photoUrl: photo,
    value: temperature,
    status: false,
  });
  // «Фото обязательно» — температуру без снимка не сохранить (одна влажность — можно).
  const photoMissing = isReadingPhotoMissing({
    settings: photoSettings,
    hasReading: norms.temperature.enabled && temperatureValue !== null,
    photoUrl: photo,
  });
  // Число со снимка не правили — одно нажатие «Всё верно — сохранить».
  const confirmRecognized = Boolean(photo) && recognizedTemperature !== null && temperature.trim() === recognizedTemperature;
  const changeTemperature = (value: string) => {
    setTemperature(value);
    setEntry("manual");
  };
  const enterManually = () => {
    setEntry("manual");
    window.requestAnimationFrame(() => document.getElementById("room-fill-temperature")?.focus());
  };
  // Число со снимка подставили — «Всё верно — сохранить» должна быть на экране: одно нажатие без прокрутки.
  const saveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (recognizedTemperature === null) return;
    const id = window.requestAnimationFrame(() => saveRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    return () => window.cancelAnimationFrame(id);
  }, [recognizedTemperature]);

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
    if (photoMissing) {
      setError(READING_PHOTO_FIXATION_TEXT.requiredError);
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
          // Комментарий — только к отклонению: вернули в норму — не отправляем.
          ...(needsCorrection && correction.trim() ? { correction: correction.trim() } : {}),
          // Снимок показания — к температуре.
          ...(photoSettings.enabled && temperatureValue !== null && photo ? { photo } : {}),
          ...(pass ? { pass } : {}),
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
        photoAttached: data?.photoAttached === true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
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
        : !hasValue
          ? norms.temperature.enabled && norms.humidity.enabled
            ? "Не указаны показания"
            : norms.humidity.enabled
              ? "Не указана влажность"
              : "Не указана температура"
          : photoMissing
            ? READING_PHOTO_FIXATION_TEXT.needPhoto
            : correctionMissing
              ? "Опишите, что сделали"
              : null;
  // После сохранения текущий объект в списке сразу «снят» — с введёнными значениями.

  return (
    <QrPageShell orgName={room.organizationName} title={journalTitle}>
        <QrPinUiStyles />
        {/* Смены помещения на плакате нет (владелец, 2026-09-22): каждое
            помещение — своим QR, чтобы замер делали на месте. */}
        <WhoRow label="Помещение" value={room.name} />
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
            <SuccessCheck />
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">Записано</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
              Записано в бланк за сегодня{saved.slot ? `, ${saved.slot}` : ""}
              {rememberedName ? ` — на имя ${rememberedName}` : ""}.
              {saved.photoAttached ? " Фото показания — в бланке рядом со значением." : ""}
            </p>
            {saved.outOfRange ? (
              <p className="mt-3 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#a13a32]">
                Показание вне нормы — руководителю уже отправлено уведомление. Проветрите или сообщите о поломке.
              </p>
            ) : null}
            {/* «Следующий QR» — главное действие: обход складов подряд без
                повторного PIN. Ссылок на другие объекты нет — только камера. */}
            <div className="mt-6">
              <NextQrButton withoutPin={cookiePassFor === employeeId || !pinRequired} />
            </div>
            <button
              type="button"
              onClick={() => {
                setSaved(null);
                setTemperature(blankTemperature);
                setEntry(initialReadingEntry(photoSettings, blankTemperature));
                setPhotoPhase("idle");
                setHumidity("");
                setCorrection("");
                setPhoto(null);
                setRecognizedTemperature(null);
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
                employees={employees.map((employee) => ({ id: employee.id, name: employee.name, position: employee.position, hasPin: employee.hasPin }))}
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
                  kind="room"
                  objectId={room.id}
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

              <div className="space-y-4">
                <div className="text-[16px] font-semibold text-[#0b1024]">Показания</div>
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
                  <div>
                    {view.showField ? (
                      <ReadingField
                        id="room-fill-temperature"
                        label="Температура"
                        unit="°C"
                        stamp={stampLabel}
                        value={temperature}
                        onChange={changeTemperature}
                        min={norms.temperature.min}
                        max={norms.temperature.max}
                        required
                        // Число подставлено со снимка и не правилось — пусть человек сверит.
                        mark={recognizedTemperature !== null && temperature.trim() === recognizedTemperature ? READING_PHOTO_TEXT.checkMark : null}
                      />
                    ) : null}
                    {/* Снимок — всегда на этом месте дерева: смена «главная кнопка → карточка
                        под полем» не сбрасывает загрузку и распознавание. */}
                    {photoSettings.enabled ? (
                      <ReadingPhoto
                        kind="room"
                        objectId={room.id}
                        token={token}
                        employeeId={employeeId}
                        pass={pass}
                        autofill={photoAutofill}
                        photoUrl={photo}
                        onPhotoChange={(url) => {
                          setPhoto(url);
                          if (!url) setRecognizedTemperature(null);
                        }}
                        value={temperature}
                        onRecognized={(text) => {
                          setTemperature(text);
                          setRecognizedTemperature(text);
                        }}
                        disabledReason={employeeId ? null : "Сначала выберите своё имя"}
                        variant={view.photoFirst ? "primary" : "inline"}
                        required={photoSettings.required}
                        onPhaseChange={setPhotoPhase}
                      />
                    ) : null}
                    {view.photoFirst && !photoSettings.required ? (
                      <button
                        type="button"
                        onClick={enterManually}
                        className="mt-3 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-5 text-[16px] font-semibold text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                        data-testid="reading-manual-button"
                      >
                        {READING_PHOTO_FIXATION_TEXT.manualButton}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {norms.humidity.enabled && view.showField ? (
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

              {error ? (
                <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] text-[#a13a32]">{error}</div>
              ) : null}

              {/* Пока ждём снимок — «Сохранить» нет: главное действие одно. */}
              {view.showSave ? (
                <div ref={saveRef}>
                  <Button
                    type="button"
                    onClick={save}
                    disabled={submitting || blockedReason !== null}
                    className="h-14 w-full rounded-2xl bg-[#5566f6] px-5 text-[18px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
                    data-testid="room-fill-save"
                  >
                    {submitting ? "Сохраняем…" : confirmRecognized ? READING_PHOTO_FIXATION_TEXT.confirmSave : "Сохранить"}
                  </Button>
                  <SaveBlockedReason reason={submitting ? null : blockedReason} />
                  {hasActiveDocument && nextSlot ? (
                    <p className="mt-2 text-center text-[14px] text-[#9b9fb3]">
                      Запись попадёт в журнал за сегодня, срок контроля {nextSlot}.
                    </p>
                  ) : null}
                </div>
              ) : null}
              </div>
              )}
            </div>
          </div>
        )}
    </QrPageShell>
  );
}
