import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowDown, ArrowRight, Lightbulb } from "lucide-react";

/**
 * Шаг инструкции → куда ведёт: `#…` — блок ниже на этой же странице с тем же
 * номером, `/…` — свой пункт меню раздела (у шага 1 ссылки нет).
 */
const STEPS = [
  { n: 1, href: null },
  { n: 2, href: "#qr" },
  { n: 3, href: "/inspection/visits" },
  { n: 4, href: "#archive" },
  { n: 5, href: "/inspection/special-mode" },
] as const;
const TIPS = [1, 2, 3, 4] as const;

const STEP_LINK =
  "group flex w-full gap-3 rounded-2xl bg-[#fafbff] p-3.5 transition-[background-color,box-shadow] duration-200 hover:bg-[#f5f6ff] hover:shadow-[0_0_0_1px_rgba(85,102,246,0.25)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 lg:flex-col lg:gap-2";

/**
 * «Что делать сейчас» (скан 83: «Инструкции (советы)»): пять шагов на
 * момент прихода проверяющего и короткие советы. Шаги QR и архива ведут к
 * блокам ниже на этой странице, журнал посещений и спецрежим — на свои
 * страницы раздела («Открыть →»).
 */
export async function InspectionGuide() {
  const t = await getTranslations("inspectionDay.guide");
  return (
    <section
      id="what-to-do"
      className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      data-inspection-guide
    >
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
      <p className="mt-1 text-[14px] text-[#6f7282]">{t("lead")}</p>

      <ol className="mt-4 grid gap-3 lg:grid-cols-5">
        {STEPS.map(({ n, href }) => {
          const page = href?.startsWith("/") ?? false;
          const body = (
            <>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[13px] font-semibold tabular-nums text-[#3848c7] transition-colors duration-150 group-hover:bg-[#5566f6] group-hover:text-white">
                {n}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1 text-[14.5px] font-semibold leading-snug text-[#0b1024]">
                  {t(`step${n}Title`)}
                  {href && !page ? <ArrowDown className="size-3.5 shrink-0 text-[#9b9fb3] transition-colors duration-150 group-hover:text-[#5566f6]" aria-hidden /> : null}
                </div>
                <p className="mt-1 text-[13.5px] leading-[1.55] text-[#3c4053] [overflow-wrap:anywhere]">{t(`step${n}Body`)}</p>
                {page ? (
                  <span className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 group-hover:text-[#5566f6] lg:mt-auto lg:pt-2">
                    {t("open")}
                    <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                  </span>
                ) : null}
              </div>
            </>
          );
          return (
            <li key={n} className="flex">
              {href && page ? (
                <Link href={href} className={STEP_LINK} data-guide-step={n} data-guide-page={href}>
                  {body}
                </Link>
              ) : href ? (
                <a href={href} className={STEP_LINK} data-guide-step={n}>
                  {body}
                </a>
              ) : (
                <div className="flex w-full gap-3 rounded-2xl bg-[#fafbff] p-3.5 lg:flex-col lg:gap-2" data-guide-step={n}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 rounded-2xl border border-[#ececf4] p-4">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          <Lightbulb className="size-4 text-[#5566f6]" aria-hidden />
          {t("tipsTitle")}
        </div>
        <ul className="mt-2 grid gap-x-6 gap-y-2 md:grid-cols-2">
          {TIPS.map((n) => (
            <li key={n} className="relative pl-4 text-[13.5px] leading-[1.55] text-[#3c4053] before:absolute before:left-0 before:top-[0.6em] before:size-1.5 before:rounded-full before:bg-[#5566f6]/60">
              {t(`tip${n}`)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
