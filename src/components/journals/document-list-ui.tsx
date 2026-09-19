"use client";

import Link from "next/link";
import { createContext, useCallback, useContext } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArchiveRestore, Ellipsis, Pencil, Plus, Printer, QrCode, Trash2 } from "lucide-react";
import { CreateDocumentDialog } from "@/components/journals/create-document-dialog";
import { confirmAsync } from "@/components/ui/confirm-async";
import { findOverlappingDocument } from "@/lib/journal-document-overlap";
import {
  JOURNAL_LIST_ACTIONS_CLASS,
  JOURNAL_LIST_HEADING_CLASS,
  JOURNAL_TAB_RAIL_CLASS,
  JOURNAL_TAB_VIEWPORT_CLASS,
} from "@/components/journals/journal-responsive";
import { FillGuideLauncher } from "@/components/journals/fill-guide-launcher";
import { TOUR } from "@/lib/tour-anchors";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { LinkPendingSpinner } from "@/components/ui/link-pending";
import { JournalEnabledIndicatorSlot } from "@/components/journals/journal-enabled-indicator";
import { cn } from "@/lib/utils";

/**
 * Может ли смотрящий создавать / настраивать / удалять документы.
 *
 * ПОЧЕМУ контекст, а не проп: у каждого журнала свой
 * `*-documents-client.tsx` (их три с половиной десятка), и протаскивать
 * один и тот же признак через все пропсы — гарантированный источник
 * расхождений. Провайдер ставится один раз на странице раздела
 * (`journals/[code]/page.tsx` → `withBanner`), значение берут общая шапка,
 * пустое состояние, меню карточки и собственные кнопки журналов.
 *
 * Без провайдера — `true`: Mini App и прочие места переиспользуют те же
 * клиенты и ведут себя как раньше.
 */
const JournalManageContext = createContext(true);

export function JournalManageProvider({
  canManage,
  children,
}: {
  canManage: boolean;
  children: React.ReactNode;
}) {
  return (
    <JournalManageContext.Provider value={canManage}>{children}</JournalManageContext.Provider>
  );
}

export function useCanManageDocuments(): boolean {
  return useContext(JournalManageContext);
}

/**
 * Пункты меню карточки документа, которые API отдаёт только руководителю:
 * `POST /api/journal-documents` (создание и копия) и `PATCH/DELETE
 * /api/journal-documents/[id]` (название, период, статус, удаление).
 * «Печать» доступна всем, кто видит документ.
 */
const MANAGE_ONLY_MENU_KEYS = new Set([
  "settings",
  "delete",
  "copy",
  "duplicate",
  "archive",
  "unarchive",
  "restore",
  "close",
  "rename",
  // Те же действия под другими именами в отдельных журналах: копия
  // (`clone`), возврат из закрытых (`activate`) и переключатель
  // «Закрыть / Вернуть в активные» (`toggle-status`). Без них у повара
  // оставались пункты, на которые API отвечает 403.
  "clone",
  "activate",
  "toggle-status",
]);

/**
 * Убирает управляющие пункты из меню карточки, когда прав нет. Функция, а
 * не хук: меню рисуется внутри `.map()` по документам.
 */
export function filterManageMenuItems<T extends { key: string }>(
  items: T[],
  canManage: boolean
): T[] {
  if (canManage) return items;
  return items.filter((item) => !MANAGE_ONLY_MENU_KEYS.has(item.key));
}

/**
 * Сколько записей пропадёт вместе с документом — строка для подтверждения
 * удаления.
 *
 * ПОЧЕМУ: окно спрашивало «Удалить документ?» и ничего не говорило про
 * объём потери. У части журналов (аварии, поломки, претензии, СИЗ,
 * перечень стекла…) ВСЕ записи лежат в `config.rows`, и посчитать их
 * можно прямо в списке, не ходя на сервер.
 *
 * `null` — считать нечего (журнал ведёт записи отдельной таблицей);
 * тогда в подтверждении остаётся прежний текст.
 */
export function countConfigRecords(config: unknown): number | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const rows = (config as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows.length : null;
}

