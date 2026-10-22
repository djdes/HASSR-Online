"use client";

import { Infinity as InfinityIcon, Loader2, Pencil, Plus, Search, Ticket, UserRound } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { LifetimeDiscountAdminRow } from "@/lib/promo/lifetime";
import type { PromoCodeAdminRow } from "@/lib/promo/promo-codes-admin";
import { formatMskDateTime, mskInputToDate } from "@/lib/promo/promotions";
import { describeDiscount } from "@/lib/promo/rules";
import type { Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

import { formatPromoDisplayDate, promoApiErrorKey } from "./promo-code-presentation";

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

type PromoErrorKey = "invalidData" | "invalidCode" | "percentTooHigh" | "organizationMissing" | "duplicateCode" | "promoMissing" | "lifetimeMissing" | "alreadyRevoked";
type Translator = ReturnType<typeof useTranslations<"rootPromoCodes">>;

function apiErrorMessage(t: Translator, value: unknown, fallback: "createError" | "changeError" | "revokeError") {
  const key = promoApiErrorKey(value);
  if (!key) return t(`feedback.${fallback}`);
  switch (key satisfies PromoErrorKey) {
    case "invalidData": return t("errors.invalidData");
    case "invalidCode": return t("errors.invalidCode");
    case "percentTooHigh": return t("errors.percentTooHigh");
    case "organizationMissing": return t("errors.organizationMissing");
    case "duplicateCode": return t("errors.duplicateCode");
    case "promoMissing": return t("errors.promoMissing");
    case "lifetimeMissing": return t("errors.lifetimeMissing");
    case "alreadyRevoked": return t("errors.alreadyRevoked");
  }
}

type LifetimeRowView = LifetimeDiscountAdminRow & { revokedByCurrentUser?: true };

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
  durationMonths: "",
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
  durationMonths: string;
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
    durationMonths: row.durationMonths ? String(row.durationMonths) : "",
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
  const locale = useLocale() as Locale;
  const t = useTranslations("rootPromoCodes");
  const translatorRef = useRef(t);
  useLayoutEffect(() => { translatorRef.current = t; }, [t]);
  const [rows, setRows] = useState(initial);
  const [lifetimeRows, setLifetimeRows] = useState<LifetimeRowView[]>(initialLifetime);
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
          durationMonths: form.lifetime && form.durationMonths ? Number(form.durationMonths) : null,
          personalEmail: form.personalEmail.trim() || null,
          organizationId: form.organizationId.trim() || null,
          campaignId: form.campaignId.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; code?: PromoRow } | null;
      if (!response.ok || !data?.code) {
        toast.error(apiErrorMessage(translatorRef.current, data?.error, "createError"));
        return;
      }
      setRows((prev) => [data.code!, ...prev]);
      setForm(EMPTY_FORM);
      toast.success(translatorRef.current("feedback.createSuccess", { code: data.code.code }));
    } catch {
      toast.error(translatorRef.current("feedback.createError"));
    } finally {
      setBusy(false);
    }
  }

  async function patch(row: PromoRow, body: Record<string, unknown>): Promise<PromoRow | null> {
    try {
      const response = await fetch(`/api/root/promo-codes/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; code?: PromoRow } | null;
      if (!response.ok || !data?.code) {
        toast.error(apiErrorMessage(translatorRef.current, data?.error, "changeError"));
        return null;
      }
      setRows((prev) => prev.map((r) => (r.id === row.id ? data.code! : r)));
      return data.code;
    } catch {
      toast.error(translatorRef.current("feedback.changeError"));
      return null;
    }
  }

  async function toggle(row: PromoRow) {
    const updated = await patch(row, { active: !row.active });
    if (updated) toast.success(translatorRef.current(row.active ? "feedback.disabled" : "feedback.enabled", { code: row.code }));
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
        durationMonths: editForm.lifetime && editForm.durationMonths ? Number(editForm.durationMonths) : null,
        personalEmail: editForm.personalEmail.trim() || null,
        organizationId: editForm.organizationId.trim() || null,
        campaignId: editForm.campaignId.trim() || null,
      });
      if (updated) {
        toast.success(translatorRef.current("feedback.saveSuccess", { code: updated.code }));
        setEditing(null);
        setEditForm(null);
      }
    } catch {
      toast.error(translatorRef.current("feedback.changeError"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(row: LifetimeDiscountAdminRow) {
    try {
      const response = await fetch(`/api/root/lifetime-discounts/${row.id}/revoke`, { method: "POST" });
      const data = (await response.json().catch(() => null)) as { error?: string; revokedAt?: string | null } | null;
      if (!response.ok) {
        toast.error(apiErrorMessage(translatorRef.current, data?.error, "revokeError"));
        return;
      }
      setLifetimeRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, revokedAt: data?.revokedAt ?? new Date().toISOString(), revokedByName: null, revokedByCurrentUser: true } : r))
      );
      setRevoking(null);
      toast.success(translatorRef.current("feedback.revokeSuccess", { code: row.code }));
    } catch {
      toast.error(translatorRef.current("feedback.revokeError"));
    }
  }

  // Срок по Москве: «с 01.10.2026 по 31.10.2026», «до …», «без срока».
  const period = (row: PromoRow) =>
    row.startsAt && row.endsAt
      ? t("period.between", { start: formatPromoDisplayDate(row.startsAt, locale), end: formatPromoDisplayDate(row.endsAt, locale) })
      : row.endsAt
        ? t("period.until", { end: formatPromoDisplayDate(row.endsAt, locale) })
        : row.startsAt
          ? t("period.from", { start: formatPromoDisplayDate(row.startsAt, locale) })
          : t("period.unlimited");

  const whom = (row: PromoRow) => {
    const personal = [row.personalEmail, row.organizationName ?? row.organizationId].filter(Boolean).join(" · ");
    if (personal) return personal;
    return t(row.newClientsOnly ? "audience.newOnly" : "audience.everyone");
  };

  const personalFields = (
    values: { lifetime: boolean; durationMonths: string; personalEmail: string; organizationId: string; campaignId: string },
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
          {t("personal.lifetime")}
          <span className="block text-[12px] text-[#9b9fb3]">
            {t("personal.lifetimeHelp")}
          </span>
        </span>
      </label>
      {values.lifetime ? (
        <label className="block">
          <span className={LABEL}>{t("personal.durationMonths")}</span>
          <input
            name="durationMonths"
            type="number"
            min={1}
            max={120}
            inputMode="numeric"
            value={values.durationMonths}
            onChange={(e) => onChange({ durationMonths: e.target.value })}
            placeholder={t("personal.durationUnlimited")}
            className={INPUT}
          />
          <span className="mt-1 block text-[12px] text-[#9b9fb3]">
            {t("personal.durationHelp")}
          </span>
        </label>
      ) : null}
      <label className="block">
        <span className={LABEL}>{t("personal.email")}</span>
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
        <span className={LABEL}>{t("personal.organization")}</span>
        <input
          name="organizationId"
          value={values.organizationId}
          onChange={(e) => onChange({ organizationId: e.target.value })}
          placeholder={t("personal.organizationPlaceholder")}
          className={cn(INPUT, "font-mono text-[13px]")}
          maxLength={64}
        />
      </label>
      <label className="block">
        <span className={LABEL}>{t("personal.campaign")}</span>
        <input
          name="campaignId"
          value={values.campaignId}
          onChange={(e) => onChange({ campaignId: e.target.value })}
          placeholder={t("personal.campaignPlaceholder")}
          className={INPUT}
          maxLength={100}
        />
      </label>
      <p className="text-[12px] leading-relaxed text-[#9b9fb3]">
        {t("personal.help")}
      </p>
    </>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className={CARD} data-testid="promo-codes-list">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("list.heading", { count: rows.length })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-[#dcdfed] bg-[#fafbff] p-0.5 text-[12.5px] font-medium">
                {(
                  [
                    ["all", t("list.all")],
                    ["personal", t("list.personalFilter", { count: personalCount })],
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
                  placeholder={t("list.searchPlaceholder")}
                  aria-label={t("list.searchLabel")}
                  className="h-8 w-[180px] rounded-xl border border-[#dcdfed] bg-white pl-8 pr-2.5 text-[12.5px] focus:border-[#5566f6] focus:outline-none"
                />
              </label>
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="text-[13.5px] text-[#9b9fb3]">
              {rows.length === 0 ? t("list.empty") : t("list.noResults")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                    <th className="pb-2 pr-4 font-medium">{t("list.code")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("list.discount")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("list.period")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("list.payments")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("list.forWhom")}</th>
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
                                {row.durationMonths ? t("list.durationTag", { months: row.durationMonths }) : t("list.lifetimeTag")}
                              </Chip>
                            ) : null}
                            {isPersonal(row) ? (
                              <Chip tone="personal">
                                <UserRound className="size-3" />
                                {t("list.personalTag")}
                              </Chip>
                            ) : null}
                            {row.campaignId ? <Chip tone="campaign">{t("list.campaignTag", { campaignId: row.campaignId })}</Chip> : null}
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
                            {t("list.edit")}
                          </button>
                          <button type="button" onClick={() => void toggle(row)} className={SMALL_BUTTON}>
                            {t(row.active ? "list.disable" : "list.enable")}
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
              {t("edit.title", { code: editing.code })}
            </div>
            <div className="space-y-3">
              <p className="text-[12.5px] leading-relaxed text-[#6f7282]">
                {t("edit.immutable", { discount: describeDiscount(editing) })}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>{t("edit.validUntil")}</span>
                  <input
                    type="date"
                    value={editForm.endsAt}
                    onChange={(e) => setEditForm({ ...editForm, endsAt: e.target.value })}
                    className={INPUT}
                  />
                </label>
                <label className="block">
                  <span className={LABEL}>{t("edit.paymentLimit")}</span>
                  <input
                    value={editForm.maxUses}
                    onChange={(e) => setEditForm({ ...editForm, maxUses: e.target.value.replace(/\D/g, "") })}
                    inputMode="numeric"
                    placeholder={t("edit.noLimit")}
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
                {t("edit.newOnly")}
              </label>
              {personalFields(editForm, (next) => setEditForm({ ...editForm, ...next }))}
              <label className="block">
                <span className={LABEL}>{t("edit.note")}</span>
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
                  {t("edit.save")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setEditForm(null);
                  }}
                  className="inline-flex h-11 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] hover:bg-[#f5f6ff]"
                >
                  {t("edit.cancel")}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className={cn(CARD, "lg:sticky lg:top-6 lg:self-start")} data-testid="promo-create-form">
            <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <Ticket className="size-4 text-[#5566f6]" />
              {t("create.title")}
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className={LABEL}>{t("create.code")}</span>
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
                  <span className={LABEL}>{t("create.kind")}</span>
                  <select
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value as "percent" | "fixed" })}
                    className={INPUT}
                  >
                    <option value="percent">{t("create.percent")}</option>
                    <option value="fixed">{t("create.rubles")}</option>
                  </select>
                </label>
                <label className="block">
                  <span className={LABEL}>{form.kind === "percent" ? t("create.percent") : t("create.amountRubles")}</span>
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
                  <span className={LABEL}>{t("create.validFrom")}</span>
                  <input
                    type="date"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className={INPUT}
                  />
                </label>
                <label className="block">
                  <span className={LABEL}>{t("create.validThrough")}</span>
                  <input
                    type="date"
                    value={form.endsAt}
                    onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                    className={INPUT}
                  />
                </label>
              </div>
              <label className="block">
                <span className={LABEL}>{t("create.paymentLimit")}</span>
                <input
                  value={form.maxUses}
                  onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, "") })}
                  inputMode="numeric"
                  placeholder={t("edit.noLimit")}
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
                {t("create.newOnly")}
              </label>
              {personalFields(form, (next) => setForm({ ...form, ...next }))}
              <label className="block">
                <span className={LABEL}>{t("create.note")}</span>
                <input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder={t("create.notePlaceholder")}
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
                {t("create.submit")}
              </button>
              <p className="text-[12px] leading-relaxed text-[#9b9fb3]">
                {t("create.help")}
              </p>
            </div>
          </section>
        )}
      </div>

      <section className={CARD} data-testid="lifetime-discounts">
        <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          <InfinityIcon className="size-4 text-[#5566f6]" />
          {t("lifetime.heading", { count: lifetimeRows.filter((r) => !r.revokedAt).length })}
        </div>
        <p className="mb-4 max-w-[760px] text-[13px] leading-relaxed text-[#6f7282]">
          {t("lifetime.explanation")}
        </p>
        {lifetimeRows.length === 0 ? (
          <p className="text-[13.5px] text-[#9b9fb3]">{t("lifetime.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                  <th className="pb-2 pr-4 font-medium">{t("lifetime.account")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("lifetime.discount")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("lifetime.order")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("lifetime.paidWithDiscount")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("lifetime.status")}</th>
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
                      №{row.orderId} · {formatPromoDisplayDate(row.boundAt, locale)}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums text-[#6f7282]">{row.autoPaidOrders}</td>
                    <td className="py-2.5 pr-4">
                      {row.revokedAt ? (
                        <span className="text-[12.5px] text-[#a13a32]">
                          {t("lifetime.revoked", { date: formatPromoDisplayDate(row.revokedAt, locale) })}
                          {row.revokedByCurrentUser ? ` · ${t("lifetime.revokedByYou")}` : row.revokedByName ? ` · ${row.revokedByName}` : ""}
                        </span>
                      ) : row.expired && row.expiresAt ? (
                        <span className="text-[12.5px] text-[#6f7282]">{t("lifetime.expired", { date: formatPromoDisplayDate(row.expiresAt, locale) })}</span>
                      ) : (
                        <span className="rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[12px] text-[#116b2a]">
                          {row.expiresAt ? t("lifetime.activeUntil", { date: formatPromoDisplayDate(row.expiresAt, locale) }) : t("lifetime.active")}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {row.revokedAt ? null : (
                        <button
                          type="button"
                          onClick={() => setRevoking(row)}
                          className={cn(SMALL_BUTTON, "text-[#a13a32]")}
                        >
                          {t("lifetime.revoke")}
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
        title={revoking ? t("lifetime.dialogTitleWithDiscount", { discount: describeDiscount(revoking) }) : t("lifetime.dialogTitle")}
        description={
          revoking
            ? t("lifetime.dialogDescription", { account: revoking.ownerEmail ?? revoking.accountId, code: revoking.code })
            : undefined
        }
        bullets={[
          { label: t("lifetime.paidOrdersUnchanged") },
          { label: t("lifetime.auditNote"), tone: "info" },
          { label: t("lifetime.cannotRestore"), tone: "warn" },
        ]}
        confirmLabel={t("lifetime.confirm")}
      />
    </div>
  );
}
