"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { MessageContract } from "@/i18n/message-contract";
import { brandQrHeightFor } from "@/lib/brand-qr-shared";
import { toast } from "sonner";
import { isBillingLimitError, useBillingError } from "@/lib/billing-limit-toast";
import { useSubmitLock } from "@/lib/use-submit-lock";
import { formatDaysRu } from "@/lib/format-days";
import { ChevronLeft, Copy, ExternalLink, KeyRound } from "lucide-react";
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
import { StaffQrPinField } from "@/components/staff/staff-qr-pin-field";
import { PersonalQrCard } from "@/components/staff/personal-qr-card";
import { Input } from "@/components/ui/input";
import type {
  PositionCategory,
  StaffEmployee,
  StaffPosition,
} from "@/components/staff/staff-types";
import { TasksFlowPromoHint } from "@/components/tasksflow/tasksflow-promo-hint";
import { WeekdayChips } from "@/components/staff/weekday-chips";
import { BuildingChips } from "@/components/staff/building-chips";
import type { BuildingOption } from "@/lib/building-scope";
import {
  DEFAULT_WEEKLY_DAYS_OFF,
  normalizeWeeklyDaysOff,
} from "@/lib/staff-days-off";

/** Сколько чипов-подсказок должностей показываем до «ещё N». */
const POSITION_HINTS_VISIBLE = 8;

type Close = { onClose: () => void; open: boolean };

/** Простая проверка почты на клиенте; окончательная — zod на сервере. */
const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Служебное значение select'а «+ Новая должность…» на шаге 2. */
const NEW_POSITION_OPTION = "__new-position__";

function shell(
  title: string,
  body: React.ReactNode,
  footer?: React.ReactNode,
  // `leading` — слот слева в шапке (кнопка «‹ Назад» в многошаговом
  // диалоге), `eyebrow` — мелкая надпись «Шаг 2 из 2» над заголовком.
  // `description` — пояснение для экранных чтецов; без него дублируется
  // заголовок (в тексте окна он звучал дважды).
  opts?: { leading?: React.ReactNode; eyebrow?: string; description?: string }
) {
  return (
    <>
      <DialogHeader className="shrink-0 border-b px-4 py-5 sm:pl-6 pr-14">
        {opts?.leading ?? null}
        {opts?.eyebrow ? (
          <div className="-mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
            {opts.eyebrow}
          </div>
        ) : null}
        <DialogTitle className="text-[18px] font-semibold text-[#0b1024]">
          {title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {opts?.description ?? title}
        </DialogDescription>
      </DialogHeader>
      {/* Скроллится только середина: шапка с крестиком и кнопки видны всегда. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
        {body}
      </div>
      {/* На узком экране кнопки футера переносятся, а не вылезают за
          край: три штуки («Добавить доступ», «Отмена», «Сохранить») в
          один ряд не помещались, и «Сохранить» уезжал за границу. */}
      {footer ? (
        <DialogFooter className="shrink-0 flex-wrap justify-end gap-2 border-t bg-white px-4 py-4 sm:flex-row sm:px-6">
          {footer}
        </DialogFooter>
      ) : null}
    </>
  );
}

function primaryBtn(
  label: string,
  onClick: () => void,
  pending?: boolean,
  disabled?: boolean
) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      className="h-11 min-w-[130px] rounded-xl bg-[#5566f6] text-[14px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0] disabled:opacity-70"
    >
      {pending ? "..." : label}
    </Button>
  );
}

function floatingLabel({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="absolute left-4 top-2 text-[11px] font-medium text-[#9b9fb3]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function FlagCheckbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
  testId: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors duration-150 hover:bg-[#f5f6ff]">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-[#5566f6]"
        data-testid={props.testId}
      />
      <span>
        <span className="block text-[14px] font-medium text-[#0b1024]">{props.label}</span>
        <span className="block text-[12px] leading-snug text-[#6f7282]">{props.hint}</span>
      </span>
    </label>
  );
}

/** Текст поля «Штатная численность» → число 0…999, null (пусто) или ошибка. */
function parseHeadcountInput(value: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d{1,3}$/.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed) };
}

/**
 * Поле «Штатная численность» в окнах создания и правки должности.
 * Пусто — «не задано»: пилюля «занято N из M» тогда не показывается.
 */
function HeadcountField(props: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("staffManagement.dialogs");
  const invalid = !parseHeadcountInput(props.value).ok;
  return (
    <div>
      {floatingLabel({
        id: props.id,
        label: t("headcountLabel"),
        children: (
          <Input
            id={props.id}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
            placeholder={t("headcountPlaceholder")}
            aria-invalid={invalid || undefined}
            aria-describedby={`${props.id}-hint`}
            data-testid="position-headcount"
            className="h-12 rounded-xl border-[#dcdfed] bg-white pl-4 pr-4 pt-6 text-[14px] tabular-nums text-[#0b1024] placeholder:text-[#9b9fb3] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          />
        ),
      })}
      <p id={`${props.id}-hint`} className="mt-1 text-[11px] leading-snug text-[#6f7282]">
        {invalid ? t("headcountInvalid") : t("headcountHint")}
      </p>
    </div>
  );
}

