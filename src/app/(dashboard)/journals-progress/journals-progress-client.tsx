"use client";

import { useLiveRefetch } from "@/lib/use-live-refetch";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import JournalsProgressLoading from "./loading";

type Status = "untouched" | "in_progress" | "completed";

type Item = {
  code: string;
  name: string;
  status: Status;
  realCount: number;
  totalCount: number;
  tfCompleted: number;
  tfTotal: number;
  primaryDocumentId: string | null;
};

type Counts = { untouched: number; in_progress: number; completed: number };

export function JournalsProgressClient() {
  const t = useTranslations("journalsProgressUi.journalsProgressClient");
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Counts>({
    untouched: 0,
    in_progress: 0,
    completed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Живое событие «журнал изменился» — перечитать сразу (тихо, без
  // спиннера); опрос раз в 60 с остаётся страховкой.
  useLiveRefetch(() => void load(true));

  async function load(silent = false, signal?: AbortSignal) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/journals/today-status", {
        cache: "no-store",
        signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? t("loadFailed"));
        return;
      }
      setItems(data.items ?? []);
      setCounts(data.counts ?? { untouched: 0, in_progress: 0, completed: 0 });
    } catch (err) {
      // AbortError при unmount — игнорируем, это штатный сценарий.
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    load(false, ctrl.signal);
    // Авто-обновление раз в 60 секунд + immediate refresh при
    // возвращении на вкладку (если был >30s в фоне). Иначе менеджер,
    // открывший вкладку утром и вернувшийся через час, видит stale
    // данные ещё минуту.
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load(true, ctrl.signal);
    }, 60_000);
    function onVisible() {
      if (typeof document !== "undefined" && !document.hidden) {
        load(true, ctrl.signal);
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearInterval(interval);
      ctrl.abort();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  // Первая загрузка — тот же скелет, что у `loading.tsx`. Раньше до ответа
  // сервера страница уже рисовала шапку по нулевым счётчикам — «Все журналы
  // на сегодня готовы», — а через секунду меняла её на «Сегодня нужно
  // заполнить: N». Обновления после первой загрузки — тихие, без скелета.
  if (loading) return <JournalsProgressLoading />;

  const inProgress = items.filter((i) => i.status === "in_progress");
  const completed = items.filter((i) => i.status === "completed");
  const untouched = items.filter((i) => i.status === "untouched");

  return (
    <div className="space-y-6">
      {/* Три SummaryCard'а («Готовы» / «В процессе» / «Не начаты») убраны:
          ровно те же числа стоят в заголовках колонок ниже. */}
      <PageHeader
        title={
          counts.untouched + counts.in_progress > 0
            ? t("titleTodo", { count: counts.untouched + counts.in_progress })
            : t("titleDone")
        }
        description={t("description")}
        actions={
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing || loading}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            {t("refresh")}
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Большая левая колонка: «Нужно внимание» — собирает
            незаполнено + начато-не-закончено. Заведующая видит
            где ещё надо подтолкнуть сотрудников. */}
        <div className="lg:col-span-2">
          <Column
            title={t("attentionTitle", { count: untouched.length + inProgress.length })}
            subtitle={t("attentionSubtitle")}
            tone="warn"
            items={[...inProgress, ...untouched]}
            emptyHint={t("attentionEmpty")}
          />
        </div>
        <Column
          title={t("readyTitle", { count: completed.length })}
          subtitle={t("readySubtitle")}
          tone="success"
          items={completed}
          emptyHint={t("readyEmpty")}
        />
      </div>
    </div>
  );
}

function Column({
  title,
  subtitle,
  tone,
  items,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  tone: "success" | "warn" | "muted";
  items: Item[];
  emptyHint: string;
}) {
  const headerDot =
    tone === "success"
      ? "bg-[#136b2a]"
      : tone === "warn"
        ? "bg-[#a13a32]"
        : "bg-[#6f7282]";
  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 md:p-6">
      <div className="mb-4 flex items-start gap-2">
        <span className={`mt-1.5 size-2 rounded-full ${headerDot}`} />
        <div>
          <h2 className="text-[15px] font-semibold text-[#0b1024]">
            {title}{" "}
            <span className="text-[12px] font-medium text-[#9b9fb3]">
              · {items.length}
            </span>
          </h2>
          <p className="mt-0.5 text-[12px] leading-snug text-[#6f7282]">
            {subtitle}
          </p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-6 text-center text-[12px] text-[#9b9fb3]">
          {emptyHint}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <ItemRow key={item.code} item={item} tone={tone} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemRow({
  item,
  tone,
}: {
  item: Item;
  tone: "success" | "warn" | "muted";
}) {
  const t = useTranslations("journalsProgressUi.journalsProgressClient");
  const href = item.primaryDocumentId
    ? `/journals/${item.code}/documents/${item.primaryDocumentId}`
    : `/journals/${item.code}`;
  const border =
    tone === "success"
      ? "border-[#c8f0d5] bg-[#ecfdf5]/40"
      : tone === "warn"
        ? "border-[#ffe9b0] bg-[#fff8eb]/30"
        : "border-[#ececf4] bg-[#fafbff]";
  return (
    <li>
      <Link
        href={href}
        className={`group flex items-center gap-3 rounded-2xl border ${border} p-3 transition-shadow hover:shadow-[0_8px_20px_-12px_rgba(85,102,246,0.18)]`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium leading-tight text-[#0b1024]">
            {item.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6f7282]">
            {item.totalCount > 0 ? (
              <span className="rounded-full bg-white px-2 py-0.5 font-medium text-[#3c4053]">
                {t("rows", { done: item.realCount, total: item.totalCount })}
              </span>
            ) : null}
            {item.tfTotal > 0 ? (
              <span className="rounded-full bg-white px-2 py-0.5 font-medium text-[#3848c7]">
                TasksFlow: {item.tfCompleted}/{item.tfTotal}
              </span>
            ) : null}
            {item.realCount === 0 && item.tfCompleted === 0 ? (
              <span className="text-[#9b9fb3]">{t("empty")}</span>
            ) : null}
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-[#9b9fb3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#5566f6]" />
      </Link>
    </li>
  );
}
