"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftRight, CalendarClock, Check, ChevronDown, MapPin, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import type { StaffEmployee, StaffPointAssignment } from "@/components/staff/staff-types";
import { isOfficeBuilding, type BuildingOption } from "@/lib/building-scope";
import {
  ASSIGNMENT_MAX_DAYS,
  ASSIGNMENT_MIN_DAYS,
  ASSIGNMENT_QUICK_DAYS,
  addDaysToKey,
  isValidAssignmentDays,
  shortDateLabel,
  type PointAssignmentMode,
} from "@/lib/point-assignments";
import { cn } from "@/lib/utils";

/**
 * Временная работа на другой точке (2026-10-27): окно «Взять на замену» на
 * странице точки и блок «Временно на другую точку» в карточке сотрудника.
 * Срок и режим — общие поля; точки вернутся сами (`expirePointAssignments`).
 */

const DEFAULT_DAYS = 7;
/** Коды ошибок API (`PlanAssignmentError`), у которых есть свой текст. */
const KNOWN_ERRORS = ["everywhere", "office_user", "office_target", "overlap", "already_there", "bad_days"] as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "•";
}

function useErrorText() {
  const t = useTranslations("staffManagement.pointAssignment");
  return (data: { code?: string | null; error?: string } | null, fallback: string) => {
    const code = data?.code ?? null;
    if (code && (KNOWN_ERRORS as readonly string[]).includes(code)) return t(`errors.${code as (typeof KNOWN_ERRORS)[number]}`);
    return data?.error || fallback;
  };
}

