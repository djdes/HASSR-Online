import { Filter } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import {
  FUNNEL_STEPS,
  FUNNEL_STEP_HINTS,
  FUNNEL_STEP_LABELS,
  FUNNEL_WEEKS,
  stepShare,
  type FunnelRow,
} from "@/lib/signup-funnel";
import { loadSignupFunnel } from "@/lib/signup-funnel.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Воронка регистраций" };

/**
 * Воронка регистраций (2026-11-01): какие недели и каналы доводят до оплаты.
 * Без неё не видно, какие правки сайта и рассылок реально работают. Канал
 * берётся из источника визита, сохранённого при регистрации с формы
 * (`Organization.signupSourceJson`); у более ранних регистраций — «нет данных».
 */
export default async function RootFunnelPage() {
  await requireRoot();
  const funnel = await loadSignupFunnel(new Date(), FUNNEL_WEEKS);
  const total = funnel.total.counts;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Filter className="size-5" />
        </span>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Воронка регистраций</h1>
          <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
            Организации, созданные за {FUNNEL_WEEKS} недель, по неделе регистрации и по каналу: дошли ли они до
            анкеты, первой записи, команды и оплаты. Доля — от регистраций той же строки. Демо и служебные
            организации не учитываются; канал известен для регистраций с формы начиная с 01.11.2026.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="funnel-summary">
        {FUNNEL_STEPS.map((step) => (
          <div key={step} className="rounded-2xl border border-[#ececf4] bg-white p-4">
            <div className="text-[13px] font-medium text-[#6f7282]">{FUNNEL_STEP_LABELS[step]}</div>
            <div className="mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-[#0b1024]">{total[step]}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-[#9b9fb3]">
              {step === "registered" ? FUNNEL_STEP_HINTS[step] : `${formatShare(stepShare(total, step))} · ${FUNNEL_STEP_HINTS[step]}`}
            </div>
          </div>
        ))}
      </div>

      <FunnelTable title="По неделям регистрации" firstColumn="Неделя" rows={funnel.weeks} testId="funnel-weeks" />
      <FunnelTable
        title="По каналам"
        firstColumn="Канал"
        rows={funnel.channels}
        testId="funnel-channels"
        empty="За эти недели регистраций нет."
      />
    </div>
  );
}

function formatShare(share: number | null): string {
  return share === null ? "—" : `${share} %`;
}

function FunnelTable({
  title,
  firstColumn,
  rows,
  testId,
  empty,
}: {
  title: string;
  firstColumn: string;
  rows: FunnelRow[];
  testId: string;
  empty?: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{title}</h2>
      {rows.length === 0 && empty ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[14px] text-[#6f7282]">
          {empty}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white">
          <table className="w-full min-w-[720px] text-[14px]" data-testid={testId}>
            <thead className="bg-[#fafbff] text-[13px] text-[#6f7282]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">{firstColumn}</th>
                {FUNNEL_STEPS.map((step) => (
                  <th key={step} className="px-4 py-3 text-right font-medium" title={FUNNEL_STEP_HINTS[step]}>
                    {FUNNEL_STEP_LABELS[step]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-[#ececf4]">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-[#0b1024]">{row.label}</td>
                  {FUNNEL_STEPS.map((step) => {
                    const share = stepShare(row.counts, step);
                    return (
                      <td key={step} className="px-4 py-3 text-right tabular-nums">
                        <span className={row.counts[step] === 0 ? "text-[#9b9fb3]" : "text-[#0b1024]"}>{row.counts[step]}</span>
                        {step === "registered" || share === null ? null : (
                          <span className="ml-1.5 text-[12px] text-[#6f7282]">{formatShare(share)}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
