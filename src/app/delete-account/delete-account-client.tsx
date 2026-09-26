"use client";

import { useEffect, useState, type ReactNode } from "react";
import { signOut } from "next-auth/react";
import { Trash2 } from "lucide-react";

import { signOutOnThisDevice } from "@/app/mini/_lib/signed-out-mark";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Удаление аккаунта — одна логика для профиля мини-приложения
 * (`mini/me/me-client.tsx`) и публичной страницы `/delete-account`
 * (её требует Google Play). Кнопку рисует вызывающий (`renderTrigger`),
 * здесь — оба диалога, запрос и то, что происходит после ответа:
 *   • 200 — выход на этом устройстве и экран входа;
 *   • 409 — владелец компании: диалог «Сначала удалите компанию» с
 *     переходом к удалению компании;
 *   • иначе — текст ошибки под кнопкой.
 */
export function DeleteAccountFlow({
  renderTrigger,
}: {
  renderTrigger: (open: () => void, busy: boolean) => ReactNode;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ownerRedirect, setOwnerRedirect] = useState<{ href: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setBusy(true);
    type Reply = { ok?: boolean; error?: string; redirect?: string } | null;
    let data: Reply;
    let status: number;
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "УДАЛИТЬ" }),
      });
      status = response.status;
      data = (await response.json().catch(() => null)) as Reply;
    } catch {
      setBusy(false);
      setConfirmOpen(false);
      setError("Не удалось удалить аккаунт. Проверьте интернет и попробуйте ещё раз.");
      return;
    }
    setConfirmOpen(false);

    if (status === 200 && data?.ok) {
      // Сессии на сервере уже отозваны — снимаем куки и здесь, чтобы
      // экран входа открылся сразу, а не после ошибки на следующем клике.
      await signOutOnThisDevice({
        fetch: (input, init) => fetch(input, init),
        signOut: () => signOut({ redirect: false }),
      }).catch(() => undefined);
      window.location.replace("/mini/login?deleted=1");
      return;
    }
    setBusy(false);
    if (status === 409 && data?.redirect) {
      setOwnerRedirect({
        href: data.redirect,
        text: data.error ?? "Вы владелец компании: удалите компанию — аккаунт удалится вместе с ней",
      });
      return;
    }
    setError(data?.error ?? "Не удалось удалить аккаунт. Попробуйте ещё раз.");
  }

  return (
    <>
      {renderTrigger(() => {
        setError(null);
        setConfirmOpen(true);
      }, busy)}
      {error ? (
        <div className="mini-err" role="alert" data-testid="delete-account-error">
          {error}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Удалить аккаунт навсегда?"
        description="Вернуть аккаунт будет нельзя. Чтобы снова работать в WeSetup, руководитель должен будет пригласить вас заново."
        bullets={[
          { label: "Вы не сможете войти в WeSetup", tone: "warn" },
          { label: "Телефон, почта, Telegram и вход будут удалены", tone: "warn" },
          {
            label:
              "Записи журналов, которые вы заполняли, останутся у компании вместе с вашим именем — это требование СанПиН и ХАССП",
            tone: "info",
          },
        ]}
        confirmLabel="Удалить аккаунт"
        cancelLabel="Отмена"
        variant="danger"
        typeToConfirm="УДАЛИТЬ"
      />

      <ConfirmDialog
        open={ownerRedirect !== null}
        onClose={() => setOwnerRedirect(null)}
        onConfirm={() => {
          if (ownerRedirect) window.location.assign(ownerRedirect.href);
        }}
        title="Сначала удалите компанию"
        description={ownerRedirect?.text}
        bullets={[
          { label: "Компания удаляется через 30 дней — до этого удаление можно отменить", tone: "info" },
          { label: "Вместе с компанией удалятся журналы, сотрудники и ваш аккаунт", tone: "warn" },
          { label: "Перед удалением скачайте архив журналов в «Настройки → Бэкап»", tone: "default" },
        ]}
        confirmLabel="Перейти к удалению компании"
        cancelLabel="Не сейчас"
        variant="warn"
      />
    </>
  );
}

/** Большая красная кнопка страницы `/delete-account`. */
export function DeleteAccountButton() {
  return (
    <DeleteAccountFlow
      renderTrigger={(open, busy) => (
        <button
          type="button"
          onClick={open}
          disabled={busy}
          className="mini-btn-danger mini-press w-full disabled:opacity-50"
          data-testid="delete-account-button"
        >
          <Trash2 className="size-5" />
          {busy ? "Удаляем…" : "Удалить аккаунт"}
        </button>
      )}
    />
  );
}

/**
 * Корень страницы `/delete-account` в палитре мини-приложения. Тема —
 * из профиля, если человек вошёл; иначе — тема телефона.
 */
export function DeleteAccountThemeRoot({
  theme,
  children,
}: {
  theme: "light" | "dark" | null;
  children: ReactNode;
}) {
  const [resolved, setResolved] = useState<"light" | "dark">(theme ?? "light");
  useEffect(() => {
    if (theme) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const apply = () => setResolved(media.matches ? "dark" : "light");
    apply();
    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, [theme]);

  return (
    <div className="mini-root min-h-dvh" data-theme={resolved}>
      {children}
    </div>
  );
}
