"use client";

import { AlertTriangle, Copy, Download, FileText, Loader2, Mail, Monitor, Save, Smartphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { OrgSphere } from "@/lib/org-profile";
import { mskInputToDate } from "@/lib/promo/promotions";
import type { ProposalSender } from "@/lib/proposal/types";
import { cn } from "@/lib/utils";

type PromoOption = {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  lifetime: boolean;
  endsAt: string | null;
  label: string;
};

type Preview = {
  webUrl: string;
  pdfUrl: string;
  email: { subject: string; preheader: string; html: string; text: string; bytes: number };
  content: { title: string; subject: string; preheader: string; ctaUrl: string };
  warnings: string[];
  promoSource: "none" | "database" | "manual";
};

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const CARD = "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6";
const LABEL = "mb-1.5 block text-[13px] font-medium text-[#3c4053]";
const SECTION = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";
const BUTTON_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60";
const BUTTON_OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

const NO_PROMO = "__none";
const MANUAL_PROMO = "__manual";

/** Конец дня по Москве для «Действует до» (как у промокодов). */
function mskDayEnd(date: string): string | null {
  const end = date ? mskInputToDate(`${date}T23:59`) : null;
  return end ? new Date(end.getTime() + 59_999).toISOString() : null;
}

function senderEquals(a: ProposalSender | null, b: ProposalSender | null): boolean {
  const norm = (s: ProposalSender | null) =>
    JSON.stringify([s?.name ?? "", s?.phone ?? "", s?.email ?? "", s?.telegram ?? ""].map((v) => v.trim()));
  return norm(a) === norm(b);
}

export function ProposalsClient({
  spheres,
  promoOptions,
  savedSender,
  fallbackSender,
  rootEmail,
}: {
  spheres: Array<{ sphere: OrgSphere; label: string }>;
  promoOptions: PromoOption[];
  savedSender: ProposalSender | null;
  fallbackSender: ProposalSender;
  rootEmail: string | null;
}) {
  const [sphere, setSphere] = useState<OrgSphere>("restaurant");
  const [companyName, setCompanyName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [promoChoice, setPromoChoice] = useState<string>(promoOptions[0]?.code ?? NO_PROMO);
  const [manual, setManual] = useState({ code: "", kind: "percent" as "percent" | "fixed", value: "10", lifetime: true, endsAt: "" });
  const [defaultSender, setDefaultSender] = useState<ProposalSender | null>(savedSender);
  const initialSender = savedSender ?? fallbackSender;
  const [sender, setSender] = useState({
    name: initialSender.name,
    phone: initialSender.phone ?? "",
    email: initialSender.email ?? "",
    telegram: initialSender.telegram ? `@${initialSender.telegram}` : "",
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pdf" | "email">("pdf");
  const [emailWidth, setEmailWidth] = useState<390 | 600>(600);
  const [busy, setBusy] = useState<null | "pdf" | "link" | "email" | "sender">(null);
  const [issuedLink, setIssuedLink] = useState<string | null>(null);
  const requestId = useRef(0);

  const selectedOption = promoOptions.find((option) => option.code === promoChoice) ?? null;

  const form = useMemo(() => {
    const promoCode =
      promoChoice === NO_PROMO ? null : promoChoice === MANUAL_PROMO ? manual.code.trim() || null : promoChoice;
    const value = Number(manual.value);
    return {
      sphere,
      companyName: companyName.trim() || null,
      recipientName: recipientName.trim() || null,
      promoCode,
      manualPromo:
        promoChoice === MANUAL_PROMO && Number.isInteger(value) && value > 0
          ? { kind: manual.kind, value, lifetime: manual.lifetime, endsAt: manual.lifetime ? null : mskDayEnd(manual.endsAt) }
          : null,
      sender: sender.name.trim()
        ? {
            name: sender.name.trim(),
            phone: sender.phone.trim() || null,
            email: sender.email.trim() || null,
            telegram: sender.telegram.trim() || null,
          }
        : null,
    };
  }, [sphere, companyName, recipientName, promoChoice, manual, sender]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const response = await fetch("/api/root/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => null)) as (Preview & { error?: string }) | null;
      if (id !== requestId.current) return;
      if (!response.ok || !data || data.error) throw new Error(data?.error ?? "Не удалось собрать предпросмотр");
      setPreview(data);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [form]);

  // Предпросмотр — через полсекунды после последнего изменения формы.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 500);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function issue(action: "pdf" | "link") {
    setBusy(action);
    try {
      const response = await fetch("/api/root/proposals/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, form }),
      });
      const data = (await response.json().catch(() => null)) as { webUrl?: string; downloadUrl?: string; error?: string } | null;
      if (!response.ok || !data?.webUrl) throw new Error(data?.error ?? "Не удалось подготовить ссылку");
      if (action === "pdf" && data.downloadUrl) {
        const link = document.createElement("a");
        link.href = data.downloadUrl;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success("PDF скачивается");
      } else {
        setIssuedLink(data.webUrl);
        try {
          await navigator.clipboard.writeText(data.webUrl);
          toast.success("Ссылка на веб-версию скопирована");
        } catch {
          // Буфер обмена недоступен (http, запрет браузера) — ссылка остаётся в поле ниже.
          toast.info("Скопируйте ссылку из поля под кнопками");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("email");
    try {
      const response = await fetch("/api/root/proposals/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => null)) as { to?: string; delivery?: "smtp" | "log"; error?: string } | null;
      if (!response.ok || !data?.to) throw new Error(data?.error ?? "Не удалось отправить");
      if (data.delivery === "log") toast.info(`Почта не настроена — письмо для ${data.to} записано в лог сервера`);
      else toast.success(`Тестовое письмо отправлено на ${data.to}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function saveSender() {
    setBusy("sender");
    try {
      const response = await fetch("/api/root/proposals/sender", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sender.name,
          phone: sender.phone || null,
          email: sender.email || null,
          telegram: sender.telegram || null,
        }),
      });
      const data = (await response.json().catch(() => null)) as { sender?: ProposalSender; error?: string } | null;
      if (!response.ok || !data?.sender) throw new Error(data?.error ?? "Не удалось сохранить");
      setDefaultSender(data.sender);
      toast.success("Отправитель по умолчанию сохранён");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  const formSender: ProposalSender | null = form.sender
    ? { ...form.sender, telegram: form.sender.telegram?.replace(/^@/, "") ?? null }
    : null;
  const senderIsDefault = senderEquals(formSender, defaultSender);

  return (
    <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className={CARD} data-testid="kp-form">
          <h2 className={SECTION}>Кому</h2>
          <div className="mt-4 space-y-3.5">
            <div>
              <label className={LABEL} htmlFor="kp-sphere">
                Сфера
              </label>
              <Select value={sphere} onValueChange={(value) => setSphere(value as OrgSphere)}>
                <SelectTrigger id="kp-sphere" data-testid="kp-sphere" className="h-11 w-full rounded-2xl border-[#dcdfed] bg-white text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {spheres.map((item) => (
                    <SelectItem key={item.sphere} value={item.sphere}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className={LABEL} htmlFor="kp-company">
                Компания <span className="font-normal text-[#9b9fb3]">— как в обращении, до 120 знаков</span>
              </label>
              <input
                id="kp-company"
                data-testid="kp-company"
                className={INPUT}
                value={companyName}
                maxLength={120}
                placeholder="Кафе «Ромашка»"
                onChange={(event) => setCompanyName(event.target.value)}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="kp-recipient">
                Имя адресата
              </label>
              <input
                id="kp-recipient"
                data-testid="kp-recipient"
                className={INPUT}
                value={recipientName}
                maxLength={80}
                placeholder="Анна Сергеевна"
                onChange={(event) => setRecipientName(event.target.value)}
              />
            </div>
          </div>
        </section>

        <section className={CARD}>
          <h2 className={SECTION}>Промокод</h2>
          <div className="mt-4 space-y-3.5">
            <Select value={promoChoice} onValueChange={setPromoChoice}>
              <SelectTrigger data-testid="kp-promo" className="h-11 w-full rounded-2xl border-[#dcdfed] bg-white text-[14px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROMO}>Без промокода</SelectItem>
                {promoOptions.map((option) => (
                  <SelectItem key={option.code} value={option.code}>
                    {option.label}
                  </SelectItem>
                ))}
                <SelectItem value={MANUAL_PROMO}>Ввести вручную…</SelectItem>
              </SelectContent>
            </Select>
            {selectedOption ? (
              <p className="text-[13px] leading-relaxed text-[#6f7282]">
                Условия — из «Промокодов»: {selectedOption.kind === "percent" ? `−${selectedOption.value} %` : `−${selectedOption.value} ₽`}
                {selectedOption.lifetime ? ", навсегда" : selectedOption.endsAt ? ", со сроком" : ", без срока"}. QR в КП
                ведёт на wesetup.ru/promo/{selectedOption.code} — код применится сам.
              </p>
            ) : null}
            {promoChoice === MANUAL_PROMO ? (
              <div className="space-y-3 rounded-2xl bg-[#fafbff] p-3.5">
                <input
                  data-testid="kp-manual-code"
                  className={INPUT}
                  value={manual.code}
                  maxLength={32}
                  placeholder="ROMASHKA10"
                  onChange={(event) => setManual((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))}
                />
                <div className="grid grid-cols-[1fr_120px] gap-2">
                  <div className="flex rounded-2xl border border-[#dcdfed] bg-white p-1">
                    {(["percent", "fixed"] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => setManual((prev) => ({ ...prev, kind }))}
                        className={cn(
                          "h-9 flex-1 rounded-xl text-[13.5px] transition-colors duration-150",
                          manual.kind === kind ? "bg-[#eef1ff] font-medium text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]",
                        )}
                      >
                        {kind === "percent" ? "Процент" : "Рубли"}
                      </button>
                    ))}
                  </div>
                  <input
                    data-testid="kp-manual-value"
                    className={INPUT}
                    inputMode="numeric"
                    value={manual.value}
                    onChange={(event) => setManual((prev) => ({ ...prev, value: event.target.value.replace(/\D/g, "") }))}
                  />
                </div>
                <label className="flex items-center justify-between gap-3 text-[13.5px] text-[#0b1024]">
                  Скидка навсегда
                  <Switch checked={manual.lifetime} onCheckedChange={(value) => setManual((prev) => ({ ...prev, lifetime: value }))} />
                </label>
                {!manual.lifetime ? (
                  <div>
                    <label className={LABEL}>Действует до (включительно, по Москве)</label>
                    <input
                      type="date"
                      className={INPUT}
                      value={manual.endsAt}
                      onChange={(event) => setManual((prev) => ({ ...prev, endsAt: event.target.value }))}
                    />
                  </div>
                ) : null}
                <p className="text-[12.5px] leading-relaxed text-[#a13a32]">
                  Код, которого нет в «Промокодах», на сайте не сработает — создайте его с теми же условиями.
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className={CARD}>
          <div className="flex items-center justify-between gap-3">
            <h2 className={SECTION}>Отправитель</h2>
            {senderIsDefault ? (
              <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] text-[#3848c7]">по умолчанию</span>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3">
            <input
              data-testid="kp-sender-name"
              className={INPUT}
              value={sender.name}
              maxLength={120}
              placeholder="Имя и должность"
              onChange={(event) => setSender((prev) => ({ ...prev, name: event.target.value }))}
            />
            <input
              className={INPUT}
              value={sender.phone}
              maxLength={60}
              placeholder="Телефон"
              data-testid="kp-sender-phone"
              onChange={(event) => setSender((prev) => ({ ...prev, phone: event.target.value }))}
            />
            <input
              className={INPUT}
              value={sender.email}
              maxLength={120}
              placeholder="Почта"
              data-testid="kp-sender-email"
              onChange={(event) => setSender((prev) => ({ ...prev, email: event.target.value }))}
            />
            <input
              className={INPUT}
              value={sender.telegram}
              maxLength={64}
              placeholder="Telegram: @username"
              data-testid="kp-sender-telegram"
              onChange={(event) => setSender((prev) => ({ ...prev, telegram: event.target.value }))}
            />
            <button
              type="button"
              data-testid="kp-save-sender"
              className={BUTTON_OUTLINE}
              disabled={busy !== null || !sender.name.trim() || senderIsDefault}
              onClick={() => void saveSender()}
            >
              {busy === "sender" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4 text-[#5566f6]" />}
              Сохранить как отправителя по умолчанию
            </button>
          </div>
        </section>

        <section className={CARD}>
          <h2 className={SECTION}>Готовое КП</h2>
          <div className="mt-4 grid gap-2.5">
            <button type="button" data-testid="kp-download" className={BUTTON_PRIMARY} disabled={busy !== null || !preview} onClick={() => void issue("pdf")}>
              {busy === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Скачать PDF
            </button>
            <button type="button" data-testid="kp-copy-link" className={BUTTON_OUTLINE} disabled={busy !== null || !preview} onClick={() => void issue("link")}>
              {busy === "link" ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4 text-[#5566f6]" />}
              Скопировать ссылку на веб-версию
            </button>
            <button type="button" data-testid="kp-test-email" className={BUTTON_OUTLINE} disabled={busy !== null || !preview || !rootEmail} onClick={() => void sendTest()}>
              {busy === "email" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4 text-[#5566f6]" />}
              Отправить мне тестовое письмо
            </button>
            {issuedLink ? (
              <input
                readOnly
                data-testid="kp-issued-link"
                className={cn(INPUT, "text-[12.5px] text-[#3c4053]")}
                value={issuedLink}
                onFocus={(event) => event.currentTarget.select()}
              />
            ) : null}
            <p className="text-[12.5px] leading-relaxed text-[#6f7282]">
              Письмо уйдёт на {rootEmail ?? "почту вашего аккаунта"}. Скачивание PDF и ссылка записываются в «Аудит».
            </p>
          </div>
          {preview && preview.warnings.length > 0 ? (
            <ul data-testid="kp-warnings" className="mt-4 space-y-2">
              {preview.warnings.map((warning) => (
                <li key={warning} className="flex gap-2 rounded-2xl bg-[#fff8eb] px-3 py-2 text-[13px] leading-relaxed text-[#7a4a00]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section className={cn(CARD, "min-w-0")} data-testid="kp-preview">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-2xl border border-[#dcdfed] bg-white p-1">
            {(
              [
                ["pdf", "PDF · А4", FileText],
                ["email", "Письмо", Mail],
              ] as const
            ).map(([key, title, Icon]) => (
              <button
                key={key}
                type="button"
                data-testid={`kp-tab-${key}`}
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13.5px] transition-colors duration-150",
                  tab === key ? "bg-[#eef1ff] font-medium text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]",
                )}
              >
                <Icon className="size-4" />
                {title}
              </button>
            ))}
          </div>
          {tab === "email" ? (
            <div className="flex rounded-2xl border border-[#dcdfed] bg-white p-1">
              {(
                [
                  [390, "Телефон 390", Smartphone],
                  [600, "Компьютер 600", Monitor],
                ] as const
              ).map(([width, title, Icon]) => (
                <button
                  key={width}
                  type="button"
                  data-testid={`kp-width-${width}`}
                  onClick={() => setEmailWidth(width)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] transition-colors duration-150",
                    emailWidth === width ? "bg-[#eef1ff] font-medium text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]",
                  )}
                >
                  <Icon className="size-4" />
                  {title}
                </button>
              ))}
            </div>
          ) : null}
          {loading ? <Loader2 className="size-4 animate-spin text-[#5566f6]" aria-label="Обновляем" /> : null}
        </div>

        {error ? (
          <p className="mt-4 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] text-[#a13a32]">{error}</p>
        ) : null}

        {preview ? (
          tab === "pdf" ? (
            <iframe
              key={preview.pdfUrl}
              data-testid="kp-pdf-frame"
              title="КП — PDF"
              src={`${preview.pdfUrl}#view=FitH&navpanes=0`}
              className="mt-4 h-[78vh] min-h-[560px] w-full rounded-2xl border border-[#ececf4] bg-[#f4f5fb]"
            />
          ) : (
            <div className="mt-4">
              <div className="rounded-2xl bg-[#fafbff] px-4 py-3 text-[13px] leading-relaxed text-[#3c4053]">
                <p>
                  <span className="text-[#6f7282]">Тема:</span> <span data-testid="kp-email-subject" className="font-medium text-[#0b1024]">{preview.email.subject}</span>
                </p>
                <p className="mt-0.5">
                  <span className="text-[#6f7282]">Прехедер:</span> {preview.email.preheader}
                </p>
                <p className="mt-0.5 text-[#6f7282]">
                  HTML {Math.round(preview.email.bytes / 102.4) / 10} КБ · есть текстовая версия
                </p>
              </div>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-[#ececf4] bg-[#f4f5fb] p-3">
                <iframe
                  data-testid="kp-email-frame"
                  title="КП — письмо"
                  srcDoc={preview.email.html}
                  style={{ width: emailWidth }}
                  className="mx-auto block h-[78vh] min-h-[560px] rounded-xl border-0 bg-white"
                />
              </div>
            </div>
          )
        ) : (
          <div className="mt-4 flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] text-[14px] text-[#6f7282]">
            {loading ? "Собираем предпросмотр…" : "Предпросмотр появится здесь"}
          </div>
        )}
      </section>
    </div>
  );
}
