"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, Minus, Plus, Trash2, X } from "lucide-react";
import { ApiError, useBillingError, useTariffLimitToast } from "@/lib/billing-limit-toast";
import { normalizeSphere } from "@/lib/org-profile";
import { positionSuggestionsFor } from "@/lib/sphere-positions";
import {
  TYPICAL_EQUIPMENT,
  WIZARD_LAMP_HOURS,
  WIZARD_MAX_QUANTITY,
  emptyEquipmentQuantities,
  planEquipment,
  typicalEquipmentQuantities,
  type WizardEquipmentType,
} from "@/lib/point-wizard";
import { LAMP_PRESETS, UV_LAMP_TYPE } from "@/lib/uv-lamp";
import { SETUP_STEPS, setupStepIndex, type SetupStep } from "@/lib/setup-wizard";
import { ExchangeOfferLine } from "@/components/directory-exchange/exchange-offer-line";

/**
 * Шаги 2–4 мастера первого входа (владелец, 2026-11-18): после анкеты —
 * «Объекты», «Сотрудники», «Оборудование». Каждый шаг необязателен
 * («Пропустить»), но ведёт человека дальше. Пишут через те же API, что и
 * разделы настроек: лимиты тарифа и права проверяет сервер.
 */

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const SECONDARY =
  "inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-semibold text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60";
