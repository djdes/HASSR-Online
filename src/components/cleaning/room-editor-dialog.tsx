"use client";

import { FillerPicker } from "@/components/settings/filler-picker";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Shared dialog для редактирования полной cleaning-конфигурации помещения:
 * name, kind, detergent, currentScope, generalScope, currentDays,
 * generalDays. Используется и в /settings/buildings (stage 3) и в журнале
 * уборки (stage 4 — там пока inline в cleaning-document-client.tsx;
 * можно мигрировать позже).
 *
 * Cleaning unification 2026-05-08, см.
 * docs/superpowers/specs/2026-05-08-cleaning-unification.md
 *
 * Сохранение делает PATCH /api/settings/rooms/[id]; этот же endpoint
 * автоматически синкает JournalChecklistItem (stage 6 hook).
 */
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ScopeListEditor,
  WeekdayMaskPicker,
  MonthDaysPicker,
} from "@/components/cleaning/scope-and-schedule-editors";
import {
  parseScopeSteps,
  type ScopeStep,
} from "@/lib/cleaning-document";
import { MultiUserPicker } from "@/components/shared/multi-user-picker";
import type { RoomResponsibleUser } from "@/lib/room-responsible-candidates";
import { Switch } from "@/components/ui/switch";
import { QrFillPreview } from "@/components/qr/qr-fill-preview";
import { ChevronDown } from "lucide-react";
import { roomKindOptions } from "@/lib/room-kinds";
import type { Locale } from "@/i18n/locales";
import {
  DEFAULT_CLIMATE_HUMIDITY,
  DEFAULT_CLIMATE_TEMPERATURE,
  type ClimateRoomNorms,
} from "@/lib/climate-document";

export type RoomEditorInitial = {
  id: string;
  name: string;
  kind: string;
  detergent: string;
  /**
   * Принимает legacy string'и, новые ScopeStep-объекты или их смесь
   * (legacy-документ, в котором часть шагов уже мигрировала). Внутри
   * normalize'ится через parseScopeSteps.
   */
  currentScope: Array<string | ScopeStep>;
  generalScope: Array<string | ScopeStep>;
  currentDays: number;
  generalDays: number;
  // 2026-05-08+ rich schedule + photo
  currentScheduleType?: "weekly" | "monthly";
  generalScheduleType?: "weekly" | "monthly";
  currentMonthDays?: string[];
  generalMonthDays?: string[];
  requirePhoto?: boolean;
  // 2026-09-04: кто убирает / кто проверяет (Room.cleanerUserIds /
  // verifierUserIds). Порядок = приоритет.
  cleanerUserIds?: string[];
  verifierUserIds?: string[];
  /** «Кто заполняет» по QR помещения (2026-09-22). undefined — вызывающий
   * не загрузил поле: блок не показываем и на сервер не шлём. */
  fillerUserIds?: string[];
  // 2026-09-04: нормы климата (Room.climateNorms). null — помещение не
  // контролируется в журнале климата.
  climateNorms?: ClimateRoomNorms | null;
};

/**
 * Snapshot переданного на сервер patch'а — каллер использует его, чтобы
 * сразу пересчитать matrix/TF-задачи без ожидания router.refresh()
 * (который async и приходит на 1 render позже).
 */
export type RoomEditorSavedSnapshot = {
  id: string;
  name: string;
  detergent: string;
  currentScope: ScopeStep[];
  generalScope: ScopeStep[];
  currentDays: number;
  generalDays: number;
  currentScheduleType: "weekly" | "monthly";
  generalScheduleType: "weekly" | "monthly";
  currentMonthDays: string[];
  generalMonthDays: string[];
  requirePhoto: boolean;
  cleanerUserIds: string[];
  verifierUserIds: string[];
  climateNorms: ClimateRoomNorms | null;
  /**
   * Изменилось ли само расписание. Правка одного названия не должна
   * запускать пересчёт плана в матрице журнала уборки.
   */
  scheduleChanged: boolean;
};

