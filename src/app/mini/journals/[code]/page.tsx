"use client";

import { MiniListSkeleton } from "@/app/mini/_components/mini-list-skeleton";

import { use, useCallback, useEffect, useState } from "react";
import { useRegisterRefresh } from "../../_components/refresh-provider";
import { useLiveRefetch } from "@/lib/use-live-refetch";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { hasDocumentFillUi } from "@/lib/journal-document-helpers";
import { PhotoUploader, PhotoFile } from "../../_components/photo-uploader";
import { PhotoLightbox } from "../../_components/photo-lightbox";
import { JournalTaskPool } from "../../_components/task-pool";
import { FillGuideLauncher } from "@/components/journals/fill-guide-launcher";
import { fieldLabel, formatFieldValue } from "@/lib/field-labels";
import { useScrollHide } from "../../_hooks/use-scroll-hide";
import { journalSubtitle } from "../_journal-subtitle";

/**
 * Журналы где работает task-pool с race-claim'ами. Если шаблон в этом
 * списке — рисуем pool ВВЕРХУ страницы с кнопками «Взять».
 */
const POOL_JOURNAL_CODES = new Set([
  "hygiene",
  "health_check",
  "cold_equipment_control",
  "climate_control",
  "cleaning",
  "incoming_control",
  "finished_product",
  "disinfectant_usage",
  "fryer_oil",
  "accident_journal",
  "complaint_register",
  "breakdown_history",
  "ppe_issuance",
  "glass_items_list",
  "glass_control",
  "metal_impurity",
  "perishable_rejection",
  "product_writeoff",
  "traceability_test",
  "general_cleaning",
  "sanitation_day_control",
  "sanitary_day_control",
  "pest_control",
  "intensive_cooling",
  "uv_lamp_runtime",
  "equipment_maintenance",
  "equipment_calibration",
  "equipment_cleaning",
  "audit_plan",
  "audit_protocol",
  "audit_report",
  "training_plan",
]);

type EntryItem = {
  id: string;
  createdAt: string;
  status: string;
  data: Record<string, unknown>;
  filledBy?: { name: string | null } | null;
  attachments?: { url: string; filename: string }[];
};

type DocItem = {
  id: string;
  title: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  /** Кто отвечает за таблицу — старый ответ API его не присылает. */
  responsibleName?: string | null;
  /** Ответственный — текущий сотрудник. */
  mine?: boolean;
};

type Payload = {
  template: { code: string; name: string; description: string | null };
  isDocument: boolean;
  entries: EntryItem[];
  documents?: DocItem[];
  /** «ключ → подпись» из схемы шаблона; старый ответ API его не присылает. */
  labels?: Record<string, string>;
};

