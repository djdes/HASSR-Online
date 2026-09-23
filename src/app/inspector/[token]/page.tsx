import Link from "next/link";
import { notFound } from "next/navigation";

import { Desk, Sheet, StatusSheet, SERIF } from "@/components/inspector/paper";
import { PeriodPicker, periodQuery } from "@/components/inspector/period-picker";
import { ViewerNameForm } from "@/components/inspector/viewer-name-form";
import { logInspectorEvent } from "@/lib/inspector-access";
import { loadInspectorJournals } from "@/lib/inspector-journals";
import { loadInspectorPage } from "@/lib/inspector-page";
import { formatDayKeyRu } from "@/lib/inspector-qr";
import { buildOrgSnapshot } from "@/lib/orders/org-snapshot";
import { resolveOrgJournalName } from "@/lib/org-journal-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Токен-страница проверяющего: в индекс не попадает (плюс disallow в robots.ts).
export const metadata = {
  title: "Журналы для проверяющих",
  robots: { index: false, follow: false },
};

/**
 * Портал проверяющего — «титульный лист и опись журналов».
 *
 * Вход только по токену из QR/ссылки, без логина и PIN. Проверяющий
 * выбирает период (внутри окна доступа), видит реквизиты организации и
 * опись включённых журналов с числом документов и записей; журнал
 * открывается листами печатной формы. Только чтение.
 */
