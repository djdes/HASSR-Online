"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Coins,
  Copy,
  Gift,
  Loader2,
  Paperclip,
  Send,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageGuide } from "@/components/ui/page-guide";
import { useAttachmentUploads } from "@/components/support/attachment-composer";
import {
  REFERRAL_REWARD_PERCENT,
  REVIEW_ACCEPT_ATTRIBUTE,
  REVIEW_TEXT_MAX_LENGTH,
  REVIEW_TEXT_MIN_LENGTH,
  TOPUP_MAX_RUB,
  TOPUP_MIN_RUB,
  formatPoints,
  reviewKindFromMime,
  reviewRewardFor,
  type ReviewKind,
} from "@/lib/balance/constants";
import type { BalanceOverview } from "@/lib/balance/overview";
import type { TopupBlockConfig } from "@/lib/balance/topup-core";
import { useLiveEvents } from "@/lib/use-live-events";

import {
  Section,
  StatusPill,
  inputClass,
  miniCard,
  miniInput,
  miniPrimary,
  miniSecondary,
  primaryButtonClass,
  secondaryButtonClass,
} from "./balance-ui";
import { TopupSection } from "./topup-section";

/**
 * «Баланс и бонусы» — один экран для сайта и Mini App (П-3).
 *
 * `variant="mini"` не меняет ни логику, ни состав блоков: отличается
 * только палитра (Mini App живёт на своих CSS-переменных темы) и
 * плотность. Дублировать экран во второй раз было бы гарантией того, что
 * витрины разъедутся уже на следующей правке.
 */
export type BalanceVariant = "site" | "mini";

const APP_ORIGIN = "https://wesetup.ru";

