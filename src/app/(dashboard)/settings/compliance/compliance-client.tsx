"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
import type { ReadingPhotoSettings } from "@/lib/reading-photo-fixation";

/** Варианты ожидания перед эскалацией — в минутах. */
const ESCALATION_OPTIONS = [30, 60, 120, 240] as const;

type Props = {
  initialRequireAdminForJournalEdit: boolean;
  initialShiftEndHour: number;
  initialLockPastDayEdits: boolean;
  initialRequirePhotoOnTaskFillStep: boolean;
  initialEscalateDeviations: boolean;
  initialEscalationMinutes: number;
  initialQrFillMode: QrFillModeValue;
  initialHealthQrRequired: boolean;
  /** «Фотофиксация показаний» QR-форм холодильника и склада. */
  initialReadingPhoto: ReadingPhotoSettings;
  /** Платный тариф: цифры со снимка вписываются сами (иначе — только фото). */
  readingPhotoAutofill: boolean;
};

type QrFillModeValue = "public" | "pin" | "auth";

export function ComplianceClient({
  initialRequireAdminForJournalEdit,
  initialShiftEndHour,
  initialLockPastDayEdits,
  initialRequirePhotoOnTaskFillStep,
  initialEscalateDeviations,
  initialEscalationMinutes,
  initialQrFillMode,
  initialHealthQrRequired,
  initialReadingPhoto,
  readingPhotoAutofill,
}: Props) {
  const t = useTranslations("settingsUi.complianceClient");
  const formatMinutes = (minutes: number): string =>
    minutes < 60
      ? t("durationMinutes", { count: minutes })
      : t("durationHours", { count: minutes / 60 });
  /** Режимы QR-форм: чем правее, тем достовернее подпись и тем больше шагов. */
  const qrFillModes: Array<{
    value: QrFillModeValue;
    label: string;
    hint: string;
    icon: typeof Users;
  }> = [
    { value: "public", label: t("qrModePublicLabel"), hint: t("qrModePublicHint"), icon: Users },
    { value: "pin", label: t("qrModePinLabel"), hint: t("qrModePinHint"), icon: KeyRound },
    { value: "auth", label: t("qrModeAuthLabel"), hint: t("qrModeAuthHint"), icon: UserRound },
  ];
  const [qrFillMode, setQrFillMode] = useState<QrFillModeValue>(initialQrFillMode);
  const [readingPhoto, setReadingPhoto] = useState<ReadingPhotoSettings>(initialReadingPhoto);
  const [savingReadingPhoto, setSavingReadingPhoto] = useState(false);

  // «Фотофиксация показаний» (2026-09-27): выключили — «обязательно» снимается
  // тоже, включили «обязательно» — фотофиксация включается (так же на сервере).
  async function handleReadingPhoto(patch: { readingPhotoEnabled?: boolean; readingPhotoRequired?: boolean }) {
    if (savingReadingPhoto) return;
    const previous = readingPhoto;
    const enabled = patch.readingPhotoRequired === true ? true : patch.readingPhotoEnabled ?? previous.enabled;
    const required = enabled ? patch.readingPhotoRequired ?? previous.required : false;
    setReadingPhoto({ enabled, required });
    setSavingReadingPhoto(true);
    try {
      const response = await fetch("/api/settings/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? t("saveFailed"));
      const saved: ReadingPhotoSettings | null =
        data?.readingPhoto && typeof data.readingPhoto.enabled === "boolean"
          ? { enabled: data.readingPhoto.enabled, required: data.readingPhoto.required === true }
          : null;
      if (saved) setReadingPhoto(saved);
      const now = saved ?? { enabled, required };
      toast.success(
        !now.enabled
          ? t("readingPhotoOff")
          : now.required
            ? t("readingPhotoRequiredOn")
            : t("readingPhotoOn")
      );
    } catch (error) {
      setReadingPhoto(previous);
      toast.error(error instanceof Error ? error.message : t("saveError"));
    } finally {
      setSavingReadingPhoto(false);
    }
  }
  const [healthQr, setHealthQr] = useState(initialHealthQrRequired);
  const [savingHealthQr, setSavingHealthQr] = useState(false);

  async function handleHealthQr(next: boolean) {
    if (savingHealthQr) return;
    setHealthQr(next);
    setSavingHealthQr(true);
    try {
      const response = await fetch("/api/settings/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ healthQrRequired: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? t("saveFailed"));
      toast.success(
        next
          ? t("healthQrOn")
          : t("healthQrOff")
      );
    } catch (error) {
      setHealthQr(!next);
      toast.error(error instanceof Error ? error.message : t("saveError"));
    } finally {
      setSavingHealthQr(false);
    }
  }
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
      if (!response.ok) throw new Error(data?.error ?? t("saveFailed"));
      toast.success(
        next === "auth"
          ? t("qrAuthSaved")
          : next === "pin"
            ? t("qrPinSaved")
            : t("qrPublicSaved")
      );
    } catch (error) {
      setQrFillMode(previous);
      toast.error(error instanceof Error ? error.message : t("saveError"));
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
        throw new Error(data?.error ?? t("saveFailed"));
      }
      toast.success(
        next
          ? t("editOnlyOn")
          : t("editOnlyOff")
      );
    } catch (error) {
      setValue(previous);
      toast.error(
        error instanceof Error ? error.message : t("saveError")
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
        throw new Error(data?.error ?? t("saveFailed"));
      }
      toast.success(
        next
          ? t("lockOn")
          : t("lockOff")
      );
    } catch (error) {
      setLockPastDay(previous);
      toast.error(error instanceof Error ? error.message : t("error"));
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
        throw new Error(data?.error ?? t("saveFailed"));
      }
      toast.success(
        next
          ? t("photoOn")
          : t("photoOff")
      );
    } catch (error) {
      setRequirePhoto(previous);
      toast.error(error instanceof Error ? error.message : t("error"));
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
        throw new Error(data?.error ?? t("saveFailed"));
      }
      toast.success(
        next
          ? t("escalateOn")
          : t("escalateOff")
      );
    } catch (error) {
      setEscalate(previous);
      toast.error(error instanceof Error ? error.message : t("error"));
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
        throw new Error(data?.error ?? t("saveFailed"));
      }
      toast.success(t("waitSaved", { duration: formatMinutes(next) }));
    } catch (error) {
      setEscalationMinutes(previous);
      toast.error(error instanceof Error ? error.message : t("error"));
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
        throw new Error(data?.error ?? t("saveFailed"));
      }
      toast.success(
        t("shiftEndSaved", { time: `${String(next).padStart(2, "0")}:00 UTC` })
      );
    } catch (error) {
      setShiftEndHour(previous);
      toast.error(error instanceof Error ? error.message : t("error"));
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
                  {t("editOnlyTitle")}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
                  {t("editOnlyBody")}
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    {t("editOnlyNote")}
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
          {t.rich("historyNote", {
            b: (chunks) => <span className="font-medium text-[#0b1024]">{chunks}</span>,
          })}
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
                  {t("shiftTitle")}
                </div>
                <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-[#6f7282]">
                  {t("shiftBody")}
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    {t.rich("shiftNote", {
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
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
                  {t("lockTitle")}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
                  {t.rich("lockBody", {
                    code: (chunks) => <span className="font-mono text-[12px]">{chunks}</span>,
                  })}
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    {t("lockNote")}
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
                  {t("photoTitle")}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
                  {t("photoBody")}
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    {t("photoNote")}
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
                  {t("escalateTitle")}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
                  {t.rich("escalateBody", {
                    b: (chunks) => <span className="font-medium text-[#0b1024]">{chunks}</span>,
                  })}
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    {t("escalateNote")}
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
                  {t("waitFor")}
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
                  {t("waitThen")}
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
            <div className="text-[16px] font-semibold text-[#0b1024]">{t("qrTitle")}</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-[#6f7282]">
              {t("qrDescription")}
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("qrModesLabel")}>
              {qrFillModes.map((mode) => {
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
            <label className="mt-4 flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 transition-colors duration-150 hover:bg-[#f5f6ff]">
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-[#0b1024]">{t("healthQrTitle")}</span>
                <span className="mt-1 block text-[12.5px] leading-[1.5] text-[#6f7282]">
                  {t("healthQrBody")}
                </span>
              </span>
              <Switch
                checked={healthQr}
                disabled={savingHealthQr}
                onCheckedChange={(value) => void handleHealthQr(value)}
                aria-label={t("healthQrAria")}
                data-testid="health-qr-required"
              />
            </label>
            {/* Фотофиксация показаний: «Сфотографируйте показание» на наклейке
                холодильника и плакате склада; вложенно — «Фото обязательно». */}
            <div className="mt-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-testid="reading-photo-settings">
              <label className="flex cursor-pointer items-start justify-between gap-4">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[14px] font-semibold text-[#0b1024]">
                    <Camera className="size-4 shrink-0 text-[#3848c7]" />
                    {t("readingPhotoTitle")}
                  </span>
                  <span className="mt-1 block text-[13px] leading-[1.5] text-[#6f7282]">
                    {t("readingPhotoBody", {
                      autofill: readingPhotoAutofill
                        ? t("readingPhotoAutofillOn")
                        : t("readingPhotoAutofillOff"),
                    })}
                  </span>
                </span>
                <Switch
                  checked={readingPhoto.enabled}
                  disabled={savingReadingPhoto}
                  onCheckedChange={(value) => void handleReadingPhoto({ readingPhotoEnabled: value })}
                  aria-label={t("readingPhotoTitle")}
                  data-testid="reading-photo-enabled"
                />
              </label>
              {readingPhoto.enabled ? (
                <label className="mt-4 flex cursor-pointer items-start justify-between gap-4 border-t border-[#ececf4] pt-4">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-[#0b1024]">{t("readingPhotoRequiredTitle")}</span>
                    <span className="mt-1 block text-[13px] leading-[1.5] text-[#6f7282]">
                      {t("readingPhotoRequiredBody")}
                    </span>
                  </span>
                  <Switch
                    checked={readingPhoto.required}
                    disabled={savingReadingPhoto}
                    onCheckedChange={(value) => void handleReadingPhoto({ readingPhotoRequired: value })}
                    aria-label={t("readingPhotoRequiredTitle")}
                    data-testid="reading-photo-required"
                  />
                </label>
              ) : null}
            </div>
            {qrFillMode === "pin" ? (
              <p className="mt-3 text-[12.5px] leading-[1.5] text-[#a13a32]">
                {t("pinNote")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
