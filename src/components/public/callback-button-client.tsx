"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Phone } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { phoneInputProps, RU_PHONE_PLACEHOLDER } from "@/lib/phone-input";
import { ymGoal } from "@/lib/signup-source";
import { cn } from "@/lib/utils";

/**
 * «Перезвоните мне» на первом экране (спека conversion-pack-2026-11): для
 * общепита звонок часто проще регистрации. Телефон и имя — заявка уходит
 * в обращения сайта (CRM и Telegram продаж), как форма «Контакты».
 */
export function CallbackButtonClient({ place, tone = "dark", topic }: { place: string; tone?: "dark" | "light"; topic?: string }) {
  const t = useTranslations("publicCallback");
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) {
      setError(t("phoneRequired"));
      return;
    }
    setError(null);
    setSending(true);
    // Обращение читают администраторы платформы — текст по-русски на любом языке сайта.
    const message = [
      "Просят перезвонить (кнопка «Перезвоните мне» на сайте).",
      name.trim() ? `Имя: ${name.trim()}.` : null,
      topic ? `Тема: ${topic}.` : null,
      `Страница: ${window.location.pathname}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const response = await fetch("/api/public/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "support", message, email: "", phone: phone.trim(), company }),
      });
      if (!response.ok) {
        setError(t("failed"));
        return;
      }
      ymGoal("callback_request", { place });
      toast.success(t("sent"));
      setOpen(false);
      setPhone("");
      setName("");
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
        onClick={() => {
          ymGoal("callback_open", { place });
          setOpen(true);
        }}
        data-testid="callback-button"
        className={cn(
          "inline-flex h-12 items-center gap-2 rounded-2xl px-4 text-[15px] font-medium transition-colors",
          tone === "dark" ? "text-white/85 hover:bg-white/10 hover:text-white" : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
        )}
      >
        <Phone className="size-4" />
        {t("button")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl border-[#ececf4] bg-white text-[#0b1024] sm:max-w-[420px]" data-testid="callback-dialog">
          <DialogHeader className="text-left">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.02em]">{t("title")}</DialogTitle>
            <DialogDescription className="text-[14px] leading-[1.55] text-[#6f7282]">{t("lead")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-[#3c4053]">{t("phone")}</span>
              <input
                {...phoneInputProps(phone, (next) => {
                  setPhone(next);
                  if (error) setError(null);
                })}
                placeholder={RU_PHONE_PLACEHOLDER}
                className={cn(
                  "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15",
                  error && "border-[#e2675b]",
                )}
                data-testid="callback-phone"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-[#3c4053]">{t("name")}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                maxLength={120}
                className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </label>
            {/* Ловушка для ботов: человек это поле не видит. */}
            <input type="text" name="company" value={company} onChange={(event) => setCompany(event.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            {error ? <p className="text-[13px] text-[#c0392b]">{error}</p> : null}
            <button
              type="submit"
              disabled={sending}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-60"
              data-testid="callback-submit"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
              {t("submit")}
            </button>
            <p className="text-[12px] leading-[1.5] text-[#9b9fb3]">{t("hint")}</p>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