export function StaffEditPositionDialog(props: {
  position: StaffPosition;
  onUpdated: () => void;
} & Close) {
  const t = useTranslations("staffManagement.dialogs");
  const [name, setName] = useState(props.position.name);
  const [categoryKey, setCategoryKey] = useState<PositionCategory>(
    props.position.categoryKey
  );
  const [headcount, setHeadcount] = useState(
    props.position.plannedHeadcount == null ? "" : String(props.position.plannedHeadcount)
  );
  const [pending, setPending] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  async function submit() {
    if (name.trim().length < 2) {
      toast.error(t("positionNameRequired"));
      return;
    }
    const plannedHeadcount = parseHeadcountInput(headcount);
    if (!plannedHeadcount.ok) {
      toast.error(t("headcountInvalid"));
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/positions/${props.position.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), categoryKey, plannedHeadcount: plannedHeadcount.value }),
      });
      if (!res.ok) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("positionUpdated"));
      props.onUpdated();
    } finally {
      setPending(false);
    }
  }

  async function deletePos() {
    setPending(true);
    try {
      const res = await fetch(`/api/positions/${props.position.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error(t("deleteFailed"));
        return;
      }
      toast.success(t("positionDeleted"));
      props.onUpdated();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          t("editPositionTitle"),
          <div className="space-y-4">
            {floatingLabel({
              id: "edit-parent",
              label: t("parentCategory"),
              children: (
                <select
                  id="edit-parent"
                  value={categoryKey}
                  onChange={(e) => setCategoryKey(e.target.value as PositionCategory)}
                  className="h-12 w-full rounded-xl border border-[#dcdfed] bg-[#f5f6ff] px-4 pt-6 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                >
                  <option value="management">{t("management")}</option>
                  <option value="staff">{t("employees")}</option>
                </select>
              ),
            })}
            {floatingLabel({
              id: "edit-pos-name",
              label: t("position"),
              children: (
                <Input
                  id="edit-pos-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 rounded-xl border-[#dcdfed] bg-white pl-4 pr-4 pt-6 text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                />
              ),
            })}
            <HeadcountField id="edit-pos-headcount" value={headcount} onChange={setHeadcount} />
          </div>,
          <div className="flex w-full items-center justify-between">
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={pending}
              className="text-[13px] font-medium text-[#d2453d] hover:underline disabled:opacity-50"
            >
              {t("deletePosition")}
            </button>
            {primaryBtn(t("save"), submit, pending)}
          </div>
        )}
      </DialogContent>

      {/* Нативный confirm() в приложении Telegram может не показаться —
          кнопка тогда молча не срабатывает (CLAUDE.md §6). */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          setConfirmDeleteOpen(false);
          await deletePos();
        }}
        title={t("deletePositionTitle", { position: props.position.name })}
        description={t("deletePositionDescription")}
        bullets={[
          {
            label: t("deletePositionOnlyEmpty"),
            tone: "warn",
          },
          { label: t("deletePositionIrreversible"), tone: "warn" },
        ]}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        variant="danger"
      />
    </Dialog>
  );
}

type TgInvitePayload = {
  inviteUrl: string;
  qrPngDataUrl: string;
  expiresAt: string;
};

type AddStep =
  | { kind: "form" }
  | { kind: "created"; userId: string; userName: string };

/**
 * Единый двухшаговый диалог «должность → сотрудник».
 *
 * Раньше это были два независимых диалога: создал должность — диалог
 * закрылся, и менеджеру приходилось искать кнопку «Добавить сотрудника».
 * Теперь после создания должности мы остаёмся открытыми и сразу
 * переходим на шаг 2 с предвыбранной должностью — типовой сценарий
 * «нанял человека на новую роль» закрывается без лишних кликов.
 *
 * Телефон на шаге 2 необязателен: обязательность мешала первому
 * заполнению штата (решение владельца 2026-08-27, отклонение от П-8).
 * Автосвязка с TasksFlow сработает позже, когда номер добавят в карточке.
 */
export function StaffAddFlowDialog(props: {
  initialStep: 1 | 2;
  categoryKey: PositionCategory;
  positions: StaffPosition[];
  initialPositionId?: string | null;
  /** Типовые названия должностей для сферы организации (шаг 1). */
  positionSuggestions?: Array<{ id: string; name: string }>;
  /** Интеграция TasksFlow уже подключена — промо не показываем. */
  hasTasksflowIntegration?: boolean;
  /** Точки организации и включён ли режим точек — чипы «Точки». */
  buildings?: BuildingOption[];
  perLocationJournals?: boolean;
  /** Точки нового сотрудника по умолчанию — активная точка менеджера. */
  defaultBuildingIds?: string[];
  /** Должность создана: обновить список, но диалог оставить открытым. */
  onPositionCreated?: () => void;
  /**
   * Сотрудник создан: обновить список. `positionId` нужен странице,
   * чтобы раскрыть и подсветить нужную должность в аккордеоне.
   */
  onCreated: (result?: { positionId: string }) => void;
} & Close) {
  const { toastApiError } = useBillingError();
  const t = useTranslations("staffManagement.dialogs");
  const tPositionSuggestion = useTranslations("staffManagement.positionSuggestions");
  type PositionSuggestionKey = keyof MessageContract["staffManagement"]["positionSuggestions"];
  const [step, setStep] = useState<1 | 2>(props.initialStep);

  // Шаг 1.
  const [posName, setPosName] = useState("");
  const [posHeadcount, setPosHeadcount] = useState("");
  const [posPending, setPosPending] = useState(false);
  // Только что созданные должности — props.positions обновится лишь
  // после router.refresh(), а выбор в select нужен мгновенно.
  const [createdPositions, setCreatedPositions] = useState<StaffPosition[]>([]);

  const positions = useMemo(() => {
    const byId = new Map<string, StaffPosition>();
    for (const p of [...props.positions, ...createdPositions]) byId.set(p.id, p);
    return [...byId.values()];
  }, [props.positions, createdPositions]);

  // Шаг 2.
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [positionId, setPositionId] = useState(
    () =>
      props.initialPositionId ??
      props.positions.find((p) => p.categoryKey === props.categoryKey)?.id ??
      props.positions[0]?.id ??
      ""
  );
  // Замок от двойного тапа по «Добавить»: setState применяется к
  // следующему рендеру, и два клика подряд заводили двух сотрудников.
  const { busy: pending, acquire, release } = useSubmitLock();
  const [subStep, setSubStep] = useState<AddStep>({ kind: "form" });
  // Выходные нового сотрудника: по умолчанию Сб+Вс, чтобы график не
  // пришлось прокликивать руками сразу после найма.
  const [buildingIds, setBuildingIds] = useState<string[]>(
    () => props.defaultBuildingIds ?? []
  );
  const [weeklyDaysOff, setWeeklyDaysOff] = useState<number[]>([
    ...DEFAULT_WEEKLY_DAYS_OFF,
  ]);
  // Те же галки прав, что в карточке сотрудника; по умолчанию сняты.
  const [keepsCore, setKeepsCore] = useState(false);
  const [manageSettings, setManageSettings] = useState(false);
  // Подсказки должностей: сервер уже вычел заведённые, здесь дополнительно
  // убираем созданные в этой же сессии диалога.
  const [showAllHints, setShowAllHints] = useState(false);
  const createdNames = useMemo(
    () => new Set(createdPositions.map((p) => p.name.trim().toLowerCase())),
    [createdPositions]
  );
  const positionHints = useMemo(
    () =>
      (props.positionSuggestions ?? []).filter(
        ({ name }) => !createdNames.has(name.trim().toLowerCase())
      ),
    [props.positionSuggestions, createdNames]
  );

  function closeAll() {
    props.onClose();
  }

  async function submitPosition() {
    const name = posName.trim();
    if (name.length < 2) {
      toast.error(t("addFlow.positionNameRequired"));
      return;
    }

    // Такая должность уже есть — не ругаемся и не плодим дубль, а просто
    // берём её и идём к сотруднику. Человек набрал «Повар» и нажал
    // «Добавить»: он хочет добавить повара, а не узнать, что повар уже
    // заведён и надо было выбрать его из списка.
    const existing = [...props.positions, ...createdPositions].find(
      (position) =>
        position.categoryKey === props.categoryKey &&
        position.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      setPositionId(existing.id);
      setPosName("");
      toast.success(t("addFlow.positionAlreadyExists", { name: existing.name }));
      setStep(2);
      return;
    }

    const plannedHeadcount = parseHeadcountInput(posHeadcount);
    if (!plannedHeadcount.ok) {
      toast.error(t("headcountInvalid"));
      return;
    }

    setPosPending(true);
    try {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          categoryKey: props.categoryKey,
          ...(plannedHeadcount.value !== null ? { plannedHeadcount: plannedHeadcount.value } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { position?: StaffPosition; error?: string }
        | null;
      if (!res.ok || !data?.position) {
        toast.error(
          data?.error === "Такая должность уже существует" || data?.error === "Должность с таким названием уже существует"
            ? t("addFlow.positionAlreadyExists", { name })
            : t("addFlow.positionCreateFailed")
        );
        return;
      }
      toast.success(t("addFlow.positionCreated"));
      setCreatedPositions((prev) => [...prev, data.position as StaffPosition]);
      setPositionId(data.position.id);
      setPosName("");
      setPosHeadcount("");
      props.onPositionCreated?.();
      setStep(2);
    } finally {
      setPosPending(false);
    }
  }

  async function submitEmployee() {
    if (!positionId) {
      toast.error(t("addFlow.createPositionFirst"));
      setStep(1);
      return;
    }
    if (fullName.trim().length < 2) {
      toast.error(t("addFlow.nameRequired"));
      return;
    }
    if (!acquire()) return;
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobPositionId: positionId,
          fullName: fullName.trim(),
          weeklyDaysOff: normalizeWeeklyDaysOff(weeklyDaysOff),
          buildingIds,
          keepsCoreJournals: keepsCore,
          canManageSettings: manageSettings,
          // Телефон необязателен — пустую строку не отправляем вовсе.
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { user?: { id: string; name: string }; error?: string }
        | null;
      if (!res.ok || !data?.user) {
        // Лимит бесплатного тарифа — с кнопкой «Оплатить».
        if (isBillingLimitError(data)) toastApiError(data, t("addFlow.employeeCreateFailed"));
        else toast.error(t("addFlow.employeeCreateFailed"));
        return;
      }
      toast.success(t("addFlow.employeeAdded"));
      // Список обновляем сразу, но диалог держим открытым: менеджер
      // может тут же выдать доступ или приглашение в Telegram.
      props.onCreated({ positionId });
      setSubStep({
        kind: "created",
        userId: data.user.id,
        userName: data.user.name,
      });
    } finally {
      release();
    }
  }

  if (subStep.kind === "created") {
    const created = subStep;
    return (
      <Dialog open={props.open} onOpenChange={(v) => !v && closeAll()}>
        <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
          {shell(
            t("addFlow.employeeAdded"),
            <div className="space-y-3 text-[14px] leading-5 text-[#0b1024]">
              <p>
                {t.rich("addFlow.addedToStaff", { name: created.userName, b: (chunks) => <b>{chunks}</b> })}
              </p>
              <p className="text-[#6f7282]">
                {t("addFlow.accessInstructions")}
              </p>
            </div>,
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={closeAll}
                disabled={pending}
                className="h-11 rounded-xl"
              >
                {t("addFlow.done")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  if (step === 1) {
    return (
      <Dialog open={props.open} onOpenChange={(v) => !v && closeAll()}>
        <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
          {shell(
            // Название группы в заголовке: без него было непонятно,
            // куда именно ляжет новая должность — в «Руководство»
            // или в «Сотрудники».
            t("addFlow.addPositionTitle", { category: t(`category.${props.categoryKey}`) }),
            <div className="space-y-3">
              {floatingLabel({
                id: "pos-name",
                label: t("position"),
                children: (
                  <Input
                    id="pos-name"
                    value={posName}
                    onChange={(e) => setPosName(e.target.value)}
                    placeholder={t("addFlow.positionPlaceholder")}
                    className="h-12 rounded-xl border-[#dcdfed] bg-[#f5f6ff] pl-4 pr-4 pt-6 text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  />
                ),
              })}
              {positionHints.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
                    {t("addFlow.commonPositions")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(showAllHints
                      ? positionHints
                      : positionHints.slice(0, POSITION_HINTS_VISIBLE)
                    ).map((hint) => (
                      <button
                        key={hint.id}
                        type="button"
                        // Подставляем название в поле — его можно
                        // поправить перед сохранением.
                        onClick={() => setPosName(hint.name)}
                        className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
                          posName.trim() === hint.name
                            ? "bg-[#5566f6] text-white"
                            : "bg-[#f5f6ff] text-[#3848c7] hover:bg-[#eef1ff]"
                        }`}
                      >
                        {tPositionSuggestion(hint.id as PositionSuggestionKey)}
                      </button>
                    ))}
                    {!showAllHints &&
                    positionHints.length > POSITION_HINTS_VISIBLE ? (
                      <button
                        type="button"
                        onClick={() => setShowAllHints(true)}
                        className="rounded-full px-3 py-1 text-[12px] text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                      >
                        {t("addFlow.moreSuggestions", { count: positionHints.length - POSITION_HINTS_VISIBLE })}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <HeadcountField id="pos-headcount" value={posHeadcount} onChange={setPosHeadcount} />
              {positions.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="text-[13px] font-medium text-[#5566f6] transition-colors hover:text-[#3848c7]"
                >
                  {t("addFlow.skipPosition")}
                </button>
              ) : null}
            </div>,
            primaryBtn(t("addFlow.add"), submitPosition, posPending),
            { eyebrow: t("addFlow.step", { current: 1 }) }
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && closeAll()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          t("addFlow.addEmployeeTitle"),
          <div className="space-y-4">
            {floatingLabel({
              id: "add-emp-pos",
              label: t("position"),
              children: (
                <select
                  id="add-emp-pos"
                  value={positionId}
                  onChange={(e) => {
                    // Служебное значение — уводит на шаг 1, чтобы не
                    // закрывать форму ради создания новой должности.
                    if (e.target.value === NEW_POSITION_OPTION) {
                      setStep(1);
                      return;
                    }
                    setPositionId(e.target.value);
                  }}
                  className="h-12 w-full rounded-xl border border-[#dcdfed] bg-[#f5f6ff] px-4 pt-6 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                >
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.categoryKey === "management"
                        ? `${t("category.management")} · `
                        : p.categoryKey === "commission"
                          ? `${t("category.commission")} · `
                          : `${t("category.staff")} · `}
                      {p.name}
                    </option>
                  ))}
                  <option value={NEW_POSITION_OPTION}>
                    {t("addFlow.newPositionOption")}
                  </option>
                </select>
              ),
            })}
            {/* ФИО и телефон в одну строку: два коротких поля друг под
                другом растягивали шаг на лишний экран. На узких телефонах
                всё равно переносим — вдвоём они там не помещаются. */}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t("addFlow.namePlaceholder")}
                className="h-12 rounded-xl border-[#dcdfed] bg-white text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              />
              <Input
                type="tel"
                {...phoneInputProps(phone, setPhone)}
                placeholder={t("addFlow.phonePlaceholder")}
                autoComplete="tel"
                className="h-12 rounded-xl border-[#dcdfed] bg-white text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              />
            </div>
            <TasksFlowPromoHint
              campaign="staff_add"
              hasIntegration={props.hasTasksflowIntegration}
            />
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
                {t("addFlow.daysOff")}
              </div>
              <WeekdayChips
                value={weeklyDaysOff}
                onChange={setWeeklyDaysOff}
                ariaLabel={t("addFlow.daysOffAria")}
              />
              <p className="text-[11px] leading-snug text-[#6f7282]">
                {t("addFlow.daysOffHint")}
              </p>
            </div>
            {props.perLocationJournals ? (
              <BuildingChips
                buildings={props.buildings ?? []}
                value={buildingIds}
                onChange={setBuildingIds}
                ariaLabel={t("addFlow.buildingsAria")}
              />
            ) : null}
            <FlagCheckbox
              checked={keepsCore}
              onChange={setKeepsCore}
              label={t("addFlow.keepsCoreLabel")}
              hint={t("addFlow.keepsCoreHint")}
              testId="staff-add-keeps-core-journals"
            />
            <FlagCheckbox
              checked={manageSettings}
              onChange={setManageSettings}
              label={t("addFlow.manageSettingsLabel")}
              hint={t("addFlow.manageSettingsHint")}
              testId="staff-add-can-manage-settings"
            />
          </div>,
          primaryBtn(t("addFlow.add"), () => void submitEmployee(), pending),
          {
            eyebrow: t("addFlow.step", { current: 2 }),
            leading: (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="-ml-1 inline-flex w-fit items-center gap-1 rounded-lg px-1 py-0.5 text-[13px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024]"
              >
                <ChevronLeft className="size-4" />
                {t("back")}
              </button>
            ),
          }
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Диалог редактирования ФИО и телефона сотрудника. Пароль / почта /
 * роль / должность тут не трогаются — это отдельные более глубокие
 * действия через /settings/users/[id] (TBD). Этот диалог закрывает
 * частый кейс «опечатался в ФИО — надо исправить» одним кликом.
 */
