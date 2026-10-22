import type { ReactNode } from "react";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";

/**
 * Обёртка правовых страниц (`/oferta`, `/privacy`).
 *
 * Повторяет типографику статьи блога (`/blog/[slug]`), но без тегов,
 * времени чтения и CTA-блока — юридический документ должен читаться
 * ровно и не отвлекать. Шапка/футер те же, что на остальных публичных
 * страницах, чтобы из документа можно было вернуться в сайт.
 *
 * Прозы-стили заданы один раз здесь через `[&_h2]`-селекторы: страницы
 * пишут чистый JSX (h2/p/ul), не повторяя классы в каждом абзаце.
 */
export function LegalArticle({
  title,
  revision,
  intro,
  children,
}: {
  title: string;
  /** Строка «Редакция от …» под заголовком. */
  revision: string;
  /** Необязательный лид-абзац крупнее основного текста. */
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />

      <article className="mx-auto max-w-[760px] px-4 py-10 sm:px-6 md:py-14">
        <h1 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.02em]">
          {title}
        </h1>
        <div className="mt-3 text-[13px] text-[#6f7282]">{revision}</div>

        {intro ? (
          <p className="mt-5 text-[17px] leading-[1.6] text-[#3c4053]">
            {intro}
          </p>
        ) : null}

        <div
          className={
            "mt-8 border-t border-[#ececf4] pt-8 " +
            // Заголовки разделов
            "[&_h2]:mt-9 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:text-[#0b1024] " +
            "[&_h2:first-child]:mt-0 " +
            "[&_h3]:mt-6 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[#0b1024] " +
            // Абзацы и списки
            "[&_p]:mt-3 [&_p]:text-[15px] [&_p]:leading-[1.7] [&_p]:text-[#3c4053] " +
            "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 " +
            "[&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 " +
            "[&_li]:text-[15px] [&_li]:leading-[1.7] [&_li]:text-[#3c4053] " +
            "[&_li::marker]:text-[#9b9fb3] " +
            // Ссылки внутри текста
            "[&_a]:text-[#3848c7] [&_a]:underline [&_a]:decoration-[#3848c7]/30 [&_a]:underline-offset-2 " +
            "[&_a]:transition-colors hover:[&_a]:decoration-[#3848c7] " +
            "[&_strong]:font-semibold [&_strong]:text-[#0b1024]"
          }
        >
          {children}
        </div>
      </article>

      <PublicFooter />
    </div>
  );
}

/**
 * Карточка реквизитов оператора — общая для оферты и политики,
 * чтобы данные ООО «БФС» жили в одном месте.
 */
export function LegalRequisites({ copy }: { copy?: {
  heading: string;
  taxIds: string;
  registrationId: string;
  address: string;
  telephone: ReactNode;
  email: ReactNode;
  website: ReactNode;
} } = {}) {
  return (
    <div className="mt-8 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5 text-[14px] leading-[1.7] text-[#3c4053] md:p-6">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">{copy?.heading ?? "Реквизиты"}</div>
      <div className="text-[15px] font-semibold text-[#0b1024]">
        Общество с ограниченной ответственностью «БФС»
      </div>
      <div className="mt-2">{copy?.taxIds ?? "ИНН 5018215599 · КПП 501801001"}</div>
      <div>{copy?.registrationId ?? "ОГРН 1235000105306"}</div>
      <div>{copy?.address ?? "Адрес: 141065, Московская область, г. Королёв, ул. Ленина, д. 10/6"}</div>
      <div className="mt-2">{copy ? copy.telephone : <>
        Телефон:{" "}
        <a
          href="tel:+79996341612"
          className="text-[#3848c7] transition-colors hover:text-[#0b1024]"
        >
          +7 (999) 634-16-12
        </a>
      </>}</div>
      <div>{copy ? copy.email : <>
        Электронная почта:{" "}
        <a
          href="mailto:support@wesetup.ru"
          className="break-all text-[#3848c7] transition-colors hover:text-[#0b1024]"
        >
          support@wesetup.ru
        </a>
      </>}</div>
      <div>{copy ? copy.website : <>
        Сайт:{" "}
        <a
          href="https://wesetup.ru"
          className="text-[#3848c7] transition-colors hover:text-[#0b1024]"
        >
          wesetup.ru
        </a>
      </>}</div>
    </div>
  );
}
