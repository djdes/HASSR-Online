import type { Metadata } from "next";

import { MiniLoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Вход — WeSetup",
  robots: { index: false, follow: false },
};

/**
 * Вход в рабочий кабинет по телефону и паролю.
 *
 * Серверный компонент с клиентской формой внутри: экран обязан
 * рисоваться до гидратации. Сотрудник открывает приложение в подвале
 * кухни на плохом интернете, и «белый экран, пока грузится JS» здесь
 * означает «приложение не работает».
 */
export default async function MiniLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; phone?: string }>;
}) {
  const { next, phone } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-[420px] flex-col justify-center">
      <div className="mini-card p-5">
        <h1 className="mini-h1">Вход в кабинет</h1>
        <p
          className="mt-2 text-[16px] leading-[1.5]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Телефон и пароль выдаёт руководитель. Если у вас есть Telegram —
          можно войти и через него, по персональной ссылке-приглашению.
        </p>

        {/* `?phone=` подставляет номер: после регистрации по QR-коду
            сотрудник приходит сюда прямо с экрана «Готово», и заново
            набирать номер ему незачем. */}
        <MiniLoginForm next={next} initialPhone={phone} />
      </div>
    </div>
  );
}
