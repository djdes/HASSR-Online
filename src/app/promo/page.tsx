import { ArrowRight, TicketX } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { promoLinkStatus, type PromoLinkStatus } from "@/lib/promo/personal-codes";
import { normalizePromoCode } from "@/lib/promo/rules";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Промокод больше не действует",
  robots: { index: false, follow: false },
};

type Rejected = Extract<PromoLinkStatus, { ok: false }>;

const TITLES: Record<Rejected["reason"], string> = {
  "not-found": "Такого промокода нет",
  "not-started": "Промокод ещё не начал действовать",
  inactive: "Промокод больше не действует",
  expired: "Промокод больше не действует",
  exhausted: "Промокод больше не действует",
};

/**
 * Сюда ведёт /promo/<CODE>, если код не действует или неизвестен. Причину
 * читаем сами по коду (адресу не доверяем). Код вдруг действует — обратно
 * на /promo/<CODE>, он всё подставит.
 */
export default async function PromoInvalidPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = raw ? normalizePromoCode(raw).slice(0, 64) : "";
  const status: PromoLinkStatus = code
    ? await promoLinkStatus(code)
    : { ok: false, reason: "not-found", lifetime: false };
  if (status.ok) redirect(`/promo/${encodeURIComponent(code)}`);
  console.info(`[promo] invalid link page code=${code || "-"} reason=${status.reason}`);

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />
      <main className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6 md:py-14">
        <section
          data-testid="promo-invalid"
          className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-8"
        >
          <span className="flex size-12 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#a13a32]">
            <TicketX className="size-6" />
          </span>
          <h1 className="mt-4 text-[26px] font-semibold tracking-[-0.02em] sm:text-[32px]">
            {TITLES[status.reason]}
          </h1>
          <p className="mt-3 text-[15px] leading-[1.7] text-[#3c4053]">
            {code ? (
              <>
                Промокод <span className="font-mono font-semibold">{code}</span> сейчас не даёт скидку.{" "}
              </>
            ) : null}
            Подписку можно оформить и без него — цены и тарифы на странице тарифов. Если код прислали
            вам в письме или предложении, напишите нам: проверим и подскажем.
          </p>
          {status.reason === "exhausted" && status.lifetime ? (
            <p className="mt-3 rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[14px] leading-[1.6] text-[#3848c7]">
              Если вы уже оплатили подписку с этим кодом, скидка навсегда за вами сохранилась — она
              применяется к оплатам сама. Проверить можно в кабинете: «Настройки» → «Тариф».
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/pricing"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
            >
              Посмотреть тарифы
              <ArrowRight className="size-4" />
            </Link>
            <a
              href="mailto:support@wesetup.ru"
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-6 text-[15px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Написать в поддержку
            </a>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
