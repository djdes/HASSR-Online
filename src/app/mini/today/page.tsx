"use client";

import Link from "next/link";

import { useRegisterRefresh } from "../_components/refresh-provider";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
// NOTE: терминология «задачи / Сегодня» — нейтральная, мини-апп
// никогда не показывает слово «журнал». Сотрудник просто видит
// чек-лист задач смены. Под капотом это journal-task-claim.

type ShiftGate = {
  gateRequired: boolean;
  shiftStarted: boolean;
  today: string;
  preset: string;
};
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Play,
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
  const [gate, setGate] = useState<ShiftGate | null>(null);
  const [startingShift, setStartingShift] = useState(false);
  // Без этого любой сбой запроса оставлял экран с вечным «крутилкой»:
  // data/gate так и не появлялись, а причина нигде не показывалась.
  const [loadError, setLoadError] = useState<string | null>(null);
  // mounted-флаг защищает от setState'ов после unmount'а — раньше
  // быстрое переключение страниц давало "Cannot update unmounted
  // component" warning + утечка. См. pass-3 review HIGH #6.
  const mountedRef = useRef(true);

  async function loadGate() {
    try {
      const res = await fetch("/api/mini/start-shift", { cache: "no-store" });
      if (!res.ok) {
        if (mountedRef.current) setLoadError(await readError(res));
        return;
      }
      const payload = (await res.json()) as ShiftGate;
      if (mountedRef.current) {
        setGate(payload);
        setLoadError(null);
      }
    } catch {
      if (mountedRef.current) setLoadError("Нет связи — потяните вниз, чтобы обновить");
    }
  }

  async function load() {
    try {
      const res = await fetch("/api/mini/today", { cache: "no-store" });
      if (!res.ok) {
        if (mountedRef.current) setLoadError(await readError(res));
        return;
      }
      const payload = (await res.json()) as Payload;
      if (mountedRef.current) {
        setData(payload);
        setLoadError(null);
      }
    } catch {
      if (mountedRef.current) setLoadError("Нет связи — потяните вниз, чтобы обновить");
    }
  }

  async function startShift() {
    setStartingShift(true);
    try {
      const res = await fetch("/api/mini/start-shift", { method: "POST" });
      if (res.ok) {
        await loadGate();
        await load();
      } else {
        // Молчаливый отказ выглядел как «кнопка не работает».
        toast.error(await readError(res));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось начать смену"
      );
    } finally {
      if (mountedRef.current) setStartingShift(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      await loadGate();
      // Не загружаем задачи пока gate не пройден — иначе сотрудник
      // мельком увидит список до того как нажал «Начать смену».
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (gate && (!gate.gateRequired || gate.shiftStarted)) {
      void load();
    }
  }, [gate]);

  // Потянули вниз — и состояние смены, и список задач: смену
  // могли открыть с другого телефона, и один список без гейта остался
  // бы запертым.
  useRegisterRefresh(async () => {
    await loadGate();
    await load();
  });

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
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const msg =
        res.status === 409
          ? body.error || "Эту задачу уже забрали — обновите страницу"
          : res.status === 403
            ? "Нет прав на эту задачу"
            : body.error || `Не удалось взять (HTTP ${res.status})`;
      toast.error(msg);
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
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || `Не удалось завершить (HTTP ${res.status})`);
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

  // Shift gate: для линейного персонала без активной смены —
  // показываем ОДНУ кнопку «Начать смену» и ничего больше. Это
  // делает обязательной отметку начала рабочего дня — заведующая
  // на Контрольной доске видит кто реально вышел на работу.
  if (gate && gate.gateRequired && !gate.shiftStarted) {
    return (
      <div className="space-y-4 pb-24">
        <Link
          href="/mini"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#6f7282]"
        >
          <ArrowLeft className="size-4" />
          Главная
        </Link>
        <div className="rounded-3xl border border-[#ececf4] bg-[#0b1024] p-8 text-center text-white">
          <div className="text-[12px] uppercase tracking-[0.16em] text-white/60">
            {new Date(gate.today).toLocaleDateString("ru-RU", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          <div className="mt-2 text-[24px] font-semibold leading-tight">
            Готов к работе?
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-white/70">
            Нажми «Начать смену» чтобы получить задачи на сегодня.
            Руководитель увидит, что ты вышел на работу.
          </p>
          <button
            type="button"
            onClick={startShift}
            disabled={startingShift}
            className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[16px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.7)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
          >
            {startingShift ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Play className="size-5 fill-current" />
            )}
            Начать смену
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    if (loadError) {
      return (
        <div className="space-y-3 pb-24">
          <div
            className="rounded-2xl px-4 py-5 text-center text-[14px] leading-relaxed"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px solid var(--mini-divider-strong)",
              color: "var(--mini-text)",
            }}
          >
            {loadError}
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                void loadGate().then(() => load());
              }}
              className="mini-press mt-4 inline-flex h-11 items-center justify-center rounded-2xl px-5 text-[14px] font-semibold"
              style={{
                background: "var(--mini-lime)",
                color: "var(--mini-primary-contrast)",
              }}
            >
              Попробовать ещё раз
            </button>
          </div>
        </div>
      );
    }
    return (
      <div
        className="flex h-40 items-center justify-center"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <Loader2 className="size-5 animate-spin" />
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
      <Link
        href="/mini"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#6f7282]"
      >
        <ArrowLeft className="size-4" />
        Главная
      </Link>

      <header className="rounded-3xl border border-[#ececf4] bg-[#0b1024] p-6 text-white">
        <div className="text-[12px] uppercase tracking-[0.16em] text-white/60">
          {new Date(data.dateKey).toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
        <div className="mt-2 text-[24px] font-semibold leading-tight">
          Сегодня
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <span className="rounded-full bg-white/10 px-2.5 py-1">
            Доступно: {totalAvailable}
          </span>
          {totalMine > 0 ? (
            <span className="rounded-full bg-[#5566f6] px-2.5 py-1">
              У меня: {totalMine}
            </span>
          ) : null}
          <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-emerald-100">
            Готово: {totalDone}
          </span>
        </div>
      </header>

      {data.myActive ? (
        <div className="rounded-2xl border border-[#5566f6] bg-[#eef1ff] p-3 text-[13px] text-[#3848c7]">
          <Lock className="mr-1.5 inline size-4 align-text-bottom" />
          Сейчас делаешь:&nbsp;
          <span className="font-semibold">{data.myActive.scopeLabel}</span>
          &nbsp;— закончи эту, тогда сможешь взять следующую.
        </div>
      ) : null}

      {data.groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[14px] text-[#6f7282]">
          На сегодня задач пока нет.
          <br />
          Подойди к руководителю — спроси, что нужно сделать.
        </div>
      ) : null}

      {data.groups.map((g) => (
        <section key={g.code} className="space-y-2">
          <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
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
  return (
    <div
      className={[
        "flex items-start gap-3 rounded-2xl border p-3.5 transition-colors",
        av === "completed"
          ? "border-[#c8f0d5] bg-[#ecfdf5]"
          : av === "mine"
            ? "border-[#5566f6] bg-[#eef1ff]"
            : av === "taken"
              ? "border-[#ececf4] bg-[#fafbff] opacity-70"
              : "border-[#ececf4] bg-white",
      ].join(" ")}
    >
      <span
        className={[
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          av === "completed"
            ? "bg-[#d9f4e1] text-[#136b2a]"
            : av === "mine"
              ? "bg-[#5566f6] text-white"
              : av === "taken"
                ? "bg-[#ececf4] text-[#9b9fb3]"
                : "bg-[#eef1ff] text-[#3848c7]",
        ].join(" ")}
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
        <div className="text-[15px] font-medium text-[#0b1024]">
          {scope.scopeLabel}
        </div>
        {scope.sublabel ? (
          <div className="mt-0.5 text-[12px] text-[#6f7282]">{scope.sublabel}</div>
        ) : null}
        {scope.claimUserName ? (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-[#6f7282]">
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
            onClick={onClaim}
            disabled={busy || locked || disabled}
            title={locked ? "Сначала заверши текущую" : undefined}
            className={[
              "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium",
              locked
                ? "border border-[#ececf4] bg-[#fafbff] text-[#9b9fb3]"
                : "bg-[#5566f6] text-white shadow-[0_8px_20px_-10px_rgba(85,102,246,0.6)]",
              disabled && !busy ? "opacity-50" : "",
            ].join(" ")}
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
              "inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#136b2a] px-3 text-[13px] font-medium text-white",
              disabled && !busy ? "opacity-50" : "",
            ].join(" ")}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Завершить
          </button>
        ) : null}
      </div>
    </div>
  );
}