export default async function InspectorLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const ctx = await loadInspectorPage(token, await searchParams);
  if (ctx.kind === "status") {
    if (ctx.notFound) notFound();
    return <StatusSheet title={ctx.title} message={ctx.message} />;
  }
  const { access, period, viewer } = ctx;

  const groups = await loadInspectorJournals(access, period.from, period.to);
  await logInspectorEvent({
    access,
    headers: ctx.headers,
    action: "inspector.view",
    viewer,
    details: { kind: "summary_page", from: period.from, to: period.to },
  });

  const snapshot = buildOrgSnapshot({
    name: access.org.name,
    inn: access.org.inn,
    address: access.org.address,
    legalProfileJson: access.org.legalProfileJson,
  });
  const orgTitle = resolveOrgJournalName(access.org);
  const legalName = snapshot.orgName !== orgTitle ? snapshot.orgName : null;
  const q = periodQuery(period);
  const base = `/inspector/${token}`;
  const totalDocs = groups.reduce((s, g) => s + g.rows.reduce((a, r) => a + r.docCount, 0), 0);
  const totalEntries = groups.reduce((s, g) => s + g.rows.reduce((a, r) => a + r.entryCount, 0), 0);
  const groupOffsets = groups.map((_, i) => groups.slice(0, i).reduce((a, g) => a + g.rows.length, 0));

  return (
    <Desk>
      <Sheet className="px-5 pb-8 pt-6 sm:px-12 sm:pb-12 sm:pt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[#141821] pb-2 text-[12.5px] text-[#5b6170]">
          <span>Материалы производственного контроля</span>
          <span>Только просмотр</span>
        </div>

        <header className="mt-8 text-center sm:mt-10">
          <h1 className={`${SERIF} text-[26px] leading-[1.15] sm:text-[34px]`} data-org-title>
            {orgTitle}
          </h1>
          {legalName ? <p className="mt-2 text-[15px] text-[#5b6170]">{legalName}</p> : null}
        </header>

        <dl className="mx-auto mt-6 max-w-[620px] divide-y divide-[#e3e5ea] border-y border-[#e3e5ea] text-[14px]" data-requisites>
          <Requisite label="ИНН" value={snapshot.orgInn} />
          <Requisite label="Адрес" value={snapshot.orgAddress} />
          <Requisite
            label={snapshot.directorPost ? capitalize(snapshot.directorPost) : "Руководитель"}
            value={snapshot.directorName}
          />
        </dl>

        <p className="mx-auto mt-6 max-w-[620px] text-center text-[14px] leading-relaxed text-[#3a3f4c]">
          Журналы ведутся в электронном виде в системе WeSetup. Записи подписываются сотрудниками
          (личный PIN или вход), время фиксируется автоматически.
        </p>

        <div className="mt-9 grid gap-6 border-t border-[#d5d8de] pt-6 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <h2 className={`${SERIF} mb-3 text-[19px]`}>Период проверки</h2>
            <PeriodPicker basePath={base} period={period} window={access.window} />
          </div>
          <div className="flex flex-col gap-2 md:items-end md:pt-10">
            <a
              href={`/api/inspector/${token}/pdf${q}`}
              className="inline-flex h-10 items-center justify-center rounded-[4px] border border-[#141821] bg-white px-4 text-[14px] font-medium text-[#141821] transition-colors duration-150 hover:bg-[#141821] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/35"
              data-summary-pdf
            >
              Скачать сводку PDF
            </a>
            <span className="text-[12.5px] tabular-nums text-[#8a8f9c]">
              {formatDayKeyRu(period.from)} - {formatDayKeyRu(period.to)}
            </span>
          </div>
        </div>

        <section className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#141821] pb-2">
            <h2 className={`${SERIF} text-[22px]`}>Опись журналов</h2>
            <span className="text-[13px] tabular-nums text-[#5b6170]" data-totals>
              документов: {totalDocs}, записей: {totalEntries}
            </span>
          </div>

          {groups.map((g, gi) => (
            <div key={g.key} className="mt-6" data-group={g.key}>
              <h3 className={`${SERIF} text-[16px] italic text-[#3a3f4c]`}>{g.label}</h3>
              <ol className="mt-2 border-t border-[#e3e5ea]">
                {g.rows.map((r, ri) => {
                  const n = groupOffsets[gi] + ri + 1;
                  // Журналы-таблицы (бракераж и т. п.) хранят строки в самом
                  // документе, а не записями — «нет записей» при документе врёт.
                  const empty = r.entryCount === 0 && r.docCount === 0;
                  return (
                    <li key={r.id} className="border-b border-[#e3e5ea]">
                      <Link
                        href={`${base}/${r.code}${q}`}
                        className="group grid grid-cols-[2.25rem_1fr] gap-x-2 py-3 transition-colors duration-150 hover:bg-[#f5f6f8] focus-visible:bg-[#f5f6f8] focus-visible:outline-none sm:grid-cols-[2.5rem_1fr_auto] sm:items-baseline sm:px-1"
                        data-journal={r.code}
                      >
                        <span className="text-right text-[13px] tabular-nums text-[#8a8f9c]">{n}.</span>
                        <span className="min-w-0 text-[15px] leading-snug text-[#141821] underline-offset-4 group-hover:underline">
                          {r.name}
                        </span>
                        <span
                          className={`col-start-2 mt-0.5 text-[13px] tabular-nums sm:col-start-3 sm:mt-0 sm:text-right ${
                            empty ? "text-[#a13a32]" : "text-[#5b6170]"
                          }`}
                        >
                          {empty
                            ? "нет записей"
                            : [r.docCount > 0 ? `${r.docCount} док.` : null, r.entryCount > 0 ? `${r.entryCount} зап.` : null]
                                .filter(Boolean)
                                .join(", ")}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>

        <section className="mt-10 border-t border-[#d5d8de] pt-6">
          <h2 className={`${SERIF} mb-3 text-[17px]`}>Отметка о просмотре</h2>
          <ViewerNameForm token={token} initialName={viewer} />
        </section>

        <footer className="mt-10 flex flex-wrap justify-between gap-2 border-t border-[#141821] pt-2 text-[12px] text-[#8a8f9c]">
          <span>
            Доступ действует до{" "}
            {access.token.expiresAt.toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: access.org.timezone || "Europe/Moscow",
            })}
          </span>
          <span>Изменить записи отсюда нельзя</span>
        </footer>
      </Sheet>
    </Desk>
  );
}

function Requisite({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 sm:grid-cols-[9rem_1fr]">
      <dt className="text-[#8a8f9c]">{label}</dt>
      <dd className="min-w-0 break-words text-[#141821]">{value || "не указано"}</dd>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
