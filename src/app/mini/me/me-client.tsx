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
} from "lucide-react";
import {
  buildMiniShellClearCookie,
  hasMiniShellCookie,
} from "@/lib/mini-shell-cookie";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FeedbackDialog } from "@/components/layout/feedback-dialog";
import { useMiniTheme } from "../_components/mini-theme";

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
 *   • «Выйти» — сбрасывает сессию на этом телефоне;
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
  if (status !== "authenticated") {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Загружаем…
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
    setBusy("signout");
    await signOut({ redirect: false });
    window.location.href = "/mini";
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
        className="-my-2 min-h-9 mini-press inline-flex items-center gap-1 text-[13px] font-medium"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <ArrowLeft className="size-4" />
        На главную
      </Link>

      <header className="px-1">
        <h1
          className="text-[22px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          Профиль
        </h1>
      </header>

      <MiniOrgSwitcher />
      <MiniLocationSwitcher />

      <section className="mini-card p-4">
        <dl className="space-y-3 text-[14px]">
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>Имя</dt>
            <dd
              className="font-medium"
              style={{ color: "var(--mini-text)" }}
            >
              {u.name || "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>Организация</dt>
            <dd
              className="font-medium"
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
                className="font-medium"
                style={{ color: "var(--mini-text)" }}
              >
                {roleLabel}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--mini-text-muted)" }}>Должность</dt>
            <dd
              className="min-w-0 truncate font-medium"
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
              className="min-w-0 truncate font-medium"
              style={{ color: "var(--mini-text)" }}
            >
              {phone || "не указан"}
            </dd>
          </div>
          {u.email && !u.email.endsWith("@invite.local") ? (
            <div className="flex items-center justify-between gap-3">
              <dt style={{ color: "var(--mini-text-muted)" }}>Почта</dt>
              <dd
                className="font-medium"
                style={{ color: "var(--mini-text)" }}
              >
                {u.email}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Theme toggle — сегментный переключатель «тёмная/светлая». */}
      <section className="mini-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div
              className="text-[14px] font-semibold"
              style={{ color: "var(--mini-text)" }}
            >
              Тема оформления
            </div>
            <div
              className="mt-0.5 text-[12px]"
              style={{ color: "var(--mini-text-muted)" }}
            >
              Настройка сохранится на этом устройстве
            </div>
          </div>
        </div>
        <div
          role="radiogroup"
          aria-label="Тема Mini App"
          className="mini-press flex gap-1 rounded-2xl p-1"
          style={{
            background: "var(--mini-surface-2)",
            border: "1px solid var(--mini-divider)",
          }}
        >
          <button
            type="button"
            role="radio"
            aria-checked={theme === "dark"}
            onClick={() => setTheme("dark")}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors"
            style={{
              background:
                theme === "dark" ? "var(--mini-text)" : "transparent",
              color:
                theme === "dark"
                  ? "var(--mini-bg)"
                  : "var(--mini-text-muted)",
            }}
          >
            <Moon className="size-4" />
            Тёмная
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={theme === "light"}
            onClick={() => setTheme("light")}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors"
            style={{
              background:
                theme === "light" ? "var(--mini-text)" : "transparent",
              color:
                theme === "light"
                  ? "var(--mini-bg)"
                  : "var(--mini-text-muted)",
            }}
          >
            <Sun className="size-4" />
            Светлая
          </button>
        </div>
      </section>

      {/* Баланс и бонусы — тот же пункт, что в меню профиля на сайте. */}
      <section>
        <Link
          href="/settings/balance"
          className="mini-press flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium"
          style={{
            background: "var(--mini-card-solid-bg)",
            color: "var(--mini-text)",
            border: "1px solid var(--mini-divider)",
          }}
        >
          <span className="inline-flex items-center gap-2">
            <Coins className="size-4" style={{ color: "var(--mini-text-muted)" }} />
            Баланс и бонусы
          </span>
          <span className="text-[11px]" style={{ color: "var(--mini-text-faint)" }}>
            отзыв и приглашения
          </span>
        </Link>
      </section>

      {/* Дальше — ровно те же пункты, что в меню профиля на сайте
          (`components/layout/profile-sheet.tsx`). Открываются здесь же,
          в оболочке приложения, с рабочей кнопкой «назад» (П-3). */}
      {fullAccess ? (
        <section>
          <Link
            href="/settings/subscription"
            className="mini-press flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium"
            style={{
              background: "var(--mini-card-solid-bg)",
              color: "var(--mini-text)",
              border: "1px solid var(--mini-divider)",
            }}
          >
            <span className="inline-flex items-center gap-2">
              <CreditCard className="size-4" style={{ color: "var(--mini-text-muted)" }} />
              Тарифы и оплата
            </span>
            <span className="text-[11px]" style={{ color: "var(--mini-text-faint)" }}>
              счета и автопродление
            </span>
          </Link>
          <Link
            href="/settings/appearance"
            className="mini-press mt-2 flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium"
            style={{
              background: "var(--mini-card-solid-bg)",
              color: "var(--mini-text)",
              border: "1px solid var(--mini-divider)",
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Palette className="size-4" style={{ color: "var(--mini-text-muted)" }} />
              Внешний вид
            </span>
            <span className="text-[11px]" style={{ color: "var(--mini-text-faint)" }}>
              логотип и цвета
            </span>
          </Link>
          <Link
            href="/settings"
            className="mini-press mt-2 flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium"
            style={{
              background: "var(--mini-card-solid-bg)",
              color: "var(--mini-text)",
              border: "1px solid var(--mini-divider)",
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Settings className="size-4" style={{ color: "var(--mini-text-muted)" }} />
              Настройки
            </span>
            <span className="text-[11px]" style={{ color: "var(--mini-text-faint)" }}>
              организация и журналы
            </span>
          </Link>
        </section>
      ) : null}

      {u.isRoot ? (
        <section>
          <Link
            href="/root"
            className="mini-press flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium"
            style={{
              background: "var(--mini-card-solid-bg)",
              color: "var(--mini-text)",
              border: "1px solid var(--mini-divider)",
            }}
          >
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4" style={{ color: "var(--mini-text-muted)" }} />
              Панель платформы
            </span>
          </Link>
        </section>
      ) : null}

      {/* Все разделы кабинета — теми же правами, что на сайте. Вкладка
          есть и в нижнем меню; здесь — на случай, если человек ищет
          «где остальное» именно в профиле. */}
      <section>
        <Link
          href="/mini/sections"
          className="mini-press flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium"
          style={{
            background: "var(--mini-card-solid-bg)",
            color: "var(--mini-text)",
            border: "1px solid var(--mini-divider)",
          }}
        >
          <span className="inline-flex items-center gap-2">
            <LayoutGrid className="size-4" style={{ color: "var(--mini-text-muted)" }} />
            Все разделы
          </span>
          <span className="text-[11px]" style={{ color: "var(--mini-text-faint)" }}>
            журналы, отчёты, настройки
          </span>
        </Link>
      </section>

      {/* Обратная связь — паритет с сайтом (П-3): на сайте форма живёт
          в шапке, в Mini App шапки нет, поэтому она стоит карточкой в
          профиле. Форма и эндпоинт те же, что на сайте. */}
      <section>
        <FeedbackDialog
          telegramBotUsername={telegramBotUsername}
          trigger={
            <button
              type="button"
              className="mini-press flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium"
              style={{
                background: "var(--mini-card-solid-bg)",
                color: "var(--mini-text)",
                border: "1px solid var(--mini-divider)",
              }}
            >
              <span className="inline-flex items-center gap-2">
                <MessageCircleMore
                  className="size-4"
                  style={{ color: "var(--mini-text-muted)" }}
                />
                Обратная связь
              </span>
              <span
                className="text-[11px]"
                style={{ color: "var(--mini-text-faint)" }}
              >
                ошибка или идея
              </span>
            </button>
          }
        />
      </section>

      {error ? (
        <div
          className="rounded-2xl p-3 text-[13px]"
          style={{
            background: "var(--mini-crimson-soft)",
            color: "var(--mini-crimson)",
            border: "1px solid var(--mini-divider)",
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Полная версия сайта. Снимает режим оболочки и уводит в
          обычный кабинет — нужно тем, кто открыл приложение на
          планшете или ноутбуке и хочет широкие таблицы и шапку. */}
      <section>
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
          className="mini-press flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium"
          style={{
            background: "var(--mini-card-solid-bg)",
            color: "var(--mini-text)",
            border: "1px solid var(--mini-divider)",
          }}
        >
          <span className="inline-flex items-center gap-2">
            <MonitorSmartphone
              className="size-4"
              style={{ color: "var(--mini-text-muted)" }}
            />
            Открыть полную версию сайта
          </span>
          <span className="text-[11px]" style={{ color: "var(--mini-text-faint)" }}>
            шапка и широкие таблицы
          </span>
        </button>
      </section>

      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setConfirmSignOutOpen(true)}
          disabled={busy !== "none"}
          className="mini-press flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium disabled:opacity-50"
          style={{
            background: "var(--mini-card-solid-bg)",
            color: "var(--mini-text)",
            border: "1px solid var(--mini-divider)",
          }}
        >
          <span className="inline-flex items-center gap-2">
            <LogOut
              className="size-4"
              style={{ color: "var(--mini-text-muted)" }}
            />
            Выйти
          </span>
          <span
            className="text-[11px]"
            style={{ color: "var(--mini-text-faint)" }}
          >
            сессия сбросится
          </span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmUnlinkOpen(true)}
          disabled={busy !== "none"}
          className="mini-press flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[14px] font-medium disabled:opacity-50"
          style={{
            background: "var(--mini-crimson-soft)",
            color: "var(--mini-crimson)",
            border: "1px solid var(--mini-divider)",
          }}
        >
          <span className="inline-flex items-center gap-2">
            <Unlink className="size-4" />
            Отвязать Telegram
          </span>
          <span className="text-[11px] opacity-70">
            {busy === "unlink" ? "…" : "нужен новый инвайт"}
          </span>
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
        description="Приложение забудет вас на этом телефоне. Чтобы вернуться, откройте приложение заново через бота в Telegram — вход произойдёт сам, пароль вводить не нужно."
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