export default function MiniJournalPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<{ title: string; hint: string } | null>(
    null
  );
  const [copying, setCopying] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal, silent = false) => {
      try {
        const resp = await fetch(`/api/mini/journals/${code}/entries`, {
          cache: "no-store",
          signal,
        });
        if (!resp.ok) {
          if (signal?.aborted || silent) return;
          // Раньше сюда падал текст ответа целиком: «Нет доступа»,
          // «HTTP 500». Человек видел приговор без объяснения — и шёл
          // жаловаться, что приложение сломалось.
          setError(explainLoadFailure(resp.status));
          return;
        }
        const data = (await resp.json()) as Payload;
        if (!signal?.aborted) {
          setPayload(data);
          setError(null);
        }
      } catch {
        // Тихое перечитывание по живому событию не должно подменять
        // список экраном ошибки из-за одного неудачного запроса.
        if (signal?.aborted || silent) return;
        setError({
          title: "Нет связи",
          hint: "Журнал не загрузился. Проверьте интернет и потяните экран вниз, чтобы обновить.",
        });
      }
    },
    [code]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Коллега отметился с другого телефона — список обновляется сам.
  // Только события этого журнала.
  useLiveRefetch(() => void load(undefined, true), { codes: [code] });
  // Потянули вниз — перечитываем записи этого журнала.
  useRegisterRefresh(() => load());

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div
          className="rounded-3xl p-4"
          style={{
            background: "var(--mini-surface-1)",
            border: "1px solid var(--mini-divider-strong)",
          }}
        >
          <h1
            className="text-[16px] font-semibold"
            style={{ color: "var(--mini-text)" }}
          >
            {error.title}
          </h1>
          <p
            className="mt-1 text-[13px] leading-5"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {error.hint}
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void load();
            }}
            className="mini-press mt-3 inline-flex h-10 items-center rounded-2xl px-4 text-[14px] font-semibold"
            style={{
              background: "var(--mini-surface-2)",
              color: "var(--mini-text)",
            }}
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }
  if (!payload) {
    // Форма скелетона переехала в общий `MiniListSkeleton`: та же
    // разметка теперь работает и как `loading.tsx`, то есть в момент
    // навигации, а не только после монтирования клиента.
    return <MiniListSkeleton label="Загружаем журнал" />;
  }

  const subtitle = journalSubtitle(
    payload.template.name,
    payload.template.description
  );
  // `hasDocumentFillUi` шире ответа API: у протокола аудита, отчёта и
  // журнала жалоб заполнение тоже идёт таблицей, хотя старый ответ
  // помечал их как «полевые». Из-за этого им рисовались «Последние
  // записи» и кнопка «Новая запись» — она вела на форму из одного поля
  // «Участок», а у жалоб и вовсе на «Страница не найдена».
  const isDocumentJournal = payload.isDocument || hasDocumentFillUi(code);

  return (
    <div className="flex flex-1 flex-col gap-4 pb-28">
      <BackLink />
      <header className="px-1">
        <h1
          className="text-[20px] font-semibold leading-6"
          style={{ color: "var(--mini-text)" }}
        >
          {payload.template.name}
        </h1>
        {subtitle ? (
          <p
            className="mt-1 text-[13px] leading-5"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {subtitle}
          </p>
        ) : null}
      </header>

      {POOL_JOURNAL_CODES.has(code) ? (
        <section className="space-y-2">
          <div
            className="px-1 text-[12px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            Сегодняшние задачи
          </div>
          <JournalTaskPool
            code={code}
            buildEntryPath={(scope) =>
              scope.journalDocumentId
                ? `/mini/documents/${scope.journalDocumentId}`
                : `/mini/journals/${code}/new`
            }
          />
        </section>
      ) : null}

      {isDocumentJournal ? (
        <DocumentJournalBody
          code={code}
          documents={payload.documents ?? []}
        />
      ) : (
        <FieldJournalBody
          code={code}
          entries={payload.entries}
          labels={payload.labels}
          copying={copying}
          onCopyYesterday={async () => {
            setCopying(true);
            try {
              const res = await fetch(
                `/api/mini/journals/${code}/bulk-copy-yesterday`,
                { method: "POST" }
              );
              const data = (await res.json().catch(() => ({}))) as {
                error?: string;
                copied?: number;
              };
              if (!res.ok) {
                // Результат копирования — это тост, а не зелёная
                // плашка: раньше отказ («нет записей за вчера»)
                // показывался тем же зелёным блоком, что и успех.
                toast.error(data.error || "Не удалось скопировать");
                return;
              }
              toast.success(
                data.copied
                  ? `Записей создано: ${data.copied}`
                  : "Копировать нечего — вчера записей не было"
              );
              await load();
            } catch {
              toast.error("Нет связи — записи не скопировались");
            } finally {
              setCopying(false);
            }
          }}
        />
      )}
    </div>
  );
}

/** Почему журнал не открылся — словами, и что делать дальше. */
function explainLoadFailure(status: number): { title: string; hint: string } {
  if (status === 401) {
    return {
      title: "Приложение вышло из учётной записи",
      hint: "Закройте приложение и откройте его снова — понадобится войти заново.",
    };
  }
  if (status === 403) {
    return {
      title: "Этот журнал вам не открыли",
      hint: "Доступ к журналам выдаёт руководитель. Попросите открыть этот журнал — после этого он появится на главной.",
    };
  }
  if (status === 404) {
    // Не утверждаем «такого журнала нет»: 404 прилетает и когда сервер
    // просто не успел отдать ответ. Обещание, что журнал исчез, пугает
    // сильнее, чем есть на самом деле.
    return {
      title: "Журнал не открылся",
      hint: "Попробуйте ещё раз. Если не поможет — возможно, ссылка устарела или журнал отключили: выберите журнал из списка на главной.",
    };
  }
  return {
    title: "Журнал не загрузился",
    hint: "Похоже, сбой на нашей стороне. Попробуйте ещё раз через минуту.",
  };
}

function BackLink() {
  return (
    <Link
      href="/mini"
      className="-my-2 min-h-9 inline-flex items-center gap-1 text-[13px] font-medium"
      style={{ color: "var(--mini-text-muted)" }}
    >
      <ArrowLeft className="size-4" />
      На главную
    </Link>
  );
}

