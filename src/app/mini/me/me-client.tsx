"use client";
import { PersonalLanguageSelect } from "@/components/i18n/personal-language-select";

import Link from "next/link";
import { MiniOrgSwitcher } from "@/app/mini/_components/mini-org-switcher";
import { MiniLocationSwitcher } from "@/app/mini/_components/mini-location-switcher";
import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { parseMobileAppUserAgent, type MobileAppPlatform } from "@/lib/mobile-app";
import { unregisterPushDevice } from "@/lib/native-bridge";
import { AppPushSettings } from "@/app/mini/_components/app-push-settings";
import { MarketingEmailToggle } from "@/components/settings/marketing-email-toggle";

import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { hasCapability } from "@/lib/permission-presets";
import { miniHomeHref } from "@/app/mini/_lib/nav-items";
import { getUserRoleLabel } from "@/lib/user-roles";
import {
  ArrowLeft,
  ChevronRight,
  Coins,
  CreditCard,
  FileSignature,
  LogOut,
  MessageCircleMore,
  Palette,
  ShieldCheck,
  Trash2,
  Unlink,
  LayoutGrid,
  MonitorSmartphone,
  type LucideIcon,
} from "lucide-react";
import {
  buildMiniShellClearCookie,
  hasMiniShellCookie,
  miniShellSignInHref,
} from "@/lib/mini-shell-cookie";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DeleteAccountFlow } from "@/app/delete-account/delete-account-client";
import { FeedbackDialog } from "@/components/layout/feedback-dialog";
import { PasskeySettings } from "@/components/auth/passkey-settings";
import { BRANDING_SETTINGS_HREF } from "@/components/theme/theme-tiles";
import { MiniThemeTiles } from "../_components/mini-theme-tiles";
import { signOutOnThisDevice } from "../_lib/signed-out-mark";
import { signOutAndOpen } from "@/lib/sign-out";
import { BillingAnnouncement } from "@/components/billing/billing-announcement";
import type { BillingPrice } from "@/lib/billing-period";
import { BillingStaffNotice } from "@/components/billing/billing-staff-notice";

/**
 * Профиль в мини-приложении.
 *
 * Зеркало выпадающего меню профиля на сайте (`profile-sheet.tsx`):
 * карточка человека, смена организации и точки, тема (те же три карточки)
 * с «Логотип и цвета», баланс, тариф, настройки, панель платформы, выход.
 * Ничего «только для приложения» здесь быть не должно (П-3) — поэтому
 * web-push, PIN для QR-плакатов и всё про установку на домашний экран
 * отсюда убраны.
 *
 * Два действия необратимы:
 *   • «Выйти» — тот же полный выход, что на сайте (все куки сессии), и
 *     пометка «вышел вручную»: в Telegram приложение больше не входит
 *     само, а открывает экран входа — вернуться через Telegram или войти
 *     в другой аккаунт (`_lib/signed-out-mark.ts`);
 *   • «Отвязать Telegram» — ещё и стирает `User.telegramChatId`, после
 *     чего понадобится новое приглашение. Это аналог выхода именно для
 *     Telegram, поэтому он остаётся.
 */
