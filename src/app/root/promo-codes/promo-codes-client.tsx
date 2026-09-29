"use client";

import { Infinity as InfinityIcon, Loader2, Pencil, Plus, Search, Ticket, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { LifetimeDiscountAdminRow } from "@/lib/promo/lifetime";
import type { PromoCodeAdminRow } from "@/lib/promo/promo-codes-admin";
import { formatMskDateTime, mskInputToDate } from "@/lib/promo/promotions";
import { describeDiscount } from "@/lib/promo/rules";
import { cn } from "@/lib/utils";

export type PromoRow = PromoCodeAdminRow;

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const SMALL_BUTTON =
  "inline-flex h-8 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";
const LABEL = "mb-1.5 block text-[13px] font-medium text-[#3c4053]";

/** Дата по Москве: «01.10.2026». */
const mskDate = (iso: string) => formatMskDateTime(new Date(iso)).slice(0, 10);
/** «2026-10-31» по Москве — значение для <input type="date">. */
const mskDateInput = (iso: string | null) => {
  if (!iso) return "";
  const [day, month, year] = mskDate(iso).split(".");
  return `${year}-${month}-${day}`;
};

/** Срок кода по Москве: начало дня «с» и конец дня «по» (23:59:59). */
function mskDayStart(date: string): string | null {
  return date ? mskInputToDate(`${date}T00:00`)?.toISOString() ?? null : null;
}
function mskDayEnd(date: string): string | null {
  const end = date ? mskInputToDate(`${date}T23:59`) : null;
  return end ? new Date(end.getTime() + 59_999).toISOString() : null;
}

const EMPTY_FORM = {
  code: "",
  kind: "percent" as "percent" | "fixed",
  value: "10",
  startsAt: "",
  endsAt: "",
  maxUses: "",
  newClientsOnly: false,
  note: "",
  lifetime: false,
  personalEmail: "",
  organizationId: "",
  campaignId: "",
};

type EditForm = {
  endsAt: string;
  maxUses: string;
  newClientsOnly: boolean;
  note: string;
  lifetime: boolean;
  personalEmail: string;
  organizationId: string;
  campaignId: string;
};

function toEditForm(row: PromoRow): EditForm {
  return {
    endsAt: mskDateInput(row.endsAt),
    maxUses: row.maxUses ? String(row.maxUses) : "",
    newClientsOnly: row.newClientsOnly,
    note: row.note ?? "",
    lifetime: row.lifetime,
    personalEmail: row.personalEmail ?? "",
    organizationId: row.organizationId ?? "",
    campaignId: row.campaignId ?? "",
  };
}

const isPersonal = (row: PromoRow) => Boolean(row.personalEmail || row.organizationId);

function Chip({ tone, children }: { tone: "lifetime" | "personal" | "campaign"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "lifetime" && "bg-[#eef1ff] text-[#3848c7]",
        tone === "personal" && "bg-[#fff8eb] text-[#a16d32]",
        tone === "campaign" && "bg-[#f5f6ff] text-[#6f7282]"
      )}
    >
      {children}
    </span>
  );
}

