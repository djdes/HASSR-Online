import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { db } from "@/lib/db";
import { JournalPageCrumbs } from "@/components/journals/journal-breadcrumbs";
import {
  getDocumentCrumbMenu,
  getJournalCrumbMenu,
} from "@/lib/journal-crumb-menu";
import { DOCUMENT_STATUS_LEGEND } from "@/lib/crumb-menu";
import { orgTodayKey } from "@/lib/timezone";
import { TodayKeyProvider } from "@/lib/today-key-context";

const ORG_NAME_FALLBACK = "Организация";

/**
 * Оболочка страницы документа.
 *
 * На мобильном бланк шире экрана, и вбок он должен ехать ЦЕЛИКОМ:
 * заголовок, кнопки, бумажная шапка, таблицы и легенда — одним листом,
 * от жеста в любой точке. На месте остаются только «Назад» (он в
 * layout'е раздела) и хлебные крошки.
 *
 * Крошки живут ЗДЕСЬ, а не на странице, именно поэтому: так они
 * физически вне зоны прокрутки. Пока их рендерила страница, они лежали
 * внутри скроллера и уезжали вместе с бланком; sticky left-0 это
 * маскировал, но контент проезжал под ними.
 *
 * Механику прокрутки задаёт атрибут `data-journal-doc-pan`: по нему
 * `globals.css` гасит собственные горизонтальные скроллеры таблиц внутри
 * и выводит их в край экрана. Без этого каждая таблица ловила жест на
 * себя, и «тянуть в любом месте» не работало в принципе.
 *
 * `w-screen` здесь намеренно НЕТ: родитель на мобильном и так во всю
 * ширину, `-mx-4` гасит его `px-4`. `w-screen` — это 100vw, и при любом
 * рассинхроне с шириной содержимого он даёт лишние пиксели переполнения.
 */
export default async function JournalDocumentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ code: string; docId: string }>;
}) {
  const { code, docId } = await params;
  const session = await requireAuth();
  const activeOrgId = getActiveOrgId(session);

  const [document, organization] = await Promise.all([
    db.journalDocument.findUnique({
      where: { id: docId },
      select: {
        title: true,
        organizationId: true,
        template: { select: { name: true } },
      },
    }),
    db.organization.findUnique({
      where: { id: activeOrgId },
      select: { name: true, timezone: true },
    }),
  ]);

  // Чужой или несуществующий документ крошек не получает: 404 отдаёт сама
  // страница, а показывать в крошках чужое название организации нельзя.
  const showCrumbs =
    Boolean(document) && document?.organizationId === activeOrgId;

  // Оба списка нужны прямо здесь: из бланка уходят и в соседний журнал,
  // и в соседний документ этого же журнала.
  const [journalMenu, documentMenu] = showCrumbs
    ? await Promise.all([
        getJournalCrumbMenu(session, code),
        getDocumentCrumbMenu(activeOrgId, code, docId, await getActiveBuildingId(session)),
      ])
    : [undefined, undefined];

  return (
    <>
      {/* A1 аудита: маркер альбомной ориентации печати. @page нельзя
          навесить селектором, поэтому globals.css ловит этот узел через
          body:has([data-journal-print-root]) и переводит лист на
          именованный @page journal-landscape. Узел hidden — нулевое
          влияние на разметку экрана. */}
      <span data-journal-print-root hidden aria-hidden="true" />

      {showCrumbs ? (
        <JournalPageCrumbs
          organizationName={organization?.name || ORG_NAME_FALLBACK}
          journalName={document?.template.name ?? ""}
          journalCode={code}
          journalMenu={journalMenu}
          tail={[
            {
              label: document?.title ?? "",
              menu: documentMenu,
              menuTitle: "Документы журнала",
              // Точки документов — «открыт / закрыт», не журнальные.
              menuLegend: DOCUMENT_STATUS_LEGEND,
            },
          ]}
        />
      ) : null}

      <div
        data-journal-doc-pan
        className="max-sm:-mx-4 max-sm:overflow-x-auto max-sm:overscroll-x-contain max-sm:px-4"
      >
        {/* «Сегодня» по поясу организации — для ВСЕХ журналов разом: сервер
            проверяет день именно так, а браузер в другом поясе предлагал день,
            который тут же отвергался. */}
        <TodayKeyProvider value={orgTodayKey(organization?.timezone)}>
          {children}
        </TodayKeyProvider>
      </div>
    </>
  );
}