/** «Записей будет удалено: 12» — или `null`, если считать нечего. */
export function deletedRecordsBullet(
  config: unknown
): { label: string; tone: "warn" } | null {
  const count = countConfigRecords(config);
  if (count === null) return null;
  return {
    label:
      count === 0
        ? "Записей в документе нет"
        : `Записей будет удалено: ${count}`,
    tone: "warn",
  };
}

/**
 * Документ списка в том минимуме, который нужен возврату из «Закрытых».
 * `dateTo` есть не у всех клиентов — тогда период считается одним днём.
 */
export type RestorableDocument = {
  id: string;
  title?: string | null;
  status?: string | null;
  /** Часть списков период в карточку не передаёт — тогда проверки нет. */
  dateFrom?: string | null;
  dateTo?: string | null;
};

function toPeriod(doc: RestorableDocument): { dateFrom: Date; dateTo: Date } | null {
  if (!doc.dateFrom) return null;
  const from = new Date(doc.dateFrom);
  if (!Number.isFinite(from.getTime())) return null;
  const to = doc.dateTo ? new Date(doc.dateTo) : from;
  return { dateFrom: from, dateTo: Number.isFinite(to.getTime()) ? to : from };
}

/**
 * «Вернуть в активные» для закрытого документа.
 *
 * ПОЧЕМУ: в двух десятках журналов закрытый документ уходил навсегда —
 * в меню карточки на вкладке «Закрытые» не было ни одного пункта,
 * который вернул бы его. Ошиблись кнопкой «Отправить в закрытые» — и
 * дописать период уже нельзя (PATCH закрытый документ не принимает).
 *
 * Перед возвратом проверяем пересечение с АКТИВНЫМ документом того же
 * журнала: два активных бланка на один период — это записи, разъехавшиеся
 * по двум документам, и на проверке ни один не выглядит заполненным.
 */
