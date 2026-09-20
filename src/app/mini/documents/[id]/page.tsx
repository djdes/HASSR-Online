import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import SiteJournalDocumentPage from "@/app/(dashboard)/journals/[code]/documents/[docId]/page";
import { JournalDocGuideOverlay } from "@/components/journals/journal-doc-guide";
import { MiniDocumentLinks } from "../mini-document-links";

/**
 * Mini App document editor.
 *
 * Делает Mini App однообразным с сайтом: вместо самописного card-only
 * редактора (старая реализация) ре-использует тот же шаблон-специфичный
 * `*-document-client` что и `/journals/[code]/documents/[docId]`. Так
 * пользователь видит точно такой же UX — карточки + переключатель на
 * таблицу — какой уже отлажен на mobile-версии сайта (`mobileView`
 * cards/table в каждом клиенте).
 *
 * Стратегия: server-side proxy к site-странице. `params` у site-page —
 * `{ code, docId }`, нам же приходит только `id`. Резолвим `template.code`
 * по документу и вызываем site-page как обычную async-функцию. Все
 * данные грузятся через её внутренний Prisma fetch — дублировать
 * нечего, dispatcher из 700 строк остаётся в одном месте.
 *
 * Auth и ACL обрабатывает SiteJournalDocumentPage (она зовёт
 * `requireAuth()` и проверяет, что `document.organizationId` совпадает
 * с активной организацией пользователя). Mini App-сессия живёт в той
 * же JWT-куке, поэтому никакого специального wiring не требуется.
 *
 * NB: внутренние back-links клиентов ведут на `/journals/<code>` (т.е.
 * site dashboard, а не Mini App) — пока приемлемо, т.к. в Mini App есть
 * свой `MiniTopBar` с «На главную» и Telegram-back. Полный rewrite
 * routeCode→basePath на 50+ клиентов — отдельный refactor.
 */
export const dynamic = "force-dynamic";

export default async function MiniDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const doc = await db.journalDocument.findUnique({
    where: { id },
    select: { template: { select: { code: true } } },
  });

  if (!doc) {
    notFound();
  }

  const code = doc.template.code;

  return (
    <div className="flex flex-1 flex-col gap-3 pb-24 print:pb-0">
      <Link
        href={`/mini/journals/${code}`}
        data-mini-noprint
        className="mini-press inline-flex items-center gap-1 px-1 text-[13px] font-medium print:hidden"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <ArrowLeft className="size-4" />К списку документов
      </Link>

      {/*
        Полный site-редактор. Включает hero документа, переключатель
        cards/table (mobileView), весь grid-renderer для таблицы — точно
        как на сайте, без дубликатов кода. Тёмный/светлый mode не нужен:
        site-клиенты уже dark-on-light, на dark-теме Mini App это будет
        читаться как «бумажная карточка» поверх charcoal-бэка — что в
        целом OK, но если станет мешать, добавим contrast-обвёртку.
      */}
      {/* Ссылки бланка написаны для сайта (`/journals/...`) — обёртка переводит
          их на экраны мини-приложения, чтобы человек не вылетал на сайт. */}
      <MiniDocumentLinks>
        {/* `chrome="mini"` — без хлебных крошек дашборда: в Mini App
            навигация своя (ссылка «К списку документов» выше + MiniNav). */}
        <SiteJournalDocumentPage
          params={Promise.resolve({ code, docId: id })}
          searchParams={Promise.resolve({})}
          chrome="mini"
        />
      </MiniDocumentLinks>

      {/* Круглая кнопка «Как заполнить?» / «Как заполнять» — как на сайте
          (П-3). Mini-layout её не монтирует, а по URL код журнала не
          вычислить — передаём явно. 148px = AI-помощник на 96px + 44px
          кнопка + 8px зазор, над нижней навигацией. */}
      <JournalDocGuideOverlay code={code} basePath="mini" bottomOffset={148} />
    </div>
  );
}
