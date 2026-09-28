"use client";

import {
  BadgePercent,
  CalendarClock,
  History,
  Loader2,
  Pencil,
  Plus,
  Power,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PromoBadge, PromoPrice, formatPriceRub } from "@/components/pricing/promo-price";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  applyPromotion,
  dateToMskInput,
  formatMskDateTime,
  mskInputToDate,
  pickActivePromotion,
  promotionEndHint,
  promotionPhase,
  validatePromotionInput,
  type AppliedPromotion,
  type PromotionAdminRow,
  type PromotionAuditEntry,
} from "@/lib/promo/promotions";
import { cn } from "@/lib/utils";

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const SECTION_LABEL = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";
const OUTLINE_BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

const DAY_MS = 24 * 60 * 60 * 1000;

type FormState = {
  editingId: string | null;
  title: string;
  percent: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  note: string;
};

/** Конец через `days` суток от даты начала, в 00:00 по Москве. */
function endAfterDays(startMsk: string, days: number): string {
  const start = mskInputToDate(startMsk);
  if (!start) return startMsk;
  return `${dateToMskInput(new Date(start.getTime() + days * DAY_MS)).slice(0, 10)}T00:00`;
}

function emptyForm(nowMsk: string): FormState {
  return {
    editingId: null,
    title: "",
    percent: "20",
    startsAt: nowMsk,
    endsAt: endAfterDays(nowMsk, 7),
    active: true,
    note: "",
  };
}

const ACTION_LABELS: Record<string, string> = {
  "promotion.create": "Создана",
  "promotion.update": "Изменена",
  "promotion.enable": "Включена",
  "promotion.disable": "Выключена",
  "promotion.delete": "Удалена",
};

