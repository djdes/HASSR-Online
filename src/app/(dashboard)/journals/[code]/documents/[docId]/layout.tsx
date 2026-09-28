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
import { CurrentJournalProvider } from "@/components/shared/custom-names-provider";

const ORG_NAME_FALLBACK = "Организация";

/**
 * Оболочка страницы документа.
 *
 * Страница документа — ПО ШИРИНЕ ЭКРАНА и вбок не прокручивается. Вбок
 * едут только широкие таблицы, каждая в своей рамке
 * (`.journal-table-scroll`: токены `JOURNAL_TABLE_SCROLL_CLASS`,
 * `JOURNAL_TABLE_VIEWPORT_CLASS`, `GRID_VIEWPORT_*`). Заголовок, кнопки,
 * описание журнала и «Добавить строку» всегда стоят от левого края экрана.
 *
 * Правка владельца 2026-09-28 (iPhone): «когда тыкаешь по журналу,
 * попадаешь в центр журнала и приходится постоянно скролить куда-то —
 * надо, чтобы в начале слева сверху». До неё на телефоне эта обёртка
 * была горизонтальным скроллером, и вбок ехал весь бланк одним листом:
 * стоило листу сдвинуться (жестом или автопрокруткой к «сегодня»), как
 * заголовок с кнопками уезжали за левый край, а справа от них оставалось
 * пустое место.
 *
 * Атрибут `data-journal-doc` читает `globals.css`: он выключает здесь
 * общий мобильный хак «каждый предок широкой таблицы — свой скроллер» и
 * выводит рамки таблиц на телефоне от края до края экрана.
 *
 * Крошки живут здесь, над содержимым страницы: layout и так знает
 * документ и собирает меню переходов «журнал → журнал / документ».
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
        template: { select: { name: true, code: true } },
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

  // Журнал документа: по нему шапка документа покажет своё название
  // организации и «Официальное название: …» (JournalOfficialNameNote).
  // Чужому документу — ничего: страница всё равно отдаст 404.
  const currentJournal = showCrumbs && document
    ? { code: document.template.code, officialName: document.template.name }
    : null;

  const content = (
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

      {/* Своей прокрутки у обёртки нет — см. комментарий к layout'у. */}
      <div data-journal-doc>
        {/* «Сегодня» по поясу организации — для ВСЕХ журналов разом: сервер
            проверяет день именно так, а браузер в другом поясе предлагал день,
            который тут же отвергался. */}
        <TodayKeyProvider value={orgTodayKey(organization?.timezone)}>
          {children}
        </TodayKeyProvider>
      </div>
    </>
  );

  return currentJournal ? (
    <CurrentJournalProvider code={currentJournal.code} officialName={currentJournal.officialName}>
      {content}
    </CurrentJournalProvider>
  ) : (
    content
  );
}