const SMALL_OUTLINE =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] font-medium text-[#3848c7] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

type ApiBuilding = { id: string; name: string; address: string | null; kind?: string | null };

/** Объекты организации без офиса — офис не точка (`OFFICE_BUILDING_KIND`). */
async function loadPoints(): Promise<ApiBuilding[]> {
  const response = await fetch("/api/settings/buildings").catch(() => null);
  if (!response?.ok) return [];
  const data = (await response.json().catch(() => null)) as { buildings?: ApiBuilding[] } | null;
  return (data?.buildings ?? []).filter((building) => building.kind !== "office");
}

/** «Шаг 2 из 4» и полоска из четырёх отрезков с подписями. */
/**
 * Шаги мастера (владелец, 2026-11-22: «шаги можно переключать туда-сюда»):
 * с `onSelect` подпись шага — кнопка, и она отвечает на тап всегда
 * (владелец, 2026-11-23: выключенные до сохранения анкеты кнопки молчали —
 * «переключение шагов не работает»). Что делать с тапом до сохранения
 * анкеты, решает мастер (`selectStep`): сохранить и перейти либо объяснить,
 * что заполнить. `canSelect` — для шага, на который перейти нельзя вовсе.
 */
export function SetupStepper({
  step,
  onSelect,
  canSelect = () => true,
}: {
  step: SetupStep;
  onSelect?: (step: SetupStep) => void;
  canSelect?: (step: SetupStep) => boolean;
}) {
  const tn = useTranslations("dashboardUi.completeProfileNudge.setup");
  const current = setupStepIndex(step);
  return (
    <div className="px-4 pt-1 sm:px-5" data-setup-stepper data-setup-step={step}>
      <div className="text-[11.5px] font-medium text-[#6f7282]">
        {tn("step", { current: String(current + 1), total: String(SETUP_STEPS.length) })}
      </div>
      <ol className="mt-1.5 grid grid-cols-4 gap-1.5">
        {SETUP_STEPS.map((key, index) => {
          const body = (
            <>
              <span
                className={`block h-1.5 rounded-full ${index <= current ? "bg-[#5566f6]" : "bg-[#e7e9f3]"}`}
                aria-hidden
              />
              <span
                className={`mt-1 block truncate text-[11px] ${
                  index === current ? "font-semibold text-[#0b1024]" : "text-[#9b9fb3]"
                }`}
              >
                {tn(`steps.${key}`)}
              </span>
            </>
          );
          const enabled = Boolean(onSelect) && canSelect(key);
          return (
            <li key={key} className="min-w-0">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(key)}
                  disabled={!enabled || index === current}
                  aria-current={index === current ? "step" : undefined}
                  data-setup-step-button={key}
                  className="block w-full rounded-md pb-0.5 text-left transition-opacity focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 enabled:hover:opacity-80 disabled:cursor-default"
                >
                  {body}
                </button>
              ) : (
                <span className="block" aria-current={index === current ? "step" : undefined}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepFooter({
  busy,
  onSkip,
  onNext,
  nextLabel,
  nextDisabled = false,
}: {
  busy: boolean;
  onSkip: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
}) {
  const tn = useTranslations("dashboardUi.completeProfileNudge.setup");
  return (
    <div className="shrink-0 border-t border-[#eef0f6] p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onSkip} disabled={busy} className={SECONDARY} data-setup-skip>
          {tn("skip")}
        </button>
        <button type="button" onClick={onNext} disabled={busy || nextDisabled} className={PRIMARY} data-setup-next>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

type PointRow = {
  key: string;
  /** id объекта в базе; null — новый. */
  id: string | null;
  name: string;
  address: string;
  initialName: string;
  initialAddress: string;
};

function savedPointRow(point: ApiBuilding): PointRow {
  const address = point.address ?? "";
  return { key: point.id, id: point.id, name: point.name, address, initialName: point.name, initialAddress: address };
}

/**
 * Объекты после обмена или переноса из другой организации: строки из базы
 * берём заново, а набранное и ещё не сохранённое (правка названия, новая
 * строка с текстом) остаётся как было.
 */
function mergePointRows(current: PointRow[], points: ApiBuilding[]): PointRow[] {
  // Пустой ответ — объектов нет или запрос не прошёл: шаг не трогаем.
  if (points.length === 0) return current;
  const edited = new Map<string, PointRow>();
  for (const row of current) {
    if (row.id && (row.name !== row.initialName || row.address !== row.initialAddress)) edited.set(row.id, row);
  }
  const drafts = current.filter((row) => row.id === null && row.name.trim() !== "");
  return [...points.map((point) => edited.get(point.id) ?? savedPointRow(point)), ...drafts];
}

/** Шаг 2 «Объекты»: названия и адреса точек, можно добавить ещё. */
export function SetupPointsStep({
  defaultAddress,
  onDone,
}: {
  /** Адрес из анкеты (ЕГРЮЛ) — первой новой точке. */
  defaultAddress: string;
  onDone: () => void;
}) {
  const tn = useTranslations("dashboardUi.completeProfileNudge.setup");
  const tariffLimit = useTariffLimitToast();
  const [rows, setRows] = useState<PointRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadPoints().then((points) => {
      if (!alive) return;
      setRows(
        points.length > 0
          ? points.map(savedPointRow)
          : [{ key: "new-0", id: null, name: "", address: defaultAddress, initialName: "", initialAddress: "" }],
      );
    });
    return () => {
      alive = false;
    };
  }, [defaultAddress]);

  /** Связали справочники или перенесли объекты из другой организации — список мог вырасти. */
  async function reloadPoints() {
    const points = await loadPoints();
    setRows((current) => (current ? mergePointRows(current, points) : current));
  }

  const update = (key: string, patch: Partial<PointRow>) =>
    setRows((current) => (current ?? []).map((row) => (row.key === key ? { ...row, ...patch } : row)));

  async function save() {
    if (!rows) return;
    setBusy(true);
    try {
      let created = 0;
      for (const row of rows) {
        const name = row.name.trim();
        const address = row.address.trim();
        if (row.id) {
          if (!name || (name === row.initialName && address === row.initialAddress)) continue;
          const response = await fetch(`/api/settings/buildings/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, address: address || null }),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.error || tn("pointsFailed"));
          }
          update(row.key, { initialName: name, initialAddress: address });
          continue;
        }
        if (!name) continue;
        const response = await fetch("/api/settings/buildings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, address: address || null }),
        });
        const data = (await response.json().catch(() => null)) as { building?: { id: string }; error?: string } | null;
        if (!response.ok || !data?.building) {
          // Объекты тарифа заняты — тост с кнопкой «Выбрать тариф», шаг остаётся.
          if (tariffLimit(data)) return;
          throw new Error(response.status === 409 ? tn("pointExists", { name }) : data?.error || tn("pointsFailed"));
        }
        // Сохранённая строка становится существующей: повторное «Далее» её не задвоит.
        update(row.key, { id: data.building.id, initialName: name, initialAddress: address });
        created += 1;
      }
      // Два объекта и больше — журналы ведутся по каждому (как «Объектов: 2» в анкете).
      const filled = rows.filter((row) => row.name.trim()).length;
      if (created > 0 && filled >= 2) {
        await fetch("/api/settings/buildings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ perLocationJournals: true }),
        }).catch(() => null);
      }
      if (filled > 0) toast.success(tn("pointsSaved"));
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tn("pointsFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-3 pt-3 sm:px-5" data-guide="setup-points">
        {/* У аккаунта уже есть другая организация — связать справочники или перенести данные (Р9). */}
        <ExchangeOfferLine onApplied={() => void reloadPoints()} />
        {rows === null ? (
          <div className="flex h-24 items-center justify-center text-[#9b9fb3]">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          rows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-2" data-setup-point>
              <input
                type="text"
                value={row.name}
                onChange={(event) => update(row.key, { name: event.target.value })}
                placeholder={index === 0 ? tn("pointNamePlaceholder") : tn("pointNameN", { index: String(index + 1) })}
                aria-label={tn("pointNameLabel", { index: String(index + 1) })}
                className={INPUT}
                maxLength={120}
              />
              <input
                type="text"
                value={row.address}
                onChange={(event) => update(row.key, { address: event.target.value })}
                placeholder={tn("pointAddress")}
                aria-label={tn("pointAddressLabel", { index: String(index + 1) })}
                className={INPUT}
                maxLength={200}
              />
              {row.id === null && rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows((current) => (current ?? []).filter((item) => item.key !== row.key))}
                  aria-label={tn("removePoint", { index: String(index + 1) })}
                  className="inline-flex size-10 items-center justify-center rounded-xl text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#d2453d]"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : (
                <span className="size-10" aria-hidden />
              )}
            </div>
          ))
        )}
        {rows !== null ? (
          <button
            type="button"
            onClick={() =>
              setRows((current) => [
                ...(current ?? []),
                { key: `new-${Date.now()}`, id: null, name: "", address: "", initialName: "", initialAddress: "" },
              ])
            }
            className={SMALL_OUTLINE}
            data-setup-add-point
          >
            <Plus className="size-4" aria-hidden />
            {tn("addPoint")}
          </button>
        ) : null}
        <p className="text-[12px] leading-snug text-[#6f7282]">{tn("pointsNote")}</p>
      </div>
      <StepFooter busy={busy} onSkip={onDone} onNext={() => void save()} nextLabel={tn("next")} nextDisabled={rows === null} />
    </>
  );
}

type Position = { id: string; name: string; categoryKey: string };

/** Шаг 3 «Сотрудники»: ФИО и должность, по одному, список добавленных. */
export function SetupStaffStep({ sphere, onDone }: { sphere: string; onDone: () => void }) {
  const tn = useTranslations("dashboardUi.completeProfileNudge.setup");
  const { toastCaughtError } = useBillingError();
  const [fullName, setFullName] = useState("");
  const [positionName, setPositionName] = useState("");
  const [added, setAdded] = useState<Array<{ id: string; name: string; position: string }>>([]);
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(() => positionSuggestionsFor(normalizeSphere(sphere), "staff", []), [sphere]);

  const canAdd = fullName.trim().length >= 2 && positionName.trim().length >= 2;

  /** Должность по названию: есть — берём, нет — заводим как линейную. */
  async function resolvePosition(name: string): Promise<string> {
    const list = (await fetch("/api/positions")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)) as { positions?: Position[] } | null;
    const key = name.trim().toLocaleLowerCase("ru-RU");
    const found = list?.positions?.find((position) => position.name.trim().toLocaleLowerCase("ru-RU") === key);
    if (found) return found.id;
    const response = await fetch("/api/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), categoryKey: "staff" }),
    });
    const data = (await response.json().catch(() => null)) as { position?: Position; error?: string } | null;
    if (!response.ok || !data?.position) throw new Error(data?.error || tn("staffFailed"));
    return data.position.id;
  }

  async function add() {
    if (!canAdd || busy) return;
    setBusy(true);
    try {
      const jobPositionId = await resolvePosition(positionName);
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobPositionId, fullName: fullName.trim() }),
      });
      const data = (await response.json().catch(() => null)) as { user?: { id: string; name: string }; error?: string } | null;
      if (!response.ok || !data?.user) throw new ApiError(data?.error || tn("staffFailed"), data);
      setAdded((current) => [...current, { id: data.user!.id, name: data.user!.name, position: positionName.trim() }]);
      setFullName("");
    } catch (error) {
      if (error instanceof ApiError) toastCaughtError(error, tn("staffFailed"));
      else toast.error(error instanceof Error ? error.message : tn("staffFailed"));
    } finally {
      setBusy(false);
    }
  }

  // «Далее» с заполненной формой — сначала добавляем человека, иначе он потеряется.
  async function next() {
    if (canAdd) await add();
    onDone();
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 pt-3 sm:px-5" data-guide="setup-staff">
        <form
          className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder={tn("staffNamePlaceholder")}
            aria-label={tn("staffName")}
            autoComplete="off"
            className={INPUT}
            maxLength={200}
            data-setup-staff-name
          />
          <input
            type="text"
            value={positionName}
            onChange={(event) => setPositionName(event.target.value)}
            placeholder={tn("staffPositionPlaceholder")}
            aria-label={tn("staffPosition")}
            list="setup-staff-positions"
            autoComplete="off"
            className={INPUT}
            maxLength={120}
            data-setup-staff-position
          />
          <datalist id="setup-staff-positions">
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <button type="submit" disabled={!canAdd || busy} className={`${SMALL_OUTLINE} h-11 justify-center`} data-setup-staff-add>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" aria-hidden />}
            {tn("staffAdd")}
          </button>
        </form>
        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label={tn("staffPosition")}>
            {suggestions.slice(0, 6).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setPositionName(name)}
                className={`rounded-full border px-2.5 py-1 text-[12.5px] transition-colors ${
                  positionName.trim() === name
                    ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                    : "border-[#e7e9f3] bg-white text-[#3c4053] hover:border-[#5566f6]/40"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
        {added.length > 0 ? (
          <ul className="space-y-1.5" data-setup-staff-list>
            {added.map((person) => (
              <li key={person.id} className="flex items-center gap-2 rounded-2xl bg-[#f5f6ff] px-3 py-2 text-[13.5px] text-[#0b1024]">
                <Check className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
                <span className="min-w-0 truncate font-medium">{person.name}</span>
                <span className="min-w-0 truncate text-[#6f7282]">· {person.position}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[12px] leading-snug text-[#6f7282]">{tn("staffNote")}</p>
      </div>
      <StepFooter busy={busy} onSkip={onDone} onNext={() => void next()} nextLabel={tn("next")} />
    </>
  );
}

const EQUIPMENT_NORMS: Partial<Record<WizardEquipmentType, string>> = Object.fromEntries(
  TYPICAL_EQUIPMENT.filter((item) => item.tempMin !== undefined && item.tempMax !== undefined).map((item) => [
    item.type,
    `${item.tempMin}…${item.tempMax} °C`,
  ]),
);

/** Шаг 4 «Оборудование»: ничего не выбрано, типовой набор — только кнопкой. */
export function SetupEquipmentStep({ onDone }: { onDone: () => void }) {
  const tn = useTranslations("dashboardUi.completeProfileNudge.setup");
  const [points, setPoints] = useState<ApiBuilding[] | null>(null);
  const [pointId, setPointId] = useState("");
  const [roomName, setRoomName] = useState(() => tn("equipmentRoomDefault"));
  const [quantities, setQuantities] = useState<Record<WizardEquipmentType, number>>(emptyEquipmentQuantities);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadPoints().then((list) => {
      if (!alive) return;
      setPoints(list);
      setPointId(list[0]?.id ?? "");
    });
    return () => {
      alive = false;
    };
  }, []);

  const labels = Object.fromEntries(
    TYPICAL_EQUIPMENT.map((item) => [item.type, tn(`types.${item.type}`)]),
  ) as Record<WizardEquipmentType, string>;
  const room = roomName.trim();
  const plan = planEquipment({
    rows: TYPICAL_EQUIPMENT.map((item) => ({ type: item.type, quantity: quantities[item.type], roomName: room || null })),
    rooms: room ? [{ name: room, kind: "kitchen" }] : [],
    labels,
    takenNames: [],
  });
  const total = Object.values(quantities).reduce((sum, value) => sum + value, 0);

  /** Цех для оборудования: с таким названием в объекте — берём, нет — заводим. */
  async function resolveArea(): Promise<string> {
    const buildingId = pointId || null;
    const list = (await fetch("/api/areas")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)) as { areas?: Array<{ id: string; name: string; buildingId: string | null }> } | null;
    const key = room.toLocaleLowerCase("ru-RU");
    const found = list?.areas?.find(
      (area) => area.name.trim().toLocaleLowerCase("ru-RU") === key && (area.buildingId ?? null) === buildingId,
    );
    if (found) return found.id;
    const response = await fetch("/api/areas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: room, ...(buildingId ? { buildingId } : {}) }),
    });
    const data = (await response.json().catch(() => null)) as { area?: { id: string }; error?: string } | null;
    if (!response.ok || !data?.area) throw new Error(data?.error || tn("equipmentFailed", { items: room }));
    return data.area.id;
  }

  async function save() {
    if (plan.length === 0) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      const areaId = await resolveArea();
      const failed: string[] = [];
      for (const item of plan) {
        const response = await fetch("/api/equipment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: item.name,
            type: item.type,
            areaId,
            ...(item.tempMin !== undefined ? { tempMin: item.tempMin } : {}),
            ...(item.tempMax !== undefined ? { tempMax: item.tempMax } : {}),
            ...(item.type === UV_LAMP_TYPE
              ? { lampModel: LAMP_PRESETS[0].label, lampLifetimeHours: WIZARD_LAMP_HOURS, lampUsedHours: 0 }
              : {}),
          }),
        }).catch(() => null);
        if (!response?.ok) failed.push(item.name);
      }
      if (failed.length > 0) toast.warning(tn("equipmentFailed", { items: failed.join(", ") }));
      else toast.success(tn("equipmentSaved", { count: String(plan.length) }));
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tn("equipmentFailed", { items: room }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 pt-3 sm:px-5" data-guide="setup-equipment">
        <div className={`grid gap-2 ${points && points.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {points && points.length > 1 ? (
            <select
              value={pointId}
              onChange={(event) => setPointId(event.target.value)}
              aria-label={tn("equipmentPoint")}
              className={INPUT}
              data-setup-equipment-point
            >
              {points.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.name}
                </option>
              ))}
            </select>
          ) : null}
          <input
            type="text"
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder={tn("equipmentRoom")}
            aria-label={tn("equipmentRoom")}
            className={INPUT}
            maxLength={120}
            data-setup-equipment-room
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setQuantities(typicalEquipmentQuantities())}
            className={SMALL_OUTLINE}
            data-setup-typical-set
          >
            <Plus className="size-4" aria-hidden />
            {tn("typicalSet")}
          </button>
          {total > 0 ? (
            <button
              type="button"
              onClick={() => setQuantities(emptyEquipmentQuantities())}
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl px-3 text-[13px] font-medium text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
            >
              <X className="size-4" aria-hidden />
              {tn("clear")}
            </button>
          ) : null}
        </div>
        <ul className="space-y-1.5">
          {TYPICAL_EQUIPMENT.map((item) => {
            const quantity = quantities[item.type];
            const change = (delta: number) =>
              setQuantities((current) => ({
                ...current,
                [item.type]: Math.max(0, Math.min(WIZARD_MAX_QUANTITY, current[item.type] + delta)),
              }));
            return (
              <li
                key={item.type}
                data-setup-equipment={item.type}
                className={`flex items-center gap-2 rounded-2xl border px-3 py-1.5 ${
                  quantity > 0 ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-white"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-[#0b1024]">{labels[item.type]}</div>
                  {EQUIPMENT_NORMS[item.type] ? (
                    <div className="text-[11.5px] text-[#6f7282]">{tn("norm", { range: EQUIPMENT_NORMS[item.type]! })}</div>
                  ) : null}
                </div>
                <div className="flex h-9 items-center rounded-xl border border-[#dcdfed] bg-white">
                  <button
                    type="button"
                    onClick={() => change(-1)}
                    disabled={quantity === 0}
                    aria-label={tn("decrease", { name: labels[item.type] })}
                    className="inline-flex size-9 items-center justify-center rounded-l-xl text-[#3848c7] hover:bg-[#f5f6ff] disabled:text-[#c7ccea]"
                  >
                    <Minus className="size-4" />
                  </button>
                  <span className="w-7 text-center text-[14px] font-semibold tabular-nums text-[#0b1024]" data-setup-quantity>
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => change(1)}
                    disabled={quantity >= WIZARD_MAX_QUANTITY}
                    aria-label={tn("increase", { name: labels[item.type] })}
                    className="inline-flex size-9 items-center justify-center rounded-r-xl text-[#3848c7] hover:bg-[#f5f6ff] disabled:text-[#c7ccea]"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-[12px] leading-snug text-[#6f7282]">{tn("equipmentNote")}</p>
      </div>
      <StepFooter
        busy={busy}
        onSkip={onDone}
        onNext={() => void save()}
        nextLabel={total > 0 ? tn("finishWithCount", { count: String(plan.length) }) : tn("finish")}
        nextDisabled={total > 0 && !room}
      />
    </>
  );
}
