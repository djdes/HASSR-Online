"use client";

import { useState } from "react";
import {
  Camera,
  Clock,
  Loader2,
  KeyRound,
  Lock,
  QrCode,
  ShieldCheck,
  Thermometer,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

/** Варианты ожидания перед эскалацией — в минутах. */
const ESCALATION_OPTIONS = [30, 60, 120, 240] as const;

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = minutes / 60;
  if (hours === 1) return "1 час";
  if (hours < 5) return `${hours} часа`;
  return `${hours} часов`;
}

type Props = {
  initialRequireAdminForJournalEdit: boolean;
  initialShiftEndHour: number;
  initialLockPastDayEdits: boolean;
  initialRequirePhotoOnTaskFillStep: boolean;
  initialEscalateDeviations: boolean;
  initialEscalationMinutes: number;
  initialQrFillMode: QrFillModeValue;
};

type QrFillModeValue = "public" | "pin" | "auth";

/** Режимы QR-форм: чем правее, тем достовернее подпись и тем больше шагов. */
const QR_FILL_MODES: Array<{
  value: QrFillModeValue;
  label: string;
  hint: string;
  icon: typeof Users;
}> = [
  {
    value: "public",
    label: "Из списка",
    hint: "Любой, кто отсканировал плакат, выбирает своё имя. Быстрее всего, но при проверке запись можно оспорить: имя мог выбрать кто угодно.",
    icon: Users,
  },
  {
    value: "pin",
    label: "Имя + PIN",
    hint: "Сотрудник выбирает имя и вводит личный 4-значный PIN из своей карточки. Пять ошибок — блокировка на 15 минут. Проще пароля на чужом телефоне.",
    icon: KeyRound,
  },
  {
    value: "auth",
    label: "Только после входа",
    hint: "После сканирования — вход под своим аккаунтом (пароль или Telegram), имя не выбирается. Запись подписана аккаунтом — для проверяющих это достоверно.",
    icon: UserRound,
  },
];

