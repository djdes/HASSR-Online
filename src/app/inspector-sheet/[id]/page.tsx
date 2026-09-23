import { notFound, redirect } from "next/navigation";

import { SERIF } from "@/components/inspector/paper";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isInspectorQrRecord } from "@/lib/inspector-qr";
import { inspectorQrSvg, inspectorQrUrl } from "@/lib/inspector-qr-service";
import { buildOrgSnapshot } from "@/lib/orders/org-snapshot";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Лист для проверяющих",
  robots: { index: false, follow: false },
};

/**
 * Лист A4 «Для проверяющих органов» с постоянным QR. Только руководство
 * своей организации; печатается сколько угодно раз — токен выводится из
 * id строки, QR не меняется до отзыва. Отдельный маршрут вне кабинета:
 * на листе не должно быть меню и шапки приложения.
 */
export default async function InspectorSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");
  const { id } = await params;
  const orgId = getActiveOrgId(session);

  const token = await db.inspectorToken.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      periodTo: true,
      expiresAt: true,
      createdAt: true,
      revokedAt: true,
      organization: {
        select: { name: true, journalShortName: true, legalProfileJson: true, inn: true, address: true, timezone: true },
      },
    },
  });
  if (!token || token.organizationId !== orgId || !isInspectorQrRecord(token)) notFound();
  const inactive = Boolean(token.revokedAt) || token.expiresAt < new Date();

  const url = inspectorQrUrl(token.id);
  const svg = inactive ? "" : await inspectorQrSvg(url);
  const snapshot = buildOrgSnapshot({
    name: token.organization.name,
    inn: token.organization.inn,
    address: token.organization.address,
    legalProfileJson: token.organization.legalProfileJson,
  });
  const orgTitle = resolveOrgJournalName(token.organization);
  const forever = token.expiresAt.getTime() - token.createdAt.getTime() > 300 * 86_400_000;
  const until = forever
    ? "до отзыва организацией"
    : `до ${token.expiresAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: token.organization.timezone || "Europe/Moscow" })}`;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#e7e9ee] px-3 py-6 text-[#141821] print:bg-white print:p-0">
      <style>{`@page { size: A4 portrait; margin: 0; } @media print { html, body { background: #fff !important; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mx-auto mb-5 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-[#5b6170]">
          Лист A4. Можно печатать повторно — QR не изменится, пока доступ не отозван.
        </p>
        {inactive ? null : <PrintButton />}
      </div>

      {inactive ? (
        <div className="mx-auto max-w-[520px] rounded-3xl border border-[#ececf4] bg-white p-8 text-center">
          <h1 className="text-[20px] font-semibold">Доступ отозван или истёк</h1>
          <p className="mt-2 text-[14px] text-[#6f7282]">Этот QR больше не работает. Выпустите новый в «Портале инспектора».</p>
        </div>
      ) : (
        <article
          className="mx-auto flex min-h-[297mm] w-full max-w-[210mm] flex-col border border-[#d5d8de] bg-white px-[8%] py-[7%] shadow-[0_18px_40px_-26px_rgba(20,24,33,0.45)] print:min-h-[296mm] print:border-0 print:shadow-none"
          data-inspector-sheet
        >
          <div className="flex items-baseline justify-between gap-4 border-b-2 border-[#141821] pb-2 text-[13px] text-[#5b6170]">
            <span>Для проверяющих органов</span>
            <span>Роспотребнадзор, СЭС</span>
          </div>

          <h1 className={`${SERIF} mt-8 text-center text-[clamp(22px,4.2vw,32px)] leading-[1.15]`}>
            Журналы производственного контроля
          </h1>
          <p className="mt-2 text-center text-[15px] text-[#5b6170]">ведутся в электронном виде</p>

          <div className="mt-8 border-y border-[#d5d8de] py-4 text-center">
            <div className={`${SERIF} text-[clamp(18px,3.2vw,24px)] leading-tight`}>{orgTitle}</div>
            {snapshot.orgName !== orgTitle ? <div className="mt-1 text-[14px] text-[#5b6170]">{snapshot.orgName}</div> : null}
            <div className="mt-1 text-[13.5px] text-[#5b6170]">
              {[snapshot.orgInn ? `ИНН ${snapshot.orgInn}` : null, snapshot.orgAddress].filter(Boolean).join(", ")}
            </div>
          </div>

          <div className="mt-8 flex justify-center">
            <div
              className="w-[min(80mm,70vw)] border border-[#141821] p-3 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
              role="img"
              aria-label="QR-код для проверяющих"
              data-sheet-qr
              // SVG строит сервер (qrcode) из нашего адреса.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>

          <ol className="mx-auto mt-8 max-w-[140mm] list-decimal space-y-1.5 pl-5 text-[15px] leading-snug">
            <li>Наведите камеру телефона на QR-код и откройте ссылку.</li>
            <li>Выберите период проверки: сегодня, неделя, месяц, квартал или свои даты.</li>
            <li>Откройте нужный журнал: он показан листами той же формы, что при печати. PDF можно скачать.</li>
          </ol>
          <p className="mx-auto mt-5 max-w-[140mm] text-center text-[13.5px] leading-relaxed text-[#3a3f4c]">
            Вход и PIN не нужны. Только просмотр: изменить записи нельзя. Каждый просмотр фиксируется
            в журнале действий организации.
          </p>

          <div className="mt-auto pt-8">
            <p className="break-all text-center font-mono text-[10.5px] text-[#8a8f9c]" data-sheet-url>
              {url}
            </p>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-[#141821] pt-2 text-[12px] text-[#5b6170]">
              <span>Доступ действует {until}</span>
              <span>WeSetup, электронные журналы СанПиН и ХАССП</span>
            </div>
          </div>
        </article>
      )}
    </main>
  );
}
