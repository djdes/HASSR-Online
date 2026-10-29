"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2, X } from "lucide-react";

import { phoneInputProps } from "@/lib/phone-input";

/**
 * Заявка на услугу прямо в карточке каталога.
 *
 * Почему панель раскрывается в карточке, а не модалка. Человек выбирает
 * услугу глазами, сравнивая соседние карточки; модалка гасит этот
 * контекст и на телефоне перекрывает то, ради чего её открыли. Панель
 * же оставляет заголовок и описание на экране — видно, на что именно
 * оставляешь телефон.
 *
 * Почему ошибки инлайном, а не через sonner. На публичных страницах
 * `<Toaster />` не смонтирован (он живёт в layout'ах /dashboard, /mini,
 * /root, /partner), поэтому `toast()` здесь был бы тихим no-op. Текст
 * ошибки нужен рядом с кнопкой — в том числе 429 от рейт-лимита, у
 * которого сервер уже присылает готовую русскую формулировку.
 */

type Status = "idle" | "sending" | "done";

const INPUT_CLASS =
  "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

const LABEL_CLASS = "mb-1.5 block text-[13px] font-medium text-[#6f7282]";

/** Цифр в телефоне должно хватить хотя бы на короткий городской номер. */
function hasEnoughDigits(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 6;
}

export function ServiceRequestForm({
  serviceKey,
  serviceTitle,
}: {
  serviceKey: string;
  serviceTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [comment, setComment] = useState("");

  const sending = status === "sending";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;

    if (name.trim().length < 2) {
      setError("Укажите, как к вам обращаться");
      return;
    }
    if (!hasEnoughDigits(phone)) {
      setError("Укажите телефон — по нему мы и перезвоним");
      return;
    }

    setError(null);
    setStatus("sending");
    try {
      const response = await fetch("/api/services/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceKey,
          contactName: name.trim(),
          contactPhone: phone.trim(),
          contactEmail: email.trim() || undefined,
          comment: comment.trim() || undefined,
        }),
      });
      // Рейт-лимит и 5xx иногда приходят без тела — не роняем форму на
      // разборе, а показываем понятный текст.
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(
          payload?.error ??
            "Не удалось отправить заявку. Попробуйте ещё раз или напишите нам в чат",
        );
        setStatus("idle");
        return;
      }
      setStatus("done");
    } catch {
      setError("Нет связи с сервером. Проверьте интернет и попробуйте снова");
      setStatus("idle");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
      >
        Заказать
        <ArrowRight className="size-4" />
      </button>
    );
  }

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-[#5566f6]/20 bg-[#f5f6ff] p-5">
        <div className="flex items-center gap-2 text-[15px] font-medium text-[#0b1024]">
          <span className="flex size-7 items-center justify-center rounded-full bg-[#5566f6] text-white">
            <Check className="size-4" />
          </span>
          Заявка отправлена
        </div>
        <p className="mt-2 text-[13px] leading-[1.6] text-[#3c4053]">
          Свяжемся в течение рабочего дня — уточним детали и назовём итоговую
          стоимость. Ничего оплачивать сейчас не нужно.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="text-[13px] leading-[1.5] text-[#6f7282]">
          Заявка на услугу
          <div className="mt-0.5 text-[14px] font-medium text-[#0b1024]">
            {serviceTitle}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Свернуть форму"
          className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#6f7282] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${serviceKey}-name`}>
            Как к вам обращаться
          </label>
          <input
            id={`${serviceKey}-name`}
            className={INPUT_CLASS}
            value={name}
            autoComplete="name"
            placeholder="Анна"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor={`${serviceKey}-phone`}>
            Телефон
          </label>
          <input
            id={`${serviceKey}-phone`}
            className={INPUT_CLASS}
            placeholder="+7 999 123-45-67"
            {...phoneInputProps(phone, setPhone)}
          />
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor={`${serviceKey}-email`}>
            Почта <span className="text-[#9b9fb3]">— необязательно</span>
          </label>
          <input
            id={`${serviceKey}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            className={INPUT_CLASS}
            placeholder="anna@cafe.ru"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor={`${serviceKey}-comment`}>
            Что за предприятие и что нужно{" "}
            <span className="text-[#9b9fb3]">— необязательно</span>
          </label>
          <textarea
            id={`${serviceKey}-comment`}
            rows={3}
            className="w-full resize-y rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[15px] leading-[1.5] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            placeholder="Кофейня в Казани, 12 сотрудников, готовимся к проверке"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] leading-[1.5] text-[#a13a32]"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={sending}
        className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Отправляем
          </>
        ) : (
          <>
            Отправить заявку
            <ArrowRight className="size-4" />
          </>
        )}
      </button>

      <p className="mt-3 text-[12px] leading-[1.5] text-[#9b9fb3]">
        Перезвоним в течение рабочего дня. Оплата — только после того, как
        обсудим объём работ; отправка заявки ни к чему не обязывает.
      </p>
    </form>
  );
}
