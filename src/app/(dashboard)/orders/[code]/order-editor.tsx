"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, Info, Save } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { PrintJournalButton } from "@/components/journals/print-journal-button";
import { brandPalette, type DocumentBrand } from "@/lib/document-brand";
import type { OrderTemplate } from "@/lib/orders/catalog";
import {
  orderRequisitesLine,
  renderOrder,
  type OrderOrgSnapshot,
  type OrderValues,
} from "@/lib/orders/render";

/**
 * Форма приказа с живым предпросмотром.
 *
 * Черновик держим в localStorage: форму заполняют в несколько заходов
 * («спрошу у бухгалтера точную должность»), и потерять ввод из-за
 * случайно закрытой вкладки нельзя. Ключ привязан к шаблону, чтобы
 * черновик одного приказа не подставился в другой.
 */
const FIELD_CLASS =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

export function OrderEditor({
  template,
  org,
  brand = null,
  canManage,
  existing,
  initialNumber,
  initialIssuedAt,
  initialValues,
  preferInitial = false,
  returnTo = null,
}: {
  template: OrderTemplate;
  org: OrderOrgSnapshot;
  /** Логотип и фирменный цвет организации для шапки листа. */
  brand?: DocumentBrand | null;
  canManage: boolean;
  existing: {
    id: string;
    number: string;
    issuedAt: string;
    values: OrderValues;
  } | null;
  initialNumber: string;
  initialIssuedAt: string;
  initialValues: OrderValues;
  /** Не восстанавливать черновик из localStorage: значения пришли из блока ППК и важнее старого черновика. */
  preferInitial?: boolean;
  /** Куда вернуть после сохранения (быстрый старт, `?from=onboarding`). */
  returnTo?: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("ordersUi");
  const draftKey = `wesetup.order-draft:${template.code}`;

  const [number, setNumber] = useState(existing?.number ?? initialNumber);
  const [issuedAt, setIssuedAt] = useState(existing?.issuedAt ?? initialIssuedAt);
  const [values, setValues] = useState<OrderValues>(
    existing?.values ?? initialValues
  );
  const [saving, setSaving] = useState(false);

  // Черновик восстанавливаем только для нового приказа: у изданного
  // источник правды — база, и подменять его старым черновиком нельзя.
  useEffect(() => {
    if (existing || preferInitial) return;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        number?: string;
        issuedAt?: string;
        values?: OrderValues;
      };
      if (draft.number) setNumber(draft.number);
      if (draft.issuedAt) setIssuedAt(draft.issuedAt);
      if (draft.values) setValues((current) => ({ ...current, ...draft.values }));
    } catch {
      /* localStorage закрыт — работаем с пустой формой */
    }
  }, [draftKey, existing, preferInitial]);

  useEffect(() => {
    if (existing) return;
    try {
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({ number, issuedAt, values })
      );
    } catch {
      /* ignore */
    }
  }, [draftKey, existing, number, issuedAt, values]);

  const rendered = useMemo(
    () => renderOrder({ template, org, values, number, issuedAt }),
    [template, org, values, number, issuedAt]
  );

  async function handleSave() {
    if (rendered.missingFields.length > 0) {
      toast.error(t("editor.fillIn", { fields: rendered.missingFields.join(", ") }));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/orders", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          existing
            ? { id: existing.id, number, issuedAt, values }
            : { templateCode: template.code, number, issuedAt, values }
        ),
      });
      const data = (await response.json().catch(() => null)) as
        | { id?: string; error?: string }
        | null;
      if (!response.ok) throw new Error(data?.error ?? t("editor.saveFailed"));

      toast.success(existing ? t("editor.updated") : t("editor.added"));
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      if (returnTo) {
        // Из быстрого старта: сразу назад, там прогресс «Оформлено N из M»
        // уже учтёт этот приказ.
        router.push(returnTo);
        router.refresh();
        return;
      }
      if (!existing && data?.id) {
        router.replace(`/orders/${template.code}?id=${data.id}`);
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function setField(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-5">
      {returnTo ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-[#5566f6]/25 bg-[#f5f6ff] p-3.5 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <p className="text-[13px] leading-snug text-[#3c4053]">
            {t("editor.fromOnboarding")}
          </p>
          <Link
            href={returnTo}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:self-auto"
          >
            <ArrowLeft className="size-4 text-[#5566f6]" />
            {t("editor.toOnboarding")}
          </Link>
        </div>
      ) : null}
      <div className="print:hidden">
        <PageHeader
          eyebrow={t("editor.eyebrow")}
          title={template.title}
          description={template.purpose}
          actions={
            <>
              <PrintJournalButton label={t("editor.print")} />
              {canManage ? (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60"
                >
                  <Save className="size-4" />
                  {saving
                    ? t("editor.saving")
                    : existing
                      ? t("editor.saveChanges")
                      : t("editor.saveToRegistry")}
                </button>
              ) : null}
            </>
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* Форма */}
        <div className="space-y-4 print:hidden">
          <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("editor.orderData")}
            </div>
            <div className="space-y-3.5">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
                  {t("editor.number")}
                </span>
                <input
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                  placeholder={t("editor.numberPlaceholder")}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
                  {t("editor.issueDate")}
                </span>
                <input
                  type="date"
                  value={issuedAt}
                  onChange={(event) => setIssuedAt(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>

              {template.fields.map((field) => (
                <label key={field.key} className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
                    {field.label}
                    {field.required ? (
                      <span className="ml-1 text-[#a13a32]">*</span>
                    ) : null}
                  </span>
                  {field.kind === "textarea" ? (
                    <textarea
                      value={values[field.key] ?? ""}
                      onChange={(event) => setField(field.key, event.target.value)}
                      rows={4}
                      className="w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-2.5 text-[14px] leading-[1.5] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                    />
                  ) : (
                    <input
                      type={field.kind === "date" ? "date" : "text"}
                      value={values[field.key] ?? ""}
                      onChange={(event) => setField(field.key, event.target.value)}
                      className={FIELD_CLASS}
                    />
                  )}
                  {field.hint ? (
                    <span className="mt-1 block text-[12px] text-[#9b9fb3]">
                      {field.hint}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </div>

          {!org.directorName ? (
            <div className="flex gap-3 rounded-2xl border border-[#5566f6]/25 bg-[#f5f6ff] p-4">
              <Info className="size-4 shrink-0 text-[#3848c7]" />
              <p className="text-[12.5px] leading-[1.5] text-[#3c4053]">
                {t("editor.missingRequisites")}
              </p>
            </div>
          ) : null}
        </div>

        {/* Лист приказа. На печати остаётся только он. */}
        <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <article className="mx-auto max-w-[720px] text-[14px] leading-[1.6] text-[#0b1024]">
            {brand?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" className="mx-auto mb-3 h-12 w-auto max-w-[200px] object-contain" />
            ) : null}
            <div className="text-center text-[15px] font-semibold">
              {org.orgName || " "}
            </div>
            {orderRequisitesLine(org) ? (
              <div className="mt-1 text-center text-[12px] text-[#6f7282]">
                {orderRequisitesLine(org)}
              </div>
            ) : null}
            {brand?.color ? (
              // `data-print-keep-bg` — опт-аут из ч/б сброса печати кабинета (`app-theme.css`).
              <div
                aria-hidden
                data-print-keep-bg
                className="mt-3 h-[3px] rounded-full [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
                style={{ background: brandPalette(brand.color).ink }}
              />
            ) : null}

            <div className="mt-8 text-center text-[18px] font-semibold tracking-[-0.01em]">
              {rendered.heading}
            </div>
            <div className="mt-2 text-center text-[15px] font-semibold">
              {rendered.title}
            </div>

            <div className="mt-6 flex items-baseline justify-between text-[13.5px]">
              <span>{rendered.city}</span>
              <span>{rendered.dateLine}</span>
            </div>

            <p className="mt-6 text-justify">{rendered.preamble}</p>

            <div className="mt-4 space-y-2">
              {rendered.body.map((paragraph, index) => (
                <p
                  key={index}
                  className={
                    paragraph.startsWith("—")
                      ? "pl-5 text-justify"
                      : "text-justify"
                  }
                >
                  {paragraph}
                </p>
              ))}
            </div>

            <div className="mt-12 flex items-end justify-between gap-6">
              <span className="text-[13.5px]">{rendered.signature.post}</span>
              <span className="flex-1 border-b border-[#0b1024] print:border-black" />
              <span className="text-[13.5px]">{rendered.signature.name}</span>
            </div>

            <div className="mt-10 text-[13px]">
              <div className="mb-3 font-medium">{t("editor.acknowledgedBy")}</div>
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="mb-5 flex gap-8">
                  {/* Линии на бумаге — серые (ч/б принтеры), не сине-серые. */}
                  <span className="flex-1 border-b border-[#dcdfed] print:border-[#e0e0e0]" />
                  <span className="w-[180px] border-b border-[#dcdfed] print:border-[#e0e0e0]" />
                </div>
              ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
