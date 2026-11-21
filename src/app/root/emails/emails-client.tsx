"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Info, MailCheck, Monitor, Paperclip, Smartphone, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import { CARD, Notice, PRIMARY, SECTION_LABEL } from "../mailing/ui";

type EmailLocale = "ru" | "en" | "uz";

export type CatalogGroupView = {
  key: string;
  title: string;
  items: Array<{ id: string; title: string; localized: boolean }>;
};

export type SelectedEmailView = {
  id: string;
  title: string;
  when: string;
  locale: EmailLocale;
  locales: EmailLocale[];
  subject: string;
  preheader: string | null;
  html: string;
  text: string;
  attachments: string[];
};

type SendResponse = { ok: boolean; code?: string; to?: string; delivered?: boolean; configured?: boolean };

const LOCALE_LABEL: Record<EmailLocale, string> = { ru: "RU", en: "EN", uz: "UZ" };

function hrefFor(id: string, locale: EmailLocale | null): string {
  return locale && locale !== "ru" ? `/root/emails?id=${id}&locale=${locale}` : `/root/emails?id=${id}`;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-2xl border border-[#ececf4] bg-[#f7f8fc] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors duration-150 [&_svg]:size-4",
            option.value === value ? "bg-white text-[#0b1024] shadow-[0_1px_2px_rgba(11,16,36,0.08)]" : "text-[#6f7282] hover:text-[#0b1024]",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * ROOT → «Письма»: список писем сайта, предпросмотр выбранного (телефон /
 * компьютер, письмо / текст), тема, строка во входящих и «Прислать мне».
 * Письмо приходит с сервера готовым HTML; во фрейме без скриптов
 * (`sandbox`), ссылки открываются в новой вкладке.
 */
export function EmailsCatalogClient({ groups, selected }: { groups: CatalogGroupView[]; selected: SelectedEmailView }) {
  const t = useTranslations("rootEmails");
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [view, setView] = useState<"email" | "text">("email");
  const [width, setWidth] = useState<"phone" | "desktop">("phone");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; message: string } | null>(null);
  const localized = selected.locales.length > 1;
  const srcDoc = selected.html.replace("<head>", '<head><base target="_blank">');

  // Высота фрейма — по письму, чтобы читать его целиком, без второй прокрутки.
  function fitFrame() {
    const node = frame.current;
    const doc = node?.contentDocument;
    if (node && doc?.documentElement) node.style.height = `${Math.max(420, doc.documentElement.scrollHeight)}px`;
  }

  useEffect(() => {
    if (view !== "email") return;
    const id = window.requestAnimationFrame(fitFrame);
    return () => window.cancelAnimationFrame(id);
  }, [width, view, srcDoc]);

  async function sendSample() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/root/emails/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, locale: selected.locale }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as SendResponse | null;
      if (data?.ok && data.configured === false) setNotice({ tone: "info", message: t("send.logged") });
      else if (data?.ok && data.delivered) setNotice({ tone: "info", message: t("send.sent", { email: data.to ?? "" }) });
      else if (data?.code === "no_email") setNotice({ tone: "danger", message: t("send.noEmail") });
      else if (data?.code === "rate_limited") setNotice({ tone: "danger", message: t("send.rateLimited") });
      else if (data?.code === "unknown") setNotice({ tone: "danger", message: t("send.unknown") });
      else setNotice({ tone: "danger", message: t("send.failed") });
    } catch {
      setNotice({ tone: "danger", message: t("send.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <nav aria-label={t("labels.list")} className={cn(CARD, "hidden h-fit lg:block")} data-testid="emails-list">
        {groups.map((group) => (
          <div key={group.key} className="mb-5 last:mb-0">
            <div className={SECTION_LABEL}>{group.title}</div>
            <ul className="mt-2 space-y-0.5">
              {group.items.map((item) => {
                const active = item.id === selected.id;
                return (
                  <li key={item.id}>
                    <Link
                      href={hrefFor(item.id, item.localized ? selected.locale : null)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[14px] leading-snug transition-colors duration-150",
                        active ? "bg-[#f5f6ff] font-medium text-[#3848c7]" : "text-[#0b1024] hover:bg-[#f7f8fc]",
                      )}
                    >
                      <span className="min-w-0">{item.title}</span>
                      {item.localized ? <span className="shrink-0 text-[11px] font-medium tracking-[0.04em] text-[#9b9fb3]">RU·EN·UZ</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="min-w-0 space-y-4">
        <label className="block lg:hidden">
          <span className={SECTION_LABEL}>{t("labels.list")}</span>
          <select
            value={selected.id}
            onChange={(event) => {
              const next = groups.flatMap((group) => group.items).find((item) => item.id === event.target.value);
              if (next) router.push(hrefFor(next.id, next.localized ? selected.locale : null));
            }}
            className="mt-2 h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            data-testid="emails-picker"
          >
            {groups.map((group) => (
              <optgroup key={group.key} label={group.title}>
                {group.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <section className={CARD} data-testid="email-preview-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">{selected.title}</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-[#6f7282]">
                <span className="font-medium text-[#3c4053]">{t("labels.when")}:</span> {selected.when}
              </p>
            </div>
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => void sendSample()} data-testid="email-send-sample">
              <MailCheck className="size-4" />
              {busy ? t("send.sending") : t("send.action")}
            </button>
          </div>

          {notice ? (
            <div className="mt-4">
              <Notice tone={notice.tone} icon={notice.tone === "info" ? <CheckCircle2 /> : <XCircle />} testId="email-send-result">
                {notice.message}
              </Notice>
            </div>
          ) : null}

          <dl className="mt-5 grid gap-x-4 gap-y-2 text-[14px] leading-relaxed sm:grid-cols-[150px_minmax(0,1fr)]">
            <dt className="text-[#6f7282]">{t("labels.subject")}</dt>
            <dd className="font-medium text-[#0b1024] [overflow-wrap:anywhere]" data-testid="email-subject">{selected.subject}</dd>
            <dt className="text-[#6f7282]">{t("labels.inbox")}</dt>
            <dd className="text-[#3c4053] [overflow-wrap:anywhere]" data-testid="email-preheader">{selected.preheader ?? "—"}</dd>
            {selected.attachments.length ? (
              <>
                <dt className="text-[#6f7282]">{t("labels.attachments")}</dt>
                <dd className="flex flex-wrap gap-2 text-[#3c4053]">
                  {selected.attachments.map((name) => (
                    <span key={name} className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f6ff] px-3 py-0.5 text-[13px] text-[#3848c7]">
                      <Paperclip className="size-3.5" />
                      {name}
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {localized ? (
              <div role="group" aria-label={t("labels.language")} className="inline-flex rounded-2xl border border-[#ececf4] bg-[#f7f8fc] p-1">
                {selected.locales.map((locale) => (
                  <Link
                    key={locale}
                    href={hrefFor(selected.id, locale)}
                    aria-current={locale === selected.locale ? "true" : undefined}
                    className={cn(
                      "inline-flex h-8 items-center rounded-xl px-3 text-[13px] font-medium transition-colors duration-150",
                      locale === selected.locale ? "bg-white text-[#0b1024] shadow-[0_1px_2px_rgba(11,16,36,0.08)]" : "text-[#6f7282] hover:text-[#0b1024]",
                    )}
                  >
                    {LOCALE_LABEL[locale]}
                  </Link>
                ))}
              </div>
            ) : (
              <span className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#ececf4] px-3 text-[13px] text-[#6f7282]">
                <Info className="size-4 text-[#9b9fb3]" />
                {t("labels.onlyRussian")}
              </span>
            )}
            <Segmented
              label={t("labels.view")}
              value={view}
              onChange={setView}
              options={[
                { value: "email", label: t("labels.viewEmail") },
                { value: "text", label: t("labels.viewText") },
              ]}
            />
            {view === "email" ? (
              <Segmented
                label={t("labels.preview")}
                value={width}
                onChange={setWidth}
                options={[
                  { value: "phone", label: t("labels.widthPhone"), icon: <Smartphone /> },
                  { value: "desktop", label: t("labels.widthDesktop"), icon: <Monitor /> },
                ]}
              />
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-[#ececf4] bg-[#f4f5fb] p-3 sm:p-5">
            {view === "email" ? (
              <iframe
                ref={frame}
                key={`${selected.id}:${selected.locale}`}
                title={t("labels.preview")}
                srcDoc={srcDoc}
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                onLoad={fitFrame}
                className="mx-auto block max-w-full rounded-xl border-0 bg-white shadow-[0_1px_3px_rgba(11,16,36,0.08)]"
                style={{ width: width === "phone" ? 390 : "100%", height: 640 }}
                data-testid="email-frame"
              />
            ) : (
              <pre
                className="mx-auto max-w-[640px] whitespace-pre-wrap rounded-xl bg-white p-5 font-sans text-[14px] leading-relaxed text-[#1f2130] [overflow-wrap:anywhere]"
                data-testid="email-text"
              >
                {selected.text}
              </pre>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
