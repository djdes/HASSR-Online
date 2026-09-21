"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
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

export function StaffEditPositionDialog(props: {
  position: StaffPosition;
  onUpdated: () => void;
} & Close) {
  const [name, setName] = useState(props.position.name);
  const [categoryKey, setCategoryKey] = useState<PositionCategory>(
    props.position.categoryKey
  );
  const [pending, setPending] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  async function submit() {
    if (name.trim().length < 2) {
      toast.error("Введите название");
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/positions/${props.position.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), categoryKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Не удалось сохранить");
        return;
      }
      toast.success("Должность обновлена");
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
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Не удалось удалить");
        return;
      }
      toast.success("Должность удалена");
      props.onUpdated();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          "Редактирование должности",
          <div className="space-y-4">
            {floatingLabel({
              id: "edit-parent",
              label: "Родительская рубрика",
              children: (
                <select
                  id="edit-parent"
                  value={categoryKey}
                  onChange={(e) => setCategoryKey(e.target.value as PositionCategory)}
                  className="h-12 w-full rounded-xl border border-[#dcdfed] bg-[#f5f6ff] px-4 pt-6 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                >
                  <option value="management">Руководство</option>
                  <option value="staff">Сотрудники</option>
                </select>
              ),
            })}
            {floatingLabel({
              id: "edit-pos-name",
              label: "Должность",
              children: (
                <Input
                  id="edit-pos-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 rounded-xl border-[#dcdfed] bg-white pl-4 pr-4 pt-6 text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                />
              ),
            })}
          </div>,
          <div className="flex w-full items-center justify-between">
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={pending}
              className="text-[13px] font-medium text-[#d2453d] hover:underline disabled:opacity-50"
            >
              Удалить должность
            </button>
            {primaryBtn("Сохранить", submit, pending)}
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
        title={`Удалить должность «${props.position.name}»?`}
        description="Должность исчезнет из справочника и из выпадающих списков при добавлении сотрудников."
        bullets={[
          {
            label: "Удалить получится, только если на должности никого нет",
            tone: "warn",
          },
          { label: "Вернуть удалённую должность нельзя", tone: "warn" },
        ]}
        confirmLabel="Удалить"
        cancelLabel="Отмена"
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
  positionSuggestions?: string[];
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
  const [step, setStep] = useState<1 | 2>(props.initialStep);

  // Шаг 1.
  const [posName, setPosName] = useState("");
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
        (name) => !createdNames.has(name.trim().toLowerCase())
      ),
    [props.positionSuggestions, createdNames]
  );

  function closeAll() {
    props.onClose();
  }

  async function submitPosition() {
    const name = posName.trim();
    if (name.length < 2) {
      toast.error("Введите название");
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
      toast.success(`Должность «${existing.name}» уже есть — добавляем сотрудника`);
      setStep(2);
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
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { position?: StaffPosition; error?: string }
        | null;
      if (!res.ok || !data?.position) {
        toast.error(data?.error ?? "Не удалось создать");
        return;
      }
      toast.success("Должность создана");
      setCreatedPositions((prev) => [...prev, data.position as StaffPosition]);
      setPositionId(data.position.id);
      setPosName("");
      props.onPositionCreated?.();
      setStep(2);
    } finally {
      setPosPending(false);
    }
  }

  async function submitEmployee() {
    if (!positionId) {
      toast.error("Сначала создайте должность");
      setStep(1);
      return;
    }
    if (fullName.trim().length < 2) {
      toast.error("Введите ФИО");
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
          // Телефон необязателен — пустую строку не отправляем вовсе.
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { user?: { id: string; name: string }; error?: string }
        | null;
      if (!res.ok || !data?.user) {
        toast.error(data?.error ?? "Не удалось создать");
        return;
      }
      toast.success("Сотрудник добавлен");
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
            "Сотрудник добавлен",
            <div className="space-y-3 text-[14px] leading-5 text-[#0b1024]">
              <p>
                <b>{created.userName}</b> добавлен в штат.
              </p>
              <p className="text-[#6f7282]">
                Логин с паролем, вход через Telegram и доступ к журналам
                выдаются в карточке сотрудника — кнопка «Добавить доступ» в
                окне редактирования.
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
                Готово
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
            `Добавление должности · ${
              props.categoryKey === "management"
                ? "Руководство"
                : props.categoryKey === "commission"
                  ? "Комиссия"
                  : "Сотрудники"
            }`,
            <div className="space-y-3">
              {floatingLabel({
                id: "pos-name",
                label: "Должность",
                children: (
                  <Input
                    id="pos-name"
                    value={posName}
                    onChange={(e) => setPosName(e.target.value)}
                    placeholder="Например, «Повар холодного цеха»"
                    className="h-12 rounded-xl border-[#dcdfed] bg-[#f5f6ff] pl-4 pr-4 pt-6 text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  />
                ),
              })}
              {positionHints.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
                    Частые должности
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(showAllHints
                      ? positionHints
                      : positionHints.slice(0, POSITION_HINTS_VISIBLE)
                    ).map((hint) => (
                      <button
                        key={hint}
                        type="button"
                        // Подставляем название в поле — его можно
                        // поправить перед сохранением.
                        onClick={() => setPosName(hint)}
                        className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
                          posName.trim() === hint
                            ? "bg-[#5566f6] text-white"
                            : "bg-[#f5f6ff] text-[#3848c7] hover:bg-[#eef1ff]"
                        }`}
                      >
                        {hint}
                      </button>
                    ))}
                    {!showAllHints &&
                    positionHints.length > POSITION_HINTS_VISIBLE ? (
                      <button
                        type="button"
                        onClick={() => setShowAllHints(true)}
                        className="rounded-full px-3 py-1 text-[12px] text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                      >
                        ещё {positionHints.length - POSITION_HINTS_VISIBLE}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {positions.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="text-[13px] font-medium text-[#5566f6] transition-colors hover:text-[#3848c7]"
                >
                  У меня уже есть должность → пропустить
                </button>
              ) : null}
            </div>,
            primaryBtn("Добавить", submitPosition, posPending),
            { eyebrow: "Шаг 1 из 2" }
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && closeAll()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          "Добавление сотрудника",
          <div className="space-y-4">
            {floatingLabel({
              id: "add-emp-pos",
              label: "Должность",
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
                        ? "Руководство · "
                        : p.categoryKey === "commission"
                          ? "Комиссия · "
                          : "Сотрудники · "}
                      {p.name}
                    </option>
                  ))}
                  <option value={NEW_POSITION_OPTION}>
                    + Новая должность…
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
                placeholder="Введите ФИО сотрудника"
                className="h-12 rounded-xl border-[#dcdfed] bg-white text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              />
              <Input
                type="tel"
                {...phoneInputProps(phone, setPhone)}
                placeholder="Телефон · необязательно"
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
                Выходные
              </div>
              <WeekdayChips
                value={weeklyDaysOff}
                onChange={setWeeklyDaysOff}
                ariaLabel="Выходные дни нового сотрудника"
              />
              <p className="text-[11px] leading-snug text-[#6f7282]">
                Нужно для журналов и задач: в выходные ставится «В», задачи
                не приходят. День правится в графике.
              </p>
            </div>
            {props.perLocationJournals ? (
              <BuildingChips
                buildings={props.buildings ?? []}
                value={buildingIds}
                onChange={setBuildingIds}
                ariaLabel="Точки нового сотрудника"
              />
            ) : null}
          </div>,
          primaryBtn("Добавить", () => void submitEmployee(), pending),
          {
            eyebrow: "Шаг 2 из 2",
            leading: (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="-ml-1 inline-flex w-fit items-center gap-1 rounded-lg px-1 py-0.5 text-[13px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024]"
              >
                <ChevronLeft className="size-4" />
                Назад
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
    weeklyDaysOff?: number[];
    buildingIds?: string[];
    canEditBrakerageDishes?: boolean;
  }) => void;
  /** Открыть окно выдачи доступа вместо этого диалога. */
  onOpenAccess?: () => void;
} & Close) {
  const { employee, open, onClose, pending, onSave, onOpenAccess } = props;
  const [name, setName] = useState(employee.name);
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [weeklyDaysOff, setWeeklyDaysOff] = useState<number[]>(
    () => normalizeWeeklyDaysOff(employee.weeklyDaysOff)
  );
  const savedWeeklyDaysOff = normalizeWeeklyDaysOff(employee.weeklyDaysOff);
  const [buildingIds, setBuildingIds] = useState<string[]>(
    () => employee.buildingIds ?? []
  );
  const [canEditDishes, setCanEditDishes] = useState(employee.canEditBrakerageDishes === true);

  // Reset local state when dialog opens on a different employee.
  useEffect(() => {
    if (open) {
      setName(employee.name);
      setPhone(employee.phone ?? "");
      setWeeklyDaysOff(normalizeWeeklyDaysOff(employee.weeklyDaysOff));
      setBuildingIds(employee.buildingIds ?? []);
      setCanEditDishes(employee.canEditBrakerageDishes === true);
    }
  }, [
    employee.canEditBrakerageDishes,
    open,
    employee.id,
    employee.name,
    employee.phone,
    employee.weeklyDaysOff,
    employee.buildingIds,
  ]);

  function submit() {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      toast.error("Введите ФИО (минимум 2 символа)");
      return;
    }
    const patch: {
      name?: string;
      phone?: string | null;
      weeklyDaysOff?: number[];
      buildingIds?: string[];
      canEditBrakerageDishes?: boolean;
    } = {};
    if (canEditDishes !== (employee.canEditBrakerageDishes === true)) {
      patch.canEditBrakerageDishes = canEditDishes;
    }
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
          `Редактировать: ${employee.name}`,
          <div className="space-y-4">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ФИО"
              className="h-12 rounded-xl border-[#dcdfed] bg-white text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            />
            <div>
              <Input
                type="tel"
                {...phoneInputProps(phone, setPhone)}
                placeholder={`Телефон · ${RU_PHONE_PLACEHOLDER}`}
                autoComplete="tel"
                className="h-12 rounded-xl border-[#dcdfed] bg-white text-[14px] text-[#0b1024] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              />
              <p className="mt-1 text-[11px] leading-snug text-[#6f7282]">
                Меняется номер — запустится автосвязка с TasksFlow по
                совпадению телефона. Чтобы очистить телефон, оставьте
                поле пустым.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
                Выходные
              </div>
              <WeekdayChips
                value={weeklyDaysOff}
                onChange={setWeeklyDaysOff}
                ariaLabel={`Выходные дни: ${employee.name}`}
              />
              <p className="text-[11px] leading-snug text-[#6f7282]">
                Правило на каждую неделю. Отдельный день можно переопределить
                в графике выходных.
              </p>
            </div>
            {props.perLocationJournals ? (
              <BuildingChips
                buildings={props.buildings ?? []}
                value={buildingIds}
                onChange={setBuildingIds}
                ariaLabel={`Точки: ${employee.name}`}
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
                  Уполномочен редактировать в бракеражных журналах список блюд
                </span>
                <span className="block text-[12px] leading-snug text-[#6f7282]">
                  По QR журнала видит все блюда за сегодня и может исправить наименование и время. Обычно —
                  заведующая производством.
                </span>
              </span>
            </label>
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
                const data = await response.json().catch(() => null);
                if (!response.ok) throw new Error(data?.error ?? "Не удалось сохранить PIN");
              }}
            />
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
                Добавить доступ
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Отмена
            </Button>
            {primaryBtn("Сохранить", submit, pending)}
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
          throw new Error(data?.error || "Не удалось создать приглашение");
        }
        if (cancelled) return;
        setInvite({
          inviteUrl: data.inviteUrl,
          qrPngDataUrl: data.qrPngDataUrl,
          expiresAt: data.expiresAt,
        });
        onIssued();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Не удалось создать приглашение"
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
  }, [employee.id, mode, onIssued, open]);

  async function copyInviteUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Не удалось скопировать ссылку");
    }
  }

  const title =
    mode === "rebind"
      ? `Перепривязать TG для ${employee.name}`
      : `Пригласить в TG: ${employee.name}`;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          title,
          pending ? (
            <div className="py-8 text-center text-[14px] text-[#6f7282]">
              Готовим ссылку Telegram…
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#d2453d]">
                {error}
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={onClose} className="h-11 rounded-xl">
                  Закрыть
                </Button>
              </div>
            </div>
          ) : invite ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#eef0fb] bg-[#f8f9ff] p-3 text-[13px] leading-5 text-[#5464ff]">
                {mode === "rebind"
                  ? "Ссылка обновлена. Сотрудник увидит ее в уведомлениях сайта, а если Telegram уже был привязан — еще и в сообщении Telegram."
                  : "Ссылка готова. Сотрудник увидит ее в уведомлениях сайта, а вы можете сразу передать ее вручную или показать QR."}
              </div>
              <div className="flex justify-center">
                <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
                  <Image
                    src={invite.qrPngDataUrl}
                    alt="QR-код приглашения в Telegram"
                    width={220}
                    height={220}
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
                  {copied ? "Скопировано" : "Копировать"}
                </Button>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-11 rounded-xl"
                >
                  Готово
                </Button>
                <Button
                  type="button"
                  asChild
                  className="h-11 rounded-xl bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
                >
                  <a href={invite.inviteUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1.5 size-4" />
                    Открыть Telegram
                  </a>
                </Button>
                {employee.telegramLinked && botUrl ? (
                  <Button type="button" variant="outline" asChild className="h-11 rounded-xl">
                    <a href={botUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1.5 size-4" />
                      Открыть чат бота
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
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          `Архивирование сотрудника "${props.employee.name}"`,
          <p className="text-[13px] text-[#6f7282]">
            Сотрудник исчезнет из активных списков и графиков, но останется
            привязан к прежним записям в журналах.
          </p>,
          primaryBtn("В архив", props.onConfirm)
        )}
      </DialogContent>
    </Dialog>
  );
}

/** «1 запись / 2 записи / 5 записей» журналов. */
function pluralJournalRecords(count: number) {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return "записей";
  switch (count % 10) {
    case 1:
      return "запись";
    case 2:
    case 3:
    case 4:
      return "записи";
    default:
      return "записей";
  }
}

export function StaffDeleteBlockedDialog(props: {
  employee: StaffEmployee;
  /// Сколько записей журналов ссылается на сотрудника — API отдаёт это
  /// число в ответе 409, а диалог раньше его не показывал.
  references?: number;
} & Close) {
  const references = props.references ?? 0;
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="max-w-[calc(100vw-1rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[480px]">
        {shell(
          `Удаление сотрудника "${props.employee.name}"`,
          <div className="space-y-2 text-[13px] text-[#6f7282]">
            <p>Данный сотрудник участвует в журналах. Удаление не возможно.</p>
            {references > 0 ? (
              <p className="font-medium text-[#3c4053]">
                На сотрудника ссылаются {references}{" "}
                {pluralJournalRecords(references)} журналов.
              </p>
            ) : null}
            <p>Если сотрудник уволился, то перенесите его в архив.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffIikoDialog(props: Close) {
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          "Заполнение выходных дней из iiko",
          <p className="text-[13px] text-[#6f7282]">
            Для настройки синхронизации с iiko обратитесь к разработчикам сервиса WeSetup.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffInstructionDialog(props: Close) {
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="max-w-[calc(100vw-1rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[560px]">
        {shell(
          "Инструкция по странице «Сотрудники»",
          <div className="space-y-3 text-[13px] leading-[1.55] text-[#3c4053]">
            <p>
              На этой странице вы можете управлять штатом организации: добавлять
              должности, сотрудников, а также вести графики выходных дней,
              отпусков, больничных и увольнений.
            </p>
            <p>
              Все заполненные графики используются <b>только для автозаполнения
              Гигиенического журнала</b> — в соответствующие ячейки журнала
              будут подставляться значения «В», «Отп» или «Б/л».
            </p>
            <p>
              Если сотрудник участвует в уже существующих записях журналов, его
              нельзя удалить — но можно перевести в <b>Архив</b>: запись в
              прежних журналах сохранится, а в активных списках его не будет.
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
      toast.error("Выберите сотрудника");
      return;
    }
    if (!dateFrom) {
      toast.error("Укажите дату");
      return;
    }
    if (props.kind !== "dismissal") {
      if (!dateTo) {
        toast.error("Укажите дату окончания");
        return;
      }
      if (dateTo < dateFrom) {
        toast.error("Дата ПО не может быть раньше С");
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
      ? "Добавление увольнения"
      : props.kind === "vacation"
        ? "Добавление отпуска"
        : "Добавление больничного";
  const fromLabel =
    props.kind === "vacation"
      ? "Дата отпуска С"
      : props.kind === "sick_leave"
        ? "Дата больничного С"
        : "Дата увольнения С";
  const toLabel =
    props.kind === "vacation"
      ? "Дата отпуска ПО"
      : "Дата больничного ПО";

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          title,
          <div className="space-y-4">
            {floatingLabel({
              id: "period-pos",
              label: "Должность",
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
                  <option value="">- Выберите значение -</option>
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
                label: "Сотрудник",
                children: (
                  <select
                    id="period-user"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    className="h-12 w-full rounded-xl border border-[#dcdfed] bg-white px-4 pt-6 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  >
                    <option value="">- Выберите значение -</option>
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
          primaryBtn("Добавить", submit, pending),
          { description: "Выберите сотрудника и даты" }
        )}
      </DialogContent>
    </Dialog>
  );
}