export function StaffEditEmployeeDialog(props: {
  employee: StaffEmployee;
  pending: boolean;
  /** Точки организации и включён ли режим точек — чипы «Точки». */
  buildings?: BuildingOption[];
  perLocationJournals?: boolean;
  onSave: (patch: {
    name?: string;
    phone?: string | null;
    contactEmail?: string | null;
    weeklyDaysOff?: number[];
    buildingIds?: string[];
    canEditBrakerageDishes?: boolean;
    keepsCoreJournals?: boolean;
    canManageSettings?: boolean;
  }) => void;
  /** Открыть окно выдачи доступа вместо этого диалога. */
  onOpenAccess?: () => void;
} & Close) {
  const t = useTranslations("staffManagement.dialogs");
  const { employee, open, onClose, pending, onSave, onOpenAccess } = props;
  const [name, setName] = useState(employee.name);
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [contactEmail, setContactEmail] = useState(employee.contactEmail ?? "");
  const [weeklyDaysOff, setWeeklyDaysOff] = useState<number[]>(
    () => normalizeWeeklyDaysOff(employee.weeklyDaysOff)
  );
  const savedWeeklyDaysOff = normalizeWeeklyDaysOff(employee.weeklyDaysOff);
  const [buildingIds, setBuildingIds] = useState<string[]>(
    () => employee.buildingIds ?? []
  );
  const [canEditDishes, setCanEditDishes] = useState(employee.canEditBrakerageDishes === true);
  const [keepsCore, setKeepsCore] = useState(employee.keepsCoreJournals === true);
  const [manageSettings, setManageSettings] = useState(employee.canManageSettings === true);

  // Reset local state when dialog opens on a different employee.
  useEffect(() => {
    if (open) {
      setName(employee.name);
      setPhone(employee.phone ?? "");
      setContactEmail(employee.contactEmail ?? "");
      setWeeklyDaysOff(normalizeWeeklyDaysOff(employee.weeklyDaysOff));
      setBuildingIds(employee.buildingIds ?? []);
      setCanEditDishes(employee.canEditBrakerageDishes === true);
      setKeepsCore(employee.keepsCoreJournals === true);
      setManageSettings(employee.canManageSettings === true);
    }
  }, [
    employee.canEditBrakerageDishes,
    employee.keepsCoreJournals,
    employee.canManageSettings,
    open,
    employee.id,
    employee.name,
    employee.phone,
    employee.contactEmail,
    employee.weeklyDaysOff,
    employee.buildingIds,
  ]);

  function submit() {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      toast.error(t("editEmployee.nameRequired"));
      return;
    }
    const trimmedEmail = contactEmail.trim();
    if (trimmedEmail && !CONTACT_EMAIL_RE.test(trimmedEmail)) {
      toast.error(t("editEmployee.emailInvalid"));
      return;
    }
    const patch: {
      name?: string;
      phone?: string | null;
      contactEmail?: string | null;
      weeklyDaysOff?: number[];
      buildingIds?: string[];
      canEditBrakerageDishes?: boolean;
      keepsCoreJournals?: boolean;
      canManageSettings?: boolean;
    } = {};
    if (trimmedEmail !== (employee.contactEmail ?? "")) {
      patch.contactEmail = trimmedEmail === "" ? null : trimmedEmail;
    }
    if (canEditDishes !== (employee.canEditBrakerageDishes === true)) {
      patch.canEditBrakerageDishes = canEditDishes;
    }
    if (keepsCore !== (employee.keepsCoreJournals === true)) patch.keepsCoreJournals = keepsCore;
    if (manageSettings !== (employee.canManageSettings === true)) patch.canManageSettings = manageSettings;
    const nextWeekly = normalizeWeeklyDaysOff(weeklyDaysOff);
    if (nextWeekly.join(",") !== savedWeeklyDaysOff.join(",")) {
      patch.weeklyDaysOff = nextWeekly;
    }
    const savedBuildings = [...(employee.buildingIds ?? [])].sort().join(",");
    if ([...buildingIds].sort().join(",") !== savedBuildings) {
      patch.buildingIds = buildingIds;
    }
    if (trimmedName !== employee.name) patch.name = trimmedName;
    const trimmedPhone = phone.trim();
    const currentPhone = employee.phone ?? "";
    if (trimmedPhone !== currentPhone) {
      patch.phone = trimmedPhone === "" ? null : trimmedPhone;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    onSave(patch);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          t("editEmployee.title", { name: employee.name }),
          <div className="space-y-4">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("editEmployee.namePlaceholder")}
              className="h-12 rounded-xl border-[#dcdfed] bg-white text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            />
            <div>
              <Input
                type="tel"
                {...phoneInputProps(phone, setPhone)}
                placeholder={t("editEmployee.phonePlaceholder", { format: RU_PHONE_PLACEHOLDER })}
                autoComplete="tel"
                className="h-12 rounded-xl border-[#dcdfed] bg-white text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              />
              <p className="mt-1 text-[11px] leading-snug text-[#6f7282]">
                {t("editEmployee.phoneHint")}
              </p>
            </div>
            <div>
              <Input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder={t("editEmployee.emailPlaceholder")}
                autoComplete="email"
                inputMode="email"
                data-testid="staff-contact-email"
                aria-invalid={
                  contactEmail.trim() !== "" && !CONTACT_EMAIL_RE.test(contactEmail.trim()) ? true : undefined
                }
                className="h-12 rounded-xl border-[#dcdfed] bg-white text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 aria-[invalid=true]:border-[#e6a19a]"
              />
              <p className="mt-1 text-[11px] leading-snug text-[#6f7282]">
                {contactEmail.trim() !== "" && !CONTACT_EMAIL_RE.test(contactEmail.trim())
                  ? t("editEmployee.emailInvalid")
                  : t("editEmployee.emailHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
                {t("addFlow.daysOff")}
              </div>
              <WeekdayChips
                value={weeklyDaysOff}
                onChange={setWeeklyDaysOff}
                ariaLabel={t("editEmployee.daysOffAria", { name: employee.name })}
              />
              <p className="text-[11px] leading-snug text-[#6f7282]">
                {t("editEmployee.daysOffHint")}
              </p>
            </div>
            {props.perLocationJournals ? (
              <BuildingChips
                buildings={props.buildings ?? []}
                value={buildingIds}
                onChange={setBuildingIds}
                ariaLabel={t("editEmployee.buildingsAria", { name: employee.name })}
              />
            ) : null}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors duration-150 hover:bg-[#f5f6ff]">
              <input
                type="checkbox"
                checked={canEditDishes}
                onChange={(event) => setCanEditDishes(event.target.checked)}
                className="mt-0.5 size-4 accent-[#5566f6]"
              />
              <span>
                <span className="block text-[14px] font-medium text-[#0b1024]">
                  {t("editEmployee.dishesLabel")}
                </span>
                <span className="block text-[12px] leading-snug text-[#6f7282]">
                  {t("editEmployee.dishesHint")}
                </span>
              </span>
            </label>
            <FlagCheckbox
              checked={keepsCore}
              onChange={setKeepsCore}
              label={t("addFlow.keepsCoreLabel")}
              hint={t("addFlow.keepsCoreHint")}
              testId="staff-keeps-core-journals"
            />
            <FlagCheckbox
              checked={manageSettings}
              onChange={setManageSettings}
              label={t("addFlow.manageSettingsLabel")}
              hint={t("editEmployee.manageSettingsHint")}
              testId="staff-can-manage-settings"
            />
            {/* PIN для быстрой QR-авторизации — отдельный PATCH, вне общего «Сохранить». */}
            <StaffQrPinField
              key={employee.id}
              employeeId={employee.id}
              hasPin={employee.hasQrPin === true}
              onSave={async (pin) => {
                const response = await fetch(`/api/staff/${employee.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ qrPin: pin }),
                });
                if (!response.ok) throw new Error(t("editEmployee.pinSaveFailed"));
              }}
            />
            <PersonalQrCard employeeId={employee.id} employeeName={employee.name} />
          </div>,
          <>
            {onOpenAccess ? (
              <Button
                type="button"
                variant="outline"
                onClick={onOpenAccess}
                disabled={pending}
                className="w-full border-[#dcdfed] text-[#3848c7] hover:bg-[#f5f6ff] sm:mr-auto sm:w-auto"
              >
                <KeyRound className="size-4" />
                {t("editEmployee.addAccess")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            {primaryBtn(t("save"), submit, pending)}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffTelegramInviteDialog(props: {
  employee: StaffEmployee;
  mode: "invite" | "rebind";
  botUrl: string | null;
  pending: boolean;
  error: string | null;
  invite: TgInvitePayload | null;
} & Close) {
  const t = useTranslations("staffManagement.dialogs.telegramInvite");
  const { employee, mode, botUrl, onClose, open, pending, error, invite } = props;
  const [copied, setCopied] = useState(false);
  const setPending = (_value: boolean) => {};
  const setError = (_value: string | null) => {};
  const setInvite = (_value: TgInvitePayload | null) => {};
  const onIssued = () => {};

  useEffect(() => {
    let cancelled = false;

    async function issue() {
      setPending(true);
      setError(null);
      setInvite(null);
      try {
        const res = await fetch(`/api/staff/${employee.id}/invite-tg`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        const data = (await res.json().catch(() => null)) as
          | (TgInvitePayload & { error?: string })
          | null;
        if (!res.ok || !data?.inviteUrl) {
          throw new Error(t("createFailed"));
        }
        if (cancelled) return;
        setInvite({
          inviteUrl: data.inviteUrl,
          qrPngDataUrl: data.qrPngDataUrl,
          expiresAt: data.expiresAt,
        });
        onIssued();
      } catch {
        if (!cancelled) {
          setError(
            t("createFailed")
          );
        }
      } finally {
        if (!cancelled) {
          setPending(false);
        }
      }
    }

    if (open) {
      void issue();
    }

    return () => {
      cancelled = true;
    };
  }, [employee.id, mode, onIssued, open, t]);

  async function copyInviteUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  const title =
    mode === "rebind"
      ? t("rebindTitle", { name: employee.name })
      : t("inviteTitle", { name: employee.name });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          title,
          pending ? (
            <div className="py-8 text-center text-[14px] text-[#6f7282]">
              {t("loading")}
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#d2453d]">
                {error}
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={onClose} className="h-11 rounded-xl">
                  {t("close")}
                </Button>
              </div>
            </div>
          ) : invite ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#eef0fb] bg-[#f8f9ff] p-3 text-[13px] leading-5 text-[#5464ff]">
                {mode === "rebind"
                  ? t("rebindReady")
                  : t("inviteReady")}
              </div>
              <div className="flex justify-center">
                <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
                  <Image
                    src={invite.qrPngDataUrl}
                    alt={t("qrAlt")}
                    width={220}
                    height={brandQrHeightFor(220)}
                    className="h-auto"
                    unoptimized
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={invite.inviteUrl}
                  className="h-11 rounded-xl border-[#dcdfed] bg-white text-[13px] text-[#0b1024]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyInviteUrl(invite.inviteUrl)}
                  className="h-11 rounded-xl px-3"
                >
                  <Copy className="size-4" />
                  {copied ? t("copied") : t("copy")}
                </Button>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-11 rounded-xl"
                >
                  {t("done")}
                </Button>
                <Button
                  type="button"
                  asChild
                  className="h-11 rounded-xl bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
                >
                  <a href={invite.inviteUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1.5 size-4" />
                    {t("openTelegram")}
                  </a>
                </Button>
                {employee.telegramLinked && botUrl ? (
                  <Button type="button" variant="outline" asChild className="h-11 rounded-xl">
                    <a href={botUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1.5 size-4" />
                      {t("openBotChat")}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffArchiveDialog(props: {
  employee: StaffEmployee;
  onConfirm: () => void;
} & Close) {
  const t = useTranslations("staffManagement.dialogs.archive");
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          t("title", { name: props.employee.name }),
          <p className="text-[13px] text-[#6f7282]">
            {t("description")}
          </p>,
          primaryBtn(t("confirm"), props.onConfirm)
        )}
      </DialogContent>
    </Dialog>
  );
}

/** «1 запись / 2 записи / 5 записей» журналов. */
export function StaffDeleteBlockedDialog(props: {
  employee: StaffEmployee;
  /// Сколько записей журналов ссылается на сотрудника — API отдаёт это
  /// число в ответе 409, а диалог раньше его не показывал.
  references?: number;
} & Close) {
  const t = useTranslations("staffManagement.dialogs.deleteBlocked");
  const references = props.references ?? 0;
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="max-w-[calc(100vw-1rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[480px]">
        {shell(
          t("title", { name: props.employee.name }),
          <div className="space-y-2 text-[13px] text-[#6f7282]">
            <p>{t("cannotDelete")}</p>
            {references > 0 ? (
              <p className="font-medium text-[#3c4053]">
                {t("references", { count: references })}
              </p>
            ) : null}
            <p>{t("archiveAdvice")}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffIikoDialog(props: Close) {
  const t = useTranslations("staffManagement.dialogs.iiko");
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          t("title"),
          <p className="text-[13px] text-[#6f7282]">
            {t("description")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffInstructionDialog(props: Close) {
  const t = useTranslations("staffManagement.dialogs.instruction");
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="max-w-[calc(100vw-1rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[560px]">
        {shell(
          t("title"),
          <div className="space-y-3 text-[13px] leading-[1.55] text-[#3c4053]">
            <p>
              {t("intro")}
            </p>
            <p>
              {t.rich("schedule", { b: (chunks) => <b>{chunks}</b> })}
            </p>
            <p>
              {t.rich("archive", { b: (chunks) => <b>{chunks}</b> })}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffAddPeriodDialog(props: {
  kind: "vacation" | "sick_leave" | "dismissal";
  positions: StaffPosition[];
  employees: StaffEmployee[];
  onConfirm: (payload: {
    kind: "vacation" | "sick_leave" | "dismissal";
    userId: string;
    dateFrom: string;
    dateTo?: string;
  }) => void;
} & Close) {
  const t = useTranslations("staffManagement.dialogs.addPeriod");
  const [positionId, setPositionId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [dateTo, setDateTo] = useState<string>("");
  const [pending, setPending] = useState(false);

  const employeesForPosition = useMemo(() => {
    if (!positionId) return [] as StaffEmployee[];
    return props.employees.filter((e) => e.jobPositionId === positionId);
  }, [props.employees, positionId]);

  function addDays(iso: string, days: number): string {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function submit() {
    if (!userId) {
      toast.error(t("employeeRequired"));
      return;
    }
    if (!dateFrom) {
      toast.error(t("dateRequired"));
      return;
    }
    if (props.kind !== "dismissal") {
      if (!dateTo) {
        toast.error(t("endDateRequired"));
        return;
      }
      if (dateTo < dateFrom) {
        toast.error(t("dateRangeInvalid"));
        return;
      }
    }
    setPending(true);
    try {
      await props.onConfirm({
        kind: props.kind,
        userId,
        dateFrom,
        dateTo: props.kind === "dismissal" ? undefined : dateTo,
      });
    } finally {
      setPending(false);
    }
  }

  // Заголовок по вкладке: раньше отпуск и больничный назывались
  // безлико «Добавление новой строки».
  const title =
    props.kind === "dismissal"
      ? t("dismissalTitle")
      : props.kind === "vacation"
        ? t("vacationTitle")
        : t("sickLeaveTitle");
  const fromLabel =
    props.kind === "vacation"
      ? t("vacationFrom")
      : props.kind === "sick_leave"
        ? t("sickLeaveFrom")
        : t("dismissalFrom");
  const toLabel =
    props.kind === "vacation"
      ? t("vacationTo")
      : t("sickLeaveTo");

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          title,
          <div className="space-y-4">
            {floatingLabel({
              id: "period-pos",
              label: t("position"),
              children: (
                <select
                  id="period-pos"
                  value={positionId}
                  onChange={(e) => {
                    setPositionId(e.target.value);
                    setUserId("");
                  }}
                  className="h-12 w-full rounded-xl border border-[#dcdfed] bg-[#f5f6ff] px-4 pt-6 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                >
                  <option value="">{t("selectValue")}</option>
                  {props.positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ),
            })}
            {positionId ? (
              floatingLabel({
                id: "period-user",
                label: t("employee"),
                children: (
                  <select
                    id="period-user"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    className="h-12 w-full rounded-xl border border-[#dcdfed] bg-white px-4 pt-6 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  >
                    <option value="">{t("selectValue")}</option>
                    {employeesForPosition.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                ),
              })
            ) : null}

            {floatingLabel({
              id: "period-from",
              label: fromLabel,
              children: (
                <Input
                  id="period-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-12 rounded-xl border-[#dcdfed] bg-white px-4 pt-6 text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                />
              ),
            })}
            {props.kind !== "dismissal" ? (
              <>
                {floatingLabel({
                  id: "period-to",
                  label: toLabel,
                  children: (
                    <Input
                      id="period-to"
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="h-12 rounded-xl border-[#dcdfed] bg-white px-4 pt-6 text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                    />
                  ),
                })}
                <div className="flex flex-wrap gap-3 text-[13px] text-[#5566f6]">
                  {[7, 14, 21, 28].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDateTo(addDays(dateFrom, d))}
                      className="hover:underline"
                    >
                      +{formatDaysRu(d)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>,
          primaryBtn(t("add"), submit, pending),
          { description: t("description") }
        )}
      </DialogContent>
    </Dialog>
  );
}
