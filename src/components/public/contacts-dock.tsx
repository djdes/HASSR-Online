"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";

import { ContactUsPanel } from "@/components/contact/contact-us-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * «Задайте вопрос» на каждой публичной странице (правки 05.11.2026: блок
 * «Контакты» / «Оставьте контакт для связи» при прокрутке).
 *
 * Кнопка появляется, когда человек прокрутил первый экран: на первом экране
 * у него уже есть главный призыв, вторая кнопка там только мешает. Стоит
 * слева внизу — справа пузырь чата поддержки.
 *
 * В окне — те же крупные контакты, что и в «Свяжитесь с нами», и под ними
 * форма: контакт и удобный способ связи. Заявка уходит обычным обращением с
 * сайта (`/api/public/feedback`, тип `support`) — администраторам платформы
 * в Telegram и на почту.
 */

const SHOW_AFTER_PX = 480;
const CHANNELS = ["call", "telegram", "max", "email"] as const;
type Channel = (typeof CHANNELS)[number];
const CHANNEL_LABEL_RU: Record<Channel, string> = { call: "звонок", telegram: "Telegram", max: "MAX", email: "почта" };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const INPUT_CLASS =
  "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

export function ContactsDock({ telegramUrl }: { telegramUrl: string | null }) {
  const t = useTranslations("publicSupport.dock");
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [channel, setChannel] = useState<Channel>("call");
  const [question, setQuestion] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = contact.trim();
    if (!value) {
      setError(t("contactRequired"));
      return;
    }
    const looksLikeEmail = EMAIL_RE.test(value);
    if (channel === "email" && !looksLikeEmail) {
      setError(t("emailInvalid"));
      return;
    }
    setError(null);
    setSending(true);
    // Обращение читают администраторы платформы — текст по-русски на любом языке сайта.
    const message = [
      "Просят связаться (блок «Задайте вопрос» на сайте).",
      `Удобный способ связи: ${CHANNEL_LABEL_RU[channel]}.`,
      name.trim() ? `Имя: ${name.trim()}.` : null,
      question.trim() ? `Вопрос: ${question.trim()}` : null,
      `Страница: ${window.location.pathname}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const response = await fetch("/api/public/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "support",
          message,
          email: looksLikeEmail ? value : "",
          phone: looksLikeEmail ? "" : value,
          company,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? t("failed"));
        return;
      }
      toast.success(t("sent"));
      setOpen(false);
      setName("");
      setContact("");
      setQuestion("");
    } catch {
      setError(t("failed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("launcherAria")}
        tabIndex={visible ? 0 : -1}
        aria-hidden={visible ? undefined : true}
        data-contacts-dock
        className={cn(
          "fixed bottom-5 left-5 z-30 inline-flex h-12 items-center gap-2 rounded-full bg-[#0b1024] px-5 text-[15px] font-semibold text-white shadow-[0_14px_30px_-10px_rgba(11,16,36,0.55)] ring-1 ring-white/15 transition-[opacity,transform,background-color] duration-200 hover:bg-[#1a2148] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/30 motion-reduce:transition-none",
          visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
        )}
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <MessageSquareText className="size-[18px] text-[#8e9bf8]" aria-hidden />
        {t("launcher")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-[22px] tracking-[-0.02em]">{t("title")}</DialogTitle>
            <DialogDescription className="text-[14px] leading-[1.55] text-[#6f7282]">{t("lead")}</DialogDescription>
          </DialogHeader>

          <ContactUsPanel telegramUrl={telegramUrl} onBeforeChat={() => setOpen(false)} />

          <form onSubmit={submit} noValidate className="mt-2 space-y-4 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4 sm:p-5">
            <div className="text-[16px] font-semibold text-[#0b1024]">{t("formTitle")}</div>

            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-[#3c4053]">{t("name")}</span>
              <input
                id="contacts-dock-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("namePlaceholder")}
                autoComplete="name"
                maxLength={120}
                className={INPUT_CLASS}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-[#3c4053]">{t("contact")}</span>
              <input
                id="contacts-dock-contact"
                value={contact}
                onChange={(event) => {
                  setContact(event.target.value);
                  if (error) setError(null);
                }}
                placeholder={t("contactPlaceholder")}
                autoComplete="tel"
                maxLength={120}
                aria-invalid={error ? true : undefined}
                className={cn(INPUT_CLASS, error && "border-[#e2675b]")}
              />
            </label>

            <fieldset className="space-y-2">
              <legend className="text-[13px] font-medium text-[#3c4053]">{t("channel")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CHANNELS.map((option) => (
                  <label
                    key={option}
                    className={cn(
                      "flex h-11 cursor-pointer items-center justify-center rounded-2xl border text-[14px] font-medium transition-colors duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#5566f6]/15",
                      channel === option
                        ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                        : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                    )}
                  >
                    <input
                      type="radio"
                      name="contacts-dock-channel"
                      value={option}
                      checked={channel === option}
                      onChange={() => setChannel(option)}
                      className="sr-only"
                    />
                    {t(`channels.${option}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-[#3c4053]">{t("question")}</span>
              <textarea
                id="contacts-dock-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={t("questionPlaceholder")}
                rows={2}
                maxLength={2000}
                className="w-full resize-y rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </label>

            {/* Ловушка для ботов: человек это поле не видит. */}
            <input
              type="text"
              name="company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="hidden"
            />

            {error ? (
              <p role="alert" className="rounded-xl bg-[#fff4f2] px-3 py-2 text-[13px] text-[#a13a32]">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={sending}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-semibold text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              {sending ? t("sending") : t("submit")}
            </button>
            <p className="text-center text-[12px] text-[#9b9fb3]">{t("privacy")}</p>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
