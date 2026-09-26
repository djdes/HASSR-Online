import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ArrowLeft, LogIn, Mail, ShieldCheck, Trash2, UserX } from "lucide-react";

import "@/app/mini/mini-theme.css";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";

import { DeleteAccountButton, DeleteAccountThemeRoot } from "./delete-account-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Удаление аккаунта",
  description:
    "Как удалить аккаунт WeSetup: в профиле приложения, на этой странице или письмом в поддержку. Что удаляется и что остаётся у компании.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1024",
};

const SUPPORT_EMAIL = "support@wesetup.ru";

/**
 * Публичная страница удаления аккаунта.
 *
 * Google Play требует адрес в интернете, по которому человек может
 * удалить аккаунт, не устанавливая приложение; App Store — удаление
 * внутри приложения (оно в профиле, `mini/me`). Сценарий один и тот же:
 * `DeleteAccountFlow`. Без входа — объяснение и кнопка «Войти», которая
 * вернёт сюда же.
 *
 * Оформление — палитра мини-приложения (`mini-theme.css`): страница
 * открывается и в приложении по универсальной ссылке.
 */
export default async function DeleteAccountPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id ?? null;
  const profile = userId
    ? await db.user
        .findUnique({
          where: { id: userId },
          select: { name: true, themePreference: true },
        })
        .catch(() => null)
    : null;
  const theme = profile ? (profile.themePreference === "dark" ? "dark" : "light") : null;

  return (
    <DeleteAccountThemeRoot theme={theme}>
      {/* В приложении страница под вырезом экрана (viewport-fit=cover):
          отступ сверху — на высоту строки состояния. На сайте он 0. */}
      <main
        className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4"
        style={{
          paddingTop: "calc(16px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))",
          paddingBottom: "calc(48px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))",
        }}
      >
        <Link href={userId ? "/mini/me" : "/"} className="mini-btn-ghost mini-press -ml-3.5 w-fit">
          <ArrowLeft className="size-5" />
          {userId ? "В профиль" : "На сайт"}
        </Link>

        <section className="relative overflow-hidden rounded-3xl bg-[#0b1024] text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)]">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute -left-20 -top-24 size-[260px] rounded-full bg-[#5566f6] opacity-40 blur-[90px]" />
            <div className="absolute -bottom-28 -right-20 size-[260px] rounded-full bg-[#7a5cff] opacity-30 blur-[100px]" />
          </div>
          <div className="relative z-10 p-6">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/60">WeSetup</div>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em]">Удаление аккаунта</h1>
            <p className="mt-2 text-[15px] leading-[1.55] text-white/75">
              Здесь можно удалить свой аккаунт в WeSetup — на сайте и в приложении это один и тот же аккаунт.
            </p>
          </div>
        </section>

        <section className="mini-card p-5">
          <h2 className="text-[17px] font-semibold" style={{ color: "var(--mini-text)" }}>
            Что произойдёт
          </h2>
          <ul className="mt-3 space-y-3 text-[15px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
            <li className="flex gap-3">
              <UserX className="mt-0.5 size-5 shrink-0" style={{ color: "var(--mini-danger)" }} aria-hidden />
              <span>Вы больше не сможете войти — ни на сайте, ни в приложении, ни через Telegram.</span>
            </li>
            <li className="flex gap-3">
              <Trash2 className="mt-0.5 size-5 shrink-0" style={{ color: "var(--mini-danger)" }} aria-hidden />
              <span>Удалятся телефон, почта, привязка Telegram, PIN-код и ключи входа.</span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0" style={{ color: "var(--mini-accent-ink)" }} aria-hidden />
              <span>
                Записи журналов, которые вы заполняли, останутся у компании вместе с вашим именем — это требование СанПиН и ХАССП.
              </span>
            </li>
          </ul>
          <p className="mt-4 text-[14px] leading-[1.5]" style={{ color: "var(--mini-text-muted)" }}>
            Если вы владелец компании, аккаунт удаляется вместе с компанией: удаление компании наступает через
            30 дней, до этого его можно отменить.
          </p>
        </section>

        <section className="mini-card flex flex-col gap-3 p-5" data-testid="delete-account-action">
          {userId ? (
            <>
              <p className="text-[15px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
                Вы вошли как{" "}
                <b style={{ color: "var(--mini-text)" }}>{profile?.name ?? session?.user?.name ?? "—"}</b>.
                Нажмите кнопку и введите слово УДАЛИТЬ для подтверждения.
              </p>
              <DeleteAccountButton />
            </>
          ) : (
            <>
              <h2 className="text-[17px] font-semibold" style={{ color: "var(--mini-text)" }}>
                Войдите, чтобы удалить аккаунт
              </h2>
              <p className="text-[15px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
                Так мы убедимся, что удаляете именно вы. После входа вы вернётесь на эту страницу.
              </p>
              <Link
                href="/mini/login?next=%2Fdelete-account"
                className="mini-btn-primary mini-press w-full"
                data-testid="delete-account-login"
              >
                <LogIn className="size-5" />
                Войти
              </Link>
            </>
          )}
        </section>

        <section className="mini-card flex gap-3 p-5">
          <Mail className="mt-0.5 size-5 shrink-0" style={{ color: "var(--mini-accent-ink)" }} aria-hidden />
          <p className="text-[15px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
            Или напишите на{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Удалить аккаунт")}`}
              className="font-semibold underline underline-offset-2"
              style={{ color: "var(--mini-accent-ink)" }}
            >
              {SUPPORT_EMAIL}
            </a>{" "}
            — укажите телефон или почту, с которыми входите, и мы удалим аккаунт вручную.
          </p>
        </section>
      </main>
    </DeleteAccountThemeRoot>
  );
}
