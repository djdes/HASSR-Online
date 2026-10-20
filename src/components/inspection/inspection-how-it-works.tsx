/**
 * Нумерованные шаги 1-2-3 страницы раздела «Пришла проверка» (эскизы
 * руководителя): как запись попадает в журнал, как заказать услугу, когда
 * включать спецрежим. Тексты уже переведены страницей.
 */
export function InspectionHowItWorks({ id, title, steps }: { id: string; title: string; steps: string[] }) {
  return (
    <section
      className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      data-inspection-how={id}
    >
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{title}</h2>
      <ol className="mt-3 grid gap-3 md:grid-cols-3">
        {steps.map((text, index) => (
          <li key={index} className="flex gap-3 rounded-2xl bg-[#fafbff] p-3.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-[13px] font-semibold tabular-nums text-white">
              {index + 1}
            </span>
            <p className="min-w-0 text-[13.5px] leading-[1.55] text-[#3c4053] [overflow-wrap:anywhere]">{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