export function ComplianceClient({
  initialRequireAdminForJournalEdit,
  initialShiftEndHour,
  initialLockPastDayEdits,
  initialRequirePhotoOnTaskFillStep,
  initialEscalateDeviations,
  initialEscalationMinutes,
  initialQrFillMode,
}: Props) {
  const [qrFillMode, setQrFillMode] = useState<QrFillModeValue>(initialQrFillMode);
  const [savingQrMode, setSavingQrMode] = useState(false);

  async function handleQrFillMode(next: QrFillModeValue) {
    if (next === qrFillMode || savingQrMode) return;
    const previous = qrFillMode;
    setQrFillMode(next);
    setSavingQrMode(true);
    try {
      const response = await fetch("/api/settings/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrFillMode: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Не удалось сохранить");
      toast.success(
        next === "auth"
          ? "QR-формы теперь требуют вход: запись подписывает аккаунт"
          : next === "pin"
            ? "QR-формы: имя + PIN. Задайте PIN сотрудникам в их карточках"
            : "QR-формы открыты: имя выбирается из списка"
      );
    } catch (error) {
      setQrFillMode(previous);
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setSavingQrMode(false);
    }
  }
  const [value, setValue] = useState(initialRequireAdminForJournalEdit);
  const [shiftEndHour, setShiftEndHour] = useState(initialShiftEndHour);
  const [lockPastDay, setLockPastDay] = useState(initialLockPastDayEdits);
  const [requirePhoto, setRequirePhoto] = useState(
    initialRequirePhotoOnTaskFillStep
  );
  const [saving, setSaving] = useState(false);
  const [savingShift, setSavingShift] = useState(false);
  const [savingLock, setSavingLock] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [escalate, setEscalate] = useState(initialEscalateDeviations);
  const [escalationMinutes, setEscalationMinutes] = useState(
    initialEscalationMinutes
  );
  const [savingEscalation, setSavingEscalation] = useState(false);

  async function handleToggle(next: boolean) {
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      const response = await fetch("/api/settings/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireAdminForJournalEdit: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сохранить");
      }
      toast.success(
        next
          ? "Включено: править могут только администраторы"
          : "Выключено: может править любой сотрудник"
      );
    } catch (error) {
      setValue(previous);
      toast.error(
        error instanceof Error ? error.message : "Ошибка сохранения"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLockPastDayToggle(next: boolean) {
    const previous = lockPastDay;
    setLockPastDay(next);
    setSavingLock(true);
    try {
      const response = await fetch("/api/settings/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockPastDayEdits: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сохранить");
      }
      toast.success(
        next
          ? "Закрытый день включён: вчерашние записи заперты"
          : "Закрытый день выключен: записи можно править"
      );
    } catch (error) {
      setLockPastDay(previous);
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSavingLock(false);
    }
  }

  async function handleRequirePhotoToggle(next: boolean) {
    const previous = requirePhoto;
    setRequirePhoto(next);
    setSavingPhoto(true);
    try {
      const response = await fetch("/api/settings/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirePhotoOnTaskFillStep: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сохранить");
      }
      toast.success(
        next
          ? "Фото-доказательство включено: каждый шаг pipeline теперь требует фото"
          : "Фото-доказательство выключено: pipeline-шаги подтверждаются одной кнопкой"
      );
    } catch (error) {
      setRequirePhoto(previous);
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSavingPhoto(false);
    }
  }

  async function handleEscalateToggle(next: boolean) {
    const previous = escalate;
    setEscalate(next);
    setSavingEscalation(true);
    try {
      const response = await fetch("/api/settings/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalateDeviationsToManagement: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сохранить");
      }
      toast.success(
        next
          ? "Руководство узнает, если отклонение не исправлено вовремя"
          : "Сообщать будем только ответственному за журнал"
      );
    } catch (error) {
      setEscalate(previous);
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSavingEscalation(false);
    }
  }

  async function handleEscalationMinutesChange(next: number) {
    const previous = escalationMinutes;
    setEscalationMinutes(next);
    setSavingEscalation(true);
    try {
      const response = await fetch("/api/settings/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviationEscalationMinutes: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сохранить");
      }
      toast.success(`Ждём исправления ${formatMinutes(next)}`);
    } catch (error) {
      setEscalationMinutes(previous);
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSavingEscalation(false);
    }
  }

  async function handleShiftEndChange(next: number) {
    const previous = shiftEndHour;
    setShiftEndHour(next);
    setSavingShift(true);
    try {
      const response = await fetch("/api/settings/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftEndHour: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сохранить");
      }
      toast.success(
        `Час окончания смены: ${String(next).padStart(2, "0")}:00 UTC`
      );
    } catch (error) {
      setShiftEndHour(previous);
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSavingShift(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-[#0b1024]">
                  Только админы могут править выполненные записи
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
                  Когда включено — кнопка «Изменить данные» на уже
                  выполненной задаче появляется только у руководителей
                  (manager / head_chef / технолог / собственник). Рядовые
                  сотрудники видят запись как сохранённую, без возможности
                  её изменить.
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    По умолчанию выключено. Большинству бригад эта строгость
                    не нужна — сотрудник, который только что заполнил
                    журнал, должен иметь возможность сам исправить опечатку.
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {saving ? (
                  <Loader2 className="size-4 animate-spin text-[#9b9fb3]" />
                ) : null}
                <Switch
                  checked={value}
                  onCheckedChange={(next) => {
                    if (saving) return;
                    void handleToggle(next);
                  }}
                  disabled={saving}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13px] leading-relaxed text-[#6f7282]">
          <span className="font-medium text-[#0b1024]">История правок</span>{" "}
          сохраняется в журнале независимо от этого переключателя — каждое
          изменение фиксируется с указанием автора, времени и предыдущих
          значений. Это требование ХАССП, его нельзя отключить.
        </div>
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
            <Clock className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-[#0b1024]">
                  Час окончания рабочей смены
                </div>
                <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-[#6f7282]">
                  Когда наступает этот час по UTC — система автоматически
                  закрывает все «общие задачи смены» (event-журналы) без
                  записей с пометкой «закрыто автоматически». Compliance
                  становится зелёным, но в weekly-digest менеджер увидит
                  это как флаг халатности.
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    По умолчанию <strong>0</strong> (полночь UTC = 03:00
                    МСК). Для ночных смен поставьте, например, 6 — смена
                    закроется в 06:00 UTC = 09:00 МСК.
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {savingShift ? (
                  <Loader2 className="size-4 animate-spin text-[#9b9fb3]" />
                ) : null}
                <select
                  value={shiftEndHour}
                  onChange={(e) =>
                    handleShiftEndChange(Number(e.target.value))
                  }
                  disabled={savingShift}
                  className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024]"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00 UTC
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
            <Lock className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-[#0b1024]">
                  Закрытый день — нельзя править вчерашние записи
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
                  Когда включено — после момента «начало сегодняшнего
                  дня» (с учётом часа окончания смены выше) рядовые
                  сотрудники не могут изменить или удалить записи за
                  прошедшие дни. Управление по-прежнему может, но
                  каждое такое действие пишется в журнал аудита с
                  отметкой <span className="font-mono text-[12px]">closed_day.override</span>.
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    Используйте если ваш бизнес проходит ХАССП-аудит и
                    нужно гарантировать, что официант не «допишет»
                    вчерашний контроль t° задним числом.
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {savingLock ? (
                  <Loader2 className="size-4 animate-spin text-[#9b9fb3]" />
                ) : null}
                <Switch
                  checked={lockPastDay}
                  onCheckedChange={(next) => {
                    if (savingLock) return;
                    void handleLockPastDayToggle(next);
                  }}
                  disabled={savingLock}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
            <Camera className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-[#0b1024]">
                  Фото-доказательство на каждом шаге pipeline
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
                  Когда включено — в задаче TasksFlow для каждого шага
                  pipeline'а сотрудник обязан загрузить фотографию
                  (камера телефона). Кнопка «Сделал» заблокирована пока
                  фото не появилось. Каждое фото попадает в audit-log
                  с привязкой к конкретному шагу — manager в любой
                  момент может посмотреть «как именно повар проверил
                  холодильник в 09:34».
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    Превращает заполнение журнала из «голой галочки» в
                    реальное evidence trail для проверок РПН. Минус — у
                    сотрудников каждая задача занимает на 30-60 секунд
                    дольше.
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {savingPhoto ? (
                  <Loader2 className="size-4 animate-spin text-[#9b9fb3]" />
                ) : null}
                <Switch
                  checked={requirePhoto}
                  onCheckedChange={(next) => {
                    if (savingPhoto) return;
                    void handleRequirePhotoToggle(next);
                  }}
                  disabled={savingPhoto}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
            <Thermometer className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-[#0b1024]">
                  Сообщать руководству, если отклонение не исправили
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
                  Когда температура выходит за норму, сообщение сразу уходит{" "}
                  <span className="font-medium text-[#0b1024]">
                    ответственному за журнал
                  </span>{" "}
                  — тому, кто назначен в «Ответственные за журналы». Если он
                  не вернул температуру в норму и не написал в журнале, что
                  сделал, — через заданное время об этом узнают руководители.
                  Одно сообщение на отклонение, а не на каждое показание.
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    Выключите, если ответственный и есть руководитель — тогда
                    второе сообщение будет лишним шумом. Если ответственный не
                    назначен или у него не подключён Telegram, сообщение уходит
                    руководству сразу.
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {savingEscalation ? (
                  <Loader2 className="size-4 animate-spin text-[#9b9fb3]" />
                ) : null}
                <Switch
                  checked={escalate}
                  onCheckedChange={(next) => {
                    if (savingEscalation) return;
                    void handleEscalateToggle(next);
                  }}
                  disabled={savingEscalation}
                />
              </div>
            </div>

            {escalate ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
                <span className="text-[13px] text-[#3c4053]">
                  Ждём исправления
                </span>
                <select
                  value={escalationMinutes}
                  onChange={(e) =>
                    handleEscalationMinutesChange(Number(e.target.value))
                  }
                  disabled={savingEscalation}
                  className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] transition-colors hover:border-[#5566f6]/40 focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15 focus:outline-none"
                >
                  {ESCALATION_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatMinutes(minutes)}
                    </option>
                  ))}
                </select>
                <span className="text-[13px] text-[#6f7282]">
                  — потом пишем руководству
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Кто может записывать по QR-плакатам. Один режим на все QR-формы:
          журналы, холодильники, помещения. */}
      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <QrCode className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold text-[#0b1024]">Запись по QR-плакату</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-[#6f7282]">
              Сотрудник сканирует плакат журнала, холодильника или помещения и
              вносит запись с телефона. Выберите, как подтверждается, кто это
              сделал. Перепечатывать плакаты при смене режима не нужно.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Режим QR-форм">
              {QR_FILL_MODES.map((mode) => {
                const Icon = mode.icon;
                const active = qrFillMode === mode.value;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={savingQrMode}
                    onClick={() => void handleQrFillMode(mode.value)}
                    className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors duration-150 ${
                      active
                        ? "border-[#5566f6] bg-[#f5f6ff] ring-4 ring-[#5566f6]/15"
                        : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                    }`}
                  >
                    <span className={`flex size-9 items-center justify-center rounded-xl ${active ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]"}`}>
                      <Icon className="size-4" />
                    </span>
                    <span className="text-[14px] font-semibold text-[#0b1024]">{mode.label}</span>
                    <span className="text-[12.5px] leading-[1.5] text-[#6f7282]">{mode.hint}</span>
                  </button>
                );
              })}
            </div>
            {qrFillMode === "pin" ? (
              <p className="mt-3 text-[12.5px] leading-[1.5] text-[#a13a32]">
                PIN задаётся в карточке сотрудника («Сотрудники → карточка → PIN для быстрой QR-авторизации») или на странице общего планшета — код один и тот же. Сотрудник без PIN записать по QR не сможет. В публичном режиме PIN тоже спрашивается у тех, кому он задан.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
