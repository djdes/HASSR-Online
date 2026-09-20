"use client";


import Link from "next/link";

import { useRegisterRefresh } from "../_components/refresh-provider";
import { claimReasonRu } from "../_lib/claim-errors";
import { miniShellSignInHref } from "@/lib/mini-shell-cookie";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
// NOTE: терминология «задачи / Сегодня» — нейтральная, мини-апп
// никогда не показывает слово «журнал». Сотрудник просто видит
// чек-лист задач смены. Под капотом это journal-task-claim.
import {
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Sparkles,
  UserCheck,
} from "lucide-react";

type Scope = {
  scopeKey: string;
  scopeLabel: string;
  sublabel?: string;
  journalCode: string;
  journalLabel: string;
  journalDocumentId?: string;
  availability: "available" | "mine" | "taken" | "completed";
  claimUserName?: string | null;
  claimId?: string;
};

type Group = {
  code: string;
  label: string;
  scopes: Scope[];
};

type Payload = {
  dateKey: string;
  groups: Group[];
  myActive: {
    id: string;
    journalCode: string;
    scopeKey: string;
    scopeLabel: string;
  } | null;
};

/** Текст ошибки от API, иначе — понятная замена вместо кода статуса. */
async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (body.error) return body.error;
  if (res.status === 401) return "Сессия истекла — войдите заново";
  if (res.status === 403) return "Нет доступа к задачам на сегодня";
  return `Не удалось загрузить задачи (HTTP ${res.status})`;
}

