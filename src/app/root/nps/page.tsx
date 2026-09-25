import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  NPS_RECOMMEND_AUDIT_ACTION,
  NPS_RECOMMEND_AUDIT_ENTITY,
  computeNpsReport,
  normalizeNpsScale,
  npsCategory,
  type NpsCategory,
  type NpsReport,
  type NpsScaleReport,
} from "@/lib/nps";

export const dynamic = "force-dynamic";

const BADGE_TONE: Record<NpsCategory, string> = {
  promoter: "bg-[#ecfdf5] text-[#116b2a]",
  passive: "bg-[#fff8eb] text-[#b25f00]",
  detractor: "bg-[#fff4f2] text-[#a13a32]",
};

const BAR_TONE: Record<NpsCategory, string> = {
  promoter: "bg-[#116b2a]/60",
  passive: "bg-[#b25f00]/45",
  detractor: "bg-[#a13a32]/55",
};

/** Распределение оценок одной шкалы: столбик на каждое значение. */
function ScaleBlock({ title, hint, report }: { title: string; hint: string; report: NpsScaleReport }) {
  const peak = Math.max(1, ...report.distribution.map((bar) => bar.count));
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-testid={`nps-scale-${report.scale}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="text-[14px] font-semibold text-[#0b1024]">{title}</div>
        <div className="text-[13px] tabular-nums text-[#6f7282]">
          NPS <span className="font-semibold text-[#0b1024]" data-testid={`nps-scale-${report.scale}-value`}>{report.nps === null ? "—" : report.nps}</span> · ответов {report.total}
          {report.average !== null ? ` · средняя ${report.average}` : ""}
        </div>
      </div>
      <div className="mt-0.5 text-[12px] text-[#9b9fb3]">{hint}</div>
      {report.total === 0 ? (
        <p className="mt-3 text-[13px] text-[#6f7282]">Ответов по этой шкале нет.</p>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-1.5" aria-label={`Распределение оценок, шкала ${report.scale === 5 ? "1–5" : "0–10"}`}>
            {report.distribution.map((bar) => (
              <div key={bar.score} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div className="text-[11px] tabular-nums text-[#6f7282]">{bar.count}</div>
                <div
                  className={`w-full rounded-md ${bar.count > 0 ? BAR_TONE[bar.category] : "bg-[#ececf4]"}`}
                  style={{ height: `${Math.max(4, Math.round((bar.count / peak) * 48))}px` }}
                />
                <div className="text-[12px] font-medium tabular-nums text-[#3c4053]">{bar.score}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[12px] tabular-nums text-[#6f7282]">
            промоутеры {report.promoters} · нейтральные {report.passives} · критики {report.detractors}
          </div>
        </>
      )}
    </div>
  );
}

function PeriodCard({ label, report }: { label: string; report: NpsReport }) {
  const overall = report.overall;
  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{label}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-[40px] font-semibold tabular-nums" data-testid="nps-value">{overall.nps === null ? "—" : overall.nps}</div>
        <div className="text-[13px] text-[#6f7282]">
          общий NPS · ответов {overall.total} · промоутеры {overall.promoters} · нейтральные {overall.passives} · критики {overall.detractors}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <ScaleBlock title="Шкала 1–5" hint="5 — промоутер, 4 — нейтральный, 1–3 — критик" report={report.scale5} />
        <ScaleBlock title="Шкала 0–10 (ответы до сентября 2026)" hint="9–10 — промоутеры, 7–8 — нейтральные, 0–6 — критики" report={report.scale10} />
      </div>
    </section>
  );
}

/** NPS клиентов: индекс за 90 дней и за всё время по обеим шкалам, комментарии. */
export default async function RootNpsPage() {
  await requireRoot();
  const now = new Date();
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const [recent, all, latest] = await Promise.all([
    db.npsResponse.findMany({ where: { createdAt: { gte: since } }, select: { score: true, scale: true } }),
    db.npsResponse.findMany({ select: { score: true, scale: true } }),
    db.npsResponse.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const orgIds = Array.from(new Set(latest.map((r) => r.organizationId)));
  const [orgs, recommendations] = await Promise.all([
    orgIds.length ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    latest.length
      ? db.auditLog.findMany({
          where: { entity: NPS_RECOMMEND_AUDIT_ENTITY, action: NPS_RECOMMEND_AUDIT_ACTION, entityId: { in: latest.map((r) => r.id) } },
          select: { entityId: true },
        })
      : Promise.resolve([]),
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const recommendedCount = new Map<string, number>();
  for (const row of recommendations) {
    if (row.entityId) recommendedCount.set(row.entityId, (recommendedCount.get(row.entityId) ?? 0) + 1);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">NPS клиентов</h1>
        <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
          Один вопрос руководителю раз в 90 дней: «Посоветуете WeSetup коллегам?» Сейчас — шкала 1–5, старые ответы 0–10 считаются по своей шкале. NPS = доля промоутеров минус доля критиков; общий — по всем ответам обеих шкал.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PeriodCard label="За 90 дней" report={computeNpsReport(recent)} />
        <PeriodCard label="За всё время" report={computeNpsReport(all)} />
      </div>
      {latest.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center text-[14px] text-[#6f7282]">Ответов пока нет.</div>
      ) : (
        <ul className="space-y-2">
          {latest.map((r) => {
            const scale = normalizeNpsScale(r.scale);
            const sent = recommendedCount.get(r.id) ?? 0;
            return (
              <li key={r.id} className="flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-3">
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums ${BADGE_TONE[npsCategory(r.score, scale)]}`}>
                  {r.score}
                  <span className="font-normal opacity-70"> из {scale}</span>
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] text-[#6f7282]">
                    {orgName.get(r.organizationId) ?? r.organizationId} · {r.createdAt.toLocaleString("ru-RU")}
                    {sent > 0 ? (
                      <span className="ml-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#3848c7]">
                        {sent === 1 ? "письмо коллеге" : `писем коллегам: ${sent}`}
                      </span>
                    ) : null}
                  </div>
                  {r.comment ? <p className="mt-1 text-[14px] leading-relaxed text-[#0b1024]">{r.comment}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
