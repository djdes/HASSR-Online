"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCopy,
  ClipboardList,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  Send,
  Thermometer,
  Unlink,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { MarketingEmailToggle } from "@/components/settings/marketing-email-toggle";
import { AppStoresTeaser } from "@/components/public/app-stores-teaser";
import { useInsideMobileApp } from "@/lib/use-inside-mobile-app";
import { Skeleton } from "@/components/ui/skeleton";

interface NotificationSettingsProps {
  botUsername: string;
  linkToken: string;
}

interface NotificationPrefs {
  temperature: boolean;
  deviations: boolean;
  compliance: boolean;
  weeklyDigest: boolean;
  quietHours?: { enabled: boolean; from: string; to: string };
}

type BooleanPrefKey = "temperature" | "deviations" | "compliance" | "weeklyDigest";

const PREF_ITEMS: Array<{
  key: BooleanPrefKey;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: "temperature",
    label: "Отклонения температуры",
    description: "Срабатывает когда IoT-датчик выходит за норму оборудования",
    icon: Thermometer,
  },
  {
    key: "deviations",
    label: "Отклонения в журналах",
    description: "Бракераж, гигиена, ККТ, невалидные записи",
    icon: AlertTriangle,
  },
  {
    key: "compliance",
    label: "Незаполненные журналы",
    description: "Ежедневный дайджест того, что надо заполнить",
    icon: ClipboardList,
  },
  {
    key: "weeklyDigest",
    label: "Еженедельный отчёт на почту",
    description:
      "Понедельник, 08:00: заполнено и пропущено, отклонения, кто не отмечался, что истекает — письмом руководителю",
    icon: Mail,
  },
];