export function BalanceClient({
  initial,
  variant = "site",
  inApp = false,
  topup = null,
}: {
  initial: BalanceOverview;
  variant?: BalanceVariant;
  /**
   * Открыто в приложении WeSetup: только баланс и история. Без «Оплатить
   * с баллами», приглашений и отзывов за баллы — это скидки на оплату
   * мимо магазина, звать к ней в приложении правила App Store и Google
   * Play не разрешают. Решает сервер по User-Agent.
   */
  inApp?: boolean;
  /**
   * «Пополнить баланс»: null — блока нет (сотрудник, ROOT в режиме
   * «войти как», приложение WeSetup). Решает сервер.
   */
  topup?: TopupBlockConfig | null;
}) {
  const [data, setData] = useState(initial);
  const mini = variant === "mini";

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/balance");
      if (!response.ok) return;
      setData((await response.json()) as BalanceOverview);
    } catch {
      /* обновим при следующем действии — экран уже показывает актуальное */
    }
  }, []);

  // Админ начислил баллы — цифра меняется на экране сразу, а не после
  // перезагрузки. Тост объясняет, что произошло: молча подскочившая
  // сумма выглядит как ошибка.
  useLiveEvents((event) => {
    if (event.type === "balance") {
      void refresh();
      const amount = Number(event.data?.amount ?? 0);
      const comment =
        typeof event.data?.comment === "string" ? event.data.comment : "";
      if (amount > 0) {
        toast.success(`Начислено ${formatPoints(amount)}`, {
          description: comment || undefined,
        });
      } else if (amount < 0) {
        toast.message(`Списано ${formatPoints(Math.abs(amount))}`, {
          description: comment || undefined,
        });
      }
    } else if (event.type === "reconnect") {
      void refresh();
    }
  });

  const referralLink = `${APP_ORIGIN}/r/${data.referralCode}`;

  return (
    <div className={mini ? "space-y-4" : "space-y-5"}>
      <HeroCard data={data} mini={mini} inApp={inApp} />

      {data.canSeeBalance && topup && !inApp ? (
        <TopupSection config={topup} mini={mini} onPaid={refresh} />
      ) : null}

      {inApp ? null : (
        <ReferralSection
          data={data}
          mini={mini}
          referralLink={referralLink}
          onSent={refresh}
        />
      )}

      {inApp ? null : <ReviewSection data={data} mini={mini} onSent={refresh} />}

      {data.canSeeBalance ? <HistorySection data={data} mini={mini} inApp={inApp} /> : null}

      {!mini && !inApp ? (
        <PageGuide
          storageKey="settings-balance"
          title="Как работают баллы"
          bullets={[
            {
              title: "Один балл — один рубль",
              body: "Баллы лежат на балансе организации и списываются при оплате подписки. Оборудование за баллы не продаём.",
            },
            {
              title: "Приглашайте коллег",
              body: `Друг оформит подписку — вам придёт ${REFERRAL_REWARD_PERCENT} % её стоимости баллами. Один бонус на одно приглашённое заведение.`,
            },
            {
              title: "Оставьте отзыв",
              body: "Текст — 300 ₽, с фото — 750 ₽, с видео — 1990 ₽. Анонимно, без имени и заведения, — на 20 % меньше. Начислим после проверки модератором.",
            },
            {
              title: "Пополните деньгами",
              body: `Картой или по счёту для юрлиц, от ${formatPoints(TOPUP_MIN_RUB)} до ${formatPoints(TOPUP_MAX_RUB)}. Деньги зачисляются баллами 1:1 сразу после оплаты. Промокоды и акции к пополнению не применяются.`,
            },
          ]}
          qa={[
            {
              q: "Баллы сгорают?",
              a: "Нет. Лежат на балансе, пока не потратите на подписку.",
            },
            {
              q: "Можно вывести деньгами?",
              a: "Нет, вывод баллов не предусмотрен: ими оплачивается подписка. Если пополнили баланс по ошибке — напишите на support@wesetup.ru.",
            },
            {
              q: "Можно оплатить баллами оборудование?",
              a: "Нет. В заказе «подписка + оборудование» баллами закроется только подписка, железо оплачивается деньгами.",
            },
            {
              q: "Почему тумблер баллов недоступен при автопродлении?",
              a: "Касса запоминает карту по сумме первого платежа. Со скидкой она запомнила бы уменьшенную сумму, и следующие списания пошли бы не по цене тарифа.",
            },
          ]}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- hero */

function HeroCard({
  data,
  mini,
  inApp,
}: {
  data: BalanceOverview;
  mini: boolean;
  inApp: boolean;
}) {
  if (!data.canSeeBalance) {
    return (
      <section
        className={
          mini
            ? "rounded-2xl p-5"
            : "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
        }
        style={mini ? miniCard : undefined}
      >
        <div className="flex items-start gap-4">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl"
            style={
              mini
                ? { background: "var(--mini-surface-2)", color: "var(--mini-text)" }
                : undefined
            }
          >
            <Coins className={mini ? "size-5" : "size-5 text-[#3848c7]"} />
          </span>
          <div className="min-w-0">
            <h2
              className={
                mini
                  ? "text-[17px] font-semibold"
                  : "text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]"
              }
              style={mini ? { color: "var(--mini-text)" } : undefined}
            >
              Ваши бонусы идут на баланс организации
            </h2>
            <p
              className={
                mini ? "mt-1.5 text-[13px]" : "mt-1.5 text-[14px] leading-relaxed text-[#6f7282]"
              }
              style={mini ? { color: "var(--mini-text-muted)" } : undefined}
            >
              {inApp
                ? "Бонусы начисляются на баланс организации. Вы принесли "
                : "Баллы тратит руководитель — при оплате подписки. Вы принесли "}
              <strong>{formatPoints(data.myEarnedRub)}</strong>: за отзыв и за
              коллег, которые пришли по вашей рекомендации.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={
        mini
          ? "rounded-2xl p-5"
          : "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
      }
      style={mini ? miniCard : undefined}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div
            className={
              mini
                ? "text-[11px] font-semibold uppercase tracking-[0.16em]"
                : "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]"
            }
            style={mini ? { color: "var(--mini-text-muted)" } : undefined}
          >
            Баланс организации
          </div>
          <div
            className={
              mini
                ? "mt-2 text-[34px] font-semibold leading-none tabular-nums"
                : "mt-2 text-[40px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-[#0b1024]"
            }
            style={mini ? { color: "var(--mini-text)" } : undefined}
          >
            {formatPoints(data.balanceRub)}
          </div>
          <p
            className={mini ? "mt-2 text-[13px]" : "mt-2 text-[14px] text-[#6f7282]"}
            style={mini ? { color: "var(--mini-text-muted)" } : undefined}
          >
            {inApp
              ? "1 балл = 1 ₽."
              : "1 балл = 1 ₽. Списываются при оплате подписки — оборудование за баллы не продаём."}
          </p>
        </div>

        {data.balanceRub > 0 && !inApp ? (
          <Link
            href="/order?plan=monthly"
            className={
              mini
                ? "inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-[14px] font-medium"
                : "inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
            }
            style={
              mini
                ? {
                    background: "var(--mini-lime)",
                    color: "var(--mini-primary-contrast)",
                  }
                : undefined
            }
          >
            <Coins className="size-4" />
            Оплатить с баллами
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- рефералы */

const INVITE_STATUS: Record<
  string,
  { label: string; tone: "muted" | "info" | "ok" }
> = {
  sent: { label: "приглашение отправлено", tone: "muted" },
  registered: { label: "зарегистрировался", tone: "info" },
  paid: { label: "оплатил", tone: "ok" },
};

function ReferralSection({
  data,
  mini,
  referralLink,
  onSent,
}: {
  data: BalanceOverview;
  mini: boolean;
  referralLink: string;
  onSent: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const canSend = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  async function send() {
    setSending(true);
    try {
      const response = await fetch("/api/balance/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          message: message.trim() || undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        toast.error(body.error ?? "Не удалось отправить приглашение");
        return;
      }
      toast.success("Приглашение отправлено");
      setEmail("");
      setMessage("");
      await onSent();
    } catch {
      toast.error("Сеть недоступна. Попробуйте ещё раз");
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success("Ссылка скопирована");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Браузер не дал скопировать — выделите ссылку вручную");
    }
  }

  const telegramShare = `https://t.me/share/url?url=${encodeURIComponent(
    referralLink,
  )}&text=${encodeURIComponent(
    "Ведём журналы СанПиН и ХАССП в WeSetup — попробуй, это заметно быстрее бумаги",
  )}`;

  return (
    <Section
      mini={mini}
      icon={<Gift className={mini ? "size-5" : "size-5 text-[#3848c7]"} />}
      title={`Пригласите друга — ${REFERRAL_REWARD_PERCENT} % на баланс`}
      subtitle={`Коллега оформит подписку — начислим ${REFERRAL_REWARD_PERCENT} % её стоимости баллами. Бонус один на каждое приглашённое заведение.`}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="почта коллеги"
          className={inputClass(mini)}
          style={mini ? miniInput : undefined}
        />
        <button
          type="button"
          disabled={!canSend || sending}
          onClick={() => setConfirmOpen(true)}
          className={primaryButtonClass(mini)}
          style={mini ? miniPrimary : undefined}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Отправить
        </button>
      </div>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value.slice(0, 500))}
        rows={2}
        placeholder="Пара слов от себя — необязательно"
        className={`${inputClass(mini)} mt-3 h-auto py-3`}
        style={mini ? miniInput : undefined}
      />

      <div
        className={
          mini
            ? "mt-4 rounded-2xl p-4"
            : "mt-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4"
        }
        style={mini ? { background: "var(--mini-surface-2)" } : undefined}
      >
        <div
          className={
            mini
              ? "text-[12px] font-medium"
              : "text-[12px] font-medium uppercase tracking-[0.14em] text-[#6f7282]"
          }
          style={mini ? { color: "var(--mini-text-muted)" } : undefined}
        >
          Ваша ссылка
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code
            className={
              mini
                ? "min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-[13px]"
                : "min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 text-[13px] text-[#0b1024] ring-1 ring-[#ececf4]"
            }
            style={
              mini
                ? { background: "var(--mini-surface-1)", color: "var(--mini-text)" }
                : undefined
            }
          >
            {referralLink}
          </code>
          <button
            type="button"
            onClick={copyLink}
            className={secondaryButtonClass(mini)}
            style={mini ? miniSecondary : undefined}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            Копировать
          </button>
          <a
            href={telegramShare}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryButtonClass(mini)}
            style={mini ? miniSecondary : undefined}
          >
            <Send className="size-4" />В Telegram
          </a>
        </div>
      </div>

      {data.invites.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {data.invites.map((invite) => {
            const status = INVITE_STATUS[invite.status] ?? INVITE_STATUS.sent;
            return (
              <li
                key={invite.id}
                className={
                  mini
                    ? "flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-[13px]"
                    : "flex items-center justify-between gap-3 rounded-2xl border border-[#ececf4] px-3.5 py-2.5 text-[13.5px]"
                }
                style={mini ? { background: "var(--mini-surface-2)" } : undefined}
              >
                <span
                  className="min-w-0 truncate"
                  style={mini ? { color: "var(--mini-text)" } : undefined}
                >
                  {invite.email}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {invite.rewardRub > 0 ? (
                    <span className="font-semibold tabular-nums text-[#116b2a]">
                      +{formatPoints(invite.rewardRub)}
                    </span>
                  ) : null}
                  <StatusPill tone={status.tone} mini={mini}>
                    {status.label}
                  </StatusPill>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={send}
        title="Отправить приглашение?"
        description={`Письмо уйдёт на ${email.trim().toLowerCase()} от имени WeSetup с вашей рекомендацией.`}
        bullets={[
          { label: "Адрес увидит только сервис — рассылок не будет" },
          {
            label: `Когда коллега оплатит подписку, вам начислят ${REFERRAL_REWARD_PERCENT} % баллами`,
            tone: "info",
          },
        ]}
        confirmLabel="Отправить"
        variant="info"
      />
    </Section>
  );
}

/* -------------------------------------------------------------- отзыв */

const REVIEW_TILES: Array<{ kind: ReviewKind; title: string; hint: string }> = [
  { kind: "text", title: "Текст", hint: "пара абзацев о работе с журналами" },
  { kind: "photo", title: "С фото", hint: "снимок кухни, планшета или журнала" },
  { kind: "video", title: "С видео", hint: "30–60 секунд от первого лица" },
];

/**
 * Сумма за отзыв. Анонимный — старая сумма зачёркнута, рядом новая
 * (−20 %, вниз до рубля). Только показ: начисляет сервер при одобрении по
 * виду вложения и флагу из БД.
 */
function RewardAmount({
  kind,
  anonymous,
  className,
  testId,
}: {
  kind: ReviewKind;
  anonymous: boolean;
  className: string;
  testId?: string;
}) {
  const full = reviewRewardFor(kind);
  if (!anonymous) {
    return (
      <span className={className} data-testid={testId}>
        {formatPoints(full)}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5" data-testid={testId}>
      <s className="text-[0.82em] font-medium text-[#9b9fb3]" data-testid={testId ? `${testId}-old` : undefined}>
        <span className="sr-only">было </span>
        {formatPoints(full)}
      </s>
      <span className={className}>
        <span className="sr-only">анонимно </span>
        {formatPoints(reviewRewardFor(kind, true))}
      </span>
    </span>
  );
}

function ReviewSection({
  data,
  mini,
  onSent,
}: {
  data: BalanceOverview;
  mini: boolean;
  onSent: () => void | Promise<void>;
}) {
  const review = data.myReview;
  const [showForm, setShowForm] = useState(false);
  // Анонимность живёт здесь, а не в форме: от неё зависят и плитки видов
  // отзыва над формой — суммы на них зачёркиваются.
  const [anonymous, setAnonymous] = useState(false);

  if (review && review.status !== "rejected" && !showForm) {
    return (
      <Section
        mini={mini}
        icon={<Star className={mini ? "size-5" : "size-5 text-[#3848c7]"} />}
        title="Ваш отзыв"
        subtitle={
          review.status === "pending"
            ? "На проверке — обычно отвечаем в течение рабочего дня."
            : `Опубликован. Начислено ${formatPoints(review.rewardRub)} на баланс организации.`
        }
      >
        <blockquote
          className={
            mini
              ? "rounded-2xl p-4 text-[13.5px] leading-[1.6]"
              : "rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] leading-[1.6] text-[#3c4053]"
          }
          style={
            mini
              ? { background: "var(--mini-surface-2)", color: "var(--mini-text)" }
              : undefined
          }
        >
          «{review.text}»
          <footer
            className={mini ? "mt-2 text-[12px]" : "mt-2 text-[12.5px] text-[#6f7282]"}
            style={mini ? { color: "var(--mini-text-muted)" } : undefined}
          >
            {review.anonymous
              ? "— анонимно, без имени и заведения"
              : `— ${review.authorName}, ${review.place}`}
          </footer>
        </blockquote>
      </Section>
    );
  }

  return (
    <Section
      mini={mini}
      icon={<Star className={mini ? "size-5" : "size-5 text-[#3848c7]"} />}
      title="Оставьте отзыв — до 1990 ₽"
      subtitle="Расскажите, как ведёте журналы. Мы опубликуем отзыв на сайте, а баллы начислим на баланс организации после проверки."
    >
      {review?.status === "rejected" ? (
        <div
          className={
            mini
              ? "mb-4 rounded-2xl p-3 text-[13px]"
              : "mb-4 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]"
          }
          style={
            mini
              ? { background: "var(--mini-crimson-soft)", color: "var(--mini-crimson)" }
              : undefined
          }
        >
          Прошлый отзыв не опубликован: {review.rejectReason ?? "причина не указана"}.
          Исправьте и отправьте заново.
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        {REVIEW_TILES.map((tile) => (
          <div
            key={tile.kind}
            data-testid={`review-tile-${tile.kind}`}
            className={
              mini
                ? "rounded-2xl p-3"
                : "rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3.5"
            }
            style={mini ? { background: "var(--mini-surface-2)" } : undefined}
          >
            <div
              className={
                mini
                  ? "text-[13px] font-medium"
                  : "text-[13.5px] font-medium text-[#0b1024]"
              }
              style={mini ? { color: "var(--mini-text)" } : undefined}
            >
              {tile.title}
            </div>
            <div className="mt-1">
              <RewardAmount
                kind={tile.kind}
                anonymous={anonymous}
                className="text-[18px] font-semibold tabular-nums text-[#116b2a]"
              />
            </div>
            <div
              className={mini ? "mt-1 text-[12px]" : "mt-1 text-[12px] text-[#6f7282]"}
              style={mini ? { color: "var(--mini-text-muted)" } : undefined}
            >
              {tile.hint}
            </div>
          </div>
        ))}
      </div>

      <ReviewForm
        data={data}
        mini={mini}
        anonymous={anonymous}
        onAnonymousChange={setAnonymous}
        onSent={async () => {
          setShowForm(false);
          await onSent();
        }}
      />
    </Section>
  );
}

function ReviewForm({
  data,
  mini,
  anonymous,
  onAnonymousChange,
  onSent,
}: {
  data: BalanceOverview;
  mini: boolean;
  anonymous: boolean;
  onAnonymousChange: (next: boolean) => void;
  onSent: () => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  // Предзаполнение — с сервера и без дублей: если организация названа так
  // же, как человек, заведение не подставляется (reviewPrefill).
  const [authorName, setAuthorName] = useState(data.reviewPrefill.authorName);
  const [place, setPlace] = useState(data.reviewPrefill.place);
  const [rating, setRating] = useState(5);
  const [consent, setConsent] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploads = useAttachmentUploads();

  const attachment = uploads.uploads[0] ?? null;
  const ready = attachment?.status === "ready" ? attachment.attachment : null;
  const kind = useMemo(
    () => reviewKindFromMime(attachment?.mimeType ?? null) ?? "text",
    [attachment?.mimeType],
  );
  const reward = reviewRewardFor(kind, anonymous);
  const uploading = attachment?.status === "uploading";
  const canSend =
    text.trim().length >= REVIEW_TEXT_MIN_LENGTH &&
    (anonymous || (authorName.trim().length >= 2 && place.trim().length >= 2)) &&
    consent &&
    !uploading &&
    !sending;

  const labelClass = mini
    ? "mb-1.5 block text-[13px] font-medium"
    : "mb-1.5 block text-[13px] font-medium text-[#0b1024]";
  const labelStyle = mini ? { color: "var(--mini-text)" } : undefined;

  async function send() {
    setSending(true);
    try {
      const response = await fetch("/api/balance/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          // Анонимный отзыв имя и заведение не отправляет вовсе.
          ...(anonymous ? {} : { authorName: authorName.trim(), place: place.trim() }),
          anonymous,
          rating,
          consentPublic: consent,
          attachments: ready ? [ready] : [],
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(body.error ?? "Не удалось отправить отзыв");
        return;
      }
      toast.success("Отзыв отправлен на проверку");
      setText("");
      uploads.clear();
      await onSent();
    } catch {
      toast.error("Сеть недоступна. Попробуйте ещё раз");
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`Оценка ${value}`}
            onClick={() => setRating(value)}
            className="transition-transform duration-150 hover:scale-110"
          >
            <Star
              className={`size-6 ${
                value <= rating
                  ? "fill-[#f5b301] text-[#f5b301]"
                  : mini
                    ? "text-[color:var(--mini-text-faint)]"
                    : "text-[#dcdfed]"
              }`}
            />
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(event) =>
          setText(event.target.value.slice(0, REVIEW_TEXT_MAX_LENGTH))
        }
        rows={5}
        aria-label="Текст отзыва"
        placeholder="Что изменилось после перехода на электронные журналы? Что понравилось, что было сложно?"
        className={`${inputClass(mini)} h-auto py-3`}
        style={mini ? miniInput : undefined}
      />
      <div
        className={mini ? "text-[12px]" : "text-[12px] text-[#9b9fb3]"}
        style={mini ? { color: "var(--mini-text-faint)" } : undefined}
      >
        {text.trim().length} / {REVIEW_TEXT_MAX_LENGTH} символов
      </div>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          data-testid="review-anonymous"
          checked={anonymous}
          onChange={(event) => onAnonymousChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#5566f6]"
        />
        <span
          className={mini ? "text-[13px]" : "text-[13.5px] leading-[1.5] text-[#0b1024]"}
          style={mini ? { color: "var(--mini-text)" } : undefined}
        >
          Оставить отзыв анонимно (без имени и заведения)
          <span
            className={mini ? "mt-0.5 block text-[12px]" : "mt-0.5 block text-[12px] text-[#6f7282]"}
            style={mini ? { color: "var(--mini-text-muted)" } : undefined}
          >
            На сайте отзыв будет подписан «Анонимный отзыв», начисление — на 20 % меньше.
          </span>
        </span>
      </label>

      {anonymous ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="review-author" className={labelClass} style={labelStyle}>
              Как вас подписать
            </label>
            <input
              id="review-author"
              value={authorName}
              onChange={(event) => setAuthorName(event.target.value)}
              placeholder="Например, Анна Петрова"
              className={inputClass(mini)}
              style={mini ? miniInput : undefined}
            />
          </div>
          <div>
            <label htmlFor="review-place" className={labelClass} style={labelStyle}>
              Заведение и город
            </label>
            <input
              id="review-place"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              placeholder="Например, кафе «Ромашка», Казань"
              className={inputClass(mini)}
              style={mini ? miniInput : undefined}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={REVIEW_ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) uploads.addFiles([files[0]]);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={Boolean(attachment)}
          className={secondaryButtonClass(mini)}
          style={mini ? miniSecondary : undefined}
        >
          <Paperclip className="size-4" />
          Фото или видео
        </button>
        {attachment ? (
          <span
            className={
              mini
                ? "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px]"
                : "inline-flex items-center gap-2 rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[12.5px] text-[#3848c7]"
            }
            style={mini ? { background: "var(--mini-surface-3)" } : undefined}
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            <span className="max-w-[180px] truncate">{attachment.filename}</span>
            <button
              type="button"
              aria-label="Убрать вложение"
              onClick={() => uploads.remove(attachment.key)}
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ) : null}
      </div>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          data-testid="review-consent"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#5566f6]"
        />
        <span
          data-testid="review-consent-text"
          className={mini ? "text-[13px]" : "text-[13px] leading-[1.5] text-[#3c4053]"}
          style={mini ? { color: "var(--mini-text-muted)" } : undefined}
        >
          {anonymous
            ? "Согласен на публикацию текста отзыва без имени и заведения"
            : "Согласен на публикацию отзыва, имени и заведения на сайте wesetup.ru и в соцсетях."}
        </span>
      </label>

      <div
        className={
          mini
            ? "flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
            : "flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4"
        }
        style={mini ? { background: "var(--mini-surface-2)" } : undefined}
      >
        <span
          className={mini ? "inline-flex flex-wrap items-baseline gap-x-1.5 text-[13px]" : "inline-flex flex-wrap items-baseline gap-x-1.5 text-[13.5px] text-[#3c4053]"}
          style={mini ? { color: "var(--mini-text-muted)" } : undefined}
        >
          {/* Пробелы между словами даёт gap флекса — литеральные пробелы
              удвоили бы отступ. */}
          <span>Будет начислено</span>
          <RewardAmount
            kind={kind}
            anonymous={anonymous}
            className="font-semibold text-[#116b2a]"
            testId="review-reward"
          />
          <span>после проверки</span>
        </span>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => setConfirmOpen(true)}
          className={primaryButtonClass(mini)}
          style={mini ? miniPrimary : undefined}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Отправить отзыв
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={send}
        title="Отправить отзыв на проверку?"
        description="Модератор прочитает отзыв и решит, публиковать ли его. Обычно это занимает один рабочий день."
        bullets={[
          {
            label: anonymous
              ? `К начислению ${formatPoints(reward)} на баланс организации — анонимный отзыв на 20 % меньше`
              : `К начислению ${formatPoints(reward)} на баланс организации`,
            tone: "info",
          },
          {
            label: anonymous
              ? "Отзыв появится на сайте без имени и заведения"
              : "Отзыв появится на сайте с вашим именем и заведением",
          },
          { label: "Пока отзыв на проверке, отправить второй нельзя" },
        ]}
        confirmLabel="Отправить"
        variant="info"
      />
    </div>
  );
}

/* ----------------------------------------------------------- история */

function HistorySection({
  data,
  mini,
  inApp,
}: {
  data: BalanceOverview;
  mini: boolean;
  inApp: boolean;
}) {
  if (data.transactions.length === 0) {
    return (
      <Section
        mini={mini}
        icon={<Coins className={mini ? "size-5" : "size-5 text-[#3848c7]"} />}
        title="История начислений"
        subtitle={
          inApp
            ? "Пока пусто."
            : "Пока пусто. Пригласите коллегу, оставьте отзыв или пополните баланс — первые баллы появятся здесь."
        }
      >
        {null}
      </Section>
    );
  }

  // Остаток после каждой операции. Список отсортирован от новых к
  // старым, поэтому «итог» строки — текущий баланс минус всё, что
  // случилось после неё. Считаем без накопителя: мутировать переменную
  // в рендере нельзя (react-hooks/immutability).
  const rows = data.transactions.map((transaction, index) => ({
    transaction,
    after:
      data.balanceRub -
      data.transactions
        .slice(0, index)
        .reduce((sum, later) => sum + later.amount, 0),
  }));

  return (
    <Section
      mini={mini}
      icon={<Coins className={mini ? "size-5" : "size-5 text-[#3848c7]"} />}
      title="История начислений"
      subtitle="Каждое движение баллов — с датой, причиной и остатком после операции."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[13.5px]">
          <thead>
            <tr
              className={
                mini
                  ? "text-left text-[11px] uppercase tracking-[0.14em]"
                  : "text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]"
              }
              style={mini ? { color: "var(--mini-text-faint)" } : undefined}
            >
              <th className="pb-2 font-medium">Дата</th>
              <th className="pb-2 font-medium">Операция</th>
              <th className="pb-2 text-right font-medium">Сумма</th>
              <th className="pb-2 text-right font-medium">Итог</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ transaction, after }) => (
              <tr
                key={transaction.id}
                className={mini ? "" : "border-t border-[#f2f3f8]"}
                style={
                  mini ? { borderTop: "1px solid var(--mini-divider)" } : undefined
                }
              >
                <td
                  className="py-2.5 whitespace-nowrap"
                  style={mini ? { color: "var(--mini-text-muted)" } : undefined}
                >
                  {new Date(transaction.createdAt).toLocaleDateString("ru-RU")}
                </td>
                <td
                  className="py-2.5"
                  style={mini ? { color: "var(--mini-text)" } : undefined}
                >
                  {transaction.description}
                </td>
                <td
                  className={`py-2.5 text-right tabular-nums font-medium ${
                    transaction.amount > 0 ? "text-[#116b2a]" : "text-[#a13a32]"
                  }`}
                >
                  {transaction.amount > 0 ? "+" : "−"}
                  {formatPoints(Math.abs(transaction.amount))}
                </td>
                <td
                  className="py-2.5 text-right tabular-nums"
                  style={mini ? { color: "var(--mini-text-muted)" } : undefined}
                >
                  {formatPoints(after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
