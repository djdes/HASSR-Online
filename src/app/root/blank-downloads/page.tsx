import { requireRoot } from "@/lib/auth-helpers";
import {
  BLANK_CONSENT_SOURCE,
  BLANK_DOWNLOAD_AUDIT_ACTION,
  BLANK_FORMAT_LABEL,
  BLANK_MARKETING_CONSENT_SOURCE,
  type BlankFormat,
} from "@/lib/blank-download";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Скачивания шаблонов",
};

const LIMIT = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

type Details = { code?: string; paperId?: string; title?: string; format?: BlankFormat };

function readDetails(value: unknown): Details {
  return value && typeof value === "object" ? (value as Details) : {};
}

/** Начало окна «за 30 дней» — момент запроса (серверный компонент, рендер один). */
function thirtyDaysAgo(): Date {
  return new Date(Date.now() - 30 * DAY_MS);
}

function formatDate(date: Date): string {
  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Скачивания шаблонов журналов с публичных страниц — список для продаж.
 *
 * Источник — согласия в LegalConsent (source "blank-download"): каждое
 * скачивание = запись согласия с почтой и датой. Журнал и формат лежат в
 * AuditLog платформы (action "blank.download", entityId = id согласия).
 * «Аккаунт» — есть ли уже пользователь с этой почтой. «Рассылка» — дала ли
 * эта почта согласие на письма (необязательная галка в том же окне,
 * запись LegalConsent с source "blank-download-marketing"): согласие —
 * про человека, поэтому «да» стоит у всех его скачиваний.
 */
export default async function RootBlankDownloadsPage() {
  await requireRoot();

  const since = thirtyDaysAgo();
  const [consents, total30, unique30] = await Promise.all([
    db.legalConsent.findMany({
      where: { source: BLANK_CONSENT_SOURCE },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: { id: true, email: true, createdAt: true },
    }),
    db.legalConsent.count({ where: { source: BLANK_CONSENT_SOURCE, createdAt: { gte: since } } }),
    db.legalConsent.groupBy({ by: ["email"], where: { source: BLANK_CONSENT_SOURCE, createdAt: { gte: since } } }),
  ]);

  const ids = consents.map((consent) => consent.id);
  const emails = [...new Set(consents.map((consent) => consent.email))];
  const [details, users, marketing] = await Promise.all([
    ids.length
      ? db.auditLog.findMany({
          where: { action: BLANK_DOWNLOAD_AUDIT_ACTION, entityId: { in: ids } },
          select: { entityId: true, details: true },
        })
      : Promise.resolve([]),
    emails.length
      ? db.user.findMany({ where: { email: { in: emails } }, select: { email: true } })
      : Promise.resolve([]),
    emails.length
      ? db.legalConsent.findMany({
          where: { source: BLANK_MARKETING_CONSENT_SOURCE, email: { in: emails } },
          select: { email: true },
          distinct: ["email"],
        })
      : Promise.resolve([]),
  ]);
  const detailsById = new Map(details.map((row) => [row.entityId, readDetails(row.details)]));
  const withAccount = new Set(users.map((user) => user.email));
  const withMarketing = new Set(marketing.map((row) => row.email));

  return (
    <div className="mx-auto max-w-[1100px]">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Скачивания шаблонов</h1>
      <p className="mt-2 max-w-[720px] text-[14px] leading-[1.6] text-[#6f7282]">
        Кто скачал шаблон журнала с сайта: почта, журнал, формат и дата. Перед скачиванием человек отмечает
        согласие на обработку персональных данных — оно хранится дословно. «Рассылка: да» — почта отметила
        необязательную галку «Присылать полезные материалы и новости». Последние {LIMIT} скачиваний.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <span className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] tabular-nums text-[#3848c7]">
          За 30 дней: {total30}
        </span>
        <span className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] tabular-nums text-[#3848c7]">
          Уникальных почт: {unique30.length}
        </span>
      </div>

      {consents.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">Скачиваний пока нет</div>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
            Они появятся, когда посетители начнут скачивать шаблоны на /blanki, страницах журналов и главной.
          </p>
        </div>
      ) : (
        <>
        {/* Телефон: карточки — таблица в пять колонок на 390 px не читается. */}
        <ul className="mt-6 space-y-2 sm:hidden" data-testid="blank-downloads-list">
          {consents.map((consent) => {
            const detail = detailsById.get(consent.id) ?? {};
            return (
              <li key={consent.id} className="rounded-2xl border border-[#ececf4] bg-white p-4">
                <a
                  href={`mailto:${consent.email}`}
                  className="block text-[14px] font-medium text-[#0b1024] underline-offset-4 [overflow-wrap:anywhere] hover:text-[#3848c7] hover:underline"
                >
                  {consent.email}
                </a>
                <div className="mt-1.5 text-[14px] text-[#3c4053]">{detail.title ?? "—"}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] tabular-nums text-[#6f7282]">
                  <span>
                    {detail.format ? BLANK_FORMAT_LABEL[detail.format] ?? detail.format : "—"} · {formatDate(consent.createdAt)}
                  </span>
                  {withAccount.has(consent.email) ? (
                    <span className="rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[12px] text-[#116b2a]">аккаунт есть</span>
                  ) : null}
                  <span
                    className={
                      withMarketing.has(consent.email)
                        ? "rounded-full bg-[#eef1ff] px-2.5 py-0.5 text-[12px] text-[#3848c7]"
                        : "text-[12px] text-[#9b9fb3]"
                    }
                  >
                    Рассылка: {withMarketing.has(consent.email) ? "да" : "нет"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-[#ececf4] bg-white sm:block">
          <table className="w-full min-w-[820px] text-[14px]" data-testid="blank-downloads-table">
            <thead className="bg-[#fafbff] text-[13px] text-[#6f7282]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Дата, МСК</th>
                <th className="px-4 py-3 text-left font-medium">Почта</th>
                <th className="px-4 py-3 text-left font-medium">Журнал</th>
                <th className="px-4 py-3 text-left font-medium">Формат</th>
                <th className="px-4 py-3 text-left font-medium">Аккаунт</th>
                <th className="px-4 py-3 text-left font-medium">Рассылка</th>
              </tr>
            </thead>
            <tbody>
              {consents.map((consent) => {
                const detail = detailsById.get(consent.id) ?? {};
                const code = detail.code ?? (detail.paperId ? `бумажный ${detail.paperId}` : null);
                return (
                  <tr key={consent.id} className="border-t border-[#ececf4] align-top">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[#3c4053]">
                      {formatDate(consent.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`mailto:${consent.email}`}
                        className="font-medium text-[#0b1024] underline-offset-4 hover:text-[#3848c7] hover:underline"
                      >
                        {consent.email}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[#0b1024]">{detail.title ?? "—"}</div>
                      {code ? <div className="mt-0.5 font-mono text-[12px] text-[#9b9fb3]">{code}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-[#3c4053]">
                      {detail.format ? BLANK_FORMAT_LABEL[detail.format] ?? detail.format : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {withAccount.has(consent.email) ? (
                        <span className="rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] text-[#116b2a]">есть</span>
                      ) : (
                        <span className="text-[13px] text-[#9b9fb3]">нет</span>
                      )}
                    </td>
                    <td className="px-4 py-3" data-testid="blank-download-marketing-cell">
                      {withMarketing.has(consent.email) ? (
                        <span className="rounded-full bg-[#eef1ff] px-2.5 py-1 text-[12px] text-[#3848c7]">да</span>
                      ) : (
                        <span className="text-[13px] text-[#9b9fb3]">нет</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
