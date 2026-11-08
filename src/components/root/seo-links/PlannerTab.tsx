"use client";

import { useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Pause,
  Play,
  Plus,
  Repeat,
  Rocket,
  Save,
  ShieldCheck,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import type { GglSchedulableFormat } from "@/lib/seo/gogetlinks-planner";
import {
  badgeToneClass,
  formatAnchorKindLabel,
  formatPlacementFormatLabel,
  formatRub,
  formatSlotStatusBadge,
  generateClientIdempotencyKey,
} from "@/lib/seo/gogetlinks-ui-format";
import { ArticleDrawer } from "./ArticleDrawer";
import {
  formatRuShortDate,
  type GglCampaignDto,
  type GglPlannedSlotDto,
  type GglSchedulePlanDto,
  parseSlotAlternatives,
  parseSlotDonorMetrics,
  parseTopvisorSnapshot,
  SEO_BTN_OUTLINE_CLASS,
  SEO_BTN_PRIMARY_CLASS,
  SEO_BTN_SM_CLASS,
  SEO_CARD_CLASS,
  SEO_INPUT_CLASS,
  type SeoLinksViewerCapabilities,
  shortWesetupPath,
} from "./types";

export interface PlannerTabProps {
  campaigns: GglCampaignDto[];
  defaultGglCampaignId?: number | null;
  accountConnected?: boolean;
  plans: GglSchedulePlanDto[];
  slots: GglPlannedSlotDto[];
  viewer: SeoLinksViewerCapabilities;
  onRefresh: () => Promise<void> | void;
}

const WEEKDAYS: Array<{ day: number; short: string }> = [
  { day: 1, short: "Пн" },
  { day: 2, short: "Вт" },
  { day: 3, short: "Ср" },
  { day: 4, short: "Чт" },
  { day: 5, short: "Пт" },
  { day: 6, short: "Сб" },
  { day: 7, short: "Вс" },
];

type SlotFilterKey = "all" | "pending_approval" | "upcoming" | "ordered" | "other";

function normalizePlanDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [2, 5];
  const nums = raw
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return nums.length > 0 ? [...new Set(nums)].sort((a, b) => a - b) : [2, 5];
}

