import { Download, ArrowRight, Check } from "lucide-react";

import { BrandLogo } from "@/components/brand/logo";
import { brandQrSvg } from "@/lib/brand-qr";
import { buildProposalContent, type ProposalContent, type ProposalJournalItem } from "@/lib/proposal/content";
import { loadProposalContext } from "@/lib/proposal/context.server";
import { verifyProposalToken } from "@/lib/proposal/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Персональное предложение по подписанной ссылке — в индекс не попадает.
export const metadata = {
  title: "Коммерческое предложение",
  robots: { index: false, follow: false },
};

/**
 * Веб-версия КП: `/kp/<подписанный токен>` — то же содержание, что в PDF и
 * письме (`buildProposalContent`), цены — на момент открытия. Токен
 * проверяется здесь и в `/kp/<токен>/pdf`; подделанный или битый — экран
 * «Ссылка недействительна» и строка в логе.
 */
export default async function ProposalWebPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = verifyProposalToken(token);
  if (!check.ok) {
    console.warn(`[kp] web view rejected reason=${check.reason}`);
    return <InvalidLink />;
  }
  const content = buildProposalContent(check.vars, await loadProposalContext());
  const qrSvg = await brandQrSvg(content.offer.ctaUrl);
  console.info(
    `[kp] web view sphere=${content.sphere} promo=${content.offer.promoCode ?? "-"} cta=${content.offer.ctaKind} expired=${content.price.promoExpired ? "yes" : "no"}`,
  );
  const pdfHref = `/kp/${encodeURIComponent(decodeToken(token))}/pdf?download=1`;
  return <ProposalView content={content} qrSvg={qrSvg} pdfHref={pdfHref} />;
}

function decodeToken(token: string): string {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function InvalidLink() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f5fb] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(11,16,36,0.2)]">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#fff4f2] text-2xl text-[#a13a32]">!</div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">Ссылка недействительна</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
          Ссылка на предложение повреждена или скопирована не полностью. Попросите отправителя прислать её ещё раз
          или откройте{" "}
          <a href="https://wesetup.ru" className="text-[#3848c7] underline underline-offset-2">
            wesetup.ru
          </a>
          .
        </p>
      </div>
    </main>
  );
}