function FieldJournalBody({
  code,
  entries,
  labels,
  copying,
  onCopyYesterday,
}: {
  code: string;
  entries: EntryItem[];
  labels?: Record<string, string>;
  copying?: boolean;
  onCopyYesterday?: () => void;
}) {
  const hidden = useScrollHide(entries.length > 4);

  return (
    <>
      {onCopyYesterday ? (
        <button
          onClick={onCopyYesterday}
          disabled={copying}
          className="w-full rounded-xl px-3 py-2.5 text-[13px] font-medium shadow-sm disabled:opacity-50"
          style={{
            background: "var(--mini-surface-1)",
            border: "1px solid var(--mini-divider-strong)",
            color: "var(--mini-text)",
          }}
        >
          {copying ? "Копируем…" : "Заполнить как вчера"}
        </button>
      ) : null}

      <section className="space-y-2">
        <h2
          className="px-1 text-[12px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Последние записи
        </h2>
        {entries.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-6 text-center text-[14px]"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px dashed var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            Пока нет записей за 7 дней. Создайте первую.
          </div>
        ) : (
          entries.map((e) => <EntryRow key={e.id} entry={e} labels={labels} />)
        )}
      </section>

      {/* Место под кнопкой: без него последняя запись списка
          остаётся под ней навсегда — до неё нельзя докрутить. */}
      <div aria-hidden className="h-16 shrink-0" />

      {/* Позиция и уезд вниз — на обёртке, нажатие — на самой кнопке.
          Одним элементом нельзя: `.mini-press:active` тоже пишет
          `transform`, и либо отклик на нажатие пропадает, либо кнопка
          в момент нажатия прыгает вправо, теряя центровку. */}
      <div
        className="fixed left-1/2 w-[calc(100%-24px)] max-w-lg sm:w-[calc(100%-32px)]"
        style={{
          // Над навигацией, а не под ней: на `bottom-4` кнопка
          // полностью перекрывалась рейлом — у него z-слой выше.
          bottom: "calc(var(--mini-safe-b) + var(--mini-nav-h) + 0.5rem)",
          zIndex: "var(--mini-z-fab)",
          // Пока читают список — кнопка уезжает вниз и не закрывает
          // строки; движение вверх возвращает её сразу.
          transform: hidden
            ? "translate(-50%, calc(100% + var(--mini-safe-b) + var(--mini-nav-h)))"
            : "translate(-50%, 0)",
          opacity: hidden ? 0 : 1,
          pointerEvents: hidden ? "none" : undefined,
          transition:
            "transform var(--mini-dur-screen) var(--mini-ease), opacity var(--mini-dur-fast) var(--mini-ease)",
        }}
        aria-hidden={hidden}
      >
        <Link
          href={`/mini/journals/${code}/new`}
          tabIndex={hidden ? -1 : undefined}
          className="mini-press flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-[15px] font-semibold shadow-lg"
          style={{
            background: "var(--mini-lime)",
            color: "var(--mini-primary-contrast)",
            boxShadow: "var(--mini-primary-shadow)",
          }}
        >
          <Plus className="size-5" />
          Новая запись
        </Link>
      </div>
    </>
  );
}

function DocumentJournalBody({
  code,
  documents,
}: {
  code: string;
  documents: DocItem[];
}) {
  return (
    <>
      {/* «Как заполнить?» — то же окно и спотлайт-тур, что на сайте (П-3).
          Прежний info-box «заполнение доступно на сайте» устарел: документ
          открывается прямо здесь. Рендерится только у журналов с
          walkthrough (journal-ui-walkthroughs.ts). */}
      <FillGuideLauncher
        code={code}
        page="list"
        variant="button"
        basePath="mini"
        firstDocumentId={documents.find((d) => d.status !== "closed")?.id}
        className="mini-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-semibold"
        style={{
          background: "var(--mini-ice-soft)",
          border: "1px solid var(--mini-divider-strong)",
          color: "var(--mini-ice)",
        }}
      />

      <section className="space-y-2">
        <h2
          className="px-1 text-[12px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {/* Раньше заголовок обещал «Мои», а список показывал таблицы всей
              организации, включая закрытые и чужие. */}
          Таблицы журнала
        </h2>
        {documents.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-6 text-center text-[14px]"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px dashed var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            Руководитель ещё не завёл ни одной таблицы этого журнала —
            заполнять пока нечего. Попросите её создать.
          </div>
        ) : (
          documents.map((d) => {
            const dateRange = formatDateRange(d.dateFrom, d.dateTo);
            return (
              <Link
                key={d.id}
                href={`/mini/documents/${d.id}`}
                className="flex items-start gap-3 rounded-2xl px-4 py-3.5 active:scale-[0.98] sm:items-center"
                style={{
                  background: "var(--mini-card-solid-bg)",
                  border: "1px solid var(--mini-divider)",
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <div
                      className="text-[14px] font-medium leading-5"
                      style={{ color: "var(--mini-text)" }}
                    >
                      {d.title || dateRange}
                    </div>
                    {/* Закрытую таблицу заполнить уже нельзя — это видно до
                        нажатия, а не после открытия документа. */}
                    {d.status === "closed" ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
                        style={{
                          background: "var(--mini-surface-2)",
                          color: "var(--mini-text-muted)",
                        }}
                      >
                        Закрыт
                      </span>
                    ) : null}
                    {d.mine ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
                        style={{
                          background: "var(--mini-ice-soft)",
                          color: "var(--mini-ice)",
                        }}
                      >
                        Ваша
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="mt-1 text-[12px] leading-4"
                    style={{ color: "var(--mini-text-muted)" }}
                  >
                    {dateRange}
                    {!d.mine && d.responsibleName
                      ? ` · отвечает ${d.responsibleName}`
                      : ""}
                  </div>
                </div>
                {/* Стрелка «наружу» обещала уход на сайт — таблица
                    открывается здесь же. */}
                <ChevronRight
                  className="mt-0.5 size-4 shrink-0 sm:mt-0"
                  style={{ color: "var(--mini-text-faint)" }}
                />
              </Link>
            );
          })
        )}
      </section>
    </>
  );
}

