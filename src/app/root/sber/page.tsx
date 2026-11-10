import { Landmark } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { loadSberAdminStatus, type SberAdminStatus } from "@/lib/sber/invoice-payments.server";
import { daysUntil } from "@/lib/sber/scanflow-shared";
import { SberSyncButton } from "./sber-sync-button";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "СберБизнес" };

type Tone = "ok" | "warn" | "bad" | "muted";

const TONE: Record<Tone, string> = {
  ok: "bg-[#ecfdf5] text-[#116b2a]",
  warn: "bg-[#fff8e6] text-[#8a5a00]",
  bad: "bg-[#fff4f2] text-[#a13a32]",
  muted: "bg-[#f5f6ff] text-[#3848c7]",
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : iso;
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${TONE[tone]}`}>{children}</span>;
}

function Row({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: Tone; hint?: string }) {
  return (
    <div className="grid gap-1 border-b border-[#ececf4] py-3 last:border-b-0 sm:grid-cols-[220px_1fr] sm:gap-4">
      <div className="text-[13px] text-[#6f7282]">{label}</div>
      <div className="min-w-0">
        <div className="text-[14px] text-[#0b1024]">{tone ? <Pill tone={tone}>{value}</Pill> : value}</div>
        {hint ? <div className="mt-1 text-[12.5px] leading-relaxed text-[#6f7282]">{hint}</div> : null}
      </div>
    </div>
  );
}

/** Итог по поступлению: SberIncomingPayment.status. */
const STATUS_VIEW: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  matched: { label: "оплачен счёт", tone: "ok" },
  credited: { label: "на балансе", tone: "ok" },
  already: { label: "счёт отмечен вручную", tone: "ok" },
  crediting: { label: "зачисляется", tone: "warn" },
  review: { label: "на разбор", tone: "warn" },
  failed: { label: "не зачислен", tone: "bad" },
};

function certRow(status: SberAdminStatus, now: number) {
  const api = status.api && "connected" in status.api ? status.api : null;
  // Сертификат, которым реально ходит WeSetup (копия .p12 ScanFlow на сервере).
  if (status.cert && "validTo" in status.cert) {
    const left = daysUntil(status.cert.validTo, now);
    const tone: Tone = left === null ? "muted" : left < 0 ? "bad" : left <= 60 ? "warn" : "ok";
    const text = left === null ? fmtDate(status.cert.validTo) : left < 0 ? `истёк ${fmtDate(status.cert.validTo)}` : `до ${fmtDate(status.cert.validTo)} · ${left} дн.`;
    const scanflowTls = api?.tls?.validTo ? ` ScanFlow сообщает срок своего сертификата: до ${fmtDate(api.tls.validTo)}.` : "";
    return (
      <Row
        label="TLS-сертификат Sber API"
        value={text}
        tone={tone}
        hint={`Сертификат приложения ScanFlow (${status.cert.subject || "без имени"}), выдан ${fmtDate(status.cert.validFrom)}. Сбер выпускает его на год, продлить можно только новым в личном кабинете Sber API — за 60 дней до конца строка станет жёлтой.${scanflowTls}`}
      />
    );
  }
  if (status.cert && "error" in status.cert) {
    return <Row label="TLS-сертификат Sber API" value="не читается" tone="bad" hint={status.cert.error} />;
  }
  return <Row label="TLS-сертификат Sber API" value="не настроен" tone="bad" hint="Нет SBER_SCANFLOW_PFX в .env сервера." />;
}

export default async function RootSberPage() {
  await requireRoot();
  const status = await loadSberAdminStatus();
  const now = Date.now();
  const dbStatus = status.db && "orgName" in status.db ? status.db : null;
  const api = status.api && "connected" in status.api ? status.api : null;
  const accessLeft = dbStatus?.accessUntil ? Date.parse(dbStatus.accessUntil) - now : null;
  const refreshLeft = daysUntil(dbStatus?.refreshUntil, now);
  const last = status.lastSync;
  const ready = status.channelConfigured && Boolean(dbStatus) && Boolean(status.accountNumber);

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <Landmark className="size-5" />
          </span>
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">СберБизнес</h1>
            <p className="mt-1 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              Оплаты по счетам приходят на р/с БФС. Каждые 10 минут сайт читает выписку этого счёта тем же подключением, что ScanFlow и DocsFlow,
              находит платежи по нашим счетам (номер счёта в назначении и сумма, либо ИНН и сумма) и отмечает счёт оплаченным — тариф подключается,
              гостю создаётся кабинет. Спорные платежи приходят администраторам на разбор.
            </p>
          </div>
        </div>
        <SberSyncButton disabled={!ready} />
      </div>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 md:p-7">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Подключение</div>
        <Row
          label="Сверка оплат"
          value={ready ? "включена" : "не работает"}
          tone={ready ? "ok" : "bad"}
          hint={
            ready
              ? undefined
              : !status.channelConfigured
                ? "На сервере нет настроек канала ScanFlow (SCANFLOW_DATABASE_URL, SBER_SCANFLOW_PFX)."
                : !status.accountNumber
                  ? "В реквизитах платформы нет расчётного счёта."
                  : status.db && "error" in status.db
                    ? `База ScanFlow не ответила: ${status.db.error}`
                    : `ScanFlow не подключён к счёту …${status.accountNumber.slice(-4)}.`
          }
        />
        <Row label="Организация и счёт" value={dbStatus ? `${dbStatus.orgName || "—"} · р/с …${dbStatus.accountNumber.slice(-4)}` : status.accountNumber ? `р/с …${status.accountNumber.slice(-4)} (из реквизитов)` : "—"} />
        <Row
          label="Токен доступа"
          value={dbStatus?.accessUntil ? `до ${fmt(dbStatus.accessUntil)}` : "—"}
          tone={accessLeft === null ? "muted" : accessLeft > 0 ? "ok" : "warn"}
          hint="Живёт час, ScanFlow обновляет его сам; перед сверкой истекающий токен сайт просит обновить у ScanFlow."
        />
        <Row
          label="Токен обновления"
          value={dbStatus?.refreshUntil ? `до ${fmtDate(dbStatus.refreshUntil)}${refreshLeft !== null ? ` · ${refreshLeft} дн.` : ""}` : "—"}
          tone={refreshLeft === null ? "muted" : refreshLeft > 30 ? "ok" : refreshLeft > 0 ? "warn" : "bad"}
          hint={dbStatus?.lastRefreshAt ? `Последнее обновление ScanFlow: ${fmt(dbStatus.lastRefreshAt)}. Продлевается при каждом обновлении.` : undefined}
        />
        {dbStatus?.lastRefreshError ? <Row label="Ошибка обновления" value={dbStatus.lastRefreshError} tone="bad" /> : null}
        <Row
          label="Секрет приложения"
          value={api?.secret ? (api.secret.perpetual ? "бессрочный" : api.secret.expiresAt ? `до ${fmtDate(api.secret.expiresAt)}` : "задан") : status.api && "error" in status.api ? "ScanFlow не ответил" : "—"}
          tone={api?.secret ? (api.secret.lastError ? "bad" : "ok") : "muted"}
          hint={api?.secret?.lastError ?? (status.api && "error" in status.api ? status.api.error : undefined)}
        />
        {certRow(status, now)}
      </section>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 md:p-7">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Последняя сверка</div>
        {last ? (
          <>
            <Row label="Когда" value={`${fmt(last.at)} · ${last.trigger === "manual" ? "вручную" : "по расписанию"}`} />
            <Row label="Результат" value={last.ok ? "выписка получена" : "ошибка"} tone={last.ok ? "ok" : "bad"} hint={last.error ?? undefined} />
            {last.ok ? (
              <Row label="За дни" value={`${last.days.join(", ")} · входящих ${last.incoming}, оплачено счетов ${last.matched}, на баланс ${last.credited ?? 0}, на разбор ${last.review}`} />
            ) : null}
          </>
        ) : (
          <p className="text-[14px] text-[#6f7282]">Сверок ещё не было.</p>
        )}
      </section>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 md:p-7">
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Поступления</div>
        {status.recent.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
            <div className="text-[15px] font-medium text-[#0b1024]">Пока нет</div>
            <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">Здесь появятся оплаты по нашим счетам, поступления, зачисленные на баланс по ИНН плательщика, и платежи, которые нужно разобрать вручную.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead className="text-[12px] text-[#6f7282]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Дата</th>
                  <th className="py-2 pr-3 font-medium">Плательщик</th>
                  <th className="py-2 pr-3 font-medium">Сумма</th>
                  <th className="py-2 pr-3 font-medium">Заказ</th>
                  <th className="py-2 font-medium">Итог</th>
                </tr>
              </thead>
              <tbody>
                {status.recent.map((row) => (
                  <tr key={row.operationId} className="border-t border-[#ececf4] align-top">
                    <td className="py-2.5 pr-3 tabular-nums">{fmtDate(row.operationDate)}</td>
                    <td className="py-2.5 pr-3">
                      {row.payerName || "—"}
                      {row.payerInn ? <div className="text-[12px] text-[#6f7282]">ИНН {row.payerInn}</div> : null}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">{row.amountRub.toLocaleString("ru-RU")} ₽</td>
                    <td className="py-2.5 pr-3 tabular-nums">{row.orderId ? `№${row.orderId}` : "—"}</td>
                    <td className="py-2.5">
                      <Pill tone={STATUS_VIEW[row.status]?.tone ?? "bad"}>{STATUS_VIEW[row.status]?.label ?? "не отмечен"}</Pill>
                      {row.note ? <div className="mt-1 text-[12px] text-[#6f7282]">{row.note}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