export function PromoCodesClient({
  initial,
  lifetime: initialLifetime,
}: {
  initial: PromoRow[];
  lifetime: LifetimeDiscountAdminRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [lifetimeRows, setLifetimeRows] = useState(initialLifetime);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "personal">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PromoRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [revoking, setRevoking] = useState<LifetimeDiscountAdminRow | null>(null);

  const personalCount = rows.filter(isPersonal).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "personal" && !isPersonal(row)) return false;
      if (!q) return true;
      return [row.code, row.personalEmail, row.organizationName, row.campaignId, row.note]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  async function create() {
    setBusy(true);
    try {
      const response = await fetch("/api/root/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          kind: form.kind,
          value: Number(form.value),
          startsAt: mskDayStart(form.startsAt),
          endsAt: mskDayEnd(form.endsAt),
          maxUses: form.maxUses ? Number(form.maxUses) : null,
          newClientsOnly: form.newClientsOnly,
          note: form.note,
          lifetime: form.lifetime,
          personalEmail: form.personalEmail.trim() || null,
          organizationId: form.organizationId.trim() || null,
          campaignId: form.campaignId.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; code?: PromoRow } | null;
      if (!response.ok || !data?.code) throw new Error(data?.error ?? "Не удалось создать");
      setRows((prev) => [data.code!, ...prev]);
      setForm(EMPTY_FORM);
      toast.success(`Промокод ${data.code.code} создан`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function patch(row: PromoRow, body: Record<string, unknown>): Promise<PromoRow | null> {
    const response = await fetch(`/api/root/promo-codes/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as { error?: string; code?: PromoRow } | null;
    if (!response.ok || !data?.code) {
      toast.error(data?.error ?? "Не удалось изменить");
      return null;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? data.code! : r)));
    return data.code;
  }

  async function toggle(row: PromoRow) {
    const updated = await patch(row, { active: !row.active });
    if (updated) toast.success(row.active ? `${row.code} отключён` : `${row.code} включён`);
  }

  function startEdit(row: PromoRow) {
    setEditing(row);
    setEditForm(toEditForm(row));
  }

  async function saveEdit() {
    if (!editing || !editForm) return;
    setBusy(true);
    try {
      const updated = await patch(editing, {
        endsAt: mskDayEnd(editForm.endsAt),
        maxUses: editForm.maxUses ? Number(editForm.maxUses) : null,
        newClientsOnly: editForm.newClientsOnly,
        note: editForm.note.trim() || null,
        lifetime: editForm.lifetime,
        personalEmail: editForm.personalEmail.trim() || null,
        organizationId: editForm.organizationId.trim() || null,
        campaignId: editForm.campaignId.trim() || null,
      });
      if (updated) {
        toast.success(`Промокод ${updated.code} сохранён`);
        setEditing(null);
        setEditForm(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(row: LifetimeDiscountAdminRow) {
    const response = await fetch(`/api/root/lifetime-discounts/${row.id}/revoke`, { method: "POST" });
    const data = (await response.json().catch(() => null)) as { error?: string; revokedAt?: string | null } | null;
    if (!response.ok) {
      toast.error(data?.error ?? "Не удалось отменить");
      return;
    }
    setLifetimeRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, revokedAt: data?.revokedAt ?? new Date().toISOString(), revokedByName: "вы" } : r))
    );
    setRevoking(null);
    toast.success(`Скидка навсегда ${row.code} отменена`);
  }

  // Срок по Москве: «с 01.10.2026 по 31.10.2026», «до …», «без срока».
  const period = (row: PromoRow) =>
    row.startsAt && row.endsAt
      ? `с ${mskDate(row.startsAt)} по ${mskDate(row.endsAt)}`
      : row.endsAt
        ? `до ${mskDate(row.endsAt)}`
        : row.startsAt
          ? `с ${mskDate(row.startsAt)}`
          : "без срока";

  const whom = (row: PromoRow) => {
    const personal = [row.personalEmail, row.organizationName ?? row.organizationId].filter(Boolean).join(" · ");
    if (personal) return personal;
    return row.newClientsOnly ? "только новым" : "всем";
  };

  const personalFields = (
    values: { lifetime: boolean; personalEmail: string; organizationId: string; campaignId: string },
    onChange: (next: Partial<typeof values>) => void
  ) => (
    <>
      <label className="flex items-start gap-2 text-[13.5px] text-[#3c4053]">
        <input
          type="checkbox"
          name="lifetime"
          checked={values.lifetime}
          onChange={(e) => onChange({ lifetime: e.target.checked })}
          className="mt-0.5 size-4 rounded border-[#dcdfed]"
        />
        <span>
          Скидка навсегда
          <span className="block text-[12px] text-[#9b9fb3]">
            Первая оплата закрепит скидку за аккаунтом — дальше она применяется сама
          </span>
        </span>
      </label>
      <label className="block">
        <span className={LABEL}>Персональный: почта</span>
        <input
          name="personalEmail"
          value={values.personalEmail}
          onChange={(e) => onChange({ personalEmail: e.target.value })}
          placeholder="owner@cafe.ru"
          className={INPUT}
          maxLength={200}
        />
      </label>
      <label className="block">
        <span className={LABEL}>Персональный: организация (id)</span>
        <input
          name="organizationId"
          value={values.organizationId}
          onChange={(e) => onChange({ organizationId: e.target.value })}
          placeholder="id из адреса /root/organizations/…"
          className={cn(INPUT, "font-mono text-[13px]")}
          maxLength={64}
        />
      </label>
      <label className="block">
        <span className={LABEL}>Метка рассылки</span>
        <input
          name="campaignId"
          value={values.campaignId}
          onChange={(e) => onChange({ campaignId: e.target.value })}
          placeholder="например, kp-2026-10"
          className={INPUT}
          maxLength={100}
        />
      </label>
      <p className="text-[12px] leading-relaxed text-[#9b9fb3]">
        Почта и/или организация — код сработает только у них. Чужому покажем «Этот промокод
        персональный — он выдан другой организации».
      </p>
    </>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className={CARD} data-testid="promo-codes-list">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Коды · {rows.length}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-[#dcdfed] bg-[#fafbff] p-0.5 text-[12.5px] font-medium">
                {(
                  [
                    ["all", `Все`],
                    ["personal", `Персональные · ${personalCount}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={`promo-filter-${value}`}
                    onClick={() => setFilter(value)}
                    className={cn(
                      "rounded-[10px] px-2.5 py-1 transition-colors",
                      filter === value ? "bg-white text-[#0b1024] shadow-sm" : "text-[#6f7282] hover:text-[#0b1024]"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#9b9fb3]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Код, почта, рассылка"
                  aria-label="Поиск по кодам"
                  className="h-8 w-[180px] rounded-xl border border-[#dcdfed] bg-white pl-8 pr-2.5 text-[12.5px] focus:border-[#5566f6] focus:outline-none"
                />
              </label>
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="text-[13.5px] text-[#9b9fb3]">
              {rows.length === 0 ? "Промокодов пока нет — создайте первый справа." : "Ничего не найдено."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                    <th className="pb-2 pr-4 font-medium">Код</th>
                    <th className="pb-2 pr-4 font-medium">Скидка</th>
                    <th className="pb-2 pr-4 font-medium">Срок (МСК)</th>
                    <th className="pb-2 pr-4 font-medium">Оплат</th>
                    <th className="pb-2 pr-4 font-medium">Кому</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr
                      key={row.id}
                      data-testid="promo-code-row"
                      data-code={row.code}
                      className={cn("border-t border-[#f2f3f8] align-top", !row.active && "opacity-60")}
                    >
                      <td className="py-2.5 pr-4">
                        <span className="font-mono font-semibold text-[#0b1024]">{row.code}</span>
                        {row.lifetime || isPersonal(row) || row.campaignId ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {row.lifetime ? (
                              <Chip tone="lifetime">
                                <InfinityIcon className="size-3" />
                                навсегда
                              </Chip>
                            ) : null}
                            {isPersonal(row) ? (
                              <Chip tone="personal">
                                <UserRound className="size-3" />
                                персональный
                              </Chip>
                            ) : null}
                            {row.campaignId ? <Chip tone="campaign">рассылка {row.campaignId}</Chip> : null}
                          </div>
                        ) : null}
                        {row.note ? <div className="mt-1 text-[12px] text-[#6f7282]">{row.note}</div> : null}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums text-[#0b1024]">{describeDiscount(row)}</td>
                      <td className="py-2.5 pr-4 text-[#6f7282]">{period(row)}</td>
                      <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums text-[#6f7282]">
                        {row.paidUses}
                        {row.maxUses ? ` / ${row.maxUses}` : ""}
                      </td>
                      <td className="max-w-[220px] break-words py-2.5 pr-4 text-[#6f7282]">{whom(row)}</td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex gap-1.5">
                          <button type="button" onClick={() => startEdit(row)} className={SMALL_BUTTON}>
                            <Pencil className="size-3.5" />
                            Изменить
                          </button>
                          <button type="button" onClick={() => void toggle(row)} className={SMALL_BUTTON}>
                            {row.active ? "Отключить" : "Включить"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {editing && editForm ? (
          <section className={cn(CARD, "lg:sticky lg:top-6 lg:self-start")} data-testid="promo-edit-form">
            <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <Pencil className="size-4 text-[#5566f6]" />
              Изменить {editing.code}
            </div>
            <div className="space-y-3">
              <p className="text-[12.5px] leading-relaxed text-[#6f7282]">
                Код и размер скидки ({describeDiscount(editing)}) не меняются — на них уже могли сослаться.
                Уже закреплённые скидки навсегда правка не меняет.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>Действует по</span>
                  <input
                    type="date"
                    value={editForm.endsAt}
                    onChange={(e) => setEditForm({ ...editForm, endsAt: e.target.value })}
                    className={INPUT}
                  />
                </label>
                <label className="block">
                  <span className={LABEL}>Лимит оплат</span>
                  <input
                    value={editForm.maxUses}
                    onChange={(e) => setEditForm({ ...editForm, maxUses: e.target.value.replace(/\D/g, "") })}
                    inputMode="numeric"
                    placeholder="без лимита"
                    className={INPUT}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[13.5px] text-[#3c4053]">
                <input
                  type="checkbox"
                  checked={editForm.newClientsOnly}
                  onChange={(e) => setEditForm({ ...editForm, newClientsOnly: e.target.checked })}
                  className="size-4 rounded border-[#dcdfed]"
                />
                Только новым клиентам
              </label>
              {personalFields(editForm, (next) => setEditForm({ ...editForm, ...next }))}
              <label className="block">
                <span className={LABEL}>Заметка</span>
                <input
                  value={editForm.note}
                  onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                  className={INPUT}
                  maxLength={200}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={busy}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setEditForm(null);
                  }}
                  className="inline-flex h-11 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] hover:bg-[#f5f6ff]"
                >
                  Отмена
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className={cn(CARD, "lg:sticky lg:top-6 lg:self-start")} data-testid="promo-create-form">
            <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <Ticket className="size-4 text-[#5566f6]" />
              Новый промокод
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className={LABEL}>Код</span>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="WELCOME10"
                  className={cn(INPUT, "font-mono")}
                  maxLength={32}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>Тип</span>
                  <select
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value as "percent" | "fixed" })}
                    className={INPUT}
                  >
                    <option value="percent">Процент</option>
                    <option value="fixed">Рубли</option>
                  </select>
                </label>
                <label className="block">
                  <span className={LABEL}>{form.kind === "percent" ? "Процент" : "Сумма, ₽"}</span>
                  <input
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value.replace(/\D/g, "") })}
                    inputMode="numeric"
                    className={INPUT}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>Действует с</span>
                  <input
                    type="date"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className={INPUT}
                  />
                </label>
                <label className="block">
                  <span className={LABEL}>по (включительно)</span>
                  <input
                    type="date"
                    value={form.endsAt}
                    onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                    className={INPUT}
                  />
                </label>
              </div>
              <label className="block">
                <span className={LABEL}>Лимит оплат</span>
                <input
                  value={form.maxUses}
                  onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, "") })}
                  inputMode="numeric"
                  placeholder="без лимита"
                  className={INPUT}
                />
              </label>
              <label className="flex items-center gap-2 text-[13.5px] text-[#3c4053]">
                <input
                  type="checkbox"
                  checked={form.newClientsOnly}
                  onChange={(e) => setForm({ ...form, newClientsOnly: e.target.checked })}
                  className="size-4 rounded border-[#dcdfed]"
                />
                Только новым клиентам (без оплаченных заказов)
              </label>
              {personalFields(form, (next) => setForm({ ...form, ...next }))}
              <label className="block">
                <span className={LABEL}>Заметка</span>
                <input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Для рассылки в сентябре"
                  className={INPUT}
                  maxLength={200}
                />
              </label>
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy || form.code.trim().length < 3 || !form.value}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Создать
              </button>
              <p className="text-[12px] leading-relaxed text-[#9b9fb3]">
                Клиент вводит код на странице оформления или открывает ссылку /promo/КОД; скидка
                считается на сервере и попадает в сумму заказа, чек и УПД.
              </p>
            </div>
          </section>
        )}
      </div>

      <section className={CARD} data-testid="lifetime-discounts">
        <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          <InfinityIcon className="size-4 text-[#5566f6]" />
          Скидки навсегда · {lifetimeRows.filter((r) => !r.revokedAt).length}
        </div>
        <p className="mb-4 max-w-[760px] text-[13px] leading-relaxed text-[#6f7282]">
          Аккаунты, за которыми первая оплата с кодом «навсегда» закрепила скидку. Она применяется к
          каждой следующей оплате сама — картой и по счёту. «Отменить» — следующие оплаты пойдут без
          неё; уже оплаченное не меняется.
        </p>
        {lifetimeRows.length === 0 ? (
          <p className="text-[13.5px] text-[#9b9fb3]">Пока ни одной — появятся после первой оплаты с таким кодом.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                  <th className="pb-2 pr-4 font-medium">Аккаунт</th>
                  <th className="pb-2 pr-4 font-medium">Скидка</th>
                  <th className="pb-2 pr-4 font-medium">С заказа</th>
                  <th className="pb-2 pr-4 font-medium">Оплат со скидкой</th>
                  <th className="pb-2 pr-4 font-medium">Статус</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {lifetimeRows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid="lifetime-row"
                    data-code={row.code}
                    className={cn("border-t border-[#f2f3f8] align-top", row.revokedAt && "opacity-60")}
                  >
                    <td className="py-2.5 pr-4">
                      <div className="text-[#0b1024]">{row.ownerEmail ?? row.accountId}</div>
                      {row.organizations.length > 0 ? (
                        <div className="text-[12px] text-[#6f7282]">
                          {row.organizations.map((org) => org.name).join(", ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-4">
                      <span className="tabular-nums text-[#0b1024]">{describeDiscount(row)}</span>{" "}
                      <span className="font-mono text-[12px] text-[#6f7282]">{row.code}</span>
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-[#6f7282]">
                      №{row.orderId} · {mskDate(row.boundAt)}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums text-[#6f7282]">{row.autoPaidOrders}</td>
                    <td className="py-2.5 pr-4">
                      {row.revokedAt ? (
                        <span className="text-[12.5px] text-[#a13a32]">
                          отменена {mskDate(row.revokedAt)}
                          {row.revokedByName ? ` · ${row.revokedByName}` : ""}
                        </span>
                      ) : (
                        <span className="rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[12px] text-[#116b2a]">действует</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {row.revokedAt ? null : (
                        <button
                          type="button"
                          onClick={() => setRevoking(row)}
                          className={cn(SMALL_BUTTON, "text-[#a13a32]")}
                        >
                          Отменить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => (revoking ? revoke(revoking) : undefined)}
        variant="danger"
        title={revoking ? `Отменить скидку ${describeDiscount(revoking)} навсегда?` : "Отменить скидку навсегда?"}
        description={
          revoking
            ? `Аккаунт ${revoking.ownerEmail ?? revoking.accountId}, код ${revoking.code}. Следующие оплаты пойдут по обычной цене.`
            : undefined
        }
        bullets={[
          { label: "Уже оплаченные заказы не меняются" },
          { label: "Отмена попадёт в журнал аудита", tone: "info" },
          { label: "Вернуть скидку можно только новым кодом «навсегда»", tone: "warn" },
        ]}
        confirmLabel="Отменить скидку"
      />
    </div>
  );
}