function normalizePlanFormats(raw: unknown): GglSchedulableFormat[] {
  if (!Array.isArray(raw)) return ["article", "note"];
  const list = raw.filter(
    (x): x is GglSchedulableFormat => x === "article" || x === "note",
  );
  return list.length > 0 ? [...new Set(list)] : ["article", "note"];
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface PlanEditorProps {
  initialPlan: GglSchedulePlanDto | null;
  wesetupCampaigns: GglCampaignDto[];
  canManagePlans: boolean;
  canEnsureCampaign: boolean;
  onSaved: () => Promise<void> | void;
}

function PlanEditorForm({
  initialPlan,
  wesetupCampaigns,
  canManagePlans,
  canEnsureCampaign,
  onSaved,
}: PlanEditorProps) {
  const defaultCampaignId =
    initialPlan?.campaignId ?? wesetupCampaigns[0]?.id ?? "";

  const [name, setName] = useState(
    initialPlan?.name ?? "Регулярное ссылочное продвижение wesetup.ru",
  );
  const [campaignId, setCampaignId] = useState(defaultCampaignId);
  const [ensuringCampaign, setEnsuringCampaign] = useState(false);
  const effectiveCampaignId = campaignId || defaultCampaignId;
  const [kind, setKind] = useState<"one_time" | "monthly">(
    initialPlan?.kind === "one_time" ? "one_time" : "monthly",
  );
  const [budgetRub, setBudgetRub] = useState(
    String(initialPlan?.budgetRub ?? 5000),
  );
  const [maxPricePerLinkRub, setMaxPricePerLinkRub] = useState(
    String(initialPlan?.maxPricePerLinkRub ?? 1200),
  );
  const [startsAt, setStartsAt] = useState(
    initialPlan?.startsAt ? initialPlan.startsAt.slice(0, 10) : todayIsoDate(),
  );
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    normalizePlanDays(initialPlan?.scheduleDaysOfWeek),
  );
  const [minTfCf, setMinTfCf] = useState(String(initialPlan?.minTfCf ?? 10));
  const [minTrust, setMinTrust] = useState(String(initialPlan?.minTrust ?? 4));
  const [minDailyTraffic, setMinDailyTraffic] = useState(
    String(initialPlan?.minDailyTraffic ?? 150),
  );
  const [allowedFormats, setAllowedFormats] = useState<GglSchedulableFormat[]>(
    normalizePlanFormats(initialPlan?.allowedFormats),
  );
  const [anchorMixBrandPct, setAnchorMixBrandPct] = useState(
    String(initialPlan?.anchorMixBrandPct ?? 60),
  );
  const [isActive, setIsActive] = useState(initialPlan?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  function applyPreset(preset: "wave_10k" | "monthly_5k") {
    if (!canManagePlans) return;
    if (preset === "wave_10k") {
      setName("Стартовая волна wesetup.ru · 10 000 ₽");
      setKind("one_time");
      setBudgetRub("10000");
      setMaxPricePerLinkRub("1250");
      setDaysOfWeek([1, 3, 5]);
      setIsActive(true);
    } else {
      setName("Ежемесячный план wesetup.ru · 5 000 ₽/мес");
      setKind("monthly");
      setBudgetRub("5000");
      setMaxPricePerLinkRub("1250");
      setDaysOfWeek([2, 5]);
      setIsActive(true);
    }
  }

  function toggleDay(day: number) {
    if (!canManagePlans) return;
    setDaysOfWeek((prev) => {
      if (prev.includes(day)) {
        return prev.length > 1 ? prev.filter((d) => d !== day) : prev;
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  }

  function toggleFormat(fmt: GglSchedulableFormat) {
    if (!canManagePlans) return;
    setAllowedFormats((prev) => {
      if (prev.includes(fmt)) {
        return prev.length > 1 ? prev.filter((f) => f !== fmt) : prev;
      }
      return [...prev, fmt];
    });
  }

  async function handleQuickEnsureCampaign() {
    if (!canEnsureCampaign) return;
    setEnsuringCampaign(true);
    try {
      const response = await fetch("/api/root/gogetlinks/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "WeSetup электронные журналы ХАССП",
          idempotencyKey: generateClientIdempotencyKey("planner-ensure-wesetup"),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        campaign?: { name: string; gglCampaignId: number };
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          data?.error ?? "Не удалось создать или привязать кампанию wesetup.ru",
        );
      }
      toast.success(
        data?.campaign
          ? `Кампания ${data.campaign.name} (#${data.campaign.gglCampaignId}) создана и закреплена`
          : "Кампания wesetup.ru готова и закреплена",
      );
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка создания кампании");
    } finally {
      setEnsuringCampaign(false);
    }
  }

  async function savePlan(overrideActive?: boolean) {
    if (!canManagePlans) return;
    if (!effectiveCampaignId) {
      toast.error(
        "Сначала создайте или синхронизируйте кампанию wesetup.ru",
      );
      return;
    }
    const parsedBudget = Number.parseInt(budgetRub, 10);
    const parsedMaxPrice = Number.parseInt(maxPricePerLinkRub, 10);
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      toast.error("Укажите положительный бюджет плана в рублях");
      return;
    }
    if (!Number.isFinite(parsedMaxPrice) || parsedMaxPrice <= 0) {
      toast.error("Укажите потолок цены одной ссылки в рублях");
      return;
    }

    const nextActive =
      overrideActive !== undefined ? overrideActive : isActive;

    setSaving(true);
    try {
      const response = await fetch("/api/root/gogetlinks/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(initialPlan?.id ? { id: initialPlan.id } : {}),
          name: name.trim(),
          campaignId: effectiveCampaignId,
          kind,
          budgetRub: parsedBudget,
          maxPricePerLinkRub: parsedMaxPrice,
          startsAt,
          scheduleDaysOfWeek: daysOfWeek,
          minTfCf: Math.max(0, Number.parseInt(minTfCf, 10) || 0),
          minTrust: Math.max(0, Number.parseInt(minTrust, 10) || 0),
          minDailyTraffic: Math.max(
            0,
            Number.parseInt(minDailyTraffic, 10) || 0,
          ),
          allowedFormats,
          anchorMixBrandPct: Math.min(
            100,
            Math.max(0, Number.parseInt(anchorMixBrandPct, 10) || 50),
          ),
          isActive: nextActive,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        materializedSlots?: number;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сохранить план закупок");
      }
      setIsActive(nextActive);
      toast.success(
        data?.materializedSlots && data.materializedSlots > 0
          ? `План сохранён, построено новых слотов: ${data.materializedSlots}`
          : "Параметры плана закупок сохранены",
      );
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сохранения плана");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {canManagePlans && !initialPlan ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-[#6f7282]">Быстрые шаблоны:</span>
          <button
            type="button"
            onClick={() => applyPreset("wave_10k")}
            className={SEO_BTN_SM_CLASS}
          >
            Разовый пакет 10 000 ₽
          </button>
          <button
            type="button"
            onClick={() => applyPreset("monthly_5k")}
            className={SEO_BTN_SM_CLASS}
          >
            Регулярный 5 000 ₽/мес
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="xl:col-span-2">
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            Название плана
          </label>
          <input
            type="text"
            value={name}
            disabled={!canManagePlans}
            onChange={(e) => setName(e.target.value)}
            className={SEO_INPUT_CLASS}
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            Кампания wesetup.ru
          </label>
          <select
            value={effectiveCampaignId}
            disabled={!canManagePlans || wesetupCampaigns.length === 0}
            onChange={(e) => setCampaignId(e.target.value)}
            className={SEO_INPUT_CLASS}
          >
            {wesetupCampaigns.length === 0 ? (
              <option value="">Нет активной кампании wesetup.ru</option>
            ) : (
              wesetupCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (#{c.gglCampaignId})
                </option>
              ))
            )}
          </select>
          {wesetupCampaigns.length === 0 && canEnsureCampaign ? (
            <button
              type="button"
              disabled={ensuringCampaign}
              onClick={() => void handleQuickEnsureCampaign()}
              className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3848c7] hover:underline disabled:opacity-50"
            >
              {ensuringCampaign ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Rocket className="size-3.5" />
              )}
              Создать и закрепить кампанию wesetup.ru
            </button>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            Режим бюджета
          </label>
          <select
            value={kind}
            disabled={!canManagePlans}
            onChange={(e) =>
              setKind(e.target.value === "one_time" ? "one_time" : "monthly")
            }
            className={SEO_INPUT_CLASS}
          >
            <option value="monthly">Ежемесячный (₽/мес)</option>
            <option value="one_time">Разовый пакет (фиксированный пул)</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            {kind === "monthly" ? "Бюджет в месяц (₽)" : "Общий бюджет пакета (₽)"}
          </label>
          <input
            type="number" inputMode="numeric"
            min={100}
            step={500}
            value={budgetRub}
            disabled={!canManagePlans}
            onChange={(e) => setBudgetRub(e.target.value)}
            className={SEO_INPUT_CLASS}
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            Потолок цены ссылки (₽)
          </label>
          <input
            type="number" inputMode="numeric"
            min={100}
            step={50}
            value={maxPricePerLinkRub}
            disabled={!canManagePlans}
            onChange={(e) => setMaxPricePerLinkRub(e.target.value)}
            className={SEO_INPUT_CLASS}
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            Дата старта расписания
          </label>
          <input
            type="date"
            value={startsAt}
            disabled={!canManagePlans}
            onChange={(e) => setStartsAt(e.target.value)}
            className={SEO_INPUT_CLASS}
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            Безанкор / бренд в анкор-листе (%)
          </label>
          <input
            type="number" inputMode="decimal"
            min={0}
            max={100}
            value={anchorMixBrandPct}
            disabled={!canManagePlans}
            onChange={(e) => setAnchorMixBrandPct(e.target.value)}
            className={SEO_INPUT_CLASS}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <div className="mb-1 text-[12px] font-medium text-[#6f7282]">
            Дни недели подготовки слотов
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((w) => {
              const checked = daysOfWeek.includes(w.day);
              return (
                <button
                  key={w.day}
                  type="button"
                  disabled={!canManagePlans}
                  onClick={() => toggleDay(w.day)}
                  className={`h-9 min-w-[40px] rounded-xl border px-2.5 text-[12.5px] font-medium transition-colors ${
                    checked
                      ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                      : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40"
                  } disabled:opacity-60`}
                >
                  {w.short}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            Мин. TF/CF донора
          </label>
          <input
            type="number" inputMode="decimal"
            min={0}
            max={100}
            value={minTfCf}
            disabled={!canManagePlans}
            onChange={(e) => setMinTfCf(e.target.value)}
            className={SEO_INPUT_CLASS}
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            Мин. Траст GGL
          </label>
          <input
            type="number" inputMode="decimal"
            min={0}
            max={100}
            value={minTrust}
            disabled={!canManagePlans}
            onChange={(e) => setMinTrust(e.target.value)}
            className={SEO_INPUT_CLASS}
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
            Мин. трафик/сутки
          </label>
          <input
            type="number" inputMode="numeric"
            min={0}
            step={50}
            value={minDailyTraffic}
            disabled={!canManagePlans}
            onChange={(e) => setMinDailyTraffic(e.target.value)}
            className={SEO_INPUT_CLASS}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ececf4] pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] text-[#6f7282]">Форматы размещения:</span>
          {(["article", "note"] as const).map((fmt) => {
            const active = allowedFormats.includes(fmt);
            return (
              <label
                key={fmt}
                className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-[#0b1024]"
              >
                <input
                  type="checkbox"
                  checked={active}
                  disabled={!canManagePlans}
                  onChange={() => toggleFormat(fmt)}
                  className="size-4 rounded border-[#dcdfed] text-[#5566f6]"
                />
                {fmt === "article"
                  ? "Статья (наш готовый материал)"
                  : "Заметка (ТЗ вебмастеру)"}
              </label>
            );
          })}
        </div>

        {canManagePlans ? (
          <div className="flex flex-wrap items-center gap-2">
            {initialPlan ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void savePlan(!isActive)}
                className={SEO_BTN_OUTLINE_CLASS}
              >
                {isActive ? (
                  <>
                    <Pause className="size-4 text-[#92400e]" />
                    Поставить на паузу
                  </>
                ) : (
                  <>
                    <Play className="size-4 text-[#116b2a]" />
                    Возобновить план
                  </>
                )}
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void savePlan()}
              className={SEO_BTN_PRIMARY_CLASS}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {initialPlan ? "Сохранить расписание" : "Создать план и слоты"}
            </button>
          </div>
        ) : (
          <span className="text-[12.5px] text-[#6f7282]">
            Изменение лимитов бюджета доступно владельцу и администраторам платформы
          </span>
        )}
      </div>
    </div>
  );
}

export function PlannerTab({
  campaigns,
  defaultGglCampaignId = null,
  accountConnected = false,
  plans,
  slots,
  viewer,
  onRefresh,
}: PlannerTabProps) {
  const wesetupCampaigns = useMemo(() => {
    const filtered = campaigns.filter((c) => c.isWesetup);
    return [...filtered].sort((a, b) => {
      const rank = (c: GglCampaignDto): number => {
        if (defaultGglCampaignId && c.gglCampaignId === defaultGglCampaignId) return 0;
        if (c.state === "active") return 1;
        return 2;
      };
      return rank(a) - rank(b);
    });
  }, [campaigns, defaultGglCampaignId]);
  const campaignById = useMemo(
    () => new Map(campaigns.map((c) => [c.id, c])),
    [campaigns],
  );

  const [selectedPlanId, setSelectedPlanId] = useState<string | "new">(
    () => plans[0]?.id ?? "new",
  );
  const [slotFilter, setSlotFilter] = useState<SlotFilterKey>("all");
  const [drawerSlotId, setDrawerSlotId] = useState<string | null>(null);
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const [donorSwapMenuSlotId, setDonorSwapMenuSlotId] = useState<string | null>(
    null,
  );

  // Stable client idempotency key per slot approval attempt to prevent double-spend on retries
  const approveKeysRef = useRef<Map<string, string>>(new Map());

  const activePlan = useMemo(() => {
    if (selectedPlanId === "new") return null;
    return plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null;
  }, [plans, selectedPlanId]);

  const drawerSlot = useMemo(
    () => slots.find((s) => s.id === drawerSlotId) ?? null,
    [slots, drawerSlotId],
  );

  const filteredSlots = useMemo(() => {
    return slots.filter((s) => {
      if (slotFilter === "all") return true;
      if (slotFilter === "pending_approval") {
        return s.status === "pending_approval";
      }
      if (slotFilter === "upcoming") {
        return s.status === "planned" || s.status === "preparing";
      }
      if (slotFilter === "ordered") {
        return s.status === "ordered" || s.status === "approved_sending";
      }
      return s.status === "skipped" || s.status === "failed";
    });
  }, [slots, slotFilter]);

  const counts = useMemo(() => {
    let pending = 0;
    let upcoming = 0;
    let ordered = 0;
    let other = 0;
    for (const s of slots) {
      if (s.status === "pending_approval") pending += 1;
      else if (s.status === "planned" || s.status === "preparing") upcoming += 1;
      else if (s.status === "ordered" || s.status === "approved_sending")
        ordered += 1;
      else other += 1;
    }
    return { pending, upcoming, ordered, other };
  }, [slots]);

  async function handleApproveSlot(slot: GglPlannedSlotDto) {
    let key = approveKeysRef.current.get(slot.id);
    if (!key) {
      key = generateClientIdempotencyKey(`slot-approve-${slot.id}`);
      approveKeysRef.current.set(slot.id, key);
    }

    setBusySlotId(slot.id);
    try {
      const response = await fetch(
        `/api/root/gogetlinks/slots/${encodeURIComponent(slot.id)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: key }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        slotStatus?: string;
      } | null;
      if (!response.ok) {
        approveKeysRef.current.delete(slot.id);
        throw new Error(
          data?.error ?? "Не удалось подтвердить и отправить закупку в GoGetLinks",
        );
      }
      approveKeysRef.current.delete(slot.id);
      toast.success(
        `Заявка на ${slot.donorDomain ?? "донора"} отправлена в GoGetLinks`,
      );
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка подтверждения");
      await onRefresh();
    } finally {
      setBusySlotId(null);
    }
  }

  async function handleSkipSlot(slot: GglPlannedSlotDto) {
    setBusySlotId(slot.id);
    try {
      const response = await fetch(
        `/api/root/gogetlinks/slots/${encodeURIComponent(slot.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "skip" }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось пропустить слот");
      }
      toast.success(`Слот ${formatRuShortDate(slot.scheduledDate)} пропущен`);
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка пропуска слота");
    } finally {
      setBusySlotId(null);
    }
  }

  async function handleSwapDonor(slot: GglPlannedSlotDto, donorSiteId?: number) {
    setBusySlotId(slot.id);
    setDonorSwapMenuSlotId(null);
    try {
      const response = await fetch(
        `/api/root/gogetlinks/slots/${encodeURIComponent(slot.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "swap_donor",
            ...(donorSiteId ? { donorSiteId } : {}),
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сменить донора");
      }
      toast.success("Площадка-донор для слота заменена из резерва");
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка смены донора");
    } finally {
      setBusySlotId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Human-in-the-loop financial safety callout */}
      <div className="flex items-start gap-3 rounded-2xl border border-[#d8deff] bg-[#eef1ff]/65 px-4 py-3 text-[13px] text-[#0b1024]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#3848c7]" />
        <div>
          <span className="font-semibold text-[#3848c7]">
            Защита от автосписаний:
          </span>{" "}
          планировщик строит сетку слотов на 30 дней вперёд, отбирает доноров (строго 1 донор = 1 ссылка на wesetup.ru) и готовит статьи за 7 дней до даты, но отправка заявки и заморозка средств в GoGetLinks выполняются{" "}
          <strong>только после вашего клика «Подтвердить закупку»</strong>.
        </div>
      </div>

      {/* Plan Settings Card */}
      <section className={SEO_CARD_CLASS}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <CalendarClock className="size-4 text-[#5566f6]" />
              Настройки расписания и лимитов
            </div>
            <p className="mt-0.5 text-[13px] text-[#6f7282]">
              Можно вести разовый стартовый пакет (например, 10 000 ₽) и регулярный ежемесячный план (например, 5 000 ₽/мес).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {plans.map((p) => {
              const selected = activePlan?.id === p.id && selectedPlanId !== "new";
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlanId(p.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                    selected
                      ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                      : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40"
                  }`}
                >
                  <span
                    className={`size-2 rounded-full ${
                      p.isActive ? "bg-[#116b2a]" : "bg-[#9b9fb3]"
                    }`}
                  />
                  {p.name} · {formatRub(p.budgetRub)}
                  {p.kind === "monthly" ? "/мес" : ""}
                </button>
              );
            })}
            {viewer.canManagePlans ? (
              <button
                type="button"
                onClick={() => setSelectedPlanId("new")}
                className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  selectedPlanId === "new" || plans.length === 0
                    ? "border-[#5566f6] bg-[#5566f6] text-white"
                    : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40"
                }`}
              >
                <Plus className="size-3.5" />
                Новый план
              </button>
            ) : null}
          </div>
        </div>

        <PlanEditorForm
          key={
            selectedPlanId === "new" || !activePlan
              ? `new-plan:${wesetupCampaigns[0]?.id ?? "none"}`
              : `${activePlan.id}:${activePlan.updatedAt ?? ""}`
          }
          initialPlan={selectedPlanId === "new" ? null : activePlan}
          wesetupCampaigns={wesetupCampaigns}
          canManagePlans={viewer.canManagePlans}
          canEnsureCampaign={Boolean(viewer.isSuperadmin && accountConnected)}
          onSaved={onRefresh}
        />
      </section>

      {/* 30-Day Calendar Slots Table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { key: "all", label: `Все слоты · ${slots.length}` },
                {
                  key: "pending_approval",
                  label: `Ждут подтверждения · ${counts.pending}`,
                },
                {
                  key: "upcoming",
                  label: `В расписании / подготовке · ${counts.upcoming}`,
                },
                { key: "ordered", label: `Отправлены · ${counts.ordered}` },
                { key: "other", label: `Пропущены / сбои · ${counts.other}` },
              ] as Array<{ key: SlotFilterKey; label: string }>
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setSlotFilter(f.key)}
                className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                  slotFilter === f.key
                    ? "border-[#5566f6] bg-[#5566f6] text-white"
                    : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredSlots.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center text-[14px] text-[#6f7282]">
            {slots.length === 0
              ? "Слотов расписания пока нет. Создайте активный план закупок выше — крон и планировщик разложат календарь на 30 дней вперёд."
              : "В выбранном фильтре слотов нет."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <table className="w-full min-w-[1040px] text-[13px]">
              <thead>
                <tr className="bg-[#fafbff] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  <th className="px-4 py-3">Дата и план</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Посадочная wesetup.ru и причина выбора</th>
                  <th className="px-4 py-3">Донор и метрики</th>
                  <th className="px-4 py-3">Формат, цена и контент</th>
                  <th className="px-4 py-3 text-right">Подтверждение</th>
                </tr>
              </thead>
              <tbody>
                {filteredSlots.map((slot) => {
                  const statusBadge = formatSlotStatusBadge(slot.status);
                  const donorMetrics = parseSlotDonorMetrics(
                    slot.donorMetricsJson,
                  );
                  const alternatives = parseSlotAlternatives(
                    slot.alternativeDonorsJson,
                  );
                  const topvisorSnap = parseTopvisorSnapshot(
                    slot.topvisorPosSnapshot,
                  );
                  const planCampaign = slot.plan?.campaignId
                    ? campaignById.get(slot.plan.campaignId)
                    : undefined;
                  const isWesetupSlot = planCampaign
                    ? planCampaign.isWesetup
                    : true;
                  const isBusy = busySlotId === slot.id;
                  const canMutateSlot =
                    isWesetupSlot &&
                    slot.status !== "ordered" &&
                    slot.status !== "approved_sending";
                  const canApproveThisSlot =
                    isWesetupSlot &&
                    slot.status === "pending_approval" &&
                    viewer.canApproveWithinPlan &&
                    Boolean(slot.donorSiteId && slot.targetUrl && slot.anchor);

                  return (
                    <tr
                      key={slot.id}
                      className="border-t border-[#ececf4] align-top transition-colors hover:bg-[#fafbff]/60"
                    >
                      {/* Date & plan */}
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="font-semibold text-[#0b1024]">
                          {formatRuShortDate(slot.scheduledDate)}
                        </div>
                        {slot.plan ? (
                          <div className="mt-0.5 max-w-[160px] truncate text-[11.5px] text-[#6f7282]">
                            {slot.plan.name}
                          </div>
                        ) : null}
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${badgeToneClass(
                            statusBadge.badgeTone,
                          )}`}
                        >
                          {statusBadge.label}
                        </span>
                        {slot.approvedByName ? (
                          <div className="mt-1 text-[11.5px] text-[#6f7282]">
                            Подтв.: {slot.approvedByName}
                          </div>
                        ) : null}
                      </td>

                      {/* Target URL & selection reason */}
                      <td className="max-w-[320px] px-4 py-3">
                        {slot.targetUrl ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <a
                              href={
                                slot.targetUrl.startsWith("http")
                                  ? slot.targetUrl
                                  : `https://wesetup.ru${slot.targetUrl}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-[#3848c7] underline-offset-2 hover:underline"
                            >
                              {shortWesetupPath(slot.targetUrl)}
                              <ExternalLink className="size-3" />
                            </a>
                            {topvisorSnap.yandexPos !== null ||
                            topvisorSnap.googlePos !== null ? (
                              <span className="rounded-md bg-[#f4f4f8] px-1.5 py-0.5 text-[11px] text-[#3c4053]">
                                Я: {topvisorSnap.yandexPos ?? "—"} · G:{" "}
                                {topvisorSnap.googlePos ?? "—"}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-[#9b9fb3]">
                            Подбирается за 7 дней до даты…
                          </span>
                        )}
                        {slot.targetKeyword ? (
                          <div className="mt-0.5 text-[12px] font-medium text-[#0b1024]">
                            Кластер: «{slot.targetKeyword}»
                          </div>
                        ) : null}
                        {slot.selectionReason ? (
                          <div className="mt-1 text-[11.5px] leading-snug text-[#6f7282]">
                            {slot.selectionReason}
                          </div>
                        ) : null}
                      </td>

                      {/* Donor & swap */}
                      <td className="px-4 py-3">
                        {slot.donorDomain ? (
                          <div>
                            <a
                              href={`https://${slot.donorDomain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-[#0b1024] underline-offset-2 hover:underline"
                            >
                              {slot.donorDomain}
                              <ExternalLink className="size-3 text-[#6f7282]" />
                            </a>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-[11.5px] text-[#6f7282]">
                              <span>
                                TF/CF:{" "}
                                <strong className="text-[#0b1024]">
                                  {donorMetrics.tf ?? "—"}/
                                  {donorMetrics.cf ?? "—"}
                                </strong>
                              </span>
                              <span>·</span>
                              <span>
                                Траст:{" "}
                                <strong className="text-[#0b1024]">
                                  {donorMetrics.trust ?? "—"}
                                </strong>
                              </span>
                              <span>·</span>
                              <span>
                                Трафик:{" "}
                                <strong className="text-[#0b1024]">
                                  {donorMetrics.dailyTraffic ?? "—"}/сут
                                </strong>
                              </span>
                            </div>

                            {canMutateSlot && alternatives.length > 0 ? (
                              <div className="relative mt-2">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    setDonorSwapMenuSlotId((curr) =>
                                      curr === slot.id ? null : slot.id,
                                    )
                                  }
                                  className={SEO_BTN_SM_CLASS}
                                >
                                  <Repeat className="size-3.5 text-[#5566f6]" />
                                  Сменить донора ({alternatives.length})
                                </button>
                                {donorSwapMenuSlotId === slot.id ? (
                                  <div className="absolute left-0 top-full z-20 mt-1 w-[270px] rounded-2xl border border-[#dcdfed] bg-white p-1.5 shadow-xl">
                                    <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#6f7282]">
                                      Резервные площадки в бюджете
                                    </div>
                                    {alternatives.map((alt) => (
                                      <button
                                        key={alt.siteId}
                                        type="button"
                                        onClick={() =>
                                          void handleSwapDonor(
                                            slot,
                                            alt.siteId,
                                          )
                                        }
                                        className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] hover:bg-[#f5f6ff]"
                                      >
                                        <div>
                                          <div className="font-medium text-[#0b1024]">
                                            {alt.domain}
                                          </div>
                                          <div className="text-[11px] text-[#6f7282]">
                                            TF/CF {alt.metrics.tf}/
                                            {alt.metrics.cf} · траф.{" "}
                                            {alt.metrics.dailyTraffic}
                                          </div>
                                        </div>
                                        <span className="shrink-0 font-semibold text-[#3848c7]">
                                          {formatRub(alt.priceRub)}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-[#9b9fb3]">Ожидает подбора</span>
                        )}
                      </td>

                      {/* Format, price & article drawer trigger */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#0b1024]">
                          {slot.estimatedPriceRub !== null
                            ? formatRub(slot.estimatedPriceRub)
                            : `до ${formatRub(slot.maxPriceRub)}`}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-[#6f7282]">
                          {formatPlacementFormatLabel(slot.placementFormat)} ·
                          лимит {formatRub(slot.maxPriceRub)}
                        </div>
                        {slot.anchor ? (
                          <div className="mt-1 text-[12px] text-[#3c4053]">
                            Анкор: «<strong>{slot.anchor}</strong>»{" "}
                            <span className="text-[11px] text-[#6f7282]">
                              ({formatAnchorKindLabel(slot.anchorKind)})
                            </span>
                          </div>
                        ) : null}
                        {slot.targetUrl || slot.article || slot.briefText ? (
                          <button
                            type="button"
                            onClick={() => setDrawerSlotId(slot.id)}
                            className={`${SEO_BTN_SM_CLASS} mt-2`}
                          >
                            <FileText className="size-3.5 text-[#5566f6]" />
                            {slot.article ? "Статья / ТЗ" : "ТЗ / Анкор"}
                          </button>
                        ) : null}
                      </td>

                      {/* Actions */}
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          {slot.status === "pending_approval" ? (
                            canApproveThisSlot ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleApproveSlot(slot)}
                                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3.5 text-[12.5px] font-medium text-white shadow-sm transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
                              >
                                {isBusy ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Check className="size-3.5" />
                                )}
                                Подтвердить закупку
                              </button>
                            ) : (
                              <span
                                className="rounded-xl border border-[#dcdfed] bg-[#fafbff] px-2.5 py-1.5 text-[11.5px] text-[#6f7282]"
                                title="Подтверждение списаний доступно администратору платформы (или SEO-специалисту, если включено разрешение в настройках аккаунта)"
                              >
                                Ждёт подтв. админа
                              </span>
                            )
                          ) : null}

                          {canMutateSlot && slot.status !== "skipped" ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleSkipSlot(slot)}
                              className={SEO_BTN_SM_CLASS}
                            >
                              <SkipForward className="size-3.5 text-[#6f7282]" />
                              Пропустить
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ArticleDrawer
        slot={drawerSlot}
        readOnly={!drawerSlot || drawerSlot.status === "ordered"}
        onClose={() => setDrawerSlotId(null)}
        onSaved={onRefresh}
      />
    </div>
  );
}
