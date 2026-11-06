import type { Metadata } from "next";
import { headers } from "next/headers";

import { LegalArticle } from "@/components/public/legal-article";
import { UptimeBar } from "@/components/public/uptime-bar";
import { DEFAULT_OG_IMAGES, DEFAULT_TWITTER_CARD, DEFAULT_TWITTER_IMAGES } from "@/lib/meta-defaults";
import type { UptimeStats } from "@/lib/uptime";
import { SERVICE_STATE_LABEL, type Announcement, type Incident, type ServiceState } from "@/lib/platform-status";

export const dynamic = "force-dynamic";

const PAGE_URL = "https://wesetup.ru/status";
const TITLE = "Статус сервиса";
const DESCRIPTION = "Работает ли WeSetup прямо сейчас: сайт, база данных, Telegram-бот, плановые работы и история инцидентов.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "WeSetup",
    url: PAGE_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: [...DEFAULT_OG_IMAGES],
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: TITLE,
    description: DESCRIPTION,
    images: [...DEFAULT_TWITTER_IMAGES],
  },
};

type StatusPayload = {
  ok: boolean;
  state: ServiceState;
  now: string;
  uptimeSec: number;
  build: { sha: string | null; time: string | null };
  components: Array<{ key: string; title: string; ok: boolean; detail: string }>;
  announcement: Announcement | null;
  incidents: Incident[];
  uptime: Pick<UptimeStats, "pct30" | "pct90" | "days"> | null;
};

const STATE_STYLE: Record<ServiceState, string> = {
  operational: "bg-[#ecfdf5] text-[#116b2a]",
  degraded: "bg-[#fff4f2] text-[#a13a32]",
  maintenance: "bg-[#fff8eb] text-[#b25f00]",
};

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "medium", timeStyle: "short" }) : "—";

/**
 * Публичная страница статуса. Данные берём у /api/status — того же, что
 * дёргают внешние мониторы, чтобы страница и монитор не расходились.
 */
export default async function StatusPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "wesetup.ru";
  const proto = h.get("x-forwarded-proto") ?? "https";
  let data: StatusPayload | null = null;
  try {
    const response = await fetch(`${proto}://${host}/api/status`, { cache: "no-store" });
    data = (await response.json()) as StatusPayload;
  } catch {
    data = null;
  }
  const state: ServiceState = data?.state ?? "degraded";

  return (
    <LegalArticle
      title="Статус сервиса"
      revision="Обновляется при каждом открытии страницы"
      intro="Эта страница показывает, работает ли WeSetup прямо сейчас, и что мы делаем, если нет. Проверка — при каждом открытии."
    >
      <div className="not-prose">
        <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[15px] font-semibold ${STATE_STYLE[state]}`}>
          <span className="size-2.5 rounded-full bg-current" />
          {SERVICE_STATE_LABEL[state]}
        </div>
        {data ? (
          <p className="mt-2 text-[13px] text-[#6f7282]">
            Проверено {when(data.now)} МСК · сборка {data.build.sha ?? "—"}
            {data.build.time ? ` от ${when(data.build.time)}` : ""} · процесс работает {formatUptime(data.uptimeSec)}
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-[#a13a32]">Не удалось получить данные статуса — это само по себе плохой знак. Напишите на admin@wesetup.ru.</p>
        )}

        {data?.announcement ? (
          <div className="mt-5 rounded-2xl border border-[#ffe9b0] bg-[#fffaf0] px-4 py-3 text-[14px] leading-relaxed text-[#3c4053]">
            {data.announcement.text}
          </div>
        ) : null}

        <div className="mt-6 overflow-hidden rounded-2xl border border-[#ececf4]">
          {(data?.components ?? []).map((component) => (
            <div key={component.key} className="flex items-center justify-between gap-3 border-b border-[#f2f3f8] px-4 py-3 last:border-b-0">
              <span className="text-[14px] font-medium text-[#0b1024]">{component.title}</span>
              <span className={`inline-flex items-center gap-1.5 text-[13px] ${component.ok ? "text-[#116b2a]" : "text-[#a13a32]"}`}>
                <span className="size-2 rounded-full bg-current" />
                {component.ok ? "работает" : "проблема"} · {component.detail}
              </span>
            </div>
          ))}
        </div>

        {data?.uptime ? (
          <div className="mt-8 rounded-2xl border border-[#ececf4] bg-white p-4">
            <UptimeBar stats={{ ...data.uptime, firstSampleAt: null }} />
          </div>
        ) : null}

        <h2 className="mt-8 text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">История</h2>
        {data && data.incidents.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {data.incidents.map((incident) => (
              <li key={incident.id} className="rounded-2xl border border-[#ececf4] bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${incident.resolvedAt ? "bg-[#ecfdf5] text-[#116b2a]" : incident.kind === "maintenance" ? "bg-[#fff8eb] text-[#b25f00]" : "bg-[#fff4f2] text-[#a13a32]"}`}>
                    {incident.resolvedAt ? "решено" : incident.kind === "maintenance" ? "работы идут" : "в работе"}
                  </span>
                  <span className="text-[14px] font-medium text-[#0b1024]">{incident.title}</span>
                </div>
                <p className="mt-1 text-[13px] text-[#6f7282]">
                  {when(incident.startedAt)}
                  {incident.resolvedAt ? ` — ${when(incident.resolvedAt)}` : ""} МСК
                </p>
                {incident.note ? <p className="mt-1 text-[13px] leading-relaxed text-[#3c4053]">{incident.note}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[14px] text-[#6f7282]">За последнее время инцидентов не было.</p>
        )}

        <p className="mt-8 text-[13px] leading-relaxed text-[#6f7282]">
          Мониторы могут опрашивать <code className="rounded bg-[#f5f6ff] px-1.5 py-0.5 text-[12px] text-[#3848c7]">/api/status</code>: 200 — всё
          работает, 503 — база недоступна. Заметили проблему раньше нас — admin@wesetup.ru.
        </p>
      </div>
    </LegalArticle>
  );
}
