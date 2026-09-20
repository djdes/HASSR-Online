"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  Send,
  Trash2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAsync } from "@/components/ui/confirm-async";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Props = {
  initialPhone: string | null;
  initialDisplay: string;
  hasIntegration: boolean;
  hasLink: boolean;
  linkSource: string | null;
  userName: string;
  telegramLinked: boolean;
};

type AutolinkResult =
  | { ok: true; linked: boolean; reason?: string }
  | { ok: false; reason: string };

type PutResponse = {
  phone?: string;
  display?: string;
  autolink?: AutolinkResult;
  error?: string;
};

export function PhoneBindingClient(props: Props) {
  const router = useRouter();
  const [phone, setPhone] = useState(props.initialPhone ?? "");
  const [editing, setEditing] = useState(props.initialPhone === null);
  const [display, setDisplay] = useState(props.initialDisplay);
  const [savedPhone, setSavedPhone] = useState(props.initialPhone);
  const [busy, setBusy] = useState(false);
  const [linkState, setLinkState] = useState<{
    hasLink: boolean;
    reason: string | null;
  }>({
    hasLink: props.hasLink,
    reason: null,
  });

  async function save() {
    if (busy) return;
    if (phone.trim().length < 10) {
      toast.error("Введите полный номер (минимум 10 цифр)");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/users/me/phone", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = (await response.json().catch(() => null)) as PutResponse | null;
      if (!response.ok || !data?.phone) {
        toast.error(data?.error ?? "Не удалось сохранить");
        return;
      }
      setSavedPhone(data.phone);
      setDisplay(data.display ?? data.phone);
      setPhone(data.phone);
      setEditing(false);

      const autolink = data.autolink;
      if (!autolink) {
        toast.success("Номер сохранён");
      } else if (autolink.ok && autolink.linked) {
        toast.success(
          "Номер сохранён · TasksFlow-аккаунт найден и связан автоматически"
        );
        setLinkState({ hasLink: true, reason: null });
      } else if (autolink.ok && !autolink.linked) {
        const why =
          autolink.reason === "no-integration"
            ? "интеграция с TasksFlow не подключена"
            : autolink.reason === "no-tf-user-with-phone"
              ? "в TasksFlow пока нет работника с этим номером"
              : autolink.reason ?? "не совпало";
        toast.success(`Номер сохранён. TasksFlow не связан: ${why}`);
        setLinkState({ hasLink: false, reason: why });
      } else {
        toast.success(
          `Номер сохранён. TasksFlow недоступен: ${autolink.reason}`
        );
        setLinkState({ hasLink: false, reason: autolink.reason ?? null });
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    // Нативный confirm() в приложении Telegram может не показаться —
    // кнопка тогда молча не срабатывает (CLAUDE.md §6).
    const ok = await confirmAsync({
      title: "Убрать номер телефона?",
      description:
        "По номеру ваш аккаунт связан с задачами. Без него связь пропадёт.",
      bullets: [
        { label: "Задачи перестанут приходить до новой привязки", tone: "warn" },
        { label: "Связь с TasksFlow будет удалена", tone: "warn" },
        { label: "Вписать номер заново можно в любой момент", tone: "info" },
      ],
      confirmLabel: "Убрать номер",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch("/api/users/me/phone", { method: "DELETE" });
      if (!response.ok) {
        toast.error("Не удалось удалить");
        return;
      }
      setSavedPhone(null);
      setDisplay("");
      setPhone("");
      setEditing(true);
      setLinkState({ hasLink: false, reason: null });
      toast.success("Номер удалён");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const statusTone = savedPhone
    ? linkState.hasLink
      ? "success"
      : "warn"
    : "muted";

  const statusCopy =
    savedPhone === null
      ? "Телефон не указан"
      : linkState.hasLink
        ? "Связан с TasksFlow"
        : "Телефон сохранён · TasksFlow ещё не связан";

  const toneCls =
    statusTone === "success"
      ? "border-[#c8f0d5] bg-[#effaf1] text-[#136b2a]"
      : statusTone === "warn"
        ? "border-[#ffe5c2] bg-[#fff8eb] text-[#b25f00]"
        : "border-[#ececf4] bg-[#fafbff] text-[#6f7282]";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      {/* LEFT — the form */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div
          className={`mb-5 flex items-center gap-3 rounded-2xl border px-4 py-3 ${toneCls}`}
        >
          {statusTone === "success" ? (
            <CheckCircle2 className="size-5 shrink-0" />
          ) : statusTone === "warn" ? (
            <Unlink className="size-5 shrink-0" />
          ) : (
            <Pencil className="size-5 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-[14px] font-medium">{statusCopy}</div>
            {savedPhone ? (
              <div className="mt-0.5 text-[13px] opacity-80 tabular-nums">
                {display || savedPhone}
              </div>
            ) : null}
          </div>
        </div>

        {editing ? (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="phone-input"
                className="block text-[13px] font-medium text-[#0b1024]"
              >
                Номер телефона
              </label>
              <Input
                id="phone-input"
                type="tel"
                {...phoneInputProps(phone, setPhone)}
                placeholder={RU_PHONE_PLACEHOLDER}
                className="mt-1.5 h-12 rounded-2xl border-[#dcdfed] text-[15px]"
              />
              <p className="mt-1.5 text-[12px] text-[#6f7282]">
                Любой формат — приведём к{" "}
                <span className="tabular-nums">+7XXXXXXXXXX</span>. Для
                зарубежных номеров сохранится исходный код страны.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={save}
                disabled={busy || phone.trim().length < 10}
                className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {savedPhone ? "Сохранить новый" : "Сохранить"}
              </Button>
              {savedPhone ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPhone(savedPhone);
                    setEditing(false);
                  }}
                  disabled={busy}
                  className="h-11 rounded-2xl border-[#dcdfed] px-5 text-[14px] text-[#3c4053]"
                >
                  Отмена
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="h-10 rounded-lg border-0 bg-[#5566f6]/[0.04] px-5 text-[14px] font-semibold text-[#5566f6]"
            >
              <Pencil className="size-4" />
              Изменить
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={clear}
              disabled={busy}
              className="h-11 rounded-2xl border-[#ffd2cd] px-5 text-[14px] text-[#a13a32] hover:bg-[#fff4f2]"
            >
              <Trash2 className="size-4" />
              Удалить
            </Button>
          </div>
        )}
      </section>

      {/* RIGHT — explanatory sidebar */}
      <aside className="space-y-4">
        <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Для чего нужен номер
          </div>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-[#3c4053]">
            <li className="flex gap-2">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
              <span>
                <b>TasksFlow</b>: задачи приходят по номеру, без email.
                При совпадении связка создастся автоматически.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
              <span>
                <b>QR-наклейки на оборудовании</b>: сотрудник сканирует →
                система узнаёт его по номеру, не требуя логина.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
              <span>
                <b>Уведомления</b> от менеджера: если нет Telegram-бота,
                по номеру можно отправить WhatsApp/SMS вручную —
                приглашение сформируется сразу.
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Быстрая навигация
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {props.hasIntegration ? (
              <Link
                href="/settings/integrations/tasksflow"
                className="inline-flex items-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-3 py-2 text-[14px] font-semibold text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
              >
                <ExternalLink className="size-4" />
                Настройки TasksFlow
              </Link>
            ) : (
              <Link
                href="/settings/integrations/tasksflow"
                className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-3 py-2 text-[13px] font-medium text-[#6f7282] hover:bg-[#f5f6ff]"
              >
                <ExternalLink className="size-4" />
                Подключить TasksFlow
              </Link>
            )}
            <Link
              href="/settings/notifications"
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium ${
                props.telegramLinked
                  ? "border-[#c8f0d5] bg-[#effaf1] text-[#136b2a]"
                  : "border-0 bg-[#5566f6]/[0.04] text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
              }`}
            >
              <ExternalLink className="size-4" />
              {props.telegramLinked ? "Telegram привязан" : "Привязать Telegram"}
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