export function NotificationSettings({
  botUsername,
  linkToken,
}: NotificationSettingsProps) {
  const router = useRouter();
  const [isLinked, setIsLinked] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    temperature: true,
    deviations: true,
    compliance: true,
    weeklyDigest: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const botLink = botUsername
    ? `https://t.me/${botUsername}?start=${linkToken}`
    : "";
  const startCommand = linkToken ? `/start ${linkToken}` : "";

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((res) => res.json())
      .then((data) => {
        setIsLinked(data.isLinked);
        setPrefs(data.prefs);
      })
      .catch(() => toast.error("Ошибка загрузки настроек"))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleUnlink() {
    setIsUnlinking(true);
    try {
      const res = await fetch("/api/notifications/telegram/unlink", {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setIsLinked(false);
      toast.success("Telegram отвязан");
      router.refresh();
    } catch {
      toast.error("Ошибка при отвязке Telegram");
    } finally {
      setIsUnlinking(false);
    }
  }

  async function handleQuietHoursChange(next: { enabled: boolean; from: string; to: string }) {
    const oldPrefs = prefs;
    const newPrefs = { ...prefs, quietHours: next };
    setPrefs(newPrefs);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPrefs),
      });
      if (!res.ok) throw new Error();
      toast.success("Сохранено");
    } catch {
      setPrefs(oldPrefs);
      toast.error("Ошибка сохранения");
    }
  }

  async function handlePrefChange(
    key: BooleanPrefKey,
    value: boolean
  ) {
    const oldPrefs = prefs;
    const newPrefs = { ...prefs, [key]: value };
    setPrefs(newPrefs);

    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPrefs),
      });
      if (!res.ok) throw new Error();
      toast.success("Сохранено");
    } catch {
      setPrefs(oldPrefs);
      toast.error("Ошибка сохранения");
    }
  }

  async function copyStartCommand() {
    if (!startCommand) return;
    try {
      await navigator.clipboard.writeText(startCommand);
      toast.success("Команда скопирована — вставьте её в @" + botUsername);
    } catch {
      toast.error("Скопируйте вручную");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <HeaderBlock />
        <div className="rounded-3xl border border-[#eceef7] bg-white p-8">
          <Skeleton className="h-5 w-64 rounded-full" />
          <Skeleton className="mt-4 h-3 w-96 rounded-full" />
        </div>
      </div>
    );
  }


  return (
    <div className="space-y-8">
      <HeaderBlock />

      {/* Карточка подключения Telegram: раньше была тёмным hero, но это не
          заголовок страницы, а обычный блок настройки — держим его светлым,
          как остальные секции. */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-8">
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:gap-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#dcdfed] bg-[#fafbff] px-3 py-1 text-[12px] uppercase tracking-[0.18em] text-[#6f7282]">
              <span
                className={`size-1.5 rounded-full ${
                  isLinked ? "bg-[#136b2a]" : "bg-[#a13a32]"
                }`}
              />
              {isLinked ? "Канал активен" : "Не подключено"}
            </div>
            <h2 className="mt-4 text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#0b1024]">
              Telegram-бот уведомлений
            </h2>
            <p className="mt-3 max-w-[440px] text-[14px] leading-[1.6] text-[#6f7282]">
              Получайте оповещения о температурных отклонениях,
              незаполненных журналах и новых назначениях — прямо в Telegram.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {isLinked ? (
                <button
                  type="button"
                  onClick={handleUnlink}
                  disabled={isUnlinking}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
                >
                  <Unlink className="size-4" />
                  {isUnlinking ? "Отвязка…" : "Отвязать Telegram"}
                </button>
              ) : botLink ? (
                <>
                  <a
                    href={botLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
                  >
                    <Send className="size-4" />
                    Открыть @{botUsername}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </a>
                  <button
                    type="button"
                    onClick={copyStartCommand}
                    className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    title="Скопировать команду /start <токен>"
                  >
                    <ClipboardCopy className="size-4" />
                    Скопировать команду
                  </button>
                </>
              ) : (
                <div className="rounded-2xl border border-[#f0f1f8] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
                  Telegram-бот пока не настроен администратором.
                </div>
              )}
            </div>
          </div>

          {/* Right: chat bubble preview */}
          <div className="hidden self-stretch md:block">
            <ChatPreview linked={isLinked} botUsername={botUsername} />
          </div>
        </div>
      </section>

      {/* How-to */}
      {!isLinked && botLink && (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-8 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h3 className="text-[20px] font-semibold tracking-tight text-[#0b1024]">
                Как привязать
              </h3>
              <p className="mt-2 max-w-[520px] text-[14px] text-[#6f7282]">
                Если при нажатии «Start» в боте ничего не приходит — Telegram
                не передал параметр. Отправьте боту команду вручную.
              </p>
            </div>
          </div>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            <HowStep
              index={1}
              title="Откройте бота"
              body={
                <>
                  Нажмите кнопку{" "}
                  <span className="font-medium text-[#0b1024]">
                    «Открыть @{botUsername}»
                  </span>{" "}
                  выше. Откроется чат с ботом.
                </>
              }
            />
            <HowStep
              index={2}
              title="Отправьте команду"
              body={
                <>
                  В чате с ботом отправьте{" "}
                  <button
                    type="button"
                    onClick={copyStartCommand}
                    className="group inline-flex items-center gap-1 rounded-lg border border-[#d6d9ee] bg-[#f5f6ff] px-2 py-0.5 font-mono text-[13px] text-[#5566f6] hover:bg-[#eef1ff]"
                  >
                    <Copy className="size-3" />
                    /start&nbsp;...
                  </button>{" "}
                  (кнопка «Скопировать команду» положит её в буфер).
                </>
              }
            />
            <HowStep
              index={3}
              title="Готово"
              body={
                <>
                  Бот ответит{" "}
                  <span className="font-medium text-[#0b1024]">
                    «Аккаунт успешно привязан»
                  </span>
                  . Токен действителен 15 минут — если истёк, обновите
                  страницу.
                </>
              }
            />
          </ol>
        </section>
      )}

      {/* Preferences */}
      <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <header className="flex items-start justify-between gap-6 border-b border-[#f0f1f8] px-8 py-6">
          <div>
            <h3 className="text-[20px] font-semibold tracking-tight text-[#0b1024]">
              Типы уведомлений
            </h3>
            <p className="mt-1 text-[14px] text-[#6f7282]">
              {isLinked
                ? "Управляйте тем, какие события доходят до вашего чата."
                : "Станут активны после привязки Telegram."}
            </p>
          </div>
        </header>
        <ul className="divide-y divide-[#f0f1f8]">
          {PREF_ITEMS.map((item) => {
            const Icon = item.icon;
            const value = prefs[item.key];
            return (
              <li
                key={item.key}
                className={`flex items-center justify-between gap-6 px-8 py-5 ${
                  !isLinked ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#5566f6]">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <div className="text-[15px] font-medium text-[#0b1024]">
                      {item.label}
                    </div>
                    <div className="mt-1 text-[13px] text-[#6f7282]">
                      {item.description}
                    </div>
                  </div>
                </div>
                <SwitchToggle
                  checked={value}
                  disabled={!isLinked}
                  onChange={(v) => handlePrefChange(item.key, v)}
                />
              </li>
            );
          })}
        </ul>
      </section>

      {/* Рекламные письма WeSetup: вернуть подписку после отписки из письма. */}
      <MarketingEmailToggle />

      {/* Footer note */}
      <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]" data-testid="quiet-hours">
        <header className="border-b border-[#f0f1f8] px-8 py-6">
          <h3 className="text-[20px] font-semibold tracking-tight text-[#0b1024]">Тихие часы</h3>
          <p className="mt-1 text-[14px] text-[#6f7282]">
            В это время Telegram молчит: напоминания и сводки придут, когда окно закончится. Отклонения температуры и инциденты приходят сразу. Время — по часовому поясу организации.
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-4 px-8 py-5">
          <label className="inline-flex items-center gap-3 text-[15px] font-medium text-[#0b1024]">
            <input
              type="checkbox"
              checked={prefs.quietHours?.enabled ?? false}
              onChange={(e) => void handleQuietHoursChange({ enabled: e.target.checked, from: prefs.quietHours?.from ?? "22:00", to: prefs.quietHours?.to ?? "08:00" })}
              className="size-4 accent-[#5566f6]"
              data-testid="quiet-toggle"
            />
            Включить
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-[#6f7282]">
            с
            <input
              type="time"
              value={prefs.quietHours?.from ?? "22:00"}
              onChange={(e) => void handleQuietHoursChange({ enabled: prefs.quietHours?.enabled ?? false, from: e.target.value, to: prefs.quietHours?.to ?? "08:00" })}
              className="h-10 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-[#6f7282]">
            до
            <input
              type="time"
              value={prefs.quietHours?.to ?? "08:00"}
              onChange={(e) => void handleQuietHoursChange({ enabled: prefs.quietHours?.enabled ?? false, from: prefs.quietHours?.from ?? "22:00", to: e.target.value })}
              className="h-10 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
        </div>
      </section>

      <section className="rounded-3xl border border-[#f0f1f8] bg-[#fafbff] p-6 text-[13px] text-[#6f7282]">
        <div className="font-medium text-[#0b1024]">Полезно знать</div>
        <ul className="mt-3 grid gap-1.5 md:grid-cols-2">
          <li>• Уведомления получают все владельцы организации.</li>
          <li>• Чтобы отключить уведомления, отправьте боту команду <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px] text-[#5566f6]">/stop</code> или нажмите «Отвязать Telegram» выше.</li>
          <li>• Историю отправленных сообщений хранит администратор платформы — если сообщение не дошло, напишите в поддержку.</li>
          <li>• Бот не пишет первым — инициатива всегда с вашей стороны.</li>
        </ul>
      </section>
    </div>
  );
}

/** Общая шапка страницы — одна и для skeleton'а, и для готового экрана. */
function HeaderBlock() {
  return (
    <PageHeader
      title="Уведомления"
      description="Telegram-канал уведомлений и предпочтения по типам событий."
    />
  );
}

function HowStep({
  index,
  title,
  body,
}: {
  index: number;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <li className="rounded-2xl border border-[#f0f1f8] bg-[#fafbff] p-5">
      <div className="flex size-7 items-center justify-center rounded-full bg-[#0b1024] text-[12px] font-semibold text-white">
        {index}
      </div>
      <div className="mt-3 text-[15px] font-medium text-[#0b1024]">{title}</div>
      <div className="mt-1.5 text-[13px] leading-[1.6] text-[#6f7282]">
        {body}
      </div>
    </li>
  );
}

function SwitchToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed ${
        checked ? "bg-[#5566f6]" : "bg-[#e4e5f0]"
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function ChatPreview({
  linked,
  botUsername,
}: {
  linked: boolean;
  botUsername: string;
}) {
  return (
    <div className="relative h-full w-full rounded-2xl border border-[#f0f1f8] bg-[#fafbff] p-4">
      <div className="flex items-center gap-2 border-b border-[#f0f1f8] pb-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-[#5566f6] text-[12px] font-semibold uppercase text-white">
          {botUsername.slice(0, 2) || "tg"}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[#0b1024]">
            @{botUsername}
          </div>
          <div className="text-[11px] text-[#9b9fb3]">
            {linked ? "в сети" : "ожидает привязки"}
          </div>
        </div>
        <ExternalLink className="ml-auto size-4 text-[#9b9fb3]" />
      </div>
      <div className="mt-3 space-y-2">
        {linked ? (
          <>
            <Bubble
              variant="bot"
              body="🔔 Вам назначен журнал: Температурный режим"
              time="10:02"
            />
            <Bubble
              variant="bot"
              body="⚠️ Температура в холодильнике 1 вышла за норму: 9.8°C"
              time="12:17"
            />
            <Bubble
              variant="bot"
              body="📋 Сегодня не заполнены: 2 журнала"
              time="18:00"
            />
          </>
        ) : (
          <>
            <Bubble variant="me" body="/start" time="..." />
            <Bubble
              variant="bot"
              body="Для привязки откройте ссылку из настроек WeSetup"
              time="..."
              muted
            />
          </>
        )}
      </div>

      <SmsAndAppTeaser />
    </div>
  );
}

function Bubble({
  variant,
  body,
  time,
  muted,
}: {
  variant: "bot" | "me";
  body: string;
  time: string;
  muted?: boolean;
}) {
  const isMe = variant === "me";
  return (
    <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-[1.4] ${
          isMe
            ? "bg-[#5566f6] text-white"
            : muted
              ? "border border-[#eceef7] bg-white text-[#9b9fb3]"
              : "border border-[#eceef7] bg-white text-[#3c4053]"
        }`}
      >
        <div className="whitespace-pre-line">{body}</div>
        <div
          className={`mt-0.5 text-right text-[10px] ${
            isMe ? "text-white/60" : "text-[#9b9fb3]"
          }`}
        >
          {time}
        </div>
      </div>
    </div>
  );
}

/**
 * SMS и мобильное приложение — обе заглушки в одном месте.
 *
 * Вынесено отдельным компонентом ради состояния кнопки интереса: карточка
 * жила внутри ChatPreview, у которого своих состояний нет и быть не
 * должно — это чистая картинка-превью переписки.
 */
function SmsAndAppTeaser() {
  // В самом приложении анонс «Приложение скоро в App Store» — бессмыслица:
  // push там настраиваются в «Профиле».
  const inApp = useInsideMobileApp();
  const [interestBusy, setInterestBusy] = useState(false);
  const [interestSent, setInterestSent] = useState(false);

  /**
   * Отметка интереса к SMS. Уходит тем же путём, что обратная связь, —
   * заводить отдельную таблицу ради счётчика «хочу» не за чем.
   */
  async function notifyInterest() {
    setInterestBusy(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "suggestion",
          message: "Интересуют SMS-уведомления — сообщите о запуске",
        }),
      });
      if (!response.ok) throw new Error("Не удалось отправить");
      setInterestSent(true);
      toast.success("Спасибо, сообщим о запуске");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setInterestBusy(false);
    }
  }

  return (
    <>
      {/* SMS — заглушка. Интеграции нет, и притворяться, что она есть,
          нельзя: тумблер выключен и подписан «в разработке». Показываем
          заранее, чтобы было видно, куда движется продукт. */}
      <div className="rounded-3xl border border-[#eceef7] bg-white p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#f5f6ff] text-[#5566f6]">
              <MessageSquare className="size-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[16px] font-semibold text-[#0b1024]">
                  SMS-уведомления
                </span>
                <span className="rounded-full bg-[#fff4f2] px-2.5 py-0.5 text-[11px] font-medium text-[#a13a32]">
                  В разработке
                </span>
              </div>
              <p className="mt-1.5 max-w-[520px] text-[13.5px] leading-[1.55] text-[#6f7282]">
                Напоминание о незаполненном журнале придёт даже тем, у кого
                нет Telegram и почты. Для линейного персонала это часто
                единственный работающий канал.
              </p>
            </div>
          </div>
          <SwitchToggle checked={false} disabled onChange={() => {}} />
        </div>

        {/* Кнопка интереса, а не просто «скоро»: она и человеку даёт
            что-то сделать вместо разглядывания выключенного тумблера, и
            нам показывает, сколько организаций этого ждёт. */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#f1f2f8] pt-4">
          <button
            type="button"
            onClick={() => void notifyInterest()}
            disabled={interestSent || interestBusy}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
          >
            {interestBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            {interestSent ? "Сообщим о запуске" : "Сообщить, когда заработает"}
          </button>
          <span className="text-[12.5px] text-[#9b9fb3]">
            Стоимость объявим при запуске — SMS оплачиваются отдельно от
            тарифа.
          </span>
        </div>
      </div>

      {/* Мобильное приложение — та же заглушка, что в подвале сайта, и
          намеренно тот же компонент: разъехавшиеся даты запуска выглядят
          хуже, чем их отсутствие. */}
      {inApp ? null : (
        <div className="rounded-3xl border border-[#eceef7] bg-white p-6 md:p-7">
          <AppStoresTeaser tone="card" />
        </div>
      )}
    </>
  );
}