/** Какую секцию раскрыть при открытии — журнал вызывает «свою». */
export type RoomEditorFocus = "cleaning" | "climate";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: RoomEditorInitial | null;
  onSaved?: (snapshot: RoomEditorSavedSnapshot) => void;
  /**
   * Секция, ради которой открыли карточку: "climate" — журнал климата
   * (раскрыты нормы, уборка свёрнута), "cleaning" / по умолчанию —
   * раскрыта уборка. Ответственные видны всегда.
   */
  focus?: RoomEditorFocus;
  /** Активные сотрудники организации — для «Кто убирает / Кто проверяет». */
  users: ReadonlyArray<RoomResponsibleUser>;
  /** userId → сколько ДРУГИХ помещений уже убирает / проверяет (подсказка). */
  roomsPerCleaner?: Map<string, number>;
  roomsPerVerifier?: Map<string, number>;
};

export function RoomEditorDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
  users,
  roomsPerCleaner,
  roomsPerVerifier,
  focus = "cleaning",
}: Props) {
  const t = useTranslations("cleaningUi.roomEditorDialog");
  const locale = useLocale() as Locale;
  // Виды — общий список (`room-kinds.ts`).
  const KIND_OPTIONS: Array<{ value: string; label: string }> = roomKindOptions(locale);
  /**
   * Примеры-чипы под списком шагов — состав как на эталоне
   * (cleaning-05-add-room-dialog.png). Клик добавляет предмет в список.
   */
  const CURRENT_SCOPE_EXAMPLES = [
    t("currentExample1"),
    t("currentExample2"),
    t("currentExample3"),
    t("currentExample4"),
    t("currentExample5"),
    t("currentExample6"),
    t("currentExample7"),
    t("currentExample8"),
  ];
  const GENERAL_SCOPE_EXAMPLES = [
    t("generalExample1"),
    t("generalExample2"),
    t("generalExample3"),
    t("generalExample4"),
    t("generalExample5"),
    t("generalExample6"),
  ];
  const describeMetric = (enabled: boolean, min: string, max: string, unit: string): string | null => {
    if (!enabled) return null;
    const a = min.trim();
    const b = max.trim();
    if (a && b) return t("rangeFromTo", { min: a, max: b, unit });
    if (a) return t("rangeFrom", { min: a, unit });
    if (b) return t("rangeTo", { max: b, unit });
    return t("rangeNone");
  };
  const describeClimate = (f: ClimateNormsForm): string => {
    const parts = [
      describeMetric(f.temperatureEnabled, f.temperatureMin, f.temperatureMax, "°C"),
      describeMetric(f.humidityEnabled, f.humidityMin, f.humidityMax, "%"),
    ];
    const temperature = parts[0] ? t("describeTemperature", { value: parts[0] }) : null;
    const humidity = parts[1] ? t("describeHumidity", { value: parts[1] }) : null;
    return [temperature, humidity].filter(Boolean).join(" · ") || t("normsNone");
  };
  const [name, setName] = useState(initial?.name ?? "");
  const [cleanerUserIds, setCleanerUserIds] = useState<string[]>(
    initial?.cleanerUserIds ?? [],
  );
  const [fillerUserIds, setFillerUserIds] = useState<string[]>(initial?.fillerUserIds ?? []);
  const [verifierUserIds, setVerifierUserIds] = useState<string[]>(
    initial?.verifierUserIds ?? [],
  );
  // Климат: null = не контролируется. В форме держим строки, чтобы
  // пустой ввод не превращался в 0.
  const [climateEnabled, setClimateEnabled] = useState<boolean>(
    Boolean(initial?.climateNorms),
  );
  const [climate, setClimate] = useState<ClimateNormsForm>(
    toClimateForm(initial?.climateNorms ?? null),
  );
  const [cleaningOpen, setCleaningOpen] = useState<boolean>(focus !== "climate");
  const [climateOpen, setClimateOpen] = useState<boolean>(
    focus === "climate" || Boolean(initial?.climateNorms),
  );
  const [kind, setKind] = useState(initial?.kind ?? "other");
  const [detergent, setDetergent] = useState(initial?.detergent ?? "");
  const [currentScope, setCurrentScope] = useState<ScopeStep[]>(
    parseScopeSteps(initial?.currentScope ?? []),
  );
  const [generalScope, setGeneralScope] = useState<ScopeStep[]>(
    parseScopeSteps(initial?.generalScope ?? []),
  );
  const [currentDays, setCurrentDays] = useState<number>(
    initial?.currentDays ?? 127,
  );
  const [generalDays, setGeneralDays] = useState<number>(
    initial?.generalDays ?? 0,
  );
  const [currentScheduleType, setCurrentScheduleType] = useState<
    "weekly" | "monthly"
  >(initial?.currentScheduleType ?? "weekly");
  const [generalScheduleType, setGeneralScheduleType] = useState<
    "weekly" | "monthly"
  >(initial?.generalScheduleType ?? "weekly");
  const [currentMonthDays, setCurrentMonthDays] = useState<string[]>(
    initial?.currentMonthDays ?? [],
  );
  const [generalMonthDays, setGeneralMonthDays] = useState<string[]>(
    initial?.generalMonthDays ?? [],
  );
  const [requirePhoto, setRequirePhoto] = useState<boolean>(
    initial?.requirePhoto ?? false,
  );
  const [saving, setSaving] = useState(false);

  // Reset form on initial change (when dialog re-opens for другое помещение)
  // Используем useEffect чтобы не тащить новый useId.
  useStateReset(initial?.id, () => {
    setName(initial?.name ?? "");
    setKind(initial?.kind ?? "other");
    setDetergent(initial?.detergent ?? "");
    setCurrentScope(parseScopeSteps(initial?.currentScope ?? []));
    setGeneralScope(parseScopeSteps(initial?.generalScope ?? []));
    setCurrentDays(initial?.currentDays ?? 127);
    setGeneralDays(initial?.generalDays ?? 0);
    setCurrentScheduleType(initial?.currentScheduleType ?? "weekly");
    setGeneralScheduleType(initial?.generalScheduleType ?? "weekly");
    setCurrentMonthDays(initial?.currentMonthDays ?? []);
    setGeneralMonthDays(initial?.generalMonthDays ?? []);
    setRequirePhoto(initial?.requirePhoto ?? false);
    setCleanerUserIds(initial?.cleanerUserIds ?? []);
    setVerifierUserIds(initial?.verifierUserIds ?? []);
    setFillerUserIds(initial?.fillerUserIds ?? []);
    setClimateEnabled(Boolean(initial?.climateNorms));
    setClimate(toClimateForm(initial?.climateNorms ?? null));
    setCleaningOpen(focus !== "climate");
    setClimateOpen(focus === "climate" || Boolean(initial?.climateNorms));
  });

  async function save() {
    if (!initial) return;
    if (!name.trim()) {
      toast.error(t("nameEmpty"));
      return;
    }
    const climateNorms = climateEnabled ? fromClimateForm(climate) : null;
    if (climateNorms && !climateNorms.temperature.enabled && !climateNorms.humidity.enabled) {
      toast.error(t("climateNeedOne"));
      return;
    }
    for (const metric of climateNorms ? [climateNorms.temperature, climateNorms.humidity] : []) {
      if (
        metric.enabled &&
        metric.min !== null &&
        metric.max !== null &&
        metric.min > metric.max
      ) {
        toast.error(t("minGreaterThanMax"));
        return;
      }
    }
    setSaving(true);
    try {
      const sanitizeSteps = (steps: ScopeStep[]): ScopeStep[] =>
        steps
          .map((s) => {
            const trimmed = s.label.trim();
            const out: ScopeStep = { label: trimmed };
            if (typeof s.requirePhoto === "boolean")
              out.requirePhoto = s.requirePhoto;
            return out;
          })
          .filter((s) => s.label.length > 0);
      const res = await fetch(`/api/settings/rooms/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          detergent: detergent.trim(),
          currentScope: sanitizeSteps(currentScope),
          generalScope: sanitizeSteps(generalScope),
          currentDays,
          generalDays,
          currentScheduleType,
          generalScheduleType,
          currentMonthDays,
          generalMonthDays,
          requirePhoto,
          cleanerUserIds,
          verifierUserIds,
          ...(initial.fillerUserIds !== undefined ? { fillerUserIds } : {}),
          climateNorms,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      toast.success(t("saved"));
      onOpenChange(false);
      const sameList = (a: string[], b: string[]) =>
        a.length === b.length && a.every((v, i) => v === b[i]);
      const scheduleChanged =
        currentDays !== (initial.currentDays ?? 127) ||
        generalDays !== (initial.generalDays ?? 0) ||
        currentScheduleType !== (initial.currentScheduleType ?? "weekly") ||
        generalScheduleType !== (initial.generalScheduleType ?? "weekly") ||
        !sameList(currentMonthDays, initial.currentMonthDays ?? []) ||
        !sameList(generalMonthDays, initial.generalMonthDays ?? []);
      onSaved?.({
        scheduleChanged,
        id: initial.id,
        name: name.trim(),
        detergent: detergent.trim(),
        currentScope: sanitizeSteps(currentScope),
        generalScope: sanitizeSteps(generalScope),
        currentDays,
        generalDays,
        currentScheduleType,
        generalScheduleType,
        currentMonthDays,
        generalMonthDays,
        requirePhoto,
        cleanerUserIds,
        verifierUserIds,
        climateNorms,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {t("title")}
          </DialogTitle>
        </DialogHeader>
        {initial ? (
          <>
            <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  {t("nameLabel")}
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px]"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{t("typeLabel")}</Label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                >
                  {KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Label className="text-[13px] font-semibold text-[#0b1024]">
                      {t("cleanersTitle")}
                    </Label>
                    <p className="mt-0.5 text-[12px] leading-[1.55] text-[#6f7282]">
                      {t("cleanersHint")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#eef1ff] px-2.5 py-1 text-[11px] font-medium text-[#3848c7] tabular-nums">
                    {t("peopleCount", { count: cleanerUserIds.length })}
                  </span>
                </div>
                <MultiUserPicker
                  role="cleaner"
                  value={cleanerUserIds}
                  onChange={setCleanerUserIds}
                  users={users}
                  roomsPerUser={roomsPerCleaner}
                  emptyHint={t("cleanersEmpty")}
                  disabled={saving}
                />
              </div>

              <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Label className="text-[13px] font-semibold text-[#0b1024]">
                      {t("verifiersTitle")}
                    </Label>
                    <p className="mt-0.5 text-[12px] leading-[1.55] text-[#6f7282]">
                      {t("verifiersHint")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#eef1ff] px-2.5 py-1 text-[11px] font-medium text-[#3848c7] tabular-nums">
                    {t("peopleCount", { count: verifierUserIds.length })}
                  </span>
                </div>
                <MultiUserPicker
                  role="verifier"
                  value={verifierUserIds}
                  onChange={setVerifierUserIds}
                  users={users}
                  roomsPerUser={roomsPerVerifier}
                  emptyHint={t("verifiersEmpty")}
                  primaryBadge={t("primaryBadge")}
                  disabled={saving}
                />
              </div>

              {initial?.fillerUserIds !== undefined ? (
                <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4">
                  <FillerPicker
                    value={fillerUserIds}
                    onChange={setFillerUserIds}
                    objectNoun={t("fillerNoun")}
                    options={users.map((user) => ({
                      id: user.id,
                      name: user.name,
                      position: user.jobPosition?.name ?? user.positionTitle ?? null,
                      management: isManagementRole(user.role),
                    }))}
                  />
                </div>
              ) : null}

              {/* Секция «Климат» — нормы температуры/влажности для журнала
                  климата. Единый справочник помещений, 2026-09-04. */}
              <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff]">
                <button
                  type="button"
                  onClick={() => setClimateOpen((v) => !v)}
                  aria-expanded={climateOpen}
                  className="flex w-full items-center justify-between gap-2 rounded-3xl px-4 py-3 text-left transition-colors hover:bg-[#f5f6ff]"
                >
                  <div>
                    <div className="text-[13px] font-semibold text-[#0b1024]">
                      {t("climateTitle")}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-[1.55] text-[#6f7282]">
                      {climateEnabled
                        ? describeClimate(climate)
                        : t("climateNotControlled")}
                    </p>
                  </div>
                  <ChevronDown
                    className={`size-4 shrink-0 text-[#6f7282] transition-transform ${climateOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {climateOpen ? (
                  <div className="space-y-4 border-t border-[#ececf4] px-4 pb-4 pt-3">
                    <label className="flex items-center gap-3 text-[13.5px] font-medium text-[#0b1024]">
                      <Switch
                        checked={climateEnabled}
                        onCheckedChange={(v) => {
                          setClimateEnabled(v);
                          if (v && !climate.temperatureEnabled && !climate.humidityEnabled) {
                            setClimate((c) => ({ ...c, temperatureEnabled: true }));
                          }
                        }}
                        className="data-[state=checked]:bg-[#5566f6] data-[state=unchecked]:bg-[#d6d9ee]"
                      />
                      {t("climateToggle")}
                    </label>
                    {climateEnabled ? (
                      <div className="space-y-3">
                        <ClimateMetricRow
                          label={t("temperatureLabel")}
                          unit="°C"
                          enabled={climate.temperatureEnabled}
                          min={climate.temperatureMin}
                          max={climate.temperatureMax}
                          onChange={(next) =>
                            setClimate((c) => ({
                              ...c,
                              temperatureEnabled: next.enabled,
                              temperatureMin: next.min,
                              temperatureMax: next.max,
                            }))
                          }
                        />
                        <ClimateMetricRow
                          label={t("humidityLabel")}
                          unit="%"
                          enabled={climate.humidityEnabled}
                          min={climate.humidityMin}
                          max={climate.humidityMax}
                          onChange={(next) =>
                            setClimate((c) => ({
                              ...c,
                              humidityEnabled: next.enabled,
                              humidityMin: next.min,
                              humidityMax: next.max,
                            }))
                          }
                        />
                        <p className="text-[11.5px] leading-[1.5] text-[#6f7282]">
                          {t("climateNormsNote")}
                        </p>
                      </div>
                    ) : null}
                    {/* QR для заполнения с телефона — только когда карточку
                        открыли из журнала климата: в журнале уборки он ни к чему. */}
                    {focus === "climate" ? (
                      <QrFillPreview
                        kind="room"
                        id={climateEnabled ? initial.id : null}
                        emptyHint={t("qrEmptyHint")}
                        className="bg-white"
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Секция «Уборка» — сворачивается, когда карточку открыли из
                  журнала климата. */}
              <button
                type="button"
                onClick={() => setCleaningOpen((v) => !v)}
                aria-expanded={cleaningOpen}
                className="flex w-full items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-white px-4 py-2.5 text-left transition-colors hover:bg-[#f5f6ff]"
              >
                <span className="text-[13px] font-semibold text-[#0b1024]">
                  {t("cleaningTitle")}
                </span>
                <ChevronDown
                  className={`size-4 shrink-0 text-[#6f7282] transition-transform ${cleaningOpen ? "rotate-180" : ""}`}
                />
              </button>

              <div className={cleaningOpen ? "space-y-5" : "hidden"}>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  {t("detergentLabel")}
                </Label>
                <Textarea
                  value={detergent}
                  onChange={(e) => setDetergent(e.target.value)}
                  placeholder={t("detergentPlaceholder")}
                  className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
                  rows={3}
                />
              </div>

              <label className="flex items-start gap-3 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4 cursor-pointer transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                <input
                  type="checkbox"
                  checked={requirePhoto}
                  onChange={(e) => setRequirePhoto(e.target.checked)}
                  className="mt-0.5 size-4 cursor-pointer accent-[#5566f6]"
                />
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-[#0b1024]">
                    {t("requirePhotoTitle")}
                  </div>
                  <p className="mt-0.5 text-[12px] leading-[1.55] text-[#6f7282]">
                    {t("requirePhotoHint")}
                  </p>
                </div>
              </label>

              <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Label className="text-[13px] font-semibold text-[#0b1024]">
                      {t("currentScopeTitle")}
                    </Label>
                    <p className="mt-0.5 text-[12px] leading-[1.55] text-[#6f7282]">
                      {t("currentScopeHint")}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#eef1ff] px-2.5 py-1 text-[11px] font-medium text-[#3848c7] tabular-nums">
                    {t("stepsCount", { count: currentScope.filter((s) => s.label.trim()).length })}
                  </span>
                </div>
                <ScopeListEditor
                  mode="with-photo"
                  value={currentScope}
                  onChange={setCurrentScope}
                  roomRequirePhoto={requirePhoto}
                  examples={CURRENT_SCOPE_EXAMPLES}
                  placeholder={t("currentScopePlaceholder")}
                  addLabel={t("addCurrentStep")}
                  emptyHint={t("currentStepsEmpty")}
                />
                <div className="space-y-2 border-t border-[#ececf4] pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[12px] font-medium text-[#3c4053]">
                      {t("whenLabel")}
                    </Label>
                    <div className="inline-flex rounded-xl border border-[#dcdfed] bg-white p-0.5">
                      <button
                        type="button"
                        onClick={() => setCurrentScheduleType("weekly")}
                        className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors ${
                          currentScheduleType === "weekly"
                            ? "bg-[#5566f6] text-white"
                            : "text-[#3c4053] hover:bg-[#f5f6ff]"
                        }`}
                      >
                        {t("weekly")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentScheduleType("monthly")}
                        className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors ${
                          currentScheduleType === "monthly"
                            ? "bg-[#5566f6] text-white"
                            : "text-[#3c4053] hover:bg-[#f5f6ff]"
                        }`}
                      >
                        {t("monthly")}
                      </button>
                    </div>
                  </div>
                  {currentScheduleType === "weekly" ? (
                    <>
                      <p className="text-[11px] leading-[1.45] text-[#6f7282]">
                        {t("currentWeeklyHint")}
                      </p>
                      <WeekdayMaskPicker
                        value={currentDays}
                        onChange={setCurrentDays}
                      />
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] leading-[1.45] text-[#6f7282]">
                        {t("currentMonthlyHint")}
                      </p>
                      <MonthDaysPicker
                        value={currentMonthDays}
                        onChange={setCurrentMonthDays}
                      />
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Label className="text-[13px] font-semibold text-[#0b1024]">
                      {t("generalScopeTitle")}
                    </Label>
                    <p className="mt-0.5 text-[12px] leading-[1.55] text-[#6f7282]">
                      {t("generalScopeHint")}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#eef1ff] px-2.5 py-1 text-[11px] font-medium text-[#3848c7] tabular-nums">
                    {t("stepsCount", { count: generalScope.filter((s) => s.label.trim()).length })}
                  </span>
                </div>
                <ScopeListEditor
                  mode="with-photo"
                  value={generalScope}
                  onChange={setGeneralScope}
                  roomRequirePhoto={requirePhoto}
                  examples={GENERAL_SCOPE_EXAMPLES}
                  placeholder={t("generalScopePlaceholder")}
                  addLabel={t("addGeneralStep")}
                  emptyHint={t("generalStepsEmpty")}
                />
                <div className="space-y-2 border-t border-[#ececf4] pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[12px] font-medium text-[#3c4053]">
                      {t("whenLabel")}
                    </Label>
                    <div className="inline-flex rounded-xl border border-[#dcdfed] bg-white p-0.5">
                      <button
                        type="button"
                        onClick={() => setGeneralScheduleType("weekly")}
                        className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors ${
                          generalScheduleType === "weekly"
                            ? "bg-[#5566f6] text-white"
                            : "text-[#3c4053] hover:bg-[#f5f6ff]"
                        }`}
                      >
                        {t("weekly")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setGeneralScheduleType("monthly")}
                        className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors ${
                          generalScheduleType === "monthly"
                            ? "bg-[#5566f6] text-white"
                            : "text-[#3c4053] hover:bg-[#f5f6ff]"
                        }`}
                      >
                        {t("monthly")}
                      </button>
                    </div>
                  </div>
                  {generalScheduleType === "weekly" ? (
                    <>
                      <p className="text-[11px] leading-[1.45] text-[#6f7282]">
                        {t("generalWeeklyHint")}
                      </p>
                      <WeekdayMaskPicker
                        value={generalDays}
                        onChange={setGeneralDays}
                      />
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] leading-[1.45] text-[#6f7282]">
                        {t("generalMonthlyHint")}
                      </p>
                      <MonthDaysPicker
                        value={generalMonthDays}
                        onChange={setGeneralMonthDays}
                      />
                    </>
                  )}
                </div>
              </div>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                className="h-11 w-full rounded-2xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                disabled={saving}
                className="h-11 w-full rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
                onClick={save}
              >
                {saving ? t("savingNow") : t("save")}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Tiny helper — re-init local state when key changes.
import { useEffect, useRef } from "react";
function useStateReset(key: string | undefined, reset: () => void) {
  const last = useRef(key);
  useEffect(() => {
    if (last.current !== key) {
      last.current = key;
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// ---------------------------------------------------------------- climate helpers

type ClimateNormsForm = {
  temperatureEnabled: boolean;
  temperatureMin: string;
  temperatureMax: string;
  humidityEnabled: boolean;
  humidityMin: string;
  humidityMax: string;
};

function numToStr(n: number | null): string {
  return n === null ? "" : String(n);
}

function strToNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function toClimateForm(norms: ClimateRoomNorms | null): ClimateNormsForm {
  const t = norms?.temperature ?? DEFAULT_CLIMATE_TEMPERATURE;
  const h = norms?.humidity ?? DEFAULT_CLIMATE_HUMIDITY;
  return {
    temperatureEnabled: t.enabled,
    temperatureMin: numToStr(t.min),
    temperatureMax: numToStr(t.max),
    humidityEnabled: h.enabled,
    humidityMin: numToStr(h.min),
    humidityMax: numToStr(h.max),
  };
}

function fromClimateForm(f: ClimateNormsForm): ClimateRoomNorms {
  return {
    temperature: {
      enabled: f.temperatureEnabled,
      min: strToNum(f.temperatureMin),
      max: strToNum(f.temperatureMax),
    },
    humidity: {
      enabled: f.humidityEnabled,
      min: strToNum(f.humidityMin),
      max: strToNum(f.humidityMax),
    },
  };
}

function ClimateMetricRow(props: {
  label: string;
  unit: string;
  enabled: boolean;
  min: string;
  max: string;
  onChange: (next: { enabled: boolean; min: string; max: string }) => void;
}) {
  const t = useTranslations("cleaningUi.roomEditorDialog");
  const { enabled, min, max } = props;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Switch
        checked={enabled}
        onCheckedChange={(v) => props.onChange({ enabled: v, min, max })}
        className="data-[state=checked]:bg-[#5566f6] data-[state=unchecked]:bg-[#d6d9ee]"
      />
      <span className="min-w-[150px] text-[13.5px] text-[#0b1024]">{props.label}</span>
      <Input
        type="number"
        value={min}
        disabled={!enabled}
        onChange={(e) => props.onChange({ enabled, min: e.target.value, max })}
        aria-label={t("minAria", { label: props.label })}
        className="h-9 w-[84px] rounded-xl border-[#dcdfed] px-3 text-[13.5px]"
      />
      <span className="text-[13px] text-[#6f7282]">{props.unit}</span>
      <span className="text-[13px] text-[#9b9fb3]">—</span>
      <Input
        type="number"
        value={max}
        disabled={!enabled}
        onChange={(e) => props.onChange({ enabled, min, max: e.target.value })}
        aria-label={t("maxAria", { label: props.label })}
        className="h-9 w-[84px] rounded-xl border-[#dcdfed] px-3 text-[13.5px]"
      />
      <span className="text-[13px] text-[#6f7282]">{props.unit}</span>
    </div>
  );
}
