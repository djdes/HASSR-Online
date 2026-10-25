"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Lock, Minus, Plus, Truck } from "lucide-react";
import { toast } from "sonner";

import { formatNumber, type Locale } from "@/i18n/locales";
import {
  HARDWARE_BUNDLES,
  HARDWARE_DEVICES,
  hardwareTotal,
  type HardwareBundleId,
} from "@/lib/hardware-pricing";
import { cn } from "@/lib/utils";

/**
 * «Доставка оборудования» на странице тарифа (тарифы 2026-10): датчики и
 * планшет, уже привязанные к аккаунту, — возможность «Премиума» и пробного.
 * Набор или свой состав по прайсу → заявка `equipment-delivery` (деньги не
 * списываются, менеджер согласует доставку и монтаж). В «Стандарте» и на
 * бесплатном — замок со ссылкой на тарифы.
 */
export function EquipmentDeliveryCard({
  available,
  defaultName,
  defaultPhone,
  defaultAddress,
}: {
  /** Возможность тарифа `equipmentDelivery`. */
  available: boolean;
  defaultName: string;
  defaultPhone: string;
  defaultAddress: string;
}) {
  const t = useTranslations("settingsUi.equipmentDelivery");
  const tp = useTranslations("publicUi.pricing");
  const locale = useLocale() as Locale;
  const [bundleId, setBundleId] = useState<HardwareBundleId | null>("standard");
  const [quantities, setQuantities] = useState<Record<string, number>>(
    () => HARDWARE_BUNDLES.find((bundle) => bundle.id === "standard")?.composition ?? {}
  );
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [address, setAddress] = useState(defaultAddress);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const total = useMemo(() => hardwareTotal(quantities), [quantities]);
  const rub = (value: number) => `${formatNumber(locale, value)} ₽`;

  if (!available) {
    return (
      <section
        data-testid="equipment-delivery-locked"
        className="flex flex-col gap-4 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#6f7282] ring-1 ring-[#ececf4]">
            <Lock className="size-5" />
          </span>
          <div>
            <div className="text-[16px] font-semibold text-[#0b1024]">{t("title")}</div>
            <p className="mt-1 max-w-[560px] text-[13.5px] leading-[1.55] text-[#6f7282]">{t("lockedText")}</p>
          </div>
        </div>
        <a
          href="#tariffs"
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          {t("upgrade")}
        </a>
      </section>
    );
  }

  const setQty = (id: string, qty: number) => {
    setBundleId(null);
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, Math.min(99, qty)) }));
  };

  async function submit() {
    if (total <= 0) {
      toast.error(t("empty"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/equipment/delivery-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: quantities, contactName: name, contactPhone: phone, address, comment }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? t("failed"));
      toast.success(t("done"));
      setComment("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="equipment-delivery"
      className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Truck className="size-5" />
        </span>
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h2>
          <p className="mt-1 max-w-[680px] text-[13.5px] leading-[1.55] text-[#6f7282]">{t("lead")}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2" role="radiogroup" aria-label={t("bundles")}>
        {HARDWARE_BUNDLES.map((bundle) => (
          <button
            key={bundle.id}
            type="button"
            role="radio"
            aria-checked={bundleId === bundle.id}
            onClick={() => {
              setBundleId(bundle.id);
              setQuantities(bundle.composition);
            }}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-2xl border px-4 text-[14px] font-medium transition-colors",
              bundleId === bundle.id
                ? "border-[#5566f6] bg-[#f5f6ff] text-[#0b1024]"
                : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40"
            )}
          >
            {tp(`bundles.${bundle.id}.name` as never)}
            <span className="text-[12.5px] text-[#6f7282]">{rub(hardwareTotal(bundle.composition))}</span>
          </button>
        ))}
        {bundleId === null ? (
          <span className="inline-flex h-10 items-center rounded-2xl bg-[#eef1ff] px-4 text-[13px] font-medium text-[#3848c7]">
            {t("custom")}
          </span>
        ) : null}
      </div>

      <ul className="mt-4 divide-y divide-[#f2f3f8] rounded-2xl border border-[#ececf4]">
        {HARDWARE_DEVICES.map((device) => {
          const qty = quantities[device.id] ?? 0;
          return (
            <li key={device.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-[#0b1024]">{tp(`devices.${device.id}.title` as never)}</div>
                <div className="text-[12.5px] text-[#6f7282]">{rub(device.price)}{device.mode === "per-unit" ? ` ${tp("perUnit")}` : ""}</div>
              </div>
              {device.mode === "flat" ? (
                <input
                  type="checkbox"
                  checked={qty > 0}
                  onChange={(event) => setQty(device.id, event.target.checked ? 1 : 0)}
                  aria-label={tp("toggleDevice", { device: tp(`devices.${device.id}.title` as never) })}
                  className="size-5 accent-[#5566f6]"
                />
              ) : (
                <div className="inline-flex items-center rounded-2xl border border-[#dcdfed]">
                  <button
                    type="button"
                    aria-label={tp("removeOne")}
                    disabled={qty <= 0}
                    onClick={() => setQty(device.id, qty - 1)}
                    className="flex size-9 items-center justify-center rounded-l-2xl text-[#3c4053] hover:bg-[#f5f6ff] disabled:opacity-40"
                  >
                    <Minus className="size-4" />
                  </button>
                  <span className="min-w-[2rem] text-center text-[14px] font-semibold tabular-nums">{qty}</span>
                  <button
                    type="button"
                    aria-label={tp("addOne")}
                    onClick={() => setQty(device.id, qty + 1)}
                    className="flex size-9 items-center justify-center rounded-r-2xl text-[#3c4053] hover:bg-[#f5f6ff]"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 text-right text-[15px] font-semibold text-[#0b1024]" data-testid="equipment-delivery-total">
        {t("total", { amount: rub(total) })} <span className="text-[13px] font-normal text-[#6f7282]">{t("oneTime")}</span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Field label={t("contactName")}>
          <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} autoComplete="name" />
        </Field>
        <Field label={t("contactPhone")}>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} autoComplete="tel" inputMode="tel" />
        </Field>
        <Field label={t("address")} wide>
          <input value={address} onChange={(event) => setAddress(event.target.value)} className={inputClass} autoComplete="street-address" />
        </Field>
        <Field label={t("comment")} wide>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} className={cn(inputClass, "h-auto py-2.5")} />
        </Field>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          data-testid="equipment-delivery-submit"
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
          {busy ? t("sending") : t("submit")}
        </button>
      </div>
    </section>
  );
}

const inputClass =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn("block", wide && "sm:col-span-2")}>
      <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">{label}</span>
      {children}
    </label>
  );
}