async function createAssignment(userId: string, body: { buildingId: string; mode: PointAssignmentMode; days: number }) {
  const response = await fetch(`/api/staff/${encodeURIComponent(userId)}/point-assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { code?: string | null; error?: string; returnKey?: string } | null;
  return { ok: response.ok, data };
}

/** Режим и срок замены + строка «что произойдёт». */
function AssignmentTermFields(props: {
  mode: PointAssignmentMode;
  onMode: (mode: PointAssignmentMode) => void;
  days: number | null;
  onDays: (days: number | null) => void;
  /** Перевод недоступен (руководитель точки и чужой сотрудник) — причина. */
  transferDisabledReason?: string | null;
  explanation: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations("staffManagement.pointAssignment");
  const quick = ASSIGNMENT_QUICK_DAYS as readonly number[];
  const [custom, setCustom] = useState(() => props.days !== null && !quick.includes(props.days));
  const [customText, setCustomText] = useState(() => (props.days !== null && !quick.includes(props.days) ? String(props.days) : ""));
  const customInvalid = custom && customText.trim() !== "" && !isValidAssignmentDays(Number(customText));

  const modeCard = (mode: PointAssignmentMode, title: string, hint: string, disabledReason?: string | null) => {
    const active = props.mode === mode;
    const off = Boolean(disabledReason) || props.disabled;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        disabled={off}
        title={disabledReason ?? hint}
        onClick={() => props.onMode(mode)}
        data-assignment-mode={mode}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-55",
          active
            ? "border-[#5566f6] bg-[#f5f6ff]"
            : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
            active ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#c9cde0] bg-white",
          )}
          aria-hidden
        >
          {active ? <Check className="size-3" /> : null}
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium text-[#0b1024]">{title}</span>
          <span className="block text-[12px] leading-snug text-[#6f7282]">{disabledReason ?? hint}</span>
        </span>
      </button>
    );
  };

  const chipClass = (active: boolean) =>
    cn(
      "inline-flex h-9 items-center rounded-lg border px-3 text-[13px] font-medium tabular-nums transition-colors duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-55",
      active
        ? "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
        : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]",
    );

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">{t("modeLabel")}</div>
        <div role="radiogroup" aria-label={t("modeLabel")} className="flex flex-col gap-2 sm:flex-row">
          {modeCard("transfer", t("modeTransfer"), t("modeTransferHint"), props.transferDisabledReason)}
          {modeCard("extra", t("modeExtra"), t("modeExtraHint"))}
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">{t("daysLabel")}</div>
        <div className="flex flex-wrap items-center gap-1">
          {quick.map((value) => (
            <button
              key={value}
              type="button"
              disabled={props.disabled}
              aria-pressed={!custom && props.days === value}
              onClick={() => {
                setCustom(false);
                props.onDays(value);
              }}
              className={chipClass(!custom && props.days === value)}
              data-assignment-days={value}
            >
              {t("days", { count: value })}
            </button>
          ))}
          <button
            type="button"
            disabled={props.disabled}
            aria-pressed={custom}
            onClick={() => {
              setCustom(true);
              const parsed = Number(customText);
              props.onDays(isValidAssignmentDays(parsed) ? parsed : null);
            }}
            className={chipClass(custom)}
          >
            {t("customDays")}
          </button>
          {custom ? (
            <Input
              type="number"
              inputMode="numeric"
              min={ASSIGNMENT_MIN_DAYS}
              max={ASSIGNMENT_MAX_DAYS}
              autoFocus
              value={customText}
              disabled={props.disabled}
              aria-label={t("customDaysAria")}
              aria-invalid={customInvalid || undefined}
              placeholder={t("customDaysPlaceholder")}
              onChange={(event) => {
                setCustomText(event.target.value);
                const parsed = Number(event.target.value);
                props.onDays(isValidAssignmentDays(parsed) ? parsed : null);
              }}
              className="h-9 w-24 rounded-lg border-[#dcdfed] text-[13px] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 aria-[invalid=true]:border-[#e6a19a]"
              data-assignment-custom-days
            />
          ) : null}
        </div>
        {customInvalid ? <p className="text-[11.5px] text-[#a13a32]">{t("daysInvalid")}</p> : null}
      </div>
      {props.explanation ? (
        <p
          className="flex items-start gap-2 rounded-2xl bg-[#f5f6ff] px-3.5 py-2.5 text-[13px] leading-snug text-[#3848c7]"
          data-assignment-explanation
        >
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{props.explanation}</span>
        </p>
      ) : null}
    </div>
  );
}

function useExplanation(todayKey: string) {
  const t = useTranslations("staffManagement.pointAssignment");
  return (args: { mode: PointAssignmentMode; days: number | null; pointName: string; homeNames: string[] }) => {
    if (args.days === null) return null;
    const date = shortDateLabel(addDaysToKey(todayKey, args.days));
    if (args.mode === "transfer" && args.homeNames.length > 0) {
      return t("returnLineTransfer", { home: args.homeNames.join(", "), point: args.pointName, date });
    }
    return t("returnLineExtra", { point: args.pointName, date });
  };
}

// ---------------------------------------------------------------- точка

export type SubstituteCandidate = {
  id: string;
  name: string;
  position: string | null;
  /** Точки, где человек работает сейчас (без этой). */
  pointNames: string[];
  /** Уже на замене — день возврата `YYYY-MM-DD`, выбрать нельзя. */
  busyUntilKey: string | null;
  /** Можно перевести (снять с его точки); руководитель точки чужих не переводит. */
  canTransfer: boolean;
};

const SEVERAL = "__several__";

/**
 * Страница точки: «Взять на замену» — сотрудник с другой точки на N дней.
 * Типичный путь — три действия: кнопка → человек → «Взять на замену»
 * (режим «Перевести сюда» и 7 дней стоят по умолчанию).
 */
export function TakeSubstituteButton(props: {
  point: { id: string; name: string };
  candidates: SubstituteCandidate[];
  todayKey: string;
}) {
  const t = useTranslations("staffManagement.pointAssignment");
  const router = useRouter();
  const errorText = useErrorText();
  const explain = useExplanation(props.todayKey);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<PointAssignmentMode>("transfer");
  const [days, setDays] = useState<number | null>(DEFAULT_DAYS);
  const [pending, setPending] = useState(false);

  const selected = props.candidates.find((candidate) => candidate.id === userId) ?? null;
  const effectiveMode: PointAssignmentMode = selected && !selected.canTransfer ? "extra" : mode;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (candidate: SubstituteCandidate) =>
      !q ||
      candidate.name.toLowerCase().includes(q) ||
      (candidate.position ?? "").toLowerCase().includes(q) ||
      candidate.pointNames.some((name) => name.toLowerCase().includes(q));
    const byKey = new Map<string, SubstituteCandidate[]>();
    for (const candidate of props.candidates.filter(matches)) {
      const key = candidate.pointNames.length === 1 ? candidate.pointNames[0] : SEVERAL;
      byKey.set(key, [...(byKey.get(key) ?? []), candidate]);
    }
    return [...byKey.entries()].sort(([a], [b]) => (a === SEVERAL ? 1 : b === SEVERAL ? -1 : a.localeCompare(b, "ru")));
  }, [props.candidates, query]);

  function reset() {
    setQuery("");
    setUserId(null);
    setMode("transfer");
    setDays(DEFAULT_DAYS);
  }

  async function submit() {
    if (!selected || days === null) return;
    setPending(true);
    try {
      const { ok, data } = await createAssignment(selected.id, { buildingId: props.point.id, mode: effectiveMode, days });
      if (!ok) {
        toast.error(errorText(data, t("failed")));
        return;
      }
      toast.success(t("created", { name: selected.name, date: shortDateLabel(data?.returnKey ?? addDaysToKey(props.todayKey, days)) }));
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("takeHint")}
        data-point-take-substitute
        className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        <ArrowLeftRight className="size-4 text-[#5566f6]" />
        {t("takeButton")}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="flex max-h-[88vh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 supports-[height:100dvh]:max-h-[88dvh] sm:max-w-[520px]">
          <DialogHeader className="shrink-0 border-b px-4 py-5 pr-14 sm:pl-6">
            <DialogTitle className="text-[18px] font-semibold text-[#0b1024]">
              {t("dialogTitle", { point: props.point.name })}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-snug text-[#6f7282]">{t("dialogIntro")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">{t("personLabel")}</div>
              {props.candidates.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#dcdfed] px-4 py-4 text-[13px] leading-snug text-[#6f7282]">
                  {t("noCandidates")}
                </p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-[#ececf4]">
                  <div className="relative border-b border-[#ececf4] bg-white">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("searchPlaceholder")}
                      aria-label={t("searchPlaceholder")}
                      className="h-11 w-full bg-transparent pl-10 pr-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none"
                    />
                  </div>
                  <div className="max-h-[260px] overflow-y-auto" role="listbox" aria-label={t("personLabel")}>
                    {groups.length === 0 ? (
                      <p className="px-4 py-4 text-center text-[13px] text-[#9b9fb3]">{t("noMatches")}</p>
                    ) : (
                      groups.map(([key, items]) => (
                        <div key={key}>
                          <div className="sticky top-0 z-[1] flex items-center gap-1.5 bg-[#fafbff] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                            <MapPin className="size-3" aria-hidden />
                            {key === SEVERAL ? t("groupSeveral") : t("groupAt", { point: key })}
                          </div>
                          {items.map((candidate) => {
                            const active = candidate.id === userId;
                            const busy = candidate.busyUntilKey !== null;
                            return (
                              <button
                                key={candidate.id}
                                type="button"
                                role="option"
                                aria-selected={active}
                                disabled={busy}
                                onClick={() => setUserId(candidate.id)}
                                data-substitute-candidate={candidate.id}
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55",
                                  active ? "bg-[#eef1ff]" : "hover:bg-[#f5f6ff]",
                                )}
                              >
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[12.5px] font-semibold text-[#3848c7]">
                                  {initialsOf(candidate.name)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[14px] font-medium text-[#0b1024]">{candidate.name}</span>
                                  <span className="block truncate text-[12px] text-[#6f7282]">
                                    {busy
                                      ? t("busy", { date: shortDateLabel(candidate.busyUntilKey!) })
                                      : [candidate.position, candidate.pointNames.join(", ")].filter(Boolean).join(" · ")}
                                  </span>
                                </span>
                                {active ? <Check className="size-4 shrink-0 text-[#5566f6]" aria-hidden /> : null}
                              </button>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <AssignmentTermFields
              mode={effectiveMode}
              onMode={setMode}
              days={days}
              onDays={setDays}
              disabled={pending}
              transferDisabledReason={selected && !selected.canTransfer ? t("transferForeign") : null}
              explanation={
                selected
                  ? explain({ mode: effectiveMode, days, pointName: props.point.name, homeNames: selected.pointNames })
                  : t("pickFirst")
              }
            />
          </div>
          <DialogFooter className="shrink-0 flex-wrap justify-end gap-2 border-t bg-white px-4 py-4 sm:flex-row sm:px-6">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={pending || !selected || days === null}
              data-substitute-submit
              className="h-11 min-w-[150px] rounded-xl bg-[#5566f6] text-[14px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0] disabled:opacity-60"
            >
              {pending ? "…" : t("submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- карточка

/** «Завершить сейчас» с подтверждением. */
export function EndAssignmentButton(props: {
  employee: { id: string; name: string };
  assignment: StaffPointAssignment;
  onEnded: () => void;
}) {
  const t = useTranslations("staffManagement.pointAssignment");
  const [open, setOpen] = useState(false);
  const date = shortDateLabel(props.assignment.returnKey);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("endHint")}
        data-assignment-end
        className="inline-flex h-8 shrink-0 items-center rounded-lg border border-[#dcdfed] bg-white px-2.5 text-[12px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
      >
        {t("endNow")}
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        variant="warn"
        title={t("endTitle")}
        description={t("endDescription", { name: props.employee.name, date })}
        bullets={[
          {
            label:
              props.assignment.mode === "transfer" && props.assignment.returnBuildingNames.length > 0
                ? t("endBulletTransfer", { point: props.assignment.buildingName, home: props.assignment.returnBuildingNames.join(", ") })
                : t("endBulletExtra", { point: props.assignment.buildingName }),
          },
          { label: t("endBulletRows"), tone: "info" },
        ]}
        confirmLabel={t("endConfirm")}
        onConfirm={async () => {
          const response = await fetch(
            `/api/staff/${encodeURIComponent(props.employee.id)}/point-assignments/${encodeURIComponent(props.assignment.id)}`,
            { method: "DELETE" },
          ).catch(() => null);
          if (!response?.ok) {
            const data = (await response?.json().catch(() => null)) as { error?: string } | null;
            toast.error(data?.error || t("endFailed"));
            return;
          }
          setOpen(false);
          toast.success(t("ended"));
          props.onEnded();
        }}
      />
    </>
  );
}

/**
 * Карточка сотрудника: «Временно на другую точку». Отдельное действие (как
 * PIN), не через общий «Сохранить»: назначение сразу меняет точки.
 */
export function PointAssignmentSection(props: {
  employee: StaffEmployee;
  buildings: BuildingOption[];
  todayKey: string;
  /** В «Где работает» есть несохранённые изменения. */
  pointsDirty: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("staffManagement.pointAssignment");
  const errorText = useErrorText();
  const explain = useExplanation(props.todayKey);
  const { employee, buildings } = props;
  const active = employee.pointAssignment ?? null;
  const [expanded, setExpanded] = useState(false);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [mode, setMode] = useState<PointAssignmentMode>("transfer");
  const [days, setDays] = useState<number | null>(DEFAULT_DAYS);
  const [pending, setPending] = useState(false);

  const points = buildings.filter((building) => !isOfficeBuilding(building));
  if (points.length < 2) return null;

  const own = employee.buildingIds ?? [];
  const known = own.filter((id) => buildings.some((building) => building.id === id));
  const inOffice = known.some((id) => isOfficeBuilding(buildings.find((building) => building.id === id)));
  const options = points.filter((building) => !own.includes(building.id));
  const homeNames = points.filter((building) => own.includes(building.id)).map((building) => building.name);
  const target = options.find((building) => building.id === buildingId) ?? null;

  let blocked: string | null = null;
  if (known.length === 0) blocked = t("errors.everywhere");
  else if (inOffice) blocked = t("errors.office_user");
  else if (options.length === 0) blocked = t("noPoints");
  else if (props.pointsDirty) blocked = t("unsavedPoints");

  async function submit() {
    if (!target || days === null) return;
    setPending(true);
    try {
      const { ok, data } = await createAssignment(employee.id, { buildingId: target.id, mode, days });
      if (!ok) {
        toast.error(errorText(data, t("failed")));
        return;
      }
      toast.success(t("created", { name: employee.name, date: shortDateLabel(data?.returnKey ?? addDaysToKey(props.todayKey, days)) }));
      props.onChanged();
    } catch {
      toast.error(t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[#ececf4] bg-[#fafbff]" data-point-assignment-section>
      {active ? (
        <div className="space-y-2 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">{t("sectionTitle")}</div>
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-[13.5px] leading-snug text-[#0b1024]" data-assignment-active>
              {active.mode === "transfer" && active.returnBuildingNames.length > 0
                ? t("activeTransfer", {
                    point: active.buildingName,
                    date: shortDateLabel(active.returnKey),
                    home: active.returnBuildingNames.join(", "),
                  })
                : t("activeExtra", { point: active.buildingName, date: shortDateLabel(active.returnKey) })}
            </p>
            <EndAssignmentButton employee={employee} assignment={active} onEnded={props.onChanged} />
          </div>
          <p className="text-[11.5px] leading-snug text-[#6f7282]">{t("editHint")}</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors duration-150 hover:bg-[#f5f6ff]"
            data-point-assignment-toggle
          >
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[14px] font-medium text-[#0b1024]">
                <ArrowLeftRight className="size-4 text-[#5566f6]" aria-hidden />
                {t("sectionTitle")}
              </span>
              <span className="block text-[12px] leading-snug text-[#6f7282]">{t("sectionHint")}</span>
            </span>
            <ChevronDown className={cn("size-4 shrink-0 text-[#9b9fb3] transition-transform duration-200", expanded && "rotate-180")} />
          </button>
          {expanded ? (
            <div className="space-y-3 border-t border-[#ececf4] px-4 py-3">
              {blocked ? (
                <p className="text-[13px] leading-snug text-[#6f7282]" data-assignment-blocked>
                  {blocked}
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">{t("pointLabel")}</div>
                    <div role="radiogroup" aria-label={t("pointLabel")} className="flex flex-wrap gap-1">
                      {options.map((building) => {
                        const on = building.id === buildingId;
                        return (
                          <button
                            key={building.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={pending}
                            onClick={() => setBuildingId(building.id)}
                            title={building.address ? `${building.name}, ${building.address}` : building.name}
                            data-assignment-point={building.id}
                            className={cn(
                              "inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                              on
                                ? "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
                                : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]",
                            )}
                          >
                            <MapPin className="size-3.5 shrink-0" />
                            <span className="truncate">{building.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <AssignmentTermFields
                    mode={mode}
                    onMode={setMode}
                    days={days}
                    onDays={setDays}
                    disabled={pending}
                    explanation={
                      target ? explain({ mode, days, pointName: target.name, homeNames }) : t("pickPointFirst")
                    }
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={() => void submit()}
                      disabled={pending || !target || days === null}
                      data-assignment-submit
                      className="h-10 rounded-xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0] disabled:opacity-60"
                    >
                      {pending ? "…" : target ? t("assignTo", { point: target.name }) : t("assign")}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Подпись ярлыка и подсказка к нему — одинаково в списках. */
export function useSubstituteBadgeText() {
  const t = useTranslations("staffManagement.pointAssignment");
  return (assignment: StaffPointAssignment) => ({
    label: t("badge", { date: shortDateLabel(assignment.returnKey) }),
    title:
      assignment.mode === "transfer" && assignment.returnBuildingNames.length > 0
        ? t("activeTransfer", {
            point: assignment.buildingName,
            date: shortDateLabel(assignment.returnKey),
            home: assignment.returnBuildingNames.join(", "),
          })
        : t("activeExtra", { point: assignment.buildingName, date: shortDateLabel(assignment.returnKey) }),
  });
}