function JournalList({ items, filled }: { items: ProposalJournalItem[]; filled: boolean }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.code} className="flex gap-2.5 text-[14px] leading-[1.5] text-[#0b1024]">
          <span
            aria-hidden
            className={`mt-[7px] size-2 shrink-0 rounded-full ${filled ? "bg-[#5566f6]" : "border border-[#5566f6]"}`}
          />
          <span>
            {item.name}
            {item.note ? <span className="text-[#6f7282]"> — {item.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

const SECTION_LABEL = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";

function ProposalView({ content, qrSvg, pdfHref }: { content: ProposalContent; qrSvg: string; pdfHref: string }) {
  const [free, team] = content.offer.rows;
  return (
    <main className="min-h-screen bg-[#f4f5fb] text-[#0b1024]">
      <div className="mx-auto max-w-[960px] px-4 pb-12 pt-5 sm:px-6 sm:pt-8">
        <header className="flex items-center justify-between gap-3">
          <a href="https://wesetup.ru" aria-label="WeSetup — на сайт" className="text-[#0b1024]">
            <BrandLogo height={22} />
          </a>
          <a
            href={pdfHref}
            data-testid="kp-download-pdf"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <Download className="size-4 text-[#5566f6]" />
            Скачать PDF
          </a>
        </header>

        <article className="mt-5 overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.25)]">
          <section className="relative overflow-hidden bg-[#0b1024] px-5 py-8 text-white sm:px-10 sm:py-10">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -left-24 -top-24 size-[380px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
              <div className="absolute -bottom-40 -right-32 size-[420px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
            </div>
            <div className="relative">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] uppercase tracking-[0.16em] text-white/60">
                <span>{content.eyebrow}</span>
                <span className="normal-case tracking-normal">{content.dateLabel}</span>
              </div>
              {content.addressee ? (
                <p data-testid="kp-addressee" className="mt-5 text-[15px] font-semibold text-[#c5ccff]">
                  {content.addressee}
                </p>
              ) : null}
              <h1 className="mt-3 text-[28px] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-[40px]">
                {content.titleLead} <span className="text-[#aab4ff]">{content.titleFor}</span>
              </h1>
              <p className="mt-4 max-w-[720px] text-[15px] leading-[1.65] text-white/80 sm:text-[16px]">{content.lead}</p>
            </div>
          </section>

          <section className="px-5 py-8 sm:px-10">
            <h2 className={SECTION_LABEL}>Как это работает</h2>
            <ol className="mt-4 grid gap-3 md:grid-cols-3">
              {content.steps.map((step, index) => (
                <li key={step.title} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5">
                  <span className="flex size-8 items-center justify-center rounded-full bg-[#5566f6] text-[14px] font-semibold text-white">
                    {index + 1}
                  </span>
                  <p className="mt-3 text-[16px] font-semibold tracking-[-0.01em]">{step.title}</p>
                  <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">{step.text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-[14px] leading-[1.6] text-[#3c4053]">{content.stepsNote}</p>
          </section>

          <section className="grid gap-8 border-t border-[#ececf4] px-5 py-8 sm:px-10 md:grid-cols-2">
            <div>
              <h2 className={SECTION_LABEL}>{content.benefitsTitle}</h2>
              <ul className="mt-4 space-y-4">
                {content.benefits.map((item) => (
                  <li key={item.title} className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[#3848c7]">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold">{item.title}</p>
                      <p className="mt-0.5 text-[14px] leading-[1.55] text-[#3c4053]">{item.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className={SECTION_LABEL}>{content.journalsTitle}</h2>
              {content.journalsRequired.length > 0 ? (
                <>
                  <p className="mb-2 mt-4 text-[13px] font-semibold text-[#3848c7]">Обязательные</p>
                  <JournalList items={content.journalsRequired} filled />
                </>
              ) : null}
              {content.journalsRecommended.length > 0 ? (
                <>
                  <p className="mb-2 mt-4 text-[13px] font-semibold text-[#3848c7]">Рекомендуем</p>
                  <JournalList items={content.journalsRecommended} filled={false} />
                </>
              ) : null}
              <p className="mt-4 text-[13px] leading-[1.55] text-[#3c4053]">
                {content.journalsMore ? (
                  <span className="font-semibold text-[#0b1024]">
                    {content.journalsMore.charAt(0).toUpperCase() + content.journalsMore.slice(1)}.{" "}
                  </span>
                ) : null}
                {content.journalsTotal}
              </p>
            </div>
          </section>

          <section className="px-3 pb-3 sm:px-6 sm:pb-6">
            <div data-testid="kp-offer" className="rounded-3xl bg-[#eef1ff] p-5 sm:p-8">
              <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#3848c7]">{content.offer.title}</p>
              <div className="mt-5 grid gap-6 md:grid-cols-[1fr_auto]">
                <div className="space-y-5">
                  {[free, team].map((row) => (
                    <div key={row.key} className="grid gap-3 sm:grid-cols-[170px_1fr]">
                      <div>
                        {row.oldPrice ? (
                          <p data-testid="kp-old-price" className="text-[15px] text-[#6f7282] line-through">
                            {row.oldPrice}
                          </p>
                        ) : null}
                        <p className="text-[30px] font-bold leading-[1.1] tracking-[-0.02em]" data-testid={`kp-price-${row.key}`}>
                          {row.price}
                          <span className="text-[14px] font-medium text-[#3c4053]">{row.unit}</span>
                        </p>
                        {row.badge ? (
                          <span className="mt-2 inline-flex rounded-full bg-[#3848c7] px-3 py-1 text-[12px] font-semibold text-white">
                            {row.badge}
                          </span>
                        ) : null}
                      </div>
                      <div>
                        <p className="text-[16px] font-semibold">{row.title}</p>
                        <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">{row.text}</p>
                      </div>
                    </div>
                  ))}
                  {content.offer.notes.map((note) => (
                    <p key={note} className="text-[14px] font-semibold leading-[1.5] text-[#3848c7]">
                      {note}
                    </p>
                  ))}
                  <div className="border-t border-[#dcdfed] pt-5">
                    {/* На телефоне QR скрыт (сканировать свой же экран нечем) — подсказка про кнопку. */}
                    <p className="text-[15px] font-semibold leading-[1.5] md:hidden">{content.offer.howToEmail}</p>
                    <p className="hidden text-[15px] font-semibold leading-[1.5] md:block">{content.offer.howTo}</p>
                    <a
                      href={content.offer.ctaUrl}
                      data-testid="kp-cta"
                      className="mt-4 inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0]"
                    >
                      {content.offer.ctaLabel}
                      <ArrowRight className="size-4" />
                    </a>
                    <p className="mt-3 text-[13px] text-[#3c4053]">{content.offer.payment}</p>
                  </div>
                </div>
                <div className="hidden w-[200px] md:block">
                  <div
                    className="w-full [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
                    aria-label="QR-код предложения"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                  {content.offer.promoCode ? (
                    <p className="mt-3 rounded-xl border border-dashed border-[#3848c7] bg-white px-3 py-2 text-center text-[16px] font-bold tracking-[0.06em]">
                      {content.offer.promoCode}
                    </p>
                  ) : (
                    <p className="mt-2 break-all text-center text-[12px] text-[#3c4053]">{content.offer.qrCaption}</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <footer className="grid gap-4 border-t border-[#ececf4] px-5 py-6 text-[13px] sm:px-10 md:grid-cols-2">
            {content.sender ? (
              <div>
                <p className="font-semibold text-[#0b1024]">{content.sender.name}</p>
                <ul className="mt-1 space-y-0.5 text-[#3c4053]">
                  {content.sender.lines.map((line) => (
                    <li key={line.kind}>
                      {line.label}:{" "}
                      <a href={line.href} className="text-[#3848c7] underline-offset-2 hover:underline">
                        {line.value}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {content.requisites ? (
              <div className="text-[12px] leading-[1.6] text-[#6f7282] md:text-right">
                {content.requisites.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </footer>
        </article>
        <p className="mt-4 text-center text-[12px] text-[#9b9fb3]">Цены указаны на {content.dateLabel}.</p>
      </div>
    </main>
  );
}
