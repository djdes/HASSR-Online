import { ChartLine, Coins } from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { getAllOrgMetrics } from "@/lib/org-metrics";
import { MetricsTable } from "./metrics-table";
import { SeedDemoButton } from "./seed-demo-button";
import { EXTRA_USER_PRICE_RUB, FREE_SEATS_LABEL, SUBSCRIPTION_SEATS_LABEL } from "@/lib/plan-catalog";

export const dynamic = "force-dynamic";

const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID || "platform";

export default async function RootMetricsPage() {
  await requireRoot();

  // Один момент времени на весь рендер: и окна 7/14/30 дней в метриках,
  // и относительные подписи «N дн назад» в таблице считаются от него.
  const refDate = new Date();
  const metrics = await getAllOrgMetrics(PLATFORM_ORG_ID, refDate);

  // Порядок по умолчанию — тот же, что стартовый в <MetricsTable>
  // (MRR по убыванию), чтобы первый кадр не прыгал после гидратации.
  const sorted = [...metrics].sort((a, b) => b.actualMrrRub - a.actualMrrRub);

  const totalActualMrr = sorted.reduce((s, m) => s + m.actualMrrRub, 0);
  const totalPotentialMrr = sorted.reduce(
    (s, m) => s + m.potentialMrrRub,
    0
  );
  const totalActiveUsers = sorted.reduce((s, m) => s + m.activeUsers, 0);
  const totalEntries7d = sorted.reduce((s, m) => s + m.entries7d, 0);
  const activeOrgs = sorted.filter((m) => m.entries7d > 0).length;
  // Баллы на всех балансах — обязательство платформы: эти рубли уже
  // «обещаны» клиентам и уменьшат будущие поступления.
  const totalBalance = sorted.reduce((s, m) => s + m.balanceRub, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <ChartLine className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[clamp(1.625rem,1.5vw+1.2rem,2rem)] font-semibold tracking-[-0.02em] text-[#0b1024]">
                Метрики платформы
              </h1>
              <SeedDemoButton />
            </div>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              Активность, retention и выручка по всем организациям.
              Расчётный MRR — `quoteSubscription(activeUsers)` по единой
              модели: {FREE_SEATS_LABEL} — 0 ₽, {SUBSCRIPTION_SEATS_LABEL} — одна
              подписка, дальше +{EXTRA_USER_PRICE_RUB} ₽ за каждого; реальный — 0 для trial-org. Trend — % изменения 7-дневной
              активности vs предыдущая неделя. Email — адрес того, кто
              зарегистрировал организацию. Заголовки колонок кликабельны,
              поиск ищет по части адреса или названия. Клик по числу
              записей раскрывает панель: какие журналы организация
              реально ведёт и кто их заполняет. IP пишется при
              входе с 26.08.2026; более ранние адреса подтянуты из
              журнала действий, поэтому у тех, кто с тех пор не заходил
              и ничего не администрировал, колонка пустая.
            </p>
          </div>
        </div>
      </div>

      {/* Aggregate stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard label="Организаций" value={sorted.length} />
        <StatCard
          label="Активных за 7 дней"
          value={activeOrgs}
          hint={`из ${sorted.length}`}
        />
        <StatCard label="Сотрудников всего" value={totalActiveUsers} />
        <StatCard label="Записей за 7 дней" value={totalEntries7d} />
        <StatCard
          label="Баллов на балансах"
          value={`${totalBalance.toLocaleString("ru-RU")} ₽`}
          hint="обязательства платформы"
        />
        <StatCard
          label="MRR"
          value={`${totalActualMrr.toLocaleString("ru-RU")} ₽`}
          hint={`потенциал: ${totalPotentialMrr.toLocaleString("ru-RU")} ₽`}
          accent
        />
      </div>

      <MetricsTable rows={sorted} now={refDate.getTime()} />
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent
          ? "border-[#5566f6]/30 bg-[#f5f6ff]"
          : "border-[#ececf4] bg-white"
      } shadow-[0_0_0_1px_rgba(240,240,250,0.45)]`}
    >
      <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-[#6f7282]">
        {accent ? <Coins className="size-3.5" /> : null}
        {label}
      </div>
      <div className="mt-1 text-[24px] font-semibold tabular-nums text-[#0b1024]">
        {value}
      </div>
      {hint ? (
        <div className="text-[12px] text-[#9b9fb3]">{hint}</div>
      ) : null}
    </div>
  );
}
