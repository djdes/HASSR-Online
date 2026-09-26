"use client";

import Link from "next/link";
import { MiniOrgSwitcher } from "@/app/mini/_components/mini-org-switcher";
import { MiniLocationSwitcher } from "@/app/mini/_components/mini-location-switcher";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";

import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { miniHomeHref } from "@/app/mini/_lib/nav-items";
import { getUserPositionLabel, getUserRoleLabel } from "@/lib/user-roles";
import {
  ArrowLeft,
  ChevronRight,
  Coins,
  CreditCard,
  LogOut,
  MessageCircleMore,
  Moon,
  Palette,
  Settings,
  ShieldCheck,
  Sun,
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
import { FeedbackDialog } from "@/components/layout/feedback-dialog";
import { PasskeySettings } from "@/components/auth/passkey-settings";
import { useMiniTheme } from "../_components/mini-theme";
import { signOutOnThisDevice } from "../_lib/signed-out-mark";

/**
 * Профиль в мини-приложении.
 *
 * Зеркало выпадающего меню профиля на сайте (`profile-sheet.tsx`):
 * карточка человека, смена организации и точки, баланс, тариф, внешний
 * вид, настройки, панель платформы, выход. Ничего «только для
 * приложения» здесь быть не должно (П-3) — поэтому web-push, PIN для
 * QR-плакатов и всё про установку на домашний экран отсюда убраны.
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
}: {
  // Читается на сервере в page.tsx: TELEGRAM_BOT_USERNAME — не
  // NEXT_PUBLIC-переменная, из клиентского компонента её не видно.
  telegramBotUsername: string;
  /** Должность и телефон в сессии не лежат — приходят из page.tsx. */
  positionTitle?: string | null;
  phone?: string | null;
}) {
  const { data: session, status } = useSession();
  const { theme, setTheme } = useMiniTheme();
  const [busy, setBusy] = useState<"none" | "signout" | "unlink">("none");
  const [error, setError] = useState<string | null>(null);
  // Confirm-state для двух destructive actions. Project rule (CLAUDE.md
  // §6): native window.confirm не используем — только ConfirmDialog с
  // bullet-описанием последствий.
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false);
  const [confirmUnlinkOpen, setConfirmUnlinkOpen] = useState(false);

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
        Загружаем…
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="mini-card flex w-full flex-col items-center gap-3 px-5 py-6 text-center">
          <div className="text-[19px] font-semibold" style={{ color: "var(--mini-text)" }}>
            Вы не вошли
          </div>
          <p className="text-[16px] leading-relaxed" style={{ color: "var(--mini-text-muted)" }}>
            Профиль виден только после входа. В Telegram вход произойдёт сам.
          </p>
          <Link
            href={miniShellSignInHref("/mini/me")}
            className="mini-btn-primary mini-press mt-1 w-full"
          >
            Войти
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
        const body = (await resp.json().catch(() => ({ error: "" }))) as {
          error?: string;
        };
        // Раньше при сбое на экране появлялось «HTTP 500» — человеку
        // непонятно ни что случилось, ни что теперь делать.
        throw new Error(
          body.error ||
            "Не удалось отвязать Telegram. Проверьте связь и попробуйте ещё раз."
        );
      }
      await signOut({ redirect: false });
      window.location.href = "/mini";
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Не удалось отвязать Telegram."
      );
      setBusy("none");
    }
  }

  async function handleSignOut() {
    setError(null);
    setBusy("signout");
    try {
      // Раньше здесь был один `signOut`: он снимал только куку next-auth,
      // а `/mini` в Telegram тут же входил обратно по initData — выйти и
      // войти в другой аккаунт было нельзя.
      await signOutOnThisDevice({
        fetch: (input, init) => fetch(input, init),
        signOut: () => signOut({ redirect: false }),
      });
    } catch {
      setError("Не удалось выйти. Проверьте связь и попробуйте ещё раз.");
      setBusy("none");
      return;
    }
    // Экран входа, а не `/mini`: там можно вернуться через Telegram или
    // войти в другой аккаунт. `replace` — чтобы «назад» не вёл в профиль
    // того, кто только что вышел.
    window.location.replace("/mini/login");
  }

  const fullAccess = hasFullWorkspaceAccess(u);
  // Домашний адрес — тот же, что у первой вкладки меню, иначе кнопка
  // «На главную» вела бы туда, откуда сразу перекидывает.
  const homeHref = miniHomeHref(u);
  // Та же приоритетность, что в «Сотрудниках»/«Команде»:
  // справочная должность → свободная строка → подпись роли.
  const positionLabel = getUserPositionLabel({
    name: u.name ?? "",
    role: u.role,
    positionTitle,
  });
  const roleLabel = u.role ? getUserRoleLabel(u.role) : null;

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <Link
        href={homeHref}
        className="mini-btn-ghost mini-press -my-1 -ml-3.5 w-fit"
      >
        <ArrowLeft className="size-5" />
        На главную
      </Link>

      <header className="px-1">
        <h1 className="mini-h1">Профиль</h1>
      </header>

      <MiniOrgSwitcher />
      <MiniLocationSwitcher />

      {/* Карточка человека — как карточки QR-страниц: подпись слева,
          значение крупно справа. */}
      <section className="mini-card p-4">
        <dl className="space-y-3 text-[16px]">
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>Имя</dt>
            <dd
              className="min-w-0 truncate text-right font-semibold"
              style={{ color: "var(--mini-text)" }}
            >
              {u.name || "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>Организация</dt>
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
              <dt style={{ color: "var(--mini-text-muted)" }}>Роль</dt>
              <dd
                className="min-w-0 truncate text-right font-semibold"
                style={{ color: "var(--mini-text)" }}
              >
                {roleLabel}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>Должность</dt>
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
            <dt style={{ color: "var(--mini-text-muted)" }}>Телефон</dt>
            <dd
              className="min-w-0 truncate text-right font-semibold"
              style={{ color: "var(--mini-text)" }}
            >
              {phone || "не указан"}
            </dd>
          </div>
          {u.email && !u.email.endsWith("@invite.local") ? (
            <div className="flex items-center justify-between gap-3">
              <dt style={{ color: "var(--mini-text-muted)" }}>Почта</dt>
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

      <section className="mini-card p-4">
        <PasskeySettings dark />
      </section>

      {/* Тема — переключатель как вкладки QR-страниц. */}
      <section className="mini-card p-4">
        <div className="mb-3">
          <div
            className="text-[17px] font-semibold"
            style={{ color: "var(--mini-text)" }}
          >
            Тема оформления
          </div>
          <div
            className="mt-0.5 text-[14.5px]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            Выбор запоминается в вашем аккаунте
          </div>
        </div>
        <div role="radiogroup" aria-label="Тема Mini App" className="mini-seg">
          <button
            type="button"
            role="radio"
            aria-checked={theme === "dark"}
            onClick={() => setTheme("dark")}
            className="mini-press"
          >
            <Moon className="size-5" />
            Тёмная
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={theme === "light"}
            onClick={() => setTheme("light")}
            className="mini-press"
          >
            <Sun className="size-5" />
            Светлая
          </button>
        </div>
      </section>

      {/* Строки — как пункты списка QR-страниц: плитка иконки, название
          крупно, пояснение под ним. Набор пунктов — тот же, что в меню
          профиля на сайте (`components/layout/profile-sheet.tsx`); они
          открываются здесь же, в оболочке приложения (П-3). */}
      <section className="space-y-2">
        {/* Баланс и бонусы — тот же пункт, что в меню профиля на сайте. */}
        <Link href="/settings/balance" className="mini-item mini-press">
          <ProfileRow icon={Coins} label="Баланс и бонусы" hint="отзыв и приглашения" />
        </Link>
        {fullAccess ? (
          <>
            <Link href="/settings/subscription" className="mini-item mini-press">
              <ProfileRow
                icon={CreditCard}
                label="Тарифы и оплата"
                hint="счета и автопродление"
              />
            </Link>
            <Link href="/settings/appearance" className="mini-item mini-press">
              <ProfileRow icon={Palette} label="Внешний вид" hint="логотип и цвета" />
            </Link>
            <Link href="/settings" className="mini-item mini-press">
              <ProfileRow
                icon={Settings}
                label="Настройки"
                hint="организация и журналы"
              />
            </Link>
          </>
        ) : null}
        {u.isRoot ? (
          <Link href="/root" className="mini-item mini-press">
            <ProfileRow icon={ShieldCheck} label="Панель платформы" />
          </Link>
        ) : null}
        {/* Все разделы кабинета — теми же правами, что на сайте. Вкладка
            есть и в нижнем меню; здесь — на случай, если человек ищет
            «где остальное» именно в профиле. */}
        <Link href="/mini/sections" className="mini-item mini-press">
          <ProfileRow
            icon={LayoutGrid}
            label="Все разделы"
            hint="журналы, отчёты, настройки"
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
                label="Обратная связь"
                hint="ошибка или идея"
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
              label="Открыть полную версию сайта"
              hint="шапка и широкие таблицы"
            />
          </button>
        )}
      </section>

      {error ? <div className="mini-err">{error}</div> : null}

      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setConfirmSignOutOpen(true)}
          disabled={busy !== "none"}
          className="mini-item mini-press disabled:opacity-50"
        >
          <ProfileRow icon={LogOut} label="Выйти" hint="сессия сбросится" chevron={false} />
        </button>
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
            label="Отвязать Telegram"
            hint={busy === "unlink" ? "…" : "понадобится новое приглашение"}
            tone="danger"
            chevron={false}
          />
        </button>
      </section>

      <ConfirmDialog
        open={confirmSignOutOpen}
        onClose={() => setConfirmSignOutOpen(false)}
        onConfirm={async () => {
          setConfirmSignOutOpen(false);
          await handleSignOut();
        }}
        title="Выйти из аккаунта?"
        description="Приложение забудет вас на этом телефоне и само входить больше не будет. Откроется экран входа: там можно вернуться в свой аккаунт или войти в другой."
        confirmLabel="Выйти"
        cancelLabel="Отмена"
        variant="info"
      />

      <ConfirmDialog
        open={confirmUnlinkOpen}
        onClose={() => setConfirmUnlinkOpen(false)}
        onConfirm={async () => {
          setConfirmUnlinkOpen(false);
          await handleUnlink();
        }}
        title="Точно отвязать Telegram?"
        description="После отвязки приложение перестанет открываться — даже из этого же чата с ботом. Чтобы вернуться, понадобится новая ссылка-приглашение от руководителя."
        bullets={[
          { label: "Приложение забудет вас на этом телефоне", tone: "default" },
          { label: "Связь аккаунта с вашим Telegram удалится", tone: "warn" },
          {
            label: "Понадобится новая ссылка-приглашение от руководителя",
            tone: "warn",
          },
        ]}
        confirmLabel="Отвязать"
        cancelLabel="Отмена"
        variant="danger"
        typeToConfirm="ОТВЯЗАТЬ"
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
