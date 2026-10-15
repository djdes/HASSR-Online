"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQrFillCopy, useQrFeedback, qrResponseFeedback, type QrFeedback } from "@/components/qr-fill/qr-fill-presentation";
import { AlertTriangle } from "lucide-react";
import { SuccessCheck } from "@/components/qr-fill/success-check";

import { Button } from "@/components/ui/button";
import { DeviationCorrection } from "@/components/qr-fill/deviation-correction";
import { QrPageShell } from "@/components/qr-fill/qr-page-shell";
import { WhoRow } from "@/components/qr-fill/who-row";
import { EmployeePicker } from "@/components/qr-fill/employee-picker";
import { ReadingField } from "@/components/qr-fill/reading-field";
import { ReadingPhoto } from "@/components/qr-fill/reading-photo";
import { isReadingPhotoUrl } from "@/lib/reading-photos";
import {
  DEFAULT_READING_PHOTO_SETTINGS,
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

const ROOM_ERROR_KEYS = {
  "roomFill.errors.invalidCode": "errors.invalidCode",
  "roomFill.errors.roomNotFound": "errors.roomNotFound",
  "roomFill.errors.enterTemperatureOrHumidity": "errors.enterTemperatureOrHumidity",
  "roomFill.errors.noDocument": "errors.noDocument",
  "roomFill.errors.periodClosed": "errors.periodClosed",
  "roomFill.errors.orgPaused": "errors.orgPaused",
} as const;
type RoomFeedback = QrFeedback | { roomKey: typeof ROOM_ERROR_KEYS[keyof typeof ROOM_ERROR_KEYS] | "reading.enterReadings" };

export function roomResponseFeedback(data: unknown): RoomFeedback {
  const code = data && typeof data === "object" && "errorCode" in data ? data.errorCode : null;
  if (typeof code === "string" && Object.hasOwn(ROOM_ERROR_KEYS, code)) return { roomKey: ROOM_ERROR_KEYS[code as keyof typeof ROOM_ERROR_KEYS] };
  return qrResponseFeedback(data, "reading.saveError");
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
export function RoomFillClient({ token, room, norms, hasActiveDocument, nextSlot, employees, mode = "public", sessionEmployee = null, todayValues = null, stamp = null, journalTitle, rememberedEmployeeId = null, passEmployeeId = null, photoAutofill = false, photoFixation = DEFAULT_READING_PHOTO_SETTINGS }: Props) {
  const t = useTranslations("roomFill");
  const { t: q } = useQrFillCopy();
  const feedback = useQrFeedback();
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
  const [error, setError] = useState<RoomFeedback | null>(null);
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
    if (hydratedRef.current) return;
    try {
      if (mode === "auth" && sessionEmployee) {
        setEmployeeId(sessionEmployee.id);
        hydratedRef.current = true;
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
      setError({ key: "reading.selectName" });
      return;
    }
    if (!hasValue) {
      setError({ roomKey: "reading.enterReadings" });
      return;
    }
    if (photoMissing) {
      setError({ key: "photo.requiredError" });
      return;
    }
    if (correctionMissing) {
      setError({ key: "reading.correctionRequired" });
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/room-fill/${encodeURIComponent(room.id)}`, {
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
      if (!response.ok) {
        setError(roomResponseFeedback(data));
        return;
      }
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
    } catch {
      setError({ key: "reading.saveError" });
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
    ? q("reading.noDocumentBlocked")
    : !employeeId
      ? q("reading.noEmployee")
      : pinRequired && !hasPass
        ? q("reading.noPin")
        : !hasValue
          ? norms.temperature.enabled && norms.humidity.enabled
            ? t("reading.missingReadings")
            : norms.humidity.enabled
              ? t("reading.missingHumidity")
              : q("reading.noTemperature")
          : photoMissing
            ? q("photo.requiredBlocked")
            : correctionMissing
              ? q("reading.describeAction")
              : null;
  // После сохранения текущий объект в списке сразу «снят» — с введёнными значениями.

  return (
    <QrPageShell orgName={room.organizationName} title={journalTitle}>
        <QrPinUiStyles />
        {/* Смены помещения на плакате нет (владелец, 2026-09-22): каждое
            помещение — своим QR, чтобы замер делали на месте. */}
        <WhoRow label={t("reading.room")} value={room.name} />
        {!hasActiveDocument ? (
          <div className="mb-5 flex gap-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4 text-[14px] leading-relaxed text-[#7a4a00]">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <span>
              {t("reading.noDocument")}</span>
          </div>
        ) : null}

        {saved ? (
          <div className="rounded-3xl border border-[#ececf4] bg-white p-8 text-center">
            <SuccessCheck />
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">{q("common.recorded")}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
              {t("reading.savedSummary", { hasSlot: saved.slot ? "yes" : "no", slot: saved.slot, hasName: rememberedName ? "yes" : "no", name: rememberedName ?? "" })}
              {saved.photoAttached ? ` ${q("reading.photoAttached")}` : ""}
            </p>
            {saved.outOfRange ? (
              <p className="mt-3 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#a13a32]">
                {t("reading.deviationSaved")}</p>
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
              {q("reading.another")}</button>
          </div>
        ) : (
          <div>
            <div className="space-y-5">
              <EmployeePicker
                employees={employees.map((employee) => ({ id: employee.id, name: employee.name, position: employee.position, hasPin: employee.hasPin }))}
                value={employeeId}
                onChange={rememberEmployee}
                fixedName={fixedEmployee ? sessionEmployee?.name ?? null : null}
                hint={restoredId !== null && restoredId === employeeId ? (!pinStepNeeded ? q("reading.rememberedReady") : selectedEmployee?.hasPin ? q("reading.rememberedPin") : null) : null}
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
                <div className="text-[16px] font-semibold text-[#0b1024]">{t("reading.heading")}</div>
                {draft.restored ? (
                  <p className="-mt-2 flex items-center justify-between gap-3 rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-2.5 text-[13px] leading-snug text-[#3848c7]">
                    <span>{q("reading.draftRestored")}</span>
                    <button type="button" className="shrink-0 font-semibold underline" onClick={() => { draft.reset(); window.location.reload(); }}>
                      {q("reading.startAgain")}</button>
                  </p>
                ) : null}
                {hasToday ? (
                  <p className="-mt-2 rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-2.5 text-[13px] leading-snug text-[#3848c7]">
                    {t("reading.prefilled")}</p>
                ) : null}
                {norms.temperature.enabled ? (
                  <div>
                    {view.showField ? (
                      <ReadingField
                        id="room-fill-temperature"
                        label={q("reading.temperature")}
                        unit="°C"
                        stamp={stampLabel}
                        value={temperature}
                        onChange={changeTemperature}
                        min={norms.temperature.min}
                        max={norms.temperature.max}
                        required
                        // Число подставлено со снимка и не правилось — пусть человек сверит.
                        mark={recognizedTemperature !== null && temperature.trim() === recognizedTemperature ? q("photo.checkMark") : null}
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
                        disabledReason={employeeId ? null : q("reading.selectNameFirst")}
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
                        {q("photo.manual")}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {norms.humidity.enabled && view.showField ? (
                  <ReadingField id="room-fill-humidity" label={q("reading.humidity")} unit="%" stamp={stampLabel} value={humidity} onChange={setHumidity} min={norms.humidity.min} max={norms.humidity.max} invalidText={humidityInvalid ? t("reading.humidityInvalid") : null} />
                ) : null}

                {/* Вне нормы — «Что сделали» обязательно: комментарий ложится
                    в журнал рядом с замером и виден в печати. */}
                {needsCorrection ? (
                  <DeviationCorrection
                    title={
                      temperatureOutside && humidityOutside
                        ? q("reading.bothOutside")
                        : temperatureOutside
                          ? q("reading.temperatureOutside")
                          : q("reading.humidityOutside")
                    }
                    hint={q("reading.managerNotified")}
                    value={correction}
                    onChange={setCorrection}
                  />
                ) : null}
              </div>

              {error ? (
              <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] text-[#a13a32]">{"roomKey" in error ? t(error.roomKey) : feedback(error)}</div>
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
                    {submitting ? q("common.saving") : confirmRecognized ? q("photo.confirmSave") : t("reading.save")}
                  </Button>
                  <SaveBlockedReason reason={submitting ? null : blockedReason} />
                  {hasActiveDocument && nextSlot ? (
                    <p className="mt-2 text-center text-[14px] text-[#9b9fb3]">
                      {t("reading.slotHint", { slot: nextSlot })}
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
