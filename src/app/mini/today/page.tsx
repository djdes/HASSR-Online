"use client";


import Link from "next/link";
import { presentPoolCopy, type PoolDisplayCopy } from "@/lib/journal-task-pool-copy";

import { useRegisterRefresh } from "../_components/refresh-provider";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { presentTodayError, readTodayError, todayCaughtError, todayDayLabel, todayJournalLabel, todaySchedule, type TodayError } from "./today-presentation";
import { miniShellSignInHref } from "@/lib/mini-shell-cookie";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
// NOTE: терминология «задачи / Сегодня» — нейтральная, мини-апп
// никогда не показывает слово «журнал». Сотрудник просто видит
// чек-лист задач смены. Под капотом это journal-task-claim.
import {
  AlertTriangle,
  Bed,
  CalendarOff,
  CheckCircle2,
  Clock,
  FileSignature,
  Loader2,
  Lock,
  Palmtree,
  Undo2,
  UserCheck,
} from "lucide-react";
import { JournalIcon } from "../_components/journal-icon";


type Scope = {
  displayCopy?: PoolDisplayCopy;
  scopeKey: string;
  scopeLabel: string;
  sublabel?: string;
  journalCode: string;
  journalLabel: string;
  journalLabelOrigin?: string;
  sublabelOrigin?: string;
  /** Имя иконки lucide, подобранное по виду журнала (см. journal-label.ts). */
  iconName?: string;
  journalDocumentId?: string;
  availability: "available" | "mine" | "taken" | "completed";
  claimUserName?: string | null;
  claimId?: string;
};

type Group = {
  code: string;
  label: string;
  labelOrigin?: string;
  scopes: Scope[];
};

type StuckClaim = {
  id: string;
  scopeLabel: string;
  journalCode: string;
  dateKey: string;
};

type Payload = {
  dateKey: string;
  groups: Group[];
  /** «off» | «vacation» | «sick» из графика смен, если сегодня не рабочий день. */
  scheduleStatus?: string | null;
  /**
   * Отпуск / больничный / постоянный выходной из вкладок графиков в
   * «Сотрудниках». Текст приходит готовым: «Сегодня у вас по графику:
   * отпуск до 25.09».
   */
  scheduleNote?: { kind: string; text: string; untilKey?: string | null } | null;
  myActive: {
    id: string;
    journalCode: string;
    scopeKey: string;
    scopeLabel: string;
    verificationStatus?: string | null;
    verifierComment?: string | null;
  } | null;
  /** Взятые и не закрытые задачи прошлых дней. */
  stuckClaims?: StuckClaim[];
  /** Сколько документов ждёт отметки «Ознакомлен(а)». */
  pendingAck?: number;
  /** false — режим «Только руководитель назначает»: «Взять» не показываем. */
  canSelfClaim?: boolean;
};

/** Плашка «сегодня у вас по графику». Спокойная, задачи не прячет. */
const SCHEDULE_NOTES = {
  sick: { icon: Bed }, sick_leave: { icon: Bed }, vacation: { icon: Palmtree },
  off: { icon: CalendarOff }, day_off: { icon: CalendarOff },
};