export function MiniMeClient({
  telegramBotUsername,
  positionTitle = null,
  phone = null,
  telegramLinked = false,
  billingAnnouncement = null,
  billingStaffNotice = false,
}: {
  /** Руководитель выбирает тариф после бесплатного периода. */
  billingStaffNotice?: boolean;
  /** Анонс бесплатного периода (тексты — с сервера). */
  billingAnnouncement?: {
    lead: string;
    tail: string | null;
    tailParts: { before: string; price: BillingPrice; after: string } | null;
    href: string | null;
    dayKey: string;
  } | null;
  // Читается на сервере в page.tsx: TELEGRAM_BOT_USERNAME — не
  // NEXT_PUBLIC-переменная, из клиентского компонента её не видно.
  telegramBotUsername: string;
  /** Должность и телефон в сессии не лежат — приходят из page.tsx. */
  positionTitle?: string | null;
  phone?: string | null;
  /** Привязан ли Telegram. Нет — кнопки «Отвязать Telegram» нет: в приложении
   *  для телефона человек входит по паролю, и кнопка только пугала бы и
   *  выкидывала из аккаунта. */
  telegramLinked?: boolean;
}) {
  const t = useTranslations("miniProfile");
  const { data: session, status } = useSession();
  const [busy, setBusy] = useState<"none" | "signout" | "unlink">("none");
  const [error, setError] = useState<"unlinkFailed" | "signOutFailed" | "unauthorized" | null>(null);
  // Confirm-state для двух destructive actions. Project rule (CLAUDE.md
  // §6): native window.confirm не используем — только ConfirmDialog с
  // bullet-описанием последствий.
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false);
  const [confirmUnlinkOpen, setConfirmUnlinkOpen] = useState(false);
  // Приложение WeSetup для телефона (по User-Agent). Узнаём после
  // монтирования: сервер рисует профиль так же, как для браузера.
  const [appPlatform, setAppPlatform] = useState<MobileAppPlatform | null>(null);
  useEffect(() => {
    setAppPlatform(parseMobileAppUserAgent(navigator.userAgent)?.platform ?? null);
  }, []);

  // Профиль нужен и линейному сотруднику: выйти, отвязать Telegram,
  // переключить тему, посмотреть баллы. Поэтому гейта по правам здесь
  // нет — внутри показываем ровно те ссылки, что доступны человеку.
  // Пока сессия проверяется — «Загружаем…». Если её нет, крутить
  // спиннер вечно нельзя: человеку надо дать дорогу на вход.
  if (status === "loading") {
    return (
      <div
        className="flex flex-1 items-center justify-center text-[16px]"
        style={{ color: "var(--mini-text-muted)" }}
      >
          {t("loading")}
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="mini-card flex w-full flex-col items-center gap-3 px-5 py-6 text-center">
          <div className="text-[19px] font-semibold" style={{ color: "var(--mini-text)" }}>
            {t("guest.title")}
          </div>
          <p className="text-[16px] leading-relaxed" style={{ color: "var(--mini-text-muted)" }}>
            {t("guest.description")}
          </p>
          <Link
            href={miniShellSignInHref("/mini/me")}
            className="mini-btn-primary mini-press mt-1 w-full"
          >
            {t("guest.signIn")}
          </Link>
        </div>
      </div>
    );
  }

  const u = session.user;

  async function handleUnlink() {
    setError(null);
    setBusy("unlink");
    try {
      const resp = await fetch("/api/mini/unlink-tg", { method: "POST" });
      if (!resp.ok) {
        // Раньше при сбое на экране появлялось «HTTP 500» — человеку
        // непонятно ни что случилось, ни что теперь делать.
        throw new Error(resp.status === 401 ? "unauthorized" : "unlinkFailed");
      }
      // Push на этот телефон больше не нужны — отвязываем, пока сессия жива.
      await unregisterPushDevice();
      // Как «Выйти»: полный выход со всеми куками сессии. Один `signOut`
      // оставлял в браузере старую куку, и сессия возвращалась.
      await signOutOnThisDevice({
        fetch: (input, init) => fetch(input, init),
        signOut: () => signOut({ redirect: false }),
      }).catch(() => undefined);
      window.location.replace("/mini/login");
    } catch (err) {
      setError(err instanceof Error && err.message === "unauthorized" ? "unauthorized" : "unlinkFailed");
      setBusy("none");
    }
  }

  async function handleSignOut() {
    setError(null);
    setBusy("signout");
    try {
      // Общий полный выход (`lib/sign-out.ts`), тот же, что на сайте:
      // push этого телефона отвязывается, все куки сессии гаснут, ставится
      // пометка «вышел вручную» — `/mini` в Telegram сам не войдёт. Раньше
      // здесь был один `signOut`: он снимал только куку next-auth, а
      // `/mini` тут же входил обратно по initData. Экран входа, а не
      // `/mini`: там можно вернуться через Telegram или войти в другой
      // аккаунт.
      await signOutAndOpen("/mini/login");
    } catch {
      setError("signOutFailed");
      setBusy("none");
    }
  }

  const fullAccess = hasFullWorkspaceAccess(u);
  // Логотип и цвет организации — в её настройках, куда пускают только с
  // `admin.full`: то же условие, что у ссылки в меню профиля сайта
  // (`canEditBranding`). Шеф полного доступа к кабинету не получает.
  const canEditBranding = hasCapability(u, "admin.full");
  // Домашний адрес — тот же, что у первой вкладки меню, иначе кнопка
  // «На главную» вела бы туда, откуда сразу перекидывает.
  const homeHref = miniHomeHref(u);
  // Та же приоритетность, что в «Сотрудниках»/«Команде»:
  // справочная должность → свободная строка → подпись роли.
  const roleLabels: Record<string, string> = {
    manager: t("roles.manager"), owner: t("roles.manager"),
    head_chef: t("roles.headChef"), technologist: t("roles.headChef"),
    cook: t("roles.cook"), operator: t("roles.cook"),
    waiter: t("roles.waiter"),
  };
  const roleLabel = u.role ? roleLabels[u.role] ?? getUserRoleLabel(u.role) : null;
  // The server prop contains only a stored job-position/free-form title or
  // null. Translate the role fallback from its stable role code; preserve any
  // non-empty stored title verbatim, even when it matches Russian UI copy.
  const positionLabel = positionTitle?.trim() || roleLabel || t("roles.employee");
  const errorMessage = error === "unauthorized"
    ? t("errors.unauthorized")
    : error === "signOutFailed"
      ? t("errors.signOutFailed")
      : error === "unlinkFailed"
        ? t("errors.unlinkFailed")
        : null;

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <Link
        href={homeHref}
        className="mini-btn-ghost mini-press -my-1 -ml-3.5 w-fit"
      >
        <ArrowLeft className="size-5" />
        {t("home")}
      </Link>

      <header className="px-1">
        <h1 className="mini-h1">{t("title")}</h1>
      </header>

      {billingAnnouncement ? (
        <BillingAnnouncement
          lead={billingAnnouncement.lead}
          tail={billingAnnouncement.tail}
          tailParts={billingAnnouncement.tailParts}
          href={billingAnnouncement.href}
          dayKey={billingAnnouncement.dayKey}
          variant="mini"
        />
      ) : null}
      {billingStaffNotice ? <BillingStaffNotice variant="mini" /> : null}

      <MiniOrgSwitcher />
      <MiniLocationSwitcher />

      {/* Карточка человека — как карточки QR-страниц: подпись слева,
          значение крупно справа. */}
      <section className="mini-card p-4">
        <dl className="space-y-3 text-[16px]">
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>{t("fields.name")}</dt>
            <dd
              className="min-w-0 truncate text-right font-semibold"
              style={{ color: "var(--mini-text)" }}
            >
              {u.name || "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>{t("fields.organization")}</dt>
            <dd
              className="min-w-0 truncate text-right font-semibold"
              style={{ color: "var(--mini-text)" }}
            >
              {u.organizationName || "—"}
            </dd>
          </div>
          {/* Подпись должности — та же, что в «Сотрудниках» и
              «Команде» (`getUserPositionLabel`): справочная должность
              важнее роли. Иначе в профиле у заведующей стояло
              «Шеф-повар», а в списке команды — «Заведующая
              производством», и человек не понимал, кто он в системе.
              Строку «Роль» показываем, только если она добавляет
              что-то новое: дважды одно и то же — лишний шум. */}
          {roleLabel && roleLabel !== positionLabel ? (
            <div className="flex items-center justify-between gap-3">
              <dt style={{ color: "var(--mini-text-muted)" }}>{t("fields.role")}</dt>
              <dd
                className="min-w-0 truncate text-right font-semibold"
                style={{ color: "var(--mini-text)" }}
              >
                {roleLabel}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>{t("fields.position")}</dt>
            <dd
              className="min-w-0 truncate text-right font-semibold"
              style={{ color: "var(--mini-text)" }}
            >
              {positionLabel}
            </dd>
          </div>
          {/* Телефон — ключ, по которому аккаунт связывается с задачами
              (П-8): если его нет, человек должен это видеть. */}
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>{t("fields.phone")}</dt>
            <dd
              className="min-w-0 truncate text-right font-semibold"
              style={{ color: "var(--mini-text)" }}
            >
              {phone || t("fields.phoneMissing")}
            </dd>
          </div>
          {u.email && !u.email.endsWith("@invite.local") ? (
            <div className="flex items-center justify-between gap-3">
              <dt style={{ color: "var(--mini-text-muted)" }}>{t("fields.email")}</dt>
              <dd
                className="min-w-0 truncate text-right font-semibold"
                style={{ color: "var(--mini-text)" }}
              >
                {u.email}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Ключи входа: во встроенном браузере Android-приложения WebAuthn не
          гарантирован — там не предлагаем. На iOS работают. */}
      {appPlatform === "android" ? null : (
        <section className="mini-card p-4">
          <PasskeySettings dark />
        </section>
      )}

      {/* Только в приложении WeSetup: push на этот телефон. */}
      {appPlatform ? <AppPushSettings /> : null}

      {/* «Новости и предложения» — как в настройках уведомлений на сайте (П-3). */}
      <MarketingEmailToggle variant="mini" />
      <section className="mini-card p-4"><PersonalLanguageSelect /></section>

      {/* Тема — те же три карточки, что в меню профиля на сайте
          («Светлая / Тёмная / Как на устройстве», как блок Appearance в
          приложении Claude): нажал — тема сменилась сразу. Под ними, как на
          сайте, — «Логотип и цвета»: брендинг организации в её настройках. */}
      <section className="mini-card p-4" data-testid="mini-theme">
        <h2
          className="mb-3 text-[17px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          {t("theme.title")}
        </h2>
        <MiniThemeTiles />
        {canEditBranding ? (
          <Link
            href={BRANDING_SETTINGS_HREF}
            data-testid="theme-branding-link"
            className="mini-btn-ghost mini-press -mx-3.5 -mb-2 mt-1 w-fit"
            style={{ color: "var(--mini-accent-ink)" }}
          >
            <Palette className="size-5 shrink-0" aria-hidden />
            {t("theme.branding")}
          </Link>
        ) : null}
      </section>

      {/* Строки — как пункты списка QR-страниц: плитка иконки, название
          крупно, пояснение под ним. Набор пунктов — тот же, что в меню
          профиля на сайте (`components/layout/profile-sheet.tsx`); они
          открываются здесь же, в оболочке приложения (П-3). */}
      <section className="space-y-2">
        {/* Ознакомление с документами — для всех сотрудников. */}
        <Link href="/acknowledge" className="mini-item mini-press">
          <ProfileRow
            icon={FileSignature}
            label="Документы для ознакомления"
            hint="политика и инструкции"
          />
        </Link>
        {/* Баланс и бонусы — тот же пункт, что в меню профиля на сайте. */}
        <Link href="/settings/balance" className="mini-item mini-press">
          <ProfileRow icon={Coins} label={t("rows.balance")} hint={t("rows.balanceHint")} />
        </Link>
        {fullAccess ? (
          <>
            {/* В приложении оплату не показываем: правила App Store и
                Google Play запрещают вести на оплату мимо магазина. */}
            {appPlatform ? null : (
              <Link href="/settings/subscription" className="mini-item mini-press">
                <ProfileRow
                  icon={CreditCard}
                  label={t("rows.subscription")}
                  hint={t("rows.subscriptionHint")}
                />
              </Link>
            )}
            <Link href="/mini/sections" className="mini-item mini-press">
              <ProfileRow
                icon={LayoutGrid}
                label="Все разделы"
                hint="меню кабинета"
              />
            </Link>
          </>
        ) : null}
        {u.isRoot ? (
          <Link href="/root" className="mini-item mini-press">
          <ProfileRow icon={ShieldCheck} label={t("rows.platform")} />
          </Link>
        ) : null}
        {/* Все разделы кабинета — теми же правами, что на сайте. Вкладка
            есть и в нижнем меню; здесь — на случай, если человек ищет
            «где остальное» именно в профиле. */}
        <Link href="/mini/sections" className="mini-item mini-press">
          <ProfileRow
            icon={LayoutGrid}
            label={t("rows.sections")}
            hint={t("rows.sectionsHint")}
          />
        </Link>
        {/* Обратная связь — паритет с сайтом (П-3): на сайте форма живёт
            в шапке, в Mini App шапки нет, поэтому она стоит карточкой в
            профиле. Форма и эндпоинт те же, что на сайте. */}
        <FeedbackDialog
          telegramBotUsername={telegramBotUsername}
          trigger={
            <button type="button" className="mini-item mini-press">
              <ProfileRow
                icon={MessageCircleMore}
                label={t("rows.feedback")}
                hint={t("rows.feedbackHint")}
              />
            </button>
          }
        />
        {/* Полная версия сайта. Снимает режим оболочки и уводит в
            обычный кабинет — нужно тем, кто открыл приложение на
            планшете или ноутбуке и хочет широкие таблицы и шапку.

            У линейного сотрудника дом на сайте — тот же `/mini/today`,
            и кнопка просто возвращала его на этот же экран. Не
            показываем: обещание, которое нельзя выполнить. */}
        {homeHref.startsWith("/mini") ? null : (
          <button
            type="button"
            onClick={() => {
              if (hasMiniShellCookie(document.cookie)) {
                document.cookie = buildMiniShellClearCookie(
                  window.location.protocol === "https:"
                );
              }
              // Полная перезагрузка, а не router.push: хром страницы
              // выбирает сервер по куке, и клиентский переход отдал бы
              // ту же оболочку.
              window.location.href = homeHref;
            }}
            className="mini-item mini-press"
          >
            <ProfileRow
              icon={MonitorSmartphone}
              label={t("rows.fullSite")}
              hint={t("rows.fullSiteHint")}
            />
          </button>
        )}
      </section>

      {errorMessage ? <div className="mini-err">{errorMessage}</div> : null}

      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setConfirmSignOutOpen(true)}
          disabled={busy !== "none"}
          className="mini-item mini-press disabled:opacity-50"
        >
          <ProfileRow icon={LogOut} label={t("rows.signOut")} hint={t("rows.signOutHint")} chevron={false} />
        </button>
        {telegramLinked ? (
        <button
          type="button"
          onClick={() => setConfirmUnlinkOpen(true)}
          disabled={busy !== "none"}
          className="mini-item mini-press disabled:opacity-50"
          style={{
            background: "var(--mini-danger-soft)",
            borderColor: "var(--mini-danger-line)",
            color: "var(--mini-danger)",
          }}
        >
          <ProfileRow
            icon={Unlink}
            label={t("rows.unlink")}
            hint={busy === "unlink" ? t("rows.unlinkBusy") : t("rows.unlinkHint")}
            tone="danger"
            chevron={false}
          />
        </button>
        ) : null}
        {/* Удаление аккаунта — требование App Store и Google Play. Диалог
            и запрос общие со страницей /delete-account. */}
        <DeleteAccountFlow
          renderTrigger={(open, deleting) => (
            <button
              type="button"
              onClick={open}
              disabled={busy !== "none" || deleting}
              className="mini-item mini-press disabled:opacity-50"
              style={{ color: "var(--mini-danger)" }}
              data-testid="me-delete-account"
            >
              <ProfileRow
                icon={Trash2}
                label={t("rows.deleteAccount")}
                hint={deleting ? t("rows.deleteAccountBusy") : t("rows.deleteAccountHint")}
                tone="danger"
                chevron={false}
              />
            </button>
          )}
        />
      </section>

      <ConfirmDialog
        open={confirmSignOutOpen}
        onClose={() => setConfirmSignOutOpen(false)}
        onConfirm={async () => {
          setConfirmSignOutOpen(false);
          await handleSignOut();
        }}
        title={t("confirm.signOutTitle")}
        description={t("confirm.signOutDescription")}
        confirmLabel={t("confirm.signOutAction")}
        cancelLabel={t("confirm.cancel")}
        variant="info"
      />

      <ConfirmDialog
        open={confirmUnlinkOpen}
        onClose={() => setConfirmUnlinkOpen(false)}
        onConfirm={async () => {
          setConfirmUnlinkOpen(false);
          await handleUnlink();
        }}
        title={t("confirm.unlinkTitle")}
        description={t("confirm.unlinkDescription")}
        bullets={[
          { label: t("confirm.unlinkForgetDevice"), tone: "default" },
          { label: t("confirm.unlinkRemoveConnection"), tone: "warn" },
          {
            label: t("confirm.unlinkNewInvite"),
            tone: "warn",
          },
        ]}
        confirmLabel={t("confirm.unlinkAction")}
        cancelLabel={t("confirm.cancel")}
        variant="danger"
        typeToConfirm={t("confirm.unlinkPhrase")}
      />
    </div>
  );
}

/**
 * Содержимое строки профиля — как пункт списка QR-страниц: плитка иконки,
 * название крупно, пояснение под ним, стрелка у переходов.
 */
function ProfileRow({
  icon: Icon,
  label,
  hint,
  tone = "default",
  chevron = true,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  tone?: "default" | "danger";
  chevron?: boolean;
}) {
  const danger = tone === "danger";
  return (
    <>
      <span
        className="mini-tile"
        style={
          danger
            ? { background: "var(--mini-surface-1)", color: "var(--mini-danger)" }
            : undefined
        }
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint ? (
          <span
            className="mini-item-hint"
            style={danger ? { color: "var(--mini-danger)" } : undefined}
          >
            {hint}
          </span>
        ) : null}
      </span>
      {chevron ? (
        <ChevronRight
          className="size-5 shrink-0"
          style={{ color: "var(--mini-text-muted)" }}
          aria-hidden
        />
      ) : null}
    </>
  );
}