export function useRestoreDocument() {
  const router = useRouter();
  return useCallback(
    async (document: RestorableDocument, siblings: RestorableDocument[] = []) => {
      const ownPeriod = toPeriod(document);
      const clash = ownPeriod
        ? findOverlappingDocument(
            siblings
              .filter((item) => item.id !== document.id)
              .flatMap((item) => {
                const period = toPeriod(item);
                return period
                  ? [
                      {
                        id: item.id,
                        title: item.title ?? "",
                        status: item.status ?? null,
                        ...period,
                      },
                    ]
                  : [];
              }),
            ownPeriod
          )
        : null;
      if (clash) {
        toast.error(
          `Вернуть нельзя: на этот период уже есть активный документ «${
            clash.title || "без названия"
          }». Закройте или удалите его, иначе записи за одни и те же дни разойдутся по двум бланкам.`
        );
        return false;
      }

      const confirmed = await confirmAsync({
        title: "Вернуть документ в активные?",
        description: `Документ «${document.title || "без названия"}» снова станет активным.`,
        bullets: [
          { label: "Его можно будет дозаполнить и исправить", tone: "info" },
          { label: "Он вернётся на вкладку «Активные»", tone: "default" },
        ],
        variant: "info",
        confirmLabel: "Вернуть",
      });
      if (!confirmed) return false;

      const response = await fetch(`/api/journal-documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.error(failure?.error || "Не удалось вернуть документ в активные");
        return false;
      }
      toast.success("Документ снова активен");
      router.refresh();
      return true;
    },
    [router]
  );
}

/**
 * Готовый пункт меню «Вернуть в активные» — для карточки закрытого
 * документа. Возвращает массив (пустой у активного документа), чтобы
 * вставлять спредом в `items={filterManageMenuItems([...])}`.
 *
 * Ключ `activate` уже перечислен в `MANAGE_ONLY_MENU_KEYS`, поэтому у
 * рядового сотрудника пункт не появится.
 */
export function restoreMenuItems(args: {
  document: RestorableDocument;
  siblings?: RestorableDocument[];
  restore: ReturnType<typeof useRestoreDocument>;
}) {
  if ((args.document.status ?? "active") !== "closed") return [];
  return [
    {
      key: "activate",
      label: "Вернуть в активные",
      icon: <ArchiveRestore className="size-4 text-[#6f7282]" />,
      onSelect: () => {
        void args.restore(args.document, args.siblings ?? []);
      },
    },
  ];
}

export function JournalTopBar(props: {
  heading: string;
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  users: { id: string; name: string; role: string }[];
  compact?: boolean;
  /**
   * Сколько документов уже есть на активной вкладке. Пока их ноль, кнопка
   * «Создать документ» в шапке не показывается — единственная точка входа
   * находится внутри карточки пустого состояния (эталон: fryer_oil-list.png,
   * cold_equipment_control-list.png). `undefined` ⇒ старое поведение.
   */
  documentCount?: number;
  /**
   * Код журнала в URL (`/journals/<code>`). Нужен «Инструкции», чтобы
   * открыть пожурнальный гайд, а не общий /sanpin. По умолчанию совпадает
   * с `templateCode`; передавайте явно там, где route ≠ template.
   */
  routeCode?: string;
  /**
   * Своя кнопка «Создать документ». Нужна журналам, которые создают
   * документ с преднастроенным `config` (disinfectant, accident,
   * breakdown-history) и потому не могут пользоваться общим
   * `<CreateDocumentDialog>`. Когда передан — рендерим его вместо
   * дефолтного диалога, всё остальное (заголовок, «Инструкция»,
   * respons-раскладка) остаётся общим.
   */
  createSlot?: React.ReactNode;
  /** uv_lamp_runtime: следующий свободный номер установки (U7 аудита). */
  nextLampNumber?: string;
  /**
   * Первый активный документ — «Как заполнить?» ведёт туда шаги «внутри
   * документа». Без него такие шаги показываются неактивными.
   */
  firstDocumentId?: string;
  /**
   * Может ли смотрящий создавать документы. У повара API отвечает 403,
   * а кнопка «Создать документ» всё равно показывалась. `undefined` ⇒
   * старое поведение (можно).
   */
  canManage?: boolean;
}) {
  const canManageFromContext = useCanManageDocuments();
  const canManage = props.canManage !== false && canManageFromContext;
  return (
    // `sm:items-center` — когда длинный H1 («Журнал бракеража скоропортящейся
    // продукции») переносится в две строки, кнопки «Инструкция» / «Создать
    // документ» центрируются по высоте блока заголовка, а не липнут к первой
    // строке (P4 сводной таблицы аудита).
    <div className="flex flex-wrap items-start justify-between gap-4 sm:items-center">
      {/* Индикатор «журнал включён» — вплотную к заголовку: решение
          «этот журнал нам не нужен» принимают, когда открыли его и
          посмотрели. Данные приходят контекстом из страницы раздела;
          в Mini App провайдера нет, и слот ничего не рисует. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:max-w-[70%]">
        {/* Ограничение ширины переехало с заголовка на эту строку: с
            `w-full` на h1 индикатор всегда переносился под него, а
            просили рядом. */}
        <h1 className={cn(JOURNAL_LIST_HEADING_CLASS, "w-auto max-w-full sm:max-w-none")}>
          {props.heading}
        </h1>
        <JournalEnabledIndicatorSlot />
      </div>
      <div className={JOURNAL_LIST_ACTIONS_CLASS}>
        {/* Одна кнопка «Инструкция»: открывает окно с двумя вкладками —
            «Куда нажимать» (шаги по интерфейсу) и «Правила» (что и как
            проверять). Страница `/journals/<code>/guide` осталась —
            ссылка на неё внизу окна. */}
        <div className="flex w-full gap-2 sm:w-auto">
          <FillGuideLauncher
            code={props.templateCode}
            journalName={props.templateName}
            page="list"
            variant="button"
            firstDocumentId={props.firstDocumentId}
          />
        </div>
        {canManage && props.activeTab === "active" && props.documentCount !== 0 ? (
          <Link
            href={`/settings/qr-posters?kind=journals&ids=${encodeURIComponent(props.routeCode ?? props.templateCode)}`}
            title="Плакат с QR-кодом: сотрудник сканирует и вносит запись в этот журнал с телефона"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[15px] font-semibold text-[#5566f6] transition-colors duration-150 hover:bg-[#5566f6]/[0.09] sm:w-auto"
          >
            <QrCode className="size-4" />
            QR
          </Link>
        ) : null}
        {canManage && props.activeTab === "active" && props.documentCount !== 0 && props.createSlot}
        {canManage && props.activeTab === "active" && props.documentCount !== 0 && !props.createSlot && (
          <CreateDocumentDialog
            templateCode={props.templateCode}
            templateName={props.templateName}
            users={props.users}
            triggerClassName="h-11 w-full gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0] sm:w-auto"
            triggerLabel="Создать документ"
            triggerIcon={<Plus className="size-5" strokeWidth={2.5} />}
            nextLampNumber={props.nextLampNumber}
            triggerDataTour={TOUR.createDocument}
          />
        )}
      </div>
    </div>
  );
}

export function JournalTabs(props: {
  activeTab: "active" | "closed";
  templateCode: string;
  compact?: boolean;
}) {
  return (
    <div className={props.compact ?? true ? "border-b border-[#d9dce8]" : "border-b border-[#ececf4]"}>
      <div className={JOURNAL_TAB_VIEWPORT_CLASS}>
        <div className={JOURNAL_TAB_RAIL_CLASS}>
          <Link
            href={`/journals/${props.templateCode}`}
            className={`relative flex items-center gap-1.5 pb-5 ${
              props.activeTab === "active"
                ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
                : "text-[#6f7282]"
            }`}
          >
            Активные
            <LinkPendingSpinner />
          </Link>
          <Link
            href={`/journals/${props.templateCode}?tab=closed`}
            className={`relative flex items-center gap-1.5 pb-5 ${
              props.activeTab === "closed"
                ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
                : "text-[#6f7282]"
            }`}
          >
            Закрытые
            <LinkPendingSpinner />
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Пустое состояние списка документов — как на эталоне
 * (fryer_oil-list.png, cold_equipment_control-list.png): серая карточка по
 * центру, заголовок «Документ ещё не создан», пояснение и большая
 * primary-кнопка «Создать документ» ВНУТРИ карточки.
 *
 * Кнопка приходит слотом (`action`), поэтому открывает ровно тот же диалог
 * создания, что и кнопка в шапке страницы: у части журналов это общий
 * `<CreateDocumentDialog>`, у части — свой `createSlot`. Пока документов
 * нет, кнопка в шапке скрыта (см. `JournalTopBar.documentCount`) — точка
 * входа ровно одна.
 *
 * Онбординг-гейт «Шаг 1 / Шаг 2» (нет сотрудников) живёт внутри самого
 * диалога (`CreateDocumentEmptyState`) и остаётся приоритетнее: карточка
 * лишь открывает диалог, а он уже показывает инструкцию.
 */
export function EmptyDocumentsState({
  label,
  description,
  action,
  templateCode,
  templateName,
  users,
  nextLampNumber,
  canManage,
}: {
  label?: string;
  description?: string;
  /**
   * Готовая кнопка (журналы со своим диалогом создания). Если не передана,
   * но заданы `templateCode`/`templateName`/`users` — рисуем общий
   * `<CreateDocumentDialog>`, тот же самый, что стоял бы в шапке.
   */
  action?: React.ReactNode;
  templateCode?: string;
  templateName?: string;
  users?: { id: string; name: string; role: string }[];
  nextLampNumber?: string;
  /** Нет прав на создание — карточка остаётся, кнопка исчезает. */
  canManage?: boolean;
} = {}) {
  const canManageFromContext = useCanManageDocuments();
  const button =
    canManage === false || !canManageFromContext
      ? null
      : action ??
    (templateCode && templateName && users ? (
      <CreateDocumentDialog
        templateCode={templateCode}
        templateName={templateName}
        users={users}
        triggerClassName={EMPTY_STATE_CREATE_BUTTON_CLASS}
        triggerLabel="Создать документ"
        triggerIcon={<Plus className="size-5" strokeWidth={2.5} />}
        nextLampNumber={nextLampNumber}
        triggerDataTour={TOUR.createDocument}
      />
    ) : null);

  return (
    <div className="rounded-2xl bg-[#f6f7fa] px-6 py-12 text-center sm:px-10 sm:py-14">
      <div className="text-[22px] font-bold tracking-[-0.02em] text-[#0b1024] sm:text-[26px]">
        {label ?? "Документ ещё не создан"}
      </div>
      <p className="mx-auto mt-3 max-w-[560px] text-[14px] leading-[1.5] text-[#6f7282]">
        {description ??
          "Нажмите на кнопку ниже, чтобы создать документ и начать фиксировать записи журнала — они понадобятся при проверке Роспотребнадзора."}
      </p>
      {button ? <div className="mt-7 flex justify-center">{button}</div> : null}
    </div>
  );
}

/** Кнопка «+ Создать документ» внутри карточки пустого состояния. */
export const EMPTY_STATE_CREATE_BUTTON_CLASS =
  "h-12 gap-2 rounded-lg bg-[#5566f6] px-6 text-[15px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Меню действий с документом на карточке журнала.
 *
 * Кнопка подписана и обведена намеренно. Раньше это были голые три
 * точки цветом акцента, по центру карточки, без рамки и подписи —
 * ровно так же выглядит индикатор загрузки, и владелец так её и
 * прочитал: «почему появляется загрузка?». Нажимать на неё при этом
 * никто не пробовал, то есть половина журналов оставалась без печати и
 * настроек.
 *
 * Заодно цель нажатия была 32 px при принятом в проекте минимуме 44.
 */
export function DocumentActionsMenu(props: {
  onEdit?: () => void;
  onPrint: () => void;
  onDelete?: () => void;
  size?: "sm" | "md";
  /**
   * Документ этой карточки и соседи по списку. Передан — у закрытого
   * документа появляется «Вернуть в активные» (с проверкой пересечения
   * периодов). Не передан — меню ведёт себя как раньше.
   */
  document?: RestorableDocument;
  siblings?: RestorableDocument[];
}) {
  // На телефоне это лист снизу, на компьютере — выпадающий список:
  // общий `ResponsiveMenu`. Меню карточки документа одно на полтора
  // десятка журналов, поэтому правка здесь меняет их все разом.
  // «Настройки» и «Удалить» API отдаёт только руководителю — у остальных
  // в меню остаётся одна «Печать».
  const canManage = useCanManageDocuments();
  const restore = useRestoreDocument();
  const onEdit = canManage ? props.onEdit : undefined;
  const onDelete = canManage ? props.onDelete : undefined;
  const restoreItems = props.document
    ? filterManageMenuItems(
        restoreMenuItems({
          document: props.document,
          siblings: props.siblings,
          restore,
        }),
        canManage
      )
    : [];
  return (
    <ResponsiveMenu
      title="Действия с документом"
      contentClassName={
        (props.size ?? "md") === "md"
          ? "w-[300px] rounded-[22px] border-0 p-3 shadow-xl"
          : "w-[260px] rounded-[20px] border-0 p-3 shadow-xl"
      }
      items={[
        ...(onEdit
          ? [
              {
                key: "settings",
                label: "Настройки",
                icon: <Pencil className="size-4 text-[#6f7282]" />,
                onSelect: onEdit,
              },
            ]
          : []),
        {
          key: "print",
          label: "Печать",
          icon: <Printer className="size-4 text-[#6f7282]" />,
          onSelect: props.onPrint,
        },
        ...restoreItems,
        ...(onDelete
          ? [
              {
                key: "delete",
                label: "Удалить",
                icon: <Trash2 className="size-4 text-[#ff3b30]" />,
                onSelect: onDelete,
                tone: "danger" as const,
              },
            ]
          : []),
      ]}
      trigger={
        <button
          type="button"
          aria-label="Действия с документом"
          className={
            // На телефоне — 44 px и подпись: наведения мыши там нет, и
            // догадаться, что значок кликабельный, неоткуда. На
            // компьютере хватает рамки и hover'а, а подпись в каждой из
            // двадцати строк только шумит.
            (props.size ?? "md") === "md"
              ? "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:h-9 sm:gap-0 sm:px-2.5"
              : "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:h-8 sm:gap-0 sm:px-2"
          }
        >
          <Ellipsis className="size-4 text-[#5566f6]" />
          <span className="sm:hidden">Действия</span>
        </button>
      }
    />
  );
}