export function PromotionsClient({
  promotions,
  history,
  nowIso,
  nowMsk,
  baseRub,
}: {
  promotions: PromotionAdminRow[];
  history: PromotionAuditEntry[];
  /** «Сейчас» сервера — по нему делим акции на идущие, будущие и прошедшие. */
  nowIso: string;
  nowMsk: string;
  /** Цена подписки по тарифу — для превью «как увидят клиенты». */
  baseRub: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLElement | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(nowMsk));
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PromotionAdminRow | null>(null);

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const windows = useMemo(
    () =>
      promotions.map((p) => ({
        row: p,
        id: p.id,
        title: p.title,
        percent: p.percent,
        startsAt: new Date(p.startsAt),
        endsAt: new Date(p.endsAt),
        active: p.active,
      })),
    [promotions]
  );
  const effective = useMemo(() => pickActivePromotion(windows, now), [windows, now]);
  const groups = useMemo(() => {
    const running = windows.filter((w) => promotionPhase(w, now) === "running");
    const scheduled = windows
      .filter((w) => promotionPhase(w, now) === "scheduled")
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const finished = windows
      .filter((w) => promotionPhase(w, now) === "finished")
      .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
    running.sort((a, b) => Number(b.id === effective?.id) - Number(a.id === effective?.id) || b.percent - a.percent);
    return { running, scheduled, finished };
  }, [windows, now, effective]);

  // Живое превью: как клиенты увидят цену с этой акцией.
  const draft = useMemo(() => {
    const startsAt = mskInputToDate(form.startsAt);
    const endsAt = mskInputToDate(form.endsAt);
    const verdict = validatePromotionInput({
      title: form.title,
      percent: Number(form.percent),
      startsAt: startsAt ?? new Date(Number.NaN),
      endsAt: endsAt ?? new Date(Number.NaN),
      note: form.note,
    });
    if (!verdict.ok) return { error: verdict.error, promotion: null as AppliedPromotion | null };
    return {
      error: null,
      promotion: {
        id: form.editingId ?? "draft",
        title: verdict.value.title,
        percent: verdict.value.percent,
        startsAt: verdict.value.startsAt.toISOString(),
        endsAt: verdict.value.endsAt.toISOString(),
      },
    };
  }, [form]);

  async function submit() {
    if (draft.error) {
      toast.error(draft.error);
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: form.title,
        percent: Number(form.percent),
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        active: form.active,
        note: form.note.trim() || null,
      };
      const response = await fetch(
        form.editingId ? `/api/root/promotions/${form.editingId}` : "/api/root/promotions",
        {
          method: form.editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = (await response.json().catch(() => null)) as { error?: string; promotion?: PromotionAdminRow } | null;
      if (!response.ok || !data?.promotion) throw new Error(data?.error ?? "Не удалось сохранить");
      toast.success(form.editingId ? `Акция «${data.promotion.title}» сохранена` : `Акция «${data.promotion.title}» создана`);
      setForm(emptyForm(dateToMskInput(new Date())));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: PromotionAdminRow) {
    setRowBusy(row.id);
    try {
      const response = await fetch(`/api/root/promotions/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Не удалось изменить");
      toast.success(row.active ? `«${row.title}» выключена` : `«${row.title}» включена`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(row: PromotionAdminRow) {
    const response = await fetch(`/api/root/promotions/${row.id}`, { method: "DELETE" });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      toast.error(data?.error ?? "Не удалось удалить");
      return;
    }
    toast.success(`Акция «${row.title}» удалена`);
    setDeleting(null);
    if (form.editingId === row.id) setForm(emptyForm(dateToMskInput(new Date())));
    router.refresh();
  }

  function edit(row: PromotionAdminRow) {
    setForm({
      editingId: row.id,
      title: row.title,
      percent: String(row.percent),
      startsAt: row.startsAtMsk,
      endsAt: row.endsAtMsk,
      active: row.active,
      note: row.note ?? "",
    });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const effectiveRow = effective?.row ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">
        {/* Что видят клиенты прямо сейчас. */}
        <section className={CARD} data-testid="promotions-now">
          <div className={SECTION_LABEL}>Сейчас на сайте</div>
          {effectiveRow ? (
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[16px] font-semibold text-[#0b1024]">«{effectiveRow.title}»</div>
                <p className="mt-1 text-[13px] text-[#6f7282]">
                  {promotionEndHint(effectiveRow)}
                  {groups.running.filter((w) => w.active).length > 1
                    ? " · идёт несколько акций — действует наибольший процент"
                    : ""}
                </p>
              </div>
              <PromoPrice
                price={applyPromotion(baseRub, {
                  id: effectiveRow.id,
                  title: effectiveRow.title,
                  percent: effectiveRow.percent,
                  startsAt: effectiveRow.startsAt,
                  endsAt: effectiveRow.endsAt,
                })}
                size="lg"
                layout="stacked"
                suffix={<span className="ml-1 text-[13px] text-[#6f7282]">/мес</span>}
              />
            </div>
          ) : (
            <p className="mt-3 text-[14px] text-[#3c4053]">
              Акций нет — на сайте обычная цена{" "}
              <span className="font-semibold tabular-nums text-[#0b1024]">{formatPriceRub(baseRub)}</span>/мес.
            </p>
          )}
        </section>

        <PromotionGroup
          title="Идут сейчас"
          empty="Сейчас ни одна акция не идёт."
          items={groups.running.map((w) => w.row)}
          effectiveId={effectiveRow?.id ?? null}
          now={now}
          rowBusy={rowBusy}
          onEdit={edit}
          onToggle={toggle}
          onDelete={setDeleting}
          testId="promotions-running"
        />
        <PromotionGroup
          title="Будущие"
          empty="Запланированных акций нет."
          items={groups.scheduled.map((w) => w.row)}
          effectiveId={null}
          now={now}
          rowBusy={rowBusy}
          onEdit={edit}
          onToggle={toggle}
          onDelete={setDeleting}
          testId="promotions-scheduled"
        />
        <PromotionGroup
          title="Прошедшие"
          empty="Завершённых акций пока нет."
          items={groups.finished.map((w) => w.row)}
          effectiveId={null}
          now={now}
          rowBusy={rowBusy}
          onEdit={edit}
          onToggle={toggle}
          onDelete={setDeleting}
          testId="promotions-finished"
        />

        <section className={CARD}>
          <div className={cn(SECTION_LABEL, "flex items-center gap-2")}>
            <History className="size-4 text-[#5566f6]" />
            История изменений
          </div>
          {history.length === 0 ? (
            <p className="mt-3 text-[13.5px] text-[#9b9fb3]">Изменений пока не было.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[#f2f3f8]" data-testid="promotions-history">
              {history.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 text-[13px]">
                  <span className="tabular-nums text-[#9b9fb3]">{formatMskDateTime(new Date(entry.at))}</span>
                  <span className="font-medium text-[#0b1024]">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                    {entry.title ? ` «${entry.title}»` : ""}
                  </span>
                  {entry.summary ? <span className="text-[#6f7282]">{entry.summary}</span> : null}
                  {entry.userName ? <span className="text-[#9b9fb3]">· {entry.userName}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section
        ref={formRef}
        className={cn(CARD, "scroll-mt-6 lg:sticky lg:top-6 lg:self-start")}
        data-testid="promotion-form"
      >
        <div className={cn(SECTION_LABEL, "mb-4 flex items-center justify-between gap-2")}>
          <span className="flex items-center gap-2">
            <BadgePercent className="size-4 text-[#5566f6]" />
            {form.editingId ? "Изменить акцию" : "Новая акция"}
          </span>
          {form.editingId ? (
            <button
              type="button"
              onClick={() => setForm(emptyForm(dateToMskInput(new Date())))}
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[12px] font-medium normal-case tracking-normal text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
            >
              <X className="size-3.5" />
              Отменить
            </button>
          ) : null}
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Название</span>
            <input
              name="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Осенняя скидка"
              maxLength={120}
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Скидка, % (1–90)</span>
            <input
              name="percent"
              value={form.percent}
              onChange={(e) => setForm({ ...form, percent: e.target.value.replace(/\D/g, "").slice(0, 2) })}
              inputMode="numeric"
              className={INPUT}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-[#3c4053]">
                Начало, МСК
                <button
                  type="button"
                  onClick={() => setForm({ ...form, startsAt: dateToMskInput(new Date()) })}
                  className="text-[12px] font-medium text-[#3848c7] hover:text-[#5566f6]"
                >
                  сейчас
                </button>
              </span>
              <input
                name="startsAt"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Конец, МСК</span>
              <input
                name="endsAt"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                className={INPUT}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#6f7282]">
            <CalendarClock className="size-3.5 text-[#9b9fb3]" />
            Длительность:
            {[7, 14, 30].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setForm({ ...form, endsAt: endAfterDays(form.startsAt, days) })}
                className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7] transition-colors hover:bg-[#eef1ff]"
              >
                {days} дн.
              </button>
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-[#9b9fb3]">
            Конец — не включительно: при конце «11.10, 00:00» акция действует весь день 10 октября.
          </p>
          <label className="flex items-center gap-2 text-[13.5px] text-[#3c4053]">
            <input
              name="active"
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="size-4 rounded border-[#dcdfed] accent-[#5566f6]"
            />
            Включена (выключенная не действует, даже если даты идут)
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Заметка для себя</span>
            <input
              name="note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Рассылка по базе 1 октября"
              maxLength={500}
              className={INPUT}
            />
          </label>

          <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
              Так увидят клиенты
            </div>
            {draft.promotion ? (
              <PromoPrice
                price={applyPromotion(baseRub, draft.promotion)}
                size="lg"
                layout="stacked"
                suffix={<span className="ml-1 text-[13px] text-[#6f7282]">/мес</span>}
              />
            ) : !form.title.trim() ? (
              // Пустая форма — не ошибка: подсказываем, с чего начать.
              <p className="text-[13px] text-[#6f7282]">
                Введите название — здесь появится цена по акции.
              </p>
            ) : (
              <p className="text-[13px] text-[#a13a32]" data-testid="promotion-form-error">
                {draft.error}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || Boolean(draft.error)}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : form.editingId ? <Pencil className="size-4" /> : <Plus className="size-4" />}
            {form.editingId ? "Сохранить акцию" : "Создать акцию"}
          </button>
          <p className="text-[12px] leading-relaxed text-[#9b9fb3]">
            Цена меняется на сайте сразу после сохранения. Уже созданные счета и заказы
            сохраняют свою сумму.
          </p>
        </div>
      </section>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        variant="danger"
        title={deleting ? `Удалить акцию «${deleting.title}»?` : "Удалить акцию?"}
        description="Если она сейчас идёт — на сайте сразу вернётся обычная цена (или цена другой идущей акции)."
        bullets={[
          { label: "Оплаченные по акции заказы сохранят скидку и процент в отчётах" },
          { label: "Удаление попадёт в историю изменений", tone: "info" },
          { label: "Чтобы просто остановить акцию, достаточно «Выключить»", tone: "warn" },
        ]}
        confirmLabel="Удалить"
      />
    </div>
  );
}

function PromotionGroup({
  title,
  empty,
  items,
  effectiveId,
  now,
  rowBusy,
  onEdit,
  onToggle,
  onDelete,
  testId,
}: {
  title: string;
  empty: string;
  items: PromotionAdminRow[];
  effectiveId: string | null;
  now: Date;
  rowBusy: string | null;
  onEdit: (row: PromotionAdminRow) => void;
  onToggle: (row: PromotionAdminRow) => void;
  onDelete: (row: PromotionAdminRow) => void;
  testId: string;
}) {
  return (
    <section className={CARD} data-testid={testId}>
      <div className={SECTION_LABEL}>
        {title} · {items.length}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-[#9b9fb3]">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((row) => (
            <PromotionItem
              key={row.id}
              row={row}
              effective={row.id === effectiveId}
              now={now}
              busy={rowBusy === row.id}
              onEdit={onEdit}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PromotionItem({
  row,
  effective,
  now,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: {
  row: PromotionAdminRow;
  effective: boolean;
  now: Date;
  busy: boolean;
  onEdit: (row: PromotionAdminRow) => void;
  onToggle: (row: PromotionAdminRow) => void;
  onDelete: (row: PromotionAdminRow) => void;
}) {
  const phase = promotionPhase({ startsAt: new Date(row.startsAt), endsAt: new Date(row.endsAt) }, now);
  const status = !row.active
    ? { label: "Выключена", className: "bg-[#f5f6ff] text-[#6f7282]" }
    : phase === "finished"
      ? { label: "Завершена", className: "bg-[#f5f6ff] text-[#6f7282]" }
      : phase === "scheduled"
        ? { label: "Запланирована", className: "bg-[#eef1ff] text-[#3848c7]" }
        : effective
          ? { label: "Действует", className: "bg-[#ecfdf5] text-[#116b2a]" }
          : { label: "Перекрыта большей скидкой", className: "bg-[#fff8eb] text-[#b25f00]" };

  return (
    <li
      data-testid="promotion-row"
      data-promotion-id={row.id}
      className={cn(
        "rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4",
        (!row.active || phase === "finished") && "opacity-75"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-[#0b1024]">{row.title}</span>
            <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[12px] font-semibold tabular-nums text-[#3848c7]">
              −{row.percent} %
            </span>
            <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium", status.className)}>
              {status.label}
            </span>
          </div>
          <div className="mt-1 text-[13px] tabular-nums text-[#6f7282]">
            {formatMskDateTime(new Date(row.startsAt))} — {formatMskDateTime(new Date(row.endsAt))} МСК
          </div>
          {phase === "running" && row.active ? (
            <div className="mt-2">
              <PromoBadge promotion={row} />
            </div>
          ) : null}
          {row.note ? <div className="mt-1.5 text-[12.5px] text-[#6f7282]">{row.note}</div> : null}
          <div className="mt-1.5 text-[12.5px] text-[#9b9fb3]">
            Оплат по акции: <span className="tabular-nums text-[#3c4053]">{row.paidOrders}</span>
            {row.discountTotalRub > 0 ? (
              <>
                {" "}
                · скидка клиентам{" "}
                <span className="tabular-nums text-[#3c4053]">{formatPriceRub(row.discountTotalRub)}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:shrink-0">
          <button type="button" onClick={() => onEdit(row)} className={OUTLINE_BUTTON}>
            <Pencil className="size-3.5 text-[#5566f6]" />
            Изменить
          </button>
          <button type="button" onClick={() => onToggle(row)} disabled={busy} className={OUTLINE_BUTTON}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5 text-[#5566f6]" />}
            {row.active ? "Выключить" : "Включить"}
          </button>
          <button
            type="button"
            onClick={() => onDelete(row)}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#ffd2cc] bg-[#fff4f2] px-2.5 text-[12.5px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#ffe9e5]"
          >
            <Trash2 className="size-3.5" />
            Удалить
          </button>
        </div>
      </div>
    </li>
  );
}
