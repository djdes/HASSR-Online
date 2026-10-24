"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, Clock3, Copy, Loader2, PauseCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { PageGuide } from "@/components/ui/page-guide";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, Field, Pill, btnOutline, btnPrimary, formatDate, hintClass, inputClass, readError } from "@/components/partner/ui";
import { PARTNER_AGREEMENT_URL, SLUG_MAX, SLUG_MIN, normalizeSlug, suggestSlug, validateSlug } from "@/lib/partners/validation";
import { cn } from "@/lib/utils";

type Membership = {
  partnerId: string;
  role: "owner" | "member";
  status: "pending" | "active" | "rejected" | "suspended";
  slug: string;
  code: string;
  companyName: string;
  brandName: string;
  publicUrl: string;
  reviewComment: string | null;
  createdAt: string;
};

type Payload = {
  membership: Membership | null;
  canApply: boolean;
  prefill: { companyName: string; inn: string; phone: string; city: string; email: string; slug: string };
  types: Record<string, string>;
};

type FormState = {
  companyName: string;
  inn: string;
  type: string;
  city: string;
  phone: string;
  telegram: string;
  contactEmail: string;
  venuesCount: string;
  slug: string;
  termsAccepted: boolean;
};

function useStatusMeta() {
  const t = useTranslations("settingsUi.partnerApplicationClient");
  return {
    pending: { icon: Clock3, tone: "indigo" as const, title: t("statusPendingTitle"), text: t("statusPendingText") },
    active: { icon: CheckCircle2, tone: "ok" as const, title: t("statusActiveTitle"), text: t("statusActiveText") },
    rejected: { icon: XCircle, tone: "danger" as const, title: t("statusRejectedTitle"), text: t("statusRejectedText") },
    suspended: { icon: PauseCircle, tone: "warn" as const, title: t("statusSuspendedTitle"), text: t("statusSuspendedText") },
  };
}

/**
 * Заявка «Стать партнёром» и статус уже поданной. Slug проверяется живьём
 * (`GET /api/settings/partner?slug=`), чтобы человек сразу видел свою
 * будущую ссылку и не получал ошибку после отправки.
 */