function EntryRow({
  entry,
  labels,
}: {
  entry: EntryItem;
  labels?: Record<string, string>;
}) {
  const dt = new Date(entry.createdAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const preview = entryPreview(entry.data, labels);
  const [photos, setPhotos] = useState<{ url: string; filename: string }[]>(
    entry.attachments ?? []
  );
  const [lightbox, setLightbox] = useState<{ url: string; filename: string } | null>(null);

  const handleUploaded = (photo: PhotoFile) => {
    setPhotos((prev) => [...prev, { url: photo.url, filename: photo.filename }]);
  };

  return (
    <div
      className="rounded-2xl px-4 py-3"
      style={{
        background: "var(--mini-card-solid-bg)",
        border: "1px solid var(--mini-divider)",
      }}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="text-[13px] font-medium"
          style={{ color: "var(--mini-text)" }}
        >
          {dt}
        </div>
        <div
          className="text-[11px]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {entry.filledBy?.name ?? "—"}
        </div>
      </div>
      {preview ? (
        <div
          className="mt-1 line-clamp-2 text-[12px]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {preview}
        </div>
      ) : null}
      {photos.length > 0 ? (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {photos.map((p, i) => (
            <button
              key={i}
              onClick={() => setLightbox(p)}
              className="shrink-0"
            >
              <img
                src={p.url}
                alt={p.filename}
                className="h-16 w-16 rounded-lg object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-2">
        <PhotoUploader entryId={entry.id} onUploaded={handleUploaded} />
      </div>
      {lightbox ? (
        <PhotoLightbox
          url={lightbox.url}
          filename={lightbox.filename}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Три первых поля записи одной строкой.
 *
 * Раньше здесь стояли сырые ключи («temperature: 4 · productName: Молоко») —
 * повар видел дамп базы вместо своей же записи. Служебные ключи
 * в превью не нужны вовсе: они одинаковы у всех записей и съедают
 * все три места, не различая их между собой.
 */
const PREVIEW_SKIP_KEYS = new Set([
  "source",
  "templateCode",
  "completedAt",
  "pipeline",
]);

function entryPreview(
  data: Record<string, unknown>,
  labels?: Record<string, string>
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (parts.length >= 3) break;
    if (key.startsWith("_") || PREVIEW_SKIP_KEYS.has(key)) continue;
    if (value == null) continue;
    if (typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") {
      continue;
    }
    const shown = formatFieldValue(value).slice(0, 24);
    if (!shown || shown === "—") continue;
    parts.push(`${fieldLabel(key, labels)}: ${shown}`);
  }
  return parts.join(" · ");
}

function formatDateRange(from: string, to: string): string {
  const start = new Date(from);
  const end = new Date(to);
  // Почти все таблицы — ровно месяц. «Сентябрь 2026» читается с одного
  // взгляда, «01.09.2026 – 30.09.2026» приходится разбирать; и так же
  // период подписан внутри самой таблицы.
  const lastDay = new Date(
    end.getFullYear(),
    end.getMonth() + 1,
    0
  ).getDate();
  const wholeMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === 1 &&
    end.getDate() === lastDay;
  if (wholeMonth) {
    const month = start.toLocaleDateString("ru-RU", { month: "long" });
    return `${month[0].toUpperCase()}${month.slice(1)} ${start.getFullYear()}`;
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  // Таблица на один день печаталась как «18.09.2026 – 18.09.2026».
  return fmt(start) === fmt(end) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}
