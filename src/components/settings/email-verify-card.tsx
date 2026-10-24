"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

/**
 * Подтверждение почты в настройках.
 *
 * Переехало сюда из анкеты регистрации: там оно блокировало кнопку
 * «Готово», и человек застревал между регистрацией и первым журналом
 * ради шести цифр из письма. Здесь ничего не блокирует — отметка нужна,
 * чтобы мы могли до клиента дописаться, а не для доступа.
 *
 * Карточка исчезает после подтверждения: серверная страница перестаёт
 * её рендерить, пока же обходимся локальным состоянием, чтобы не ждать
 * перезагрузки.
 */
export function EmailVerifyCard({ email }: { email: string }) {
  const t = useTranslations("settingsUi.emailVerifyCard");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/email-verify/send", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t("sendFailed"));
      // Сервер знает, что почта уже подтверждена (например, отметку
      // проставил backfill, а страница отрисована из кэша). Не просим
      // код, которого не будет, — просто убираем карточку.
      if (data?.alreadyVerified) {
        setDone(true);
        toast.success(t("alreadyVerified"));
        return;
      }
      setSent(true);
      toast.success(t("codeSent", { email }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/email-verify/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t("wrongCode"));
      setDone(true);
      toast.success(t("verified"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("wrongCode"));
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;

  return (
    <section
      id="email-verify"
      className="rounded-3xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6"
    >
      {/* На телефоне — сверху вниз: раньше кнопка стояла рядом и
          сжимала текст в колонку по два слова. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] text-white">
          <Mail className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-[#0b1024]">
            {t("title")}
          </div>
          <p className="mt-1 text-[13px] leading-snug text-[#6f7282]">
            {t("description", { email })}
          </p>
        </div>
        </div>

        {sent ? (
          <div className="flex items-center gap-2">
            <input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              placeholder="000000"
              className="h-11 w-full max-w-[130px] rounded-2xl border border-[#dcdfed] bg-white px-4 text-center text-[16px] tracking-[0.3em] text-[#0b1024] placeholder:tracking-normal placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <button
              type="button"
              onClick={confirm}
              disabled={busy || code.length < 6}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c9cef7]"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {t("confirm")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={busy}
            className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 sm:w-auto text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("sendCode")}
          </button>
        )}
      </div>
    </section>
  );
}
