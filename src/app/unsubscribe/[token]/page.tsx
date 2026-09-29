import Link from "next/link";
import { MailX } from "lucide-react";

import { findUnsubscribeTarget } from "@/lib/mailing/public.server";

import { UnsubscribeButton } from "./unsubscribe-button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Отписка от новостей и предложений",
  robots: { index: false, follow: false },
};

/**
 * `/unsubscribe/<token>` — страница из ссылки «Отписаться» в рекламном
 * письме. Одна кнопка: переход по ссылке сам ничего не меняет (почтовые
 * сканеры открывают ссылки), отписывает нажатие. Служебные письма не
 * затрагиваются — об этом сказано прямо.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  let token = raw;
  try {
    token = decodeURIComponent(raw);
  } catch {
    // как есть
  }
  const target = await findUnsubscribeTarget(token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
      <section className="w-full max-w-[460px] rounded-3xl border border-[#ececf4] bg-white p-7 shadow-[0_20px_60px_-30px_rgba(11,16,36,0.25)] sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <MailX className="size-6" />
        </div>
        {target ? (
          <>
            <h1 className="mt-5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
              Отписаться от новостей и предложений WeSetup
            </h1>
            <p className="mt-3 text-[15px] leading-[1.6] text-[#3c4053]">
              {target.maskedEmail ? (
                <>
                  Новости и предложения WeSetup больше не придут на{" "}
                  <span className="font-medium text-[#0b1024]">{target.maskedEmail}</span>, а если у вас есть аккаунт —
                  и в колокольчик, push и Telegram.
                </>
              ) : (
                "Новости и предложения WeSetup больше не придут ни письмом, ни в колокольчик, push или Telegram."
              )}{" "}
              Служебные письма — коды входа, счета, уведомления о журналах — продолжат приходить.
            </p>
            <UnsubscribeButton token={token} already={target.alreadyUnsubscribed} />
          </>
        ) : (
          <>
            <h1 className="mt-5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
              Ссылка недействительна
            </h1>
            <p className="mt-3 text-[15px] leading-[1.6] text-[#3c4053]">
              Возможно, её скопировали не целиком. Откройте ссылку «Отписаться» из письма ещё раз или напишите
              на <a className="font-medium text-[#3848c7] underline" href="mailto:support@wesetup.ru">support@wesetup.ru</a> —
              отпишем вручную.
            </p>
          </>
        )}
        <p className="mt-6 border-t border-[#ececf4] pt-4 text-[13px] leading-[1.6] text-[#6f7282]">
          Если у вас есть аккаунт, вернуть новости можно в настройках уведомлений.{" "}
          <Link href="/" className="font-medium text-[#3848c7] hover:text-[#5566f6]">
            wesetup.ru
          </Link>
        </p>
      </section>
    </main>
  );
}