export function PartnerApplicationClient() {
  const t = useTranslations("settingsUi.partnerApplicationClient");
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<{ slug: string; available: boolean; error: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/settings/partner", { cache: "no-store" });
      if (!res.ok) {
        toast.error(await readError(res, t("loadFailed")));
        return;
      }
      const payload = (await res.json()) as Payload;
      if (!alive) return;
      setData(payload);
      setForm({
        companyName: payload.prefill.companyName,
        inn: payload.prefill.inn,
        type: "consultant",
        city: payload.prefill.city,
        phone: payload.prefill.phone,
        telegram: "",
        contactEmail: payload.prefill.email,
        venuesCount: "",
        slug: payload.prefill.slug,
        termsAccepted: false,
      });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Пока slug не трогали руками — предлагаем его из названия компании.
  const effectiveSlug = useMemo(() => {
    if (!form) return "";
    return slugTouched ? normalizeSlug(form.slug) : form.slug || suggestSlug(form.companyName);
  }, [form, slugTouched]);

  useEffect(() => {
    if (!form || data?.membership?.status === "pending" || data?.membership?.status === "active") return;
    const check = validateSlug(effectiveSlug);
    if (!check.ok) {
      setSlugState(effectiveSlug ? { slug: effectiveSlug, available: false, error: check.error } : null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/settings/partner?slug=${encodeURIComponent(check.slug)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { slug: string; available: boolean; error: string | null };
        setSlugState(json);
      } catch {
        /* отменено новым вводом */
      }
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSlug]);

  async function copy(key: string, value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      toast.success(t("copiedToast", { label }));
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/partner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          slug: effectiveSlug,
          venuesCount: Number(form.venuesCount) || 0,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, t("submitFailed")));
      toast.success(t("submitted"));
      const refreshed = await fetch("/api/settings/partner", { cache: "no-store" });
      if (refreshed.ok) setData((await refreshed.json()) as Payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!data || !form) {
    return (
      <div className="flex items-center gap-2 rounded-3xl border border-[#ececf4] bg-white px-6 py-10 text-[14px] text-[#6f7282]">
        <Loader2 className="size-4 animate-spin text-[#5566f6]" />
        {t("loading")}
      </div>
    );
  }

  const membership = data.membership;
  const showForm = !membership || membership.status === "rejected";

  return (
    <div className="space-y-5">
      {membership ? <StatusCard membership={membership} copied={copied} onCopy={copy} /> : null}

      {showForm ? (
        <>
          <PageGuide
            storageKey="settings-partner-apply"
            title={t("guideTitle")}
            bullets={[
              { title: t("guide1Title"), body: t("guide1Body") },
              { title: t("guide2Title"), body: t("guide2Body") },
              { title: t("guide3Title"), body: t("guide3Body") },
            ]}
            qa={[
              { q: t("qa1Q"), a: t("qa1A") },
              { q: t("qa2Q"), a: t("qa2A") },
            ]}
          />

          {!data.canApply ? (
            <div className="rounded-3xl border border-[#ececf4] bg-[#fff4f2] px-5 py-4 text-[14px] text-[#a13a32]">
              {t("cannotApply")}
            </div>
          ) : null}

          <form onSubmit={submit}>
            <Card eyebrow={t("cardEyebrow")} title={t("cardTitle")}>
              <p className="mb-4 text-[12px] text-[#6f7282]">
                {t.rich("requiredNote", {
                  req: (chunks) => <span className="text-[#d2453d]">{chunks}</span>,
                })}
              </p>
              <fieldset disabled={!data.canApply || submitting} className="grid gap-4 sm:grid-cols-2">
                <Field label={t("companyName")} required className="sm:col-span-2">
                  <input
                    className={inputClass}
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    maxLength={120}
                    required
                    placeholder={t("companyPlaceholder")}
                  />
                </Field>
                <Field label={t("inn")} required>
                  <input
                    className={inputClass}
                    value={form.inn}
                    onChange={(e) => setForm({ ...form, inn: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                    inputMode="numeric"
                    required
                    placeholder={t("innPlaceholder")}
                  />
                </Field>
                <Field label={t("partnerType")} required>
                  <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {Object.entries(data.types).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("city")} required>
                  <input className={inputClass} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={80} required />
                </Field>
                <Field label={t("venues")} optional hint={t("venuesHint")}>
                  <input
                    className={inputClass}
                    value={form.venuesCount}
                    onChange={(e) => setForm({ ...form, venuesCount: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    inputMode="numeric"
                    placeholder={t("venuesPlaceholder")}
                  />
                </Field>
                <Field label={t("phone")} required>
                  <input className={inputClass} {...phoneInputProps(form.phone, (phone) => setForm({ ...form, phone }))} required placeholder={RU_PHONE_PLACEHOLDER} />
                </Field>
                <Field label={t("telegram")} optional hint={t("telegramHint")}>
                  <input className={inputClass} value={form.telegram} onChange={(e) => setForm({ ...form, telegram: e.target.value })} maxLength={64} placeholder="@username" />
                </Field>
                <Field label={t("contactEmail")} required className="sm:col-span-2">
                  <input className={inputClass} type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} required />
                </Field>
                <div className="sm:col-span-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
                      {t("slugLabel")}
                      <span className="ml-0.5 text-[#d2453d]" aria-hidden>*</span>
                    </span>
                    <div className="flex items-center overflow-hidden rounded-2xl border border-[#dcdfed] bg-white focus-within:border-[#5566f6] focus-within:ring-4 focus-within:ring-[#5566f6]/15">
                      <span className="shrink-0 select-none border-r border-[#ececf4] bg-[#fafbff] px-3 text-[14px] text-[#6f7282]">wesetup.ru/p/</span>
                      <input
                        className="h-11 w-full bg-transparent px-3 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none"
                        value={slugTouched ? form.slug : effectiveSlug}
                        onChange={(e) => {
                          setSlugTouched(true);
                          setForm({ ...form, slug: e.target.value.toLowerCase() });
                        }}
                        maxLength={SLUG_MAX}
                        placeholder="sanpin-consult"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </label>
                  <p className={cn(hintClass, slugState && !slugState.available ? "text-[#a13a32]" : slugState?.available ? "text-[#116b2a]" : undefined)}>
                    {slugState
                      ? slugState.available
                        ? t("slugAvailable", { slug: slugState.slug })
                        : slugState.error ?? t("slugTaken")
                      : t("slugHint", { min: SLUG_MIN, max: SLUG_MAX })}
                  </p>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] leading-[1.5] text-[#3c4053] sm:col-span-2">
                  <Checkbox
                    className="mt-0.5 shrink-0"
                    checked={form.termsAccepted}
                    onCheckedChange={(checked) => setForm({ ...form, termsAccepted: checked === true })}
                    aria-required
                    aria-label={t("termsAria")}
                  />
                  <span>
                    {t("termsLead")}{" "}
                    <Link href={PARTNER_AGREEMENT_URL} target="_blank" className="text-[#3848c7] underline-offset-2 hover:underline">
                      {t("termsLink")}
                    </Link>
                    {t("termsTail")}
                  </span>
                </label>
              </fieldset>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={!data.canApply || submitting || !form.termsAccepted || (slugState ? !slugState.available : false)}
                  className={btnPrimary}
                >
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t("submit")}
                  <ArrowRight className="size-4" />
                </button>
                <Link href="/partners" target="_blank" className={btnOutline}>
                  {t("programmeTerms")}
                </Link>
              </div>
              {data.canApply && !form.termsAccepted ? (
                <p className="mt-2 text-[12px] text-[#a13a32]">
                  {t("termsRequired")}
                </p>
              ) : null}
            </Card>
          </form>
        </>
      ) : null}
    </div>
  );
}

function StatusCard({
  membership,
  copied,
  onCopy,
}: {
  membership: Membership;
  copied: string | null;
  onCopy: (key: string, value: string, label: string) => void;
}) {
  const t = useTranslations("settingsUi.partnerApplicationClient");
  const statusMeta = useStatusMeta();
  const meta = statusMeta[membership.status];
  const Icon = meta.icon;
  return (
    <Card>
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-2xl",
            meta.tone === "ok" && "bg-[#ecfdf5] text-[#116b2a]",
            meta.tone === "indigo" && "bg-[#eef1ff] text-[#3848c7]",
            meta.tone === "warn" && "bg-[#fff7ed] text-[#9a4a06]",
            meta.tone === "danger" && "bg-[#fff4f2] text-[#a13a32]",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">{meta.title}</div>
            <Pill tone={meta.tone}>{membership.brandName}</Pill>
          </div>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">{meta.text}</p>
          <div className="mt-1 text-[12px] text-[#9b9fb3]">{t("applicationFrom", { date: formatDate(membership.createdAt) })}</div>

          {membership.reviewComment && membership.status !== "pending" ? (
            <div className="mt-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 text-[14px] leading-[1.55] text-[#3c4053]">
              <span className="font-medium text-[#0b1024]">{t("reviewComment")}</span> {membership.reviewComment}
            </div>
          ) : null}

          {membership.status === "active" ? (
            <div className="mt-4 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("linkTitle")}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 break-all text-[14px] font-medium text-[#0b1024]">{membership.publicUrl}</code>
                    <button type="button" className={cn(btnOutline, "h-8 px-2.5 text-[13px]")} onClick={() => onCopy("url", membership.publicUrl, t("linkLabel"))}>
                      {copied === "url" ? <Check className="size-3.5 text-[#116b2a]" /> : <Copy className="size-3.5 text-[#5566f6]" />}
                    </button>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("codeTitle")}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="text-[18px] font-semibold tracking-[0.18em] text-[#0b1024]">{membership.code}</code>
                    <button type="button" className={cn(btnOutline, "h-8 px-2.5 text-[13px]")} onClick={() => onCopy("code", membership.code, t("codeLabel"))}>
                      {copied === "code" ? <Check className="size-3.5 text-[#116b2a]" /> : <Copy className="size-3.5 text-[#5566f6]" />}
                    </button>
                  </div>
                </div>
              </div>
              <Link href="/partner" className={btnPrimary}>
                {t("openCabinet")}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
