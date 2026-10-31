import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Check, Minus } from "lucide-react";

import { nicheLandingForSphere } from "@/lib/badge/niche-link";
import { badgeTone } from "@/lib/badge/render";
import { getBadgeStatusByCode, type BadgeStatus } from "@/lib/badge/status";
import type { TodayView } from "@/lib/badge/today";
import { getBadgePoints, getBadgeToday, type BadgePoint } from "@/lib/badge/today-data";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ [name: string]: string | string[] | undefined }>;
};

const CHECKS = [
  "Журналы температуры, гигиены, уборки и приёмки ведутся в электронном виде",
  "Записи с датой, временем и автором — их нельзя дописать задним числом",
  "Отклонения от норм фиксируются и закрываются корректирующими действиями",
];

type PageData = {
  status: BadgeStatus;
  points: BadgePoint[];
  point: BadgePoint | null;
  today: TodayView | null;
  timezone: string;
};

/**
 * Всё, что нужно странице: статус бейджа, точки (страница своя у каждой,
 * если журналы ведутся по точкам) и блок «Сегодня». Точки и «Сегодня» —
 * только если организация включила блок (`badgeTodayEnabled`, отдельное
 * согласие); без него страница как раньше и `?point=` не учитывается — QR
 * с напечатанной таблички ведёт на общую страницу. Неизвестная или чужая
 * точка у сети — 404, как и выключенный бейдж. `cache` — метаданные и
 * страница одного запроса читают базу один раз.
 */
const loadPage = cache(async (code: string, pointParam: string | null): Promise<PageData | null> => {
  const status = await getBadgeStatusByCode(code);
  if (!status) return null;
  const org = await db.organization.findUnique({
    where: { id: status.organizationId },
    select: { id: true, type: true, timezone: true, perLocationJournals: true, badgeTodayEnabled: true },
  });
  if (!org) return null;
  const points = org.badgeTodayEnabled ? await getBadgePoints(org) : [];
  const point = pointParam && points.length > 0 ? (points.find((item) => item.id === pointParam) ?? null) : null;
  if (pointParam && points.length > 0 && !point) return null;
  // У сети точек «Сегодня» — на странице точки: общая страница — список точек.
  const showToday = org.badgeTodayEnabled && (points.length === 0 || point !== null);
  const today = showToday ? await getBadgeToday(org, point?.id ?? null).catch(() => null) : null;
  return { status, points, point, today, timezone: org.timezone || "Europe/Moscow" };
});

function pointParamOf(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const data = await loadPage(code, pointParamOf((await searchParams).point));
  if (!data) return { title: "Бейдж не найден — WeSetup" };
  const { status, point, today } = data;
  const name = point ? `${point.name} — ${status.name}` : status.name;
  return {
    title: `${name} — электронные журналы ХАССП в WeSetup`,
    description: today
      ? `${today.sphere.audience}: ${today.sphere.title.toLowerCase()} — отметки журналов и проверки за сегодня.`
      : `Организация ведёт производственный контроль в WeSetup. Заполнено ${status.percent ?? "—"}% журналов за последние ${status.days} дней.`,
  };
}

