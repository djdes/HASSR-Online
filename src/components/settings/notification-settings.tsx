"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
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
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: "temperature",
    icon: Thermometer,
  },
  {
    key: "deviations",
    icon: AlertTriangle,
  },
  {
    key: "compliance",
    icon: ClipboardList,
  },
  {
    key: "weeklyDigest",
    icon: Mail,
  },
];

export function NotificationSettings({
  botUsername,
  linkToken,
}: NotificationSettingsProps) {
  const t = useTranslations("notificationSettings");
  const feedback = useRef(t);
  useEffect(() => { feedback.current = t; }, [t]);
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
      .then((res) => {
        if (!res.ok) throw new Error("preferences-load");
        return res.json();
      })
      .then((data) => {
        setIsLinked(data.isLinked);
        setPrefs(data.prefs);
      })
      .catch(() => toast.error(feedback.current("loadError")))
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
      toast.success(feedback.current("unlinkedSuccess"));
      router.refresh();
    } catch {
      toast.error(feedback.current("unlinkError"));
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
      toast.success(feedback.current("saved"));
    } catch {
      setPrefs(oldPrefs);
      toast.error(feedback.current("saveError"));
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
      toast.success(feedback.current("saved"));
    } catch {
      setPrefs(oldPrefs);
      toast.error(feedback.current("saveError"));
    }
  }

  async function copyStartCommand() {
    if (!startCommand) return;
    try {
      await navigator.clipboard.writeText(startCommand);
      toast.success(feedback.current("copied", { username: botUsername }));
    } catch {
      toast.error(feedback.current("copyError"));
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
              {t(isLinked ? "active" : "notConnected")}
            </div>
            <h2 className="mt-4 text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#0b1024]">
              {t("botTitle")}
            </h2>
            <p className="mt-3 max-w-[440px] text-[14px] leading-[1.6] text-[#6f7282]">
              {t("botDescription")}
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
                  {t(isUnlinking ? "unlinking" : "unlink")}
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
                    {t("openBot", { username: botUsername })}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </a>
                  <button
                    type="button"
                    onClick={copyStartCommand}
                    className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    title={t("copyCommandTitle")}
                  >
                    <ClipboardCopy className="size-4" />
                    {t("copyCommand")}
                  </button>
                </>
              ) : (
                <div className="rounded-2xl border border-[#f0f1f8] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
                  {t("botNotConfigured")}
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
                {t("howTitle")}
              </h3>
              <p className="mt-2 max-w-[520px] text-[14px] text-[#6f7282]">
                {t("howDescription")}
              </p>
            </div>
          </div>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            <HowStep
              index={1}
              title={t("stepOpenTitle")}
              body={t.rich("stepOpenBody", {
                username: botUsername,
                strong: (chunks) => <span className="font-medium text-[#0b1024]">{chunks}</span>,
              })}
            />
            <HowStep
              index={2}
              title={t("stepCommandTitle")}
              body={t.rich("stepCommandBody", {
                command: (chunks) => <button
                    type="button"
                    onClick={copyStartCommand}
                    className="group inline-flex items-center gap-1 rounded-lg border border-[#d6d9ee] bg-[#f5f6ff] px-2 py-0.5 font-mono text-[13px] text-[#5566f6] hover:bg-[#eef1ff]"
                  >
                    <Copy className="size-3" />
                    {chunks}
                  </button>,
              })}
            />
            <HowStep
              index={3}
              title={t("stepDoneTitle")}
              body={t.rich("stepDoneBody", {
                strong: (chunks) => <span className="font-medium text-[#0b1024]">{chunks}</span>,
              })}
            />
          </ol>
        </section>
      )}

      {/* Preferences */}
      <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <header className="flex items-start justify-between gap-6 border-b border-[#f0f1f8] px-8 py-6">
          <div>
            <h3 className="text-[20px] font-semibold tracking-tight text-[#0b1024]">
              {t("typesTitle")}
            </h3>
            <p className="mt-1 text-[14px] text-[#6f7282]">
              {t(isLinked ? "typesLinked" : "typesUnlinked")}
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
                      {t(`preferences.${item.key}.label`)}
                    </div>
                    <div className="mt-1 text-[13px] text-[#6f7282]">
                      {t(`preferences.${item.key}.description`)}
                    </div>
                  </div>
                </div>
                <SwitchToggle
                  label={t(`preferences.${item.key}.label`)}
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
          <h3 className="text-[20px] font-semibold tracking-tight text-[#0b1024]">{t("quietTitle")}</h3>
          <p className="mt-1 text-[14px] text-[#6f7282]">
            {t("quietDescription")}
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
            {t("quietEnable")}
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-[#6f7282]">
            {t("quietFrom")}
            <input
              type="time"
              value={prefs.quietHours?.from ?? "22:00"}
              onChange={(e) => void handleQuietHoursChange({ enabled: prefs.quietHours?.enabled ?? false, from: e.target.value, to: prefs.quietHours?.to ?? "08:00" })}
              className="h-10 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-[#6f7282]">
            {t("quietTo")}
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
        <div className="font-medium text-[#0b1024]">{t("notesTitle")}</div>
        <ul className="mt-3 grid gap-1.5 md:grid-cols-2">
          <li>• {t("noteOwners")}</li>
          <li>• {t.rich("noteStop", { command: (chunks) => <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px] text-[#5566f6]">{chunks}</code> })}</li>
          <li>• {t("noteHistory")}</li>
          <li>• {t("noteFirst")}</li>
        </ul>
      </section>
    </div>
  );
}

/** Общая шапка страницы — одна и для skeleton'а, и для готового экрана. */
function HeaderBlock() {
  const t = useTranslations("notificationSettings");
  return (
    <PageHeader
      title={t("title")}
      description={t("description")}
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
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
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
  const t = useTranslations("notificationSettings");
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
            {t(linked ? "previewOnline" : "previewWaiting")}
          </div>
        </div>
        <ExternalLink className="ml-auto size-4 text-[#9b9fb3]" />
      </div>
      <div className="mt-3 space-y-2">
        {linked ? (
          <>
            <Bubble
              variant="bot"
              body={t("previewAssigned")}
              time="10:02"
            />
            <Bubble
              variant="bot"
              body={t("previewTemperature")}
              time="12:17"
            />
            <Bubble
              variant="bot"
              body={t("previewIncomplete")}
              time="18:00"
            />
          </>
        ) : (
          <>
            <Bubble variant="me" body="/start" time="..." />
            <Bubble
              variant="bot"
              body={t("previewConnect")}
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
  const t = useTranslations("notificationSettings");
  const feedback = useRef(t);
  useEffect(() => { feedback.current = t; }, [t]);
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
      if (!response.ok) throw new Error("sms-interest");
      setInterestSent(true);
      toast.success(feedback.current("smsSuccess"));
    } catch {
      toast.error(feedback.current("smsError"));
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
                  {t("smsTitle")}
                </span>
                <span className="rounded-full bg-[#fff4f2] px-2.5 py-0.5 text-[11px] font-medium text-[#a13a32]">
                  {t("smsDevelopment")}
                </span>
              </div>
              <p className="mt-1.5 max-w-[520px] text-[13.5px] leading-[1.55] text-[#6f7282]">
                {t("smsDescription")}
              </p>
            </div>
          </div>
          <SwitchToggle label={t("smsTitle")} checked={false} disabled onChange={() => {}} />
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
            {t(interestSent ? "smsSent" : "smsNotify")}
          </button>
          <span className="text-[12.5px] text-[#9b9fb3]">
            {t("smsPricing")}
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