export default function MiniTodayPage() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Без этого любой сбой запроса оставлял экран с вечным «крутилкой»:
  // data/gate так и не появлялись, а причина нигде не показывалась.
  const [loadError, setLoadError] = useState<string | null>(null);
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
          setLoadError(
            res.status === 401
              ? "Чтобы увидеть задачи на сегодня, нужно войти. Внутри Telegram вход произойдёт сам."
              : await readError(res)
          );
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
      if (mountedRef.current) setLoadError("Нет связи — потяните вниз, чтобы обновить");
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
      const raw = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      const body = { error: raw.error ?? raw.message };
      const msg =
        res.status === 409
          ? body.error || "Эту задачу уже забрал кто-то другой"
          : res.status === 403
            ? "Нет доступа к этой задаче"
            : res.status === 401
              ? "Вход закончился — войдите заново"
              : body.error || "Не удалось взять задачу. Попробуйте ещё раз.";
      toast.error(msg);
      // Список перерисовываем сами: «обновите страницу» на телефоне —
      // это просьба, которую никто не выполняет.
      if (res.status === 409 || res.status === 403) await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось взять задачу"
      );
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
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        toast.error(
          body.error || claimReasonRu(body.reason, res.status)
        );
      }
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось завершить задачу"
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
          <div
            className="flex flex-col items-center gap-4 rounded-2xl px-4 py-5 text-center text-[14px] leading-relaxed"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px solid var(--mini-divider-strong)",
              color: "var(--mini-text)",
            }}
          >
            <span>{loadError}</span>
            {needsSignIn ? (
              <Link
                href={miniShellSignInHref("/mini/today")}
                className="mini-press inline-flex h-11 items-center justify-center rounded-2xl px-5 text-[14px] font-semibold"
                style={{
                  background: "var(--mini-lime)",
                  color: "var(--mini-primary-contrast)",
                }}
              >
                Войти
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLoadError(null);
                  void load();
                }}
                className="mini-press inline-flex h-11 items-center justify-center rounded-2xl px-5 text-[14px] font-semibold"
                style={{
                  background: "var(--mini-lime)",
                  color: "var(--mini-primary-contrast)",
                }}
              >
                Попробовать ещё раз
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3 pb-24">
        <div
          className="flex h-40 items-center justify-center gap-2 text-[14px]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          <Loader2 className="size-5 animate-spin" />
          Загружаем задачи…
        </div>
      </div>
    );
  }

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

      <header
        className="rounded-3xl border p-6"
        style={{
          background: "var(--mini-surface-1)",
          borderColor: "var(--mini-divider-strong)",
        }}
      >
        <div
          className="text-[12px] uppercase tracking-[0.16em]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {new Date(data.dateKey).toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
        <div
          className="mt-2 text-[24px] font-semibold leading-tight"
          style={{ color: "var(--mini-text)" }}
        >
          Сегодня
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <span
            className="rounded-full px-2.5 py-1"
            style={{
              background: "var(--mini-surface-2)",
              color: "var(--mini-text-muted)",
            }}
          >
            Свободно: {totalAvailable}
          </span>
          {totalMine > 0 ? (
            <span
              className="rounded-full px-2.5 py-1 font-medium"
              style={{
                background: "var(--mini-lime)",
                color: "var(--mini-primary-contrast)",
              }}
            >
              У меня: {totalMine}
            </span>
          ) : null}
          <span
            className="rounded-full px-2.5 py-1"
            style={{
              background: "var(--mini-sage-soft)",
              color: "var(--mini-sage)",
            }}
          >
            Готово: {totalDone}
          </span>
        </div>
      </header>

      {data.myActive ? (
        <div
          className="rounded-2xl border p-3 text-[13px]"
          style={{
            background: "var(--mini-lime-soft)",
            borderColor: "var(--mini-lime-strong)",
            color: "var(--mini-text)",
          }}
        >
          <Lock className="mr-1.5 inline size-4 align-text-bottom" />
          Сейчас вы делаете:&nbsp;
          <span className="font-semibold">{data.myActive.scopeLabel}</span>
          &nbsp;— закончите её, тогда сможете взять следующую.
        </div>
      ) : null}

      {data.groups.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed px-6 py-10 text-center text-[14px]"
          style={{
            background: "var(--mini-surface-1)",
            borderColor: "var(--mini-divider-strong)",
            color: "var(--mini-text-muted)",
          }}
        >
          На сегодня задач пока нет.
          <br />
          Подойдите к руководителю — спросите, что нужно сделать.
        </div>
      ) : null}

      {data.groups.map((g) => (
        <section key={g.code} className="space-y-2">
          <div
            className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--mini-text-faint)" }}
          >
            {g.label} ({g.scopes.length})
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
              locked={Boolean(
                data.myActive &&
                  data.myActive.journalCode +
                    data.myActive.scopeKey !==
                    s.journalCode + s.scopeKey
              )}
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
  onClaim,
  onComplete,
}: {
  scope: Scope;
  /** True когда именно ЭТА scope'а в процессе POST. */
  busy: boolean;
  /** True когда другая scope'а в процессе POST — блокируем во избежание race. */
  disabled?: boolean;
  locked: boolean;
  onClaim: () => void;
  onComplete: () => void;
}) {
  const av = scope.availability;
  // Цвета берём из темы: экран открывается и в тёмном оформлении,
  // а раньше здесь была жёстко светлая палитра.
  const rowStyle =
    av === "completed"
      ? { background: "var(--mini-sage-soft)", borderColor: "var(--mini-sage)" }
      : av === "mine"
        ? { background: "var(--mini-lime-soft)", borderColor: "var(--mini-lime-strong)" }
        : {
            background: "var(--mini-surface-1)",
            borderColor: "var(--mini-divider)",
          };
  const iconStyle =
    av === "completed"
      ? { background: "var(--mini-sage-soft)", color: "var(--mini-sage)" }
      : av === "mine"
        ? { background: "var(--mini-lime)", color: "var(--mini-primary-contrast)" }
        : av === "taken"
          ? { background: "var(--mini-surface-2)", color: "var(--mini-text-faint)" }
          : { background: "var(--mini-lime-soft)", color: "var(--mini-lime)" };
  return (
    <div
      className={[
        "flex items-start gap-3 rounded-2xl border p-3.5 transition-colors",
        av === "taken" ? "opacity-70" : "",
      ].join(" ")}
      style={rowStyle}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-xl"
        style={iconStyle}
      >
        {av === "completed" ? (
          <CheckCircle2 className="size-5" />
        ) : av === "mine" ? (
          <UserCheck className="size-5" />
        ) : av === "taken" ? (
          <Lock className="size-5" />
        ) : (
          <Sparkles className="size-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="text-[15px] font-medium"
          style={{ color: "var(--mini-text)" }}
        >
          {scope.scopeLabel}
        </div>
        {scope.sublabel ? (
          <div
            className="mt-0.5 text-[12px]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {scope.sublabel}
          </div>
        ) : null}
        {scope.claimUserName ? (
          <div
            className="mt-1 flex items-center gap-1 text-[11px]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            <Clock className="size-3" />
            {av === "completed" ? "Готово · " : av === "mine" ? "Я · " : "Занято · "}
            <span>{scope.claimUserName}</span>
          </div>
        ) : null}
      </div>
      <div className="shrink-0">
        {av === "available" ? (
          <button
            type="button"
            // Кнопка под замком остаётся нажимаемой намеренно: на
            // телефоне подсказку из `title` не увидеть, а disabled-кнопка
            // молчит. Тап объясняет причину тостом, брать задачу при
            // этом по-прежнему нельзя.
            onClick={() => {
              if (locked) {
                toast.info("Сначала завершите текущую задачу");
                return;
              }
              onClaim();
            }}
            disabled={busy || disabled}
            title={locked ? "Сначала завершите текущую задачу" : undefined}
            className={[
              "mini-press inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium",
              disabled && !busy ? "opacity-50" : "",
            ].join(" ")}
            style={
              locked
                ? {
                    background: "var(--mini-surface-2)",
                    borderColor: "var(--mini-divider)",
                    color: "var(--mini-text-faint)",
                  }
                : {
                    background: "var(--mini-lime)",
                    borderColor: "transparent",
                    color: "var(--mini-primary-contrast)",
                  }
            }
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {locked ? <Lock className="size-3.5" /> : null}
            Взять
          </button>
        ) : null}
        {av === "mine" ? (
          <button
            type="button"
            onClick={onComplete}
            disabled={busy || disabled}
            className={[
              "mini-press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium",
              disabled && !busy ? "opacity-50" : "",
            ].join(" ")}
            style={{
              background: "var(--mini-sage)",
              color: "var(--mini-primary-contrast)",
            }}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Завершить
          </button>
        ) : null}
      </div>
    </div>
  );
}