/** Публичная страница бейджа: без сотрудников, без содержимого записей — статус и, по согласию, «Сегодня». */
export default async function PublicBadgePage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const data = await loadPage(code, pointParamOf((await searchParams).point));
  if (!data) notFound();
  const { status, points, point, today, timezone } = data;
  const tone = badgeTone(status.percent);
  const computed = new Date(status.computedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="min-h-screen bg-[#fafbff] px-4 py-10 text-[#0b1024] sm:py-16">
      <div className="mx-auto max-w-[640px]">
        <section className="relative overflow-hidden rounded-3xl border border-[#ececf4] bg-[#0b1024] text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)]">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-[320px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-32 -right-24 size-[360px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          </div>
          <div className="relative z-10 p-7 sm:p-9">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/60">Проверено WeSetup</div>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">{point ? point.name : status.name}</h1>
            <p className="mt-1 text-[14px] text-white/70">
              {point ? `${status.name} · ` : ""}
              {status.sphere} · ведёт электронные журналы СанПиН и ХАССП
            </p>
            {point?.address ? <p className="mt-1 text-[13px] text-white/55">{point.address}</p> : null}
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <div className="flex size-24 shrink-0 items-center justify-center rounded-full border-4 text-[26px] font-semibold tabular-nums" style={{ borderColor: tone.color }}>
                {status.percent === null ? "—" : `${status.percent}%`}
              </div>
              <div className="min-w-0">
                <div className="text-[16px] font-semibold">Заполнено журналов за {status.days} дней</div>
                <div className="mt-1 inline-flex rounded-full px-3 py-1 text-[13px] font-medium" style={{ background: tone.soft, color: tone.color }}>
                  {tone.label}
                </div>
                <p className="mt-2 text-[12.5px] text-white/60">
                  {status.percent === null ? "Журналы ещё не заполнялись." : `${status.filledSlots} из ${status.totalSlots} ежедневных записей.`} Обновлено {computed}.
                </p>
              </div>
            </div>
          </div>
        </section>

        {today ? <TodaySection today={today} timezone={timezone} /> : null}

        {points.length > 0 && !point ? <PointsSection points={points} badgeCode={code} /> : null}

        <section className="mt-6 rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-7">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Что это значит</div>
          <ul className="mt-3 space-y-2.5 text-[14px] leading-relaxed text-[#3c4053]">
            {CHECKS.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] leading-relaxed text-[#6f7282]">
            Страница обезличена: здесь нет имён сотрудников и содержимого записей — только факт ведения журналов, доля заполненных за последний месяц
            {today ? ", сегодняшние отметки" : ""}
            {today?.keepsBrakerage && today.dishMode === "list" ? " и названия блюд, прошедших бракераж" : ""}. Статус считается
            автоматически и не редактируется организацией.
          </p>
        </section>

        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          {point ? (
            <Link href={`/b/${encodeURIComponent(code)}`} className="text-[14px] font-medium text-[#3848c7] underline-offset-2 hover:underline">
              Все точки «{status.name}»
            </Link>
          ) : null}
          <Link href={nicheLandingForSphere(status.sphereValue)} className="text-[14px] font-medium text-[#3848c7] underline-offset-2 hover:underline">
            Электронные журналы для сферы «{status.sphere}» — как это устроено
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            Узнать о WeSetup
          </Link>
          <span className="text-[12px] text-[#6f7282]">Электронные журналы СанПиН и ХАССП для кафе, ресторанов и производств</span>
        </div>
      </div>
    </main>
  );
}

const CARD = "mt-6 rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-7";

function Mark({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium ${
        done ? "bg-[#ecfdf5] text-[#136c3e]" : "bg-[#f4f4f7] text-[#6f7282]"
      }`}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
      {label}
      <span className="sr-only">{done ? ": отмечено" : ": нет отметки"}</span>
    </span>
  );
}

/** «Сегодня» по сфере: отметки журналов за сегодня и вчера и блюда бракеража. */
function TodaySection({ today, timezone }: { today: TodayView; timezone: string }) {
  const { sphere, facts, dishes, dishMode, keepsBrakerage } = today;
  const dateLabel = new Date().toLocaleDateString("ru-RU", { timeZone: timezone, day: "numeric", month: "long" });
  return (
    <section className={CARD} data-badge-today>
      <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#5566f6]">{sphere.audience}</div>
      <h2 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]">
        {sphere.title}, {dateLabel}
      </h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-[#3c4053]">{sphere.lead}</p>

      {facts.length > 0 ? (
        <ul className="mt-5 divide-y divide-[#f0f1f7]" data-badge-facts>
          {facts.map((item) => (
            <li key={item.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="min-w-0 text-[14.5px] font-medium sm:flex-1">{item.label}</span>
              <span className="flex shrink-0 gap-1.5">
                <Mark done={item.today} label="Сегодня" />
                <Mark done={item.yesterday} label="Вчера" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {keepsBrakerage && dishMode === "list" ? (
        <div className="mt-5" data-badge-dishes>
          <div className="text-[15px] font-semibold">
            {sphere.dishesTitle}
            <span className="ml-1.5 text-[#6f7282]">· {dishes.length}</span>
          </div>
          {dishes.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-[#6f7282]">Сегодня блюда ещё не проходили бракераж.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {dishes.map((dish, index) => (
                <li
                  key={`${dish.name}-${index}`}
                  className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 rounded-2xl border border-[#ececf4] px-3.5 py-2.5 sm:grid-cols-[3rem_minmax(0,1fr)_auto]"
                >
                  <span className="pt-0.5 text-[13px] font-semibold tabular-nums text-[#3848c7]">{dish.time ?? ""}</span>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-medium leading-snug">{dish.name}</span>
                    <span className="mt-0.5 block text-[12.5px] text-[#6f7282]">
                      {[dish.weight ? `выход ${dish.weight} г` : null, dish.rating].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span
                    className={`col-start-2 mt-2 justify-self-start rounded-full px-2.5 py-1 text-[12px] font-medium sm:col-start-3 sm:row-start-1 sm:mt-0 ${
                      dish.allowed ? "bg-[#ecfdf5] text-[#136c3e]" : "bg-[#fff4f2] text-[#a13a32]"
                    }`}
                  >
                    {dish.allowed ? "Разрешено к выдаче" : "Не допущено"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {keepsBrakerage && dishMode === "count" ? (
        <p className="mt-4 rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[14px] font-medium text-[#3848c7]" data-badge-dishes>
          {sphere.dishesTitle} сегодня: {dishes.length}
        </p>
      ) : null}

      <p className="mt-4 text-[12px] leading-relaxed text-[#6f7282]">
        Отметки — по электронным журналам за сегодня и вчера, время — местное. Обновляется каждые несколько минут.
      </p>
    </section>
  );
}

function PointsSection({ points, badgeCode }: { points: BadgePoint[]; badgeCode: string }) {
  return (
    <section className={CARD} data-badge-points>
      <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Точки</div>
      <h2 className="mt-1.5 text-[20px] font-semibold leading-tight tracking-[-0.02em]">Выберите свою точку</h2>
      <ul className="mt-4 space-y-2">
        {points.map((item) => (
          <li key={item.id}>
            <Link
              href={`/b/${encodeURIComponent(badgeCode)}?point=${encodeURIComponent(item.id)}`}
              className="flex items-center gap-3 rounded-2xl border border-[#ececf4] px-4 py-3 transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium">{item.name}</span>
                {item.address ? <span className="block text-[12.5px] text-[#6f7282]">{item.address}</span> : null}
              </span>
              <span aria-hidden className="text-[#5566f6]">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
