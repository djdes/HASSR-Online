"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

type Item = {
  line: number;
  name: string;
  quantityLabel: string;
  expiryDate: string | null;
};

type ItemCheck = {
  decision: "accept" | "reject";
  productTemperature: string;
  packagingOk: boolean;
  organolepticOk: boolean;
  expiryDate: string;
  correctiveActions: string;
};

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] outline-none transition-colors focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border px-3 text-[13.5px] font-medium transition-colors ${
        checked ? "border-[#bfe6cf] bg-[#ecfdf5] text-[#136c3e]" : "border-[#f3c9c4] bg-[#fff4f2] text-[#a13a32]"
      }`}
    >
      {checked ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
      {label}
    </button>
  );
}

/**
 * Приёмка накладной: общие отметки поставки и проверка каждой строки.
 * По умолчанию всё «в порядке» и «принять» — человек отмечает только
 * отклонения; у отклонённой строки обязательно, что сделали с товаром.
 */
export function AcceptanceForm({
  documentId,
  items,
  defaults,
}: {
  documentId: string;
  items: Item[];
  defaults: { deliveryDate: string; deliveryTime: string };
}) {
  const t = useTranslations("supplyEdo.document");
  const router = useRouter();
  const [deliveryDate, setDeliveryDate] = useState(defaults.deliveryDate);
  const [deliveryTime, setDeliveryTime] = useState(defaults.deliveryTime);
  const [transportOk, setTransportOk] = useState(true);
  const [documentsOk, setDocumentsOk] = useState(true);
  const [checks, setChecks] = useState<Record<number, ItemCheck>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.line,
        {
          decision: "accept",
          productTemperature: "",
          packagingOk: true,
          organolepticOk: true,
          expiryDate: item.expiryDate ?? "",
          correctiveActions: "",
        },
      ]),
    ),
  );
  const [busy, setBusy] = useState<"accept" | "ignore" | null>(null);

  const update = (line: number, patch: Partial<ItemCheck>) =>
    setChecks((current) => ({ ...current, [line]: { ...current[line], ...patch } }));

  async function submit() {
    if (items.some((item) => checks[item.line].decision === "reject" && !checks[item.line].correctiveActions.trim())) {
      toast.error(t("errors.corrective"));
      return;
    }
    const [hour, minute] = deliveryTime.split(":");
    setBusy("accept");
    try {
      const res = await fetch(`/api/edo/documents/${documentId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delivery: {
            deliveryDate: deliveryDate || undefined,
            deliveryHour: hour && /^\d{2}$/.test(hour) ? hour : undefined,
            deliveryMinute: minute && /^\d{2}$/.test(minute) ? minute : undefined,
            transportOk,
            documentsOk,
          },
          items: items.map((item) => {
            const check = checks[item.line];
            return {
              line: item.line,
              decision: check.decision,
              packagingOk: check.packagingOk,
              organolepticOk: check.organolepticOk,
              productTemperature: check.productTemperature.trim() || undefined,
              expiryDate: check.expiryDate,
              correctiveActions: check.correctiveActions.trim() || undefined,
            };
          }),
        }),
      });
      const body = (await res.json().catch(() => null)) as { rowIds?: string[]; error?: string } | null;
      if (!res.ok || !body?.rowIds) {
        toast.error(body?.error ?? t("errors.failed"));
        return;
      }
      toast.success(t("done", { count: body.rowIds.length }));
      router.refresh();
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function ignore() {
    setBusy("ignore");
    try {
      const res = await fetch(`/api/edo/documents/${documentId}/ignore`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(body?.error ?? t("errors.failed"));
        return;
      }
      toast.success(t("ignored"));
      router.refresh();
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4" data-edo-acceptance>
      <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("checkTitle")}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-[#6f7282]">{t("checkHint")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px] text-[#3c4053]">
            {t("deliveryDate")}
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={`${INPUT} mt-1`} />
          </label>
          <label className="block text-[13px] text-[#3c4053]">
            {t("deliveryTime")}
            <input type="time" value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} className={`${INPUT} mt-1`} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Toggle checked={transportOk} onChange={setTransportOk} label={t("transportOk")} />
          <Toggle checked={documentsOk} onChange={setDocumentsOk} label={t("documentsOk")} />
        </div>
      </div>

      <ul className="space-y-2.5">
        {items.map((item) => {
          const check = checks[item.line];
          const rejected = check.decision === "reject";
          return (
            <li
              key={item.line}
              className={`rounded-2xl border bg-white px-4 py-4 sm:px-5 ${rejected ? "border-[#f3c9c4]" : "border-[#ececf4]"}`}
              data-edo-line={item.line}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold leading-snug text-[#0b1024] [overflow-wrap:anywhere]">{item.name}</div>
                  <div className="mt-0.5 text-[13px] text-[#6f7282]">
                    {t("quantity")}: {item.quantityLabel}
                  </div>
                </div>
                <div className="inline-flex rounded-2xl border border-[#dcdfed] p-1" role="radiogroup">
                  {(["accept", "reject"] as const).map((decision) => (
                    <button
                      key={decision}
                      type="button"
                      role="radio"
                      aria-checked={check.decision === decision}
                      onClick={() => update(item.line, { decision })}
                      className={`h-9 rounded-xl px-3 text-[13px] font-medium transition-colors ${
                        check.decision === decision
                          ? decision === "accept"
                            ? "bg-[#136c3e] text-white"
                            : "bg-[#a13a32] text-white"
                          : "text-[#3c4053] hover:bg-[#f5f6ff]"
                      }`}
                    >
                      {t(decision)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-[13px] text-[#3c4053]">
                  {t("temperature")}
                  <input
                    inputMode="decimal"
                    value={check.productTemperature}
                    onChange={(e) => update(item.line, { productTemperature: e.target.value.slice(0, 20) })}
                    placeholder="+4"
                    className={`${INPUT} mt-1`}
                  />
                </label>
                <label className="block text-[13px] text-[#3c4053]">
                  {t("expiry")}
                  <input
                    type="date"
                    value={check.expiryDate}
                    onChange={(e) => update(item.line, { expiryDate: e.target.value })}
                    className={`${INPUT} mt-1`}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Toggle checked={check.packagingOk} onChange={(value) => update(item.line, { packagingOk: value })} label={t("packagingOk")} />
                <Toggle checked={check.organolepticOk} onChange={(value) => update(item.line, { organolepticOk: value })} label={t("organolepticOk")} />
              </div>
              {rejected ? (
                <label className="mt-3 block text-[13px] text-[#3c4053]">
                  {t("corrective")}
                  <textarea
                    value={check.correctiveActions}
                    onChange={(e) => update(item.line, { correctiveActions: e.target.value.slice(0, 500) })}
                    rows={2}
                    className="mt-1 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-2.5 text-[14px] text-[#0b1024] outline-none focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
                  />
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy !== null}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
          data-edo-submit
        >
          {busy === "accept" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy === "accept" ? t("submitting") : t("submit")}
        </button>
        <div className="text-[13px] text-[#6f7282] sm:text-right">
          <button
            type="button"
            onClick={() => void ignore()}
            disabled={busy !== null}
            className="font-medium text-[#3848c7] underline-offset-2 hover:underline disabled:opacity-60"
          >
            {t("ignore")}
          </button>
          <div className="mt-0.5">{t("ignoreHint")}</div>
        </div>
      </div>
    </section>
  );
}