export default function MiniTodayPage() {
  const router = useRouter();
  const t = useTranslations("miniToday");
  const locale = useLocale() as Locale;
  const copyRef = useRef(t);
  useEffect(() => { copyRef.current = t; }, [t]);
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Без этого любой сбой запроса оставлял экран с вечным «крутилкой»:
  // data/gate так и не появлялись, а причина нигде не показывалась.
  const [loadError, setLoadError] = useState<TodayError | null>(null);
  // 401 — это не «ошибка загрузки», а «вы не вошли»: вместо кнопки
  // «Попробовать ещё раз» человеку нужна дорога на вход.
  const [needsSignIn, setNeedsSignIn] = useState(false);
  // mounted-флаг защищает от setState'ов после unmount'а — раньше
  // быстрое переключение страниц давало "Cannot update unmounted
  // component" warning + утечка. См. pass-3 review HIGH #6.
  const mountedRef = useRef(true);

  async function load() {
    try {
      const res = await fetch("/api/mini/today", { cache: "no-store" });
      if (!res.ok) {
        if (mountedRef.current) {
          setNeedsSignIn(res.status === 401);
          setLoadError(await readTodayError(res, "load"));
        }
        return;
      }
      const payload = (await res.json()) as Payload;
      if (mountedRef.current) {
        setData(payload);
        setLoadError(null);
        setNeedsSignIn(false);
      }
    } catch {
      if (mountedRef.current) {
        setLoadError(todayCaughtError(null, "load"));
      }
    }
  }

  // Задачи показываем сразу: «начала смены» в приложении больше нет —
  // смены ставит руководитель в графике кабинета.
  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useRegisterRefresh(load);

  async function claim(scope: Scope) {
    if (!data) return;
    // Глобальный mutex — раньше двойной тап на разные scope'ы запускал
    // 2 POST'а в параллель, и race-condition'а 409 с другим сотрудником
    // могла дать unexpected результат. Теперь все «Взять» disabled
    // пока ЛЮБОЙ claim в полёте.
    if (busy) return;
    setBusy(scope.scopeKey);
    try {
      const res = await fetch("/api/journal-task-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journalCode: scope.journalCode,
          scopeKey: scope.scopeKey,
          scopeLabel: scope.scopeLabel,
          dateKey: data.dateKey,
          parentHint: scope.scopeLabel,
        }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.claim?.id) {
          router.push(`/mini/claim/${j.claim.id}`);
          return;
        }
        await load();
        return;
      }
      // Surface error: ранее silent fall-through скрывал 409 «уже
      // взяли», 400 «нужна активная смена», 403 ACL.
      // Сервер кладёт пояснение в `message`, а не в `error` — раньше оно
      // терялось и человек видел общую фразу вместо «сначала завершите X».
      const error = await readTodayError(res, "claim");
      toast.error(presentTodayError(copyRef.current, error));
      // Список перерисовываем сами: «обновите страницу» на телефоне —
      // это просьба, которую никто не выполняет.
      if (res.status === 409 || res.status === 403) await load();
    } catch (err) {
      toast.error(
        // Раньше сюда улетало «Failed to fetch» от браузера.
        presentTodayError(copyRef.current, todayCaughtError(err, "claim"))
      );
    } finally {
      setBusy(null);
    }
  }

  /**
   * Вернуть зависшую задачу прошлого дня в общий список.
   *
   * Пока она висит, взять новую нельзя — правило «одна активная задача»
   * считает задачи любого дня. Раньше выхода из этого тупика не было.
   */
  async function releaseClaim(claimId: string) {
    if (busy) return;
    setBusy(claimId);
    try {
      const res = await fetch(`/api/journal-task-claims/${claimId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      });
      if (!res.ok) {
        const error = await readTodayError(res, "release");
        toast.error(presentTodayError(copyRef.current, error));
      } else {
        toast.success(copyRef.current("released"));
      }
      await load();
    } catch (err) {
      toast.error(presentTodayError(copyRef.current, todayCaughtError(err, "release")));
    } finally {
      setBusy(null);
    }
  }

  async function complete(claimId: string) {
    if (busy) return;
    setBusy(claimId);
    try {
      const res = await fetch(`/api/journal-task-claims/${claimId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!res.ok) {
        const error = await readTodayError(res, "complete");
        toast.error(presentTodayError(copyRef.current, error));
      }
      await load();
    } catch (err) {
      toast.error(
        presentTodayError(copyRef.current, todayCaughtError(err, "complete"))
      );
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    if (loadError) {
      return (
        <div className="space-y-3 pb-24">
          {/* Столбиком: раньше кнопка подпирала текст сбоку и наезжала
              на него на узком экране. */}
          <div className="mini-card flex flex-col items-center gap-4 px-4 py-5 text-center text-[16px] leading-relaxed">
            <span>{presentTodayError(t, loadError)}</span>
            {needsSignIn ? (
              <Link
                href={miniShellSignInHref("/mini/today")}
                className="mini-btn-primary mini-press w-full"
              >
                {t("signIn")}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLoadError(null);
                  void load();
                }}
                className="mini-btn-primary mini-press w-full"
              >
                {t("retry")}
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3 pb-24">
        <div
          className="flex h-40 items-center justify-center gap-2 text-[16px]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          <Loader2 className="size-5 animate-spin" />
          {t("loading")}
        </div>
      </div>
    );
  }

  // Отпуск / больничный / выходной приходит из двух мест: вкладок графиков
  // в «Сотрудниках» (текст с датой окончания — точнее) и «Графика смен».
  // Первый — приоритетнее.
  const scheduleKind = data.scheduleNote?.kind ?? data.scheduleStatus ?? null;
  const ScheduleIcon = scheduleKind && Object.hasOwn(SCHEDULE_NOTES, scheduleKind)
    ? SCHEDULE_NOTES[scheduleKind as keyof typeof SCHEDULE_NOTES].icon
    : null;
  const scheduleText = todaySchedule(t, locale, data.scheduleStatus, data.scheduleNote);

  const totalAvailable = data.groups.flatMap((g) =>
    g.scopes.filter((s) => s.availability === "available")
  ).length;
  const totalMine = data.groups.flatMap((g) =>
    g.scopes.filter((s) => s.availability === "mine")
  ).length;
  const totalDone = data.groups.flatMap((g) =>
    g.scopes.filter((s) => s.availability === "completed")
  ).length;

  return (
    <div className="space-y-4 pb-24">

      {/* Карточка дня — как карточки QR-страниц: подпись капсом,
          крупный заголовок, счётчики-пилюли. */}
      <header className="mini-card p-5">
        <div className="mini-eyebrow">
          {/* Дата приходит уже посчитанной по поясу организации.
              `new Date(dateKey)` разбирал её как UTC и в часть суток
              показывал соседний день — форматируем в UTC. */}
          {todayDayLabel(data.dateKey, locale, true)}
        </div>
        <h1 className="mini-h1 mt-1.5">{t("title")}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="mini-pill">{t("availableCount", { count: totalAvailable })}</span>
          {totalMine > 0 ? (
            <span className="mini-pill" data-tone="accent">
              {t("mineCount", { count: totalMine })}
            </span>
          ) : null}
          <span className="mini-pill" data-tone="ok">
            {t("doneCount", { count: totalDone })}
          </span>
        </div>
      </header>

      {/* Отметка из «Графика смен». Сотрудник её вообще не видел:
          управляющая ставила больничный, а в приложении ничего не
          менялось. Задачи не прячем — человек может выйти на подмену. */}
      {scheduleText ? (
        <div className="mini-note flex items-start gap-2.5">
          {ScheduleIcon ? (
            <ScheduleIcon
              className="mt-0.5 size-5 shrink-0"
              style={{ color: "var(--mini-accent-ink)" }}
            />
          ) : null}
          <span>
            {t("schedule.notice", { note: scheduleText })}
          </span>
        </div>
      ) : null}

      {/* Документы на ознакомление: политика, положение, инструкции. */}
      {(data.pendingAck ?? 0) > 0 ? (
        <Link href="/acknowledge" className="mini-warn mini-press flex items-center gap-2.5">
          <FileSignature
            className="size-5 shrink-0"
            style={{ color: "var(--mini-warn)" }}
          />
          <span className="min-w-0 flex-1">
            Нужно ознакомиться с документами:{" "}
            <span className="font-semibold">{data.pendingAck}</span>
          </span>
        </Link>
      ) : null}

      {/* Незакрытая задача прошлого дня. Раньше она просто блокировала
          всё остальное, а открыть её было нельзя: экран отвечал «уже
          закрыта или её взял другой сотрудник». */}
      {(data.stuckClaims ?? []).map((stuck) => (
        <div key={stuck.id} className="mini-warn">
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0"
              style={{ color: "var(--mini-warn)" }}
            />
            <div className="min-w-0 flex-1">
              <div>
                {t.rich("stuck", { date: todayDayLabel(stuck.dateKey, locale), name: stuck.scopeLabel, task: (chunks) => <span className="font-semibold">{chunks}</span> })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/mini/claim/${stuck.id}`}
                  className="mini-btn-primary mini-btn-sm mini-press"
                >
                  {t("open")}
                </Link>
                <button
                  type="button"
                  onClick={() => void releaseClaim(stuck.id)}
                  disabled={busy !== null}
                  className="mini-btn-secondary mini-btn-sm mini-press"
                >
                  {busy === stuck.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Undo2 className="size-4" />
                  )}
                  {t("release")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {data.myActive ? (
        <div className="mini-note">
          <Lock
            className="mr-1.5 inline size-4 align-text-bottom"
            style={{ color: "var(--mini-accent-ink)" }}
          />
          {t.rich("active", { name: data.myActive.scopeLabel, task: (chunks) => <span className="font-semibold">{chunks}</span> })}
          {/* Отказ заведующей доходил только до Telegram: на экране была
              обычная активная задача без единого слова о переделке. */}
          {data.myActive.verificationStatus === "rejected" ? (
            <div className="mini-warn mt-2.5">
              <span
                className="font-semibold"
                style={{ color: "var(--mini-warn)" }}
              >
                {t("rejected")}
              </span>{" "}
              {data.myActive.verifierComment?.trim() ||
                t("noComment")}
            </div>
          ) : null}
        </div>
      ) : null}

      {data.groups.length === 0 ? (
        <div
          className="rounded-[20px] border border-dashed px-6 py-10 text-center text-[16px] leading-relaxed"
          style={{
            background: "var(--mini-surface-1)",
            borderColor: "var(--mini-divider-strong)",
            color: "var(--mini-text-muted)",
          }}
        >
          {t("empty")}
          <br />
          {t("emptyHint")}
        </div>
      ) : null}

      {data.groups.map((g) => (
        <section key={g.code} className="space-y-2">
          <div className="mini-label px-1">
            {t("groupCount", { name: todayJournalLabel(t, g.code, g.label, g.labelOrigin), count: g.scopes.length })}
          </div>
          {/* Сортируем scopes так, чтобы «можно взять» и «у меня» были
              сверху — сотрудник без опыта видит ровно то, что от него
              ждут, без скролла мимо «занято коллегой». */}
          {[...g.scopes].sort((a, b) => {
            const order = { available: 0, mine: 1, taken: 2, completed: 3 };
            return order[a.availability] - order[b.availability];
          }).map((s) => (
            <ScopeRow
              key={s.scopeKey}
              scope={s}
              busy={busy === s.scopeKey || busy === s.claimId}
              // Глобальная блокировка пока в полёте ЛЮБОЙ claim/complete.
              // Раньше можно было пока «Взять» в одном scope'е жмёт —
              // тапнуть «Взять» в другом и получить race с backend'ом.
              disabled={busy !== null && busy !== s.scopeKey && busy !== s.claimId}
              // Зависшая задача прошлого дня тоже держит человека:
              // правило «одна активная задача» не смотрит на дату.
              locked={
                (data.stuckClaims ?? []).length > 0 ||
                Boolean(
                  data.myActive &&
                    data.myActive.journalCode + data.myActive.scopeKey !==
                      s.journalCode + s.scopeKey
                )
              }
              lockedHint={
                (data.stuckClaims ?? []).length > 0
                  ? t("lockedStuck")
                  : t("lockedActive")
              }
              canSelfClaim={data.canSelfClaim !== false}
              onClaim={() => claim(s)}
              onComplete={() => s.claimId && complete(s.claimId)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function ScopeRow({
  scope,
  busy,
  disabled,
  locked,
  lockedHint,
  canSelfClaim = true,
  onClaim,
  onComplete,
}: {
  scope: Scope;
  /** True когда именно ЭТА scope'а в процессе POST. */
  busy: boolean;
  /** True когда другая scope'а в процессе POST — блокируем во избежание race. */
  disabled?: boolean;
  locked: boolean;
  /** Почему нельзя взять — текст тоста и подсказки. */
  lockedHint: string;
  /** false — задачи назначает руководитель, кнопки «Взять» нет. */
  canSelfClaim?: boolean;
  onClaim: () => void;
  onComplete: () => void;
}) {
  const t = useTranslations("miniToday");
  const poolT = useTranslations("miniTaskPool");
  const av = scope.availability;
  // Строка — карточка QR-страниц. Цвета из темы: экран открывается и в
  // тёмном оформлении. «Занято коллегой» не гасим прозрачностью (текст
  // терял контраст) — тише делаем подложку.
  const rowStyle =
    av === "completed"
      ? { background: "var(--mini-ok-soft)", borderColor: "var(--mini-ok-line)" }
      : av === "mine"
        ? { background: "var(--mini-accent-soft)", borderColor: "var(--mini-accent-line)" }
        : av === "taken"
          ? { background: "var(--mini-surface-2)", borderColor: "var(--mini-divider)" }
          : undefined;
  const iconStyle =
    av === "completed"
      ? { background: "var(--mini-ok-soft)", color: "var(--mini-ok)" }
      : av === "mine"
        ? { background: "var(--mini-accent)", color: "var(--mini-on-accent)" }
        : av === "taken"
          ? { background: "var(--mini-surface-3)", color: "var(--mini-text-muted)" }
          : undefined;
  return (
    <div
      className="mini-card flex items-center gap-3 p-3.5 transition-colors"
      style={rowStyle}
    >
      <span className="mini-tile" style={iconStyle}>
        {av === "completed" ? (
          <CheckCircle2 className="size-5" />
        ) : av === "mine" ? (
          <UserCheck className="size-5" />
        ) : av === "taken" ? (
          <Lock className="size-5" />
        ) : (
          // Иконка по виду журнала — тем же помощником, что и на
          // экране задачи. Раньше у всех задач были одинаковые «искры».
          <JournalIcon
            name={scope.iconName}
            journalCode={scope.journalCode}
            className="size-5"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="text-[17px] font-semibold leading-snug"
          style={{ color: "var(--mini-text)" }}
        >
          {presentPoolCopy(poolT, scope.displayCopy, scope.journalCode, "scopeLabel", scope.scopeLabel)}
        </div>
        {scope.sublabel ? (
          <div
            className="mt-0.5 text-[14.5px] leading-snug"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {presentPoolCopy(poolT, scope.displayCopy, scope.journalCode, "sublabel", todayJournalLabel(t, scope.journalCode, scope.sublabel, scope.sublabelOrigin))}
          </div>
        ) : null}
        {scope.claimUserName ? (
          <div
            className="mt-1 flex items-center gap-1 text-[14px]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            <Clock className="size-3.5" />
            {t.rich(av === "completed" ? "personDone" : av === "mine" ? "personMine" : "personTaken", { name: scope.claimUserName, person: (chunks) => <span>{chunks}</span> })}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">
        {av === "available" && !canSelfClaim ? (
          <span
            className="inline-flex max-w-[7.5rem] items-center text-right text-[14px] leading-snug"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {t("assignedByManager")}
          </span>
        ) : null}
        {av === "available" && canSelfClaim ? (
          <button
            type="button"
            // Кнопка под замком остаётся нажимаемой намеренно: на
            // телефоне подсказку из `title` не увидеть, а disabled-кнопка
            // молчит. Тап объясняет причину тостом, брать задачу при
            // этом по-прежнему нельзя.
            onClick={() => {
              if (locked) {
                toast.info(lockedHint);
                return;
              }
              onClaim();
            }}
            disabled={busy || disabled}
            title={locked ? lockedHint : undefined}
            className={[
              locked
                ? "mini-btn-secondary mini-btn-sm mini-press"
                : "mini-btn-primary mini-btn-sm mini-press",
              disabled && !busy ? "opacity-50" : "",
            ].join(" ")}
            // Под замком — тихая кнопка: видно, что взять пока нельзя.
            style={
              locked
                ? {
                    background: "var(--mini-surface-2)",
                    borderColor: "var(--mini-divider-strong)",
                    color: "var(--mini-text-muted)",
                  }
                : undefined
            }
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {locked ? <Lock className="size-4" /> : null}
            {t("claim")}
          </button>
        ) : null}
        {av === "mine" ? (
          <button
            type="button"
            onClick={onComplete}
            disabled={busy || disabled}
            className={[
              "mini-btn-ok mini-btn-sm mini-press",
              disabled && !busy ? "opacity-50" : "",
            ].join(" ")}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("complete")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

