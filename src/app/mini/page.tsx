"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { toast } from "sonner";
import { adoptCookieSession } from "./_lib/cookie-session";
import { useLiveRefetch } from "@/lib/use-live-refetch";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  MapPin,
  Play,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { sanitizeMiniAppRedirectPath } from "@/lib/journal-obligation-links";
import {
  clearSnapshot,
  isSnapshotUsable,
  readSnapshot,
  snapshotAgeLabel,
  writeSnapshot,
} from "./_lib/snapshot-cache";
import { InstallPrompt } from "./_components/install-prompt";
import { JournalActionsSheet } from "./_components/journal-actions-sheet";
import { MiniCard } from "./_components/mini-card";
import { MiniBonusCard } from "./_components/mini-bonus-card";
import { getTelegramWebApp } from "./_components/telegram-web-app";
import {
  telegramSignInProblemFromMessage,
  type TelegramSignInProblem,
} from "@/lib/telegram-auth-messages";
import { QrScannerButton } from "./_components/qr-scanner";
import { GeoReminder } from "./_components/geo-reminder";
import { MiniHomeSkeleton } from "./_components/mini-home-skeleton";
import { useRegisterRefresh } from "./_components/refresh-provider";
import { MyShiftButton } from "./_components/my-shift-button";

type LocalState =
  | { kind: "init" }
  | {
      kind: "error";
      message: string;
      /** Отказ Telegram: повтор не поможет, нужно переоткрыть из бота. */
      problem?: TelegramSignInProblem | null;
    };

type HomeUser = {
  name: string;
  organizationName: string;
};

type AreaLoc = { id: string; name: string; lat: number; lng: number };

/** Точка (здание), в которой человек сейчас работает; см. /api/mini/home. */
type HomeLocation = {
  activeBuilding: { id: string; name: string } | null;
  canSwitch: boolean;
};

type HomeJournal = {
  code: string;
  name: string;
  description: string | null;
  filled: boolean;
};

type StaffHomeData = {
  mode: "staff";
  user: HomeUser;
  permissions: string[];
  areas: AreaLoc[];
  location?: HomeLocation;
  now: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    href: string;
    /** Точка обязательства — подпись карточки в сети точек. */
    buildingName?: string | null;
    bonusAmountKopecks?: number;
    claimedById?: string | null;
    claimedByName?: string | null;
    claimedAt?: string | null;
  }>;
  all: HomeJournal[];
};

type ManagerHomeData = {
  mode: "manager";
  user: HomeUser;
  permissions: string[];
  summary: {
    total: number;
    pending: number;
    done: number;
    employeesWithPending: number;
  };
  areas: AreaLoc[];
  location?: HomeLocation;
  all: HomeJournal[];
};

type ReadonlyHomeData = {
  mode: "readonly";
  user: HomeUser;
  permissions: string[];
  areas: AreaLoc[];
  location?: HomeLocation;
  all: HomeJournal[];
};

type HomeData = StaffHomeData | ManagerHomeData | ReadonlyHomeData;

export default function MiniHomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localState, setLocalState] = useState<LocalState>({ kind: "init" });
  const [home, setHome] = useState<HomeData | null>(null);
  const [shiftGate, setShiftGate] = useState<{
    gateRequired: boolean;
    shiftStarted: boolean;
    today: string;
  } | null>(null);
  const [startingShift, setStartingShift] = useState(false);
  // Журнал, у которого открыт лист быстрых действий (долгое нажатие).
  const [journalActions, setJournalActions] = useState<{
    code: string;
    name: string;
  } | null>(null);
  // Снимок прошлого ответа: в подвале с одной палкой главная идёт
  // секунды, и всё это время виден только скелетон. Пометка
  // «данные на 08:12» обязательна: без неё старый список выдаётся
  // за сегодняшний.
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const signInStarted = useRef(false);
  const fetchStarted = useRef(false);
  const redirectStarted = useRef(false);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const nextPath = (() => {
    const target = sanitizeMiniAppRedirectPath(searchParams.get("next") ?? "");
    return target === "/mini" ? null : target;
  })();

  useEffect(() => {
    if (status !== "unauthenticated" || signInStarted.current) return;

    const webApp = getTelegramWebApp();
    if (!webApp || !webApp.initData) {
      // Вне Telegram раньше был глухой экран «Откройте внутри
      // Telegram». Теперь ведём на вход по телефону и паролю: кабинет
      // должен открываться обычной вкладкой браузера и, дальше, как
      // установленное приложение. Telegram-вход остаётся основным для
      // тех, кто уже привязан, — эта ветка его не трогает.
      signInStarted.current = true;
      const back = window.location.pathname + window.location.search;
      const loginUrl = `/mini/login?next=${encodeURIComponent(back)}`;
      // Кука уже может быть — вход по телефону, установленное приложение.
      // Провайдер сам её не подхватит (см. _lib/cookie-session.ts):
      // спрашиваем, и без сессии ведём на вход. Страховка на 4 с — если
      // провайдер не перечитал, лучше форма входа, чем вечный скелет.
      void (async () => {
        const adopted = await adoptCookieSession();
        if (!adopted) {
          router.replace(loginUrl);
          return;
        }
        window.setTimeout(() => {
          if (statusRef.current !== "authenticated") router.replace(loginUrl);
        }, 4000);
      })();
      return;
    }
    try {
      webApp.ready();
      webApp.expand();
    } catch {
      /* older TG clients don't expose every method */
    }
    signInStarted.current = true;
    void (async () => {
      // Race с таймаутом 12s — на тонком cellular из подвала кухни
      // signIn может зависнуть навсегда. Пользователю нужен явный
      // error-state с кнопкой «Повторить» вместо вечного skeleton'а.
      const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
        setTimeout(() => resolve({ timeout: true }), 12000)
      );
      const signInPromise = signIn("telegram", {
        initData: webApp.initData,
        redirect: false,
      });
      const result = await Promise.race([
        signInPromise.then((r) => ({ timeout: false as const, r })),
        timeoutPromise,
      ]);
      if ("timeout" in result && result.timeout) {
        setLocalState({
          kind: "error",
          message: "Telegram отвечает медленно. Проверьте подключение.",
        });
        return;
      }
      const r = "r" in result ? result.r : null;
      if (!r || r.error) {
        const message = r?.error || "Сессия Telegram не получена";
        setLocalState({
          kind: "error",
          message,
          problem: telegramSignInProblemFromMessage(message),
        });
      }
    })();
  }, [router, status]);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      !nextPath ||
      redirectStarted.current
    ) {
      return;
    }

    redirectStarted.current = true;
    router.replace(nextPath);
  }, [nextPath, router, status]);

  // Вынесли в useCallback, чтобы тот же путь использовался и для
  // первоначальной загрузки, и для pull-to-refresh — без дублирования
  // обработки ошибок и без копирования URL.
  const fetchHome = useCallback(async () => {
    try {
      const [shiftResp, homeResp] = await Promise.all([
        fetch("/api/mini/start-shift", { cache: "no-store" }),
        fetch("/api/mini/home", { cache: "no-store" }),
      ]);
      if (shiftResp.ok) {
        const shift = (await shiftResp.json()) as {
          gateRequired: boolean;
          shiftStarted: boolean;
          today: string;
        };
        setShiftGate(shift);
      }
      if (!homeResp.ok) {
        const body = (await homeResp.json().catch(() => ({ error: "" }))) as {
          error?: string;
        };
        throw new Error(body.error || `HTTP ${homeResp.status}`);
      }
      const data = (await homeResp.json()) as HomeData;
      setHome(data);
      setSnapshotAt(null);
      writeSnapshot(data, {
        userId: session?.user?.id ?? null,
        organizationId: session?.user?.organizationId ?? null,
      });
      // На успешном refetch сбрасываем error-state — пользователь
      // вытянул вниз, мы заново вошли в norma flow.
      setLocalState((prev) => (prev.kind === "error" ? { kind: "init" } : prev));
    } catch (err) {
      setLocalState({
        kind: "error",
        message: err instanceof Error ? err.message : "Не удалось загрузить данные",
      });
    }
  }, [session?.user?.id, session?.user?.organizationId]);

  // Снимок показываем до первого же ответа сервера и только свой:
  // владелец и организация записаны внутри снимка и сверяются.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (home) return;
    const scope = {
      userId: session?.user?.id ?? null,
      organizationId: session?.user?.organizationId ?? null,
    };
    const snapshot = readSnapshot<HomeData>();
    if (!isSnapshotUsable(snapshot, scope, Date.now())) {
      // Чужой или протухший — убираем, чтобы не лежал до следующего раза.
      if (snapshot) clearSnapshot();
      return;
    }
    setHome(snapshot!.data);
    setSnapshotAt(snapshot!.savedAt);
  }, [status, home, session?.user?.id, session?.user?.organizationId]);

  // Коллега отметился с другого телефона, руководитель закрыл день —
  // главная обновляется сама, без «потяните вниз». Поток открываем
  // только после входа: без сессии /api/live отвечает 401.
  useLiveRefetch(() => void fetchHome(), { enabled: status === "authenticated" });
  // Потянули вниз — перечитываем главную, а не всю страницу.
  useRegisterRefresh(fetchHome);

  const startShift = useCallback(async () => {
    setStartingShift(true);
    try {
      const res = await fetch("/api/mini/start-shift", { method: "POST" });
      if (res.ok) {
        await fetchHome();
        return;
      }
      // Молчаливый отказ выглядел как «кнопка не работает»: человек жал
      // ещё и ещё, экран не менялся и ничего не объяснял.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(
        body.error ||
          (res.status === 401
            ? "Вход закончился — войдите заново"
            : "Не удалось начать смену. Попробуйте ещё раз.")
      );
    } catch {
      toast.error("Нет связи. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setStartingShift(false);
    }
  }, [fetchHome]);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      fetchStarted.current ||
      nextPath
    ) {
      return;
    }

    fetchStarted.current = true;
    void (async () => {
      try {
        await fetchHome();
      } catch {
        /* errors уже разложены в setLocalState */
      }
    })();
  }, [fetchHome, nextPath, status]);

  if (localState.kind === "error") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <section
          className="w-full rounded-3xl px-6 py-8 text-center"
          style={{
            background: "var(--mini-crimson-soft)",
            border: "1px solid var(--mini-divider-strong)",
          }}
        >
          <ShieldAlert
            className="mx-auto size-9"
            style={{ color: "var(--mini-crimson)" }}
          />
          <h1 className="mini-display-bold mt-4" style={{ fontSize: 22 }}>
            Не получилось войти
          </h1>
          <p
            className="mt-2 text-[14px] leading-6"
            style={{ color: "var(--mini-crimson)" }}
          >
            {localState.message}
          </p>
          {/* Когда Telegram отказал в подписи (устарела или не сошлась),
              повтор не поможет никогда: те же данные отправятся снова.
              Единственный выход — закрыть приложение и открыть его из
              бота, чтобы Telegram выдал свежую подпись. Поэтому здесь
              вместо «Попробовать ещё раз» — «Закрыть приложение». */}
          {localState.problem ? (
            <button
              type="button"
              onClick={() => {
                try {
                  getTelegramWebApp()?.close?.();
                } catch {
                  /* старый клиент — кнопка просто ничего не сделает */
                }
              }}
              className="mini-press mt-5 inline-flex h-10 items-center gap-2 rounded-2xl px-5 text-[14px] font-medium"
              style={{
                background: "var(--mini-surface-2)",
                border: "1px solid var(--mini-divider-strong)",
                color: "var(--mini-text)",
              }}
            >
              Закрыть приложение
            </button>
          ) : (
            /* Retry-кнопка: signInStarted был установлен в true и без
               сброса повторный signIn никогда не запустится. Сбрасываем
               guard-флаги и переводим state в init — useEffect status-edge
               переподнимет signIn при `unauthenticated`.
               Для уже вошедшего сброс флагов ничего не запускал (зависимости
               эффекта не менялись) — экран навсегда оставался скелетоном,
               поэтому здесь перезапрашиваем главную сами. */
            <button
              type="button"
              onClick={() => {
                signInStarted.current = false;
                fetchStarted.current = false;
                setLocalState({ kind: "init" });
                setHome(null);
                if (statusRef.current === "authenticated") {
                  fetchStarted.current = true;
                  void fetchHome();
                }
              }}
              className="mini-press mt-5 inline-flex h-10 items-center gap-2 rounded-2xl px-5 text-[14px] font-medium"
              style={{
                background: "var(--mini-surface-2)",
                border: "1px solid var(--mini-divider-strong)",
                color: "var(--mini-text)",
              }}
            >
              Попробовать ещё раз
            </button>
          )}
          {/* Второй выход из этого экрана. Ошибка «аккаунт не связан с
              Telegram» тоже была тупиком: повторять вход бессмысленно,
              пока руководитель не привяжет аккаунт. Телефон и пароль
              работают независимо от привязки. */}
          <div className="mt-3">
            <Link
              href="/mini/login"
              className="text-[14px] underline"
              style={{ color: "var(--mini-text-muted)" }}
            >
              Войти по телефону
            </Link>
          </div>
        </section>
      </div>
    );
  }
  // Аутентифицированному, но без payload — показываем skeleton-каркас.
  // Эффективнее на восприятие чем спиннер: мерцание из 3-4 «карточек»
  // создаёт иллюзию того что страница уже здесь и просто доукомплектуется,
  // а не «зависла на белом экране».
  if (status === "authenticated" && !home) {
    return <MiniHomeSkeleton />;
  }
  if (status !== "authenticated" || !home) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-[14px]"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <Loader2
          className="mr-2 size-4 animate-spin"
          style={{ color: "var(--mini-lime)" }}
        />
        Загружаем кабинет…
      </div>
    );
  }

  // Shift gate: для линейного персонала (gateRequired=true), пока
  // нет WorkShift на сегодня — показываем ОДНУ кнопку «Начать смену»
  // и НИЧЕГО больше. Каждый новый день эта проверка повторяется
  // потому что WorkShift unique по (userId, date).
  if (shiftGate?.gateRequired && !shiftGate.shiftStarted) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-12">
        {/* Переменных --mini-card / --mini-border в теме нет: карточка
            оставалась без фона, а рамка бралась из цвета текста. */}
        <div
          className="rounded-3xl border p-8 text-center"
          style={{
            background: "var(--mini-surface-1)",
            borderColor: "var(--mini-divider-strong)",
          }}
        >
          <div
            className="mini-eyebrow"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {new Date(shiftGate.today).toLocaleDateString("ru-RU", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          <div
            className="mini-display mt-3"
            style={{
              fontSize: "32px",
              color: "var(--mini-text)",
            }}
          >
            Готов к работе?
          </div>
          <p
            className="mt-3 text-[14px] leading-relaxed"
            style={{ color: "var(--mini-text-muted)" }}
          >
            Нажмите «Начать смену», чтобы получить задачи на сегодня.
            Руководитель увидит, что вы вышли на работу.
          </p>
          <button
            type="button"
            onClick={startShift}
            disabled={startingShift}
            className="mini-press mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-6 text-[16px] font-semibold disabled:opacity-60"
            // --mini-text-on-lime не существует: подпись наследовала цвет
            // текста и читалась белым по салатовому.
            style={{
              background: "var(--mini-lime)",
              color: "var(--mini-primary-contrast)",
            }}
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

  const displayName = session?.user?.name ?? home.user.name;
  const perms = new Set(home.permissions);
  const showStaffNow = home.mode === "staff" && home.now.length > 0;
  // Различаем «всё на сегодня закрыто» (Done!) и «новому сотруднику
  // не назначено ничего» (No-assignments). Раньше оба случая показывали
  // «Все задачи выполнены» — что demoralizing для новичка с нулём
  // assignments.
  const showStaffNoAssignments =
    home.mode === "staff" && home.now.length === 0 && home.all.length === 0;
  const showStaffDoneBanner =
    home.mode === "staff" && home.now.length === 0 && home.all.length > 0;
  const isReadonly = home.mode === "readonly";

  const greeting = timeGreeting();
  const total = home.all.length;
  const filled = home.all.filter((j) => j.filled).length;
  const completion = total === 0 ? 0 : Math.round((filled / total) * 100);

  return (
    <div className="flex flex-1 flex-col gap-5 pb-28">
      {/* Editorial hero — «Сегодня» + progress ring */}
      <header className="mini-reveal relative">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mini-eyebrow">
              {greeting} · {formatDateRu()}
            </div>
            {/* Честная пометка возраста: без неё вчерашний список
                задач неотличим от сегодняшнего. */}
            {snapshotAt !== null ? (
              <div
                className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px]"
                style={{
                  background: "var(--mini-amber-soft)",
                  color: "var(--mini-amber)",
                }}
              >
                <Loader2 className="size-3 animate-spin" />
                {snapshotAgeLabel(snapshotAt, Date.now())} · обновляем
              </div>
            ) : null}
            <h1
              className="mini-display mt-2 line-clamp-2"
              // Длинное имя одним словом («Константинопольский») в 42px
              // не переносилось: вылезало за экран и уезжало под кнопку
              // «Сканировать QR». Длинным — кегль меньше и перенос где угодно.
              style={{
                fontSize: firstName(displayName).length > 9 ? "30px" : "42px",
                overflowWrap: "anywhere",
                color: "var(--mini-text)",
              }}
            >
              {firstName(displayName)}
              <span
                style={{
                  color: "var(--mini-lime)",
                  fontStyle: "italic",
                  fontWeight: 400,
                }}
              >
                ,
              </span>
            </h1>
            {home.user.organizationName || home.location?.activeBuilding ? (
              <p
                className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[13px]"
                style={{ color: "var(--mini-text-muted)" }}
              >
                {home.user.organizationName ? (
                  <span className="truncate">{home.user.organizationName}</span>
                ) : null}
                {/* Точка: чип ведёт в профиль, где её можно сменить. */}
                {home.location?.activeBuilding ? (
                  <Link
                    href="/mini/me"
                    aria-label={`Точка: ${home.location.activeBuilding.name}. Сменить`}
                    className="inline-flex max-w-[45%] shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium"
                    style={{
                      background: "var(--mini-accent-soft, rgba(85,102,246,0.12))",
                      color: "var(--mini-accent, #5566f6)",
                    }}
                  >
                    <MapPin className="size-3 shrink-0" />
                    <span className="truncate">{home.location.activeBuilding.name}</span>
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
          <QrScannerButton />
        </div>

        {/* Three-stat strip + progress ring */}
        <div className="mt-5 grid grid-cols-[1fr_auto] gap-4 items-center">
          <div className="space-y-3">
            {home.mode === "manager" ? (
              <>
                <HeroStat
                  value={home.summary.pending}
                  label="открытых задач"
                  tone={home.summary.pending > 0 ? "amber" : "sage"}
                />
                <HeroStat
                  value={home.summary.employeesWithPending}
                  label={pluralRu(
                    home.summary.employeesWithPending,
                    "сотрудник ждёт",
                    "сотрудника ждут",
                    "сотрудников ждут"
                  )}
                  tone="ice"
                />
              </>
            ) : (
              <>
                <HeroStat
                  value={home.mode === "staff" ? home.now.length : filled}
                  label={
                    home.mode === "staff"
                      ? pluralRu(
                          home.now.length,
                          "задача в работе",
                          "задачи в работе",
                          "задач в работе"
                        )
                      : pluralRu(filled, "выполнена сегодня", "выполнено сегодня", "выполнено сегодня")
                  }
                  tone={
                    home.mode === "staff" && home.now.length > 0 ? "amber" : "lime"
                  }
                />
                <HeroStat
                  value={total}
                  label={pluralRu(total, "задача всего", "задачи всего", "задач всего")}
                  tone="neutral"
                />
              </>
            )}
          </div>
          <ProgressRing percent={completion} />
        </div>
      </header>

      {home.areas && home.areas.length > 0 ? (
        <GeoReminder areas={home.areas} />
      ) : null}

      {/* Показывается само и только когда уместно: iPhone, не Telegram,
          не установлено, после второй записи и не чаще раза в месяц. */}
      <InstallPrompt />

      {/* «Я вышел / закончил смену» — self-service для линейного
          сотрудника. Manager-режим тоже видит кнопку: иногда
          руководитель сам подменяет смену, и ему нужно открыть/закрыть. */}
      {!isReadonly ? <MyShiftButton /> : null}

      {isReadonly ? (
        <section
          className="rounded-2xl px-4 py-3 text-[13px] leading-5"
          style={{
            background: "var(--mini-amber-soft)",
            border: "1px solid rgba(255,144,64,0.22)",
            color: "var(--mini-amber)",
          }}
        >
          Режим просмотра — выполнять задачи нельзя, только листать.
        </section>
      ) : null}

      {showStaffNow ? (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="mini-eyebrow">На сейчас</h2>
            <span
              className="mini-mono"
              style={{
                fontSize: 11,
                color: "var(--mini-amber)",
                letterSpacing: "0.08em",
              }}
            >
              {home.now.length}{" "}
              {pluralRu(home.now.length, "задача ждёт", "задачи ждут", "задач ждёт")}
            </span>
          </div>
          {home.now.map((item, idx) => {
            const isPremium = (item.bonusAmountKopecks ?? 0) > 0;
            return (
              <div
                key={item.id}
                className="mini-reveal"
                style={{ animationDelay: `${idx * 40}ms` }}
              >
                {isPremium ? (
                  <MiniBonusCard
                    obligationId={item.id}
                    title={item.name}
                    subtitle={
                      item.buildingName
                        ? [item.buildingName, item.description].filter(Boolean).join(" · ")
                        : item.description
                    }
                    bonusAmountKopecks={item.bonusAmountKopecks ?? 0}
                    initialClaimedByName={item.claimedByName ?? null}
                    initialClaimedAt={item.claimedAt ?? null}
                    index={idx + 1}
                  />
                ) : (
                  <MiniCard
                    href={item.href}
                    title={item.name}
                    subtitle={
                      item.buildingName
                        ? [item.buildingName, item.description].filter(Boolean).join(" · ")
                        : item.description
                    }
                    status={{ kind: "todo", label: "нужно заполнить" }}
                    index={idx + 1}
                  />
                )}
              </div>
            );
          })}
        </section>
      ) : null}

      {showStaffDoneBanner ? (
        <section
          className="flex items-center gap-3 rounded-2xl px-4 py-4 text-[14px] leading-5"
          style={{
            background: "var(--mini-lime-soft)",
            border: "1px solid rgba(200,255,90,0.26)",
            color: "var(--mini-lime)",
          }}
        >
          <CheckCircle2 className="size-5 shrink-0" strokeWidth={2} />
          <span style={{ color: "var(--mini-text)" }}>
            Смена закрыта. Все задачи на сегодня выполнены.
          </span>
        </section>
      ) : null}

      {showStaffNoAssignments ? (
        <section
          className="rounded-2xl px-5 py-6 text-center"
          style={{
            background: "var(--mini-surface-1)",
            border: "1px dashed var(--mini-divider-strong)",
          }}
        >
          <div
            className="mini-display-bold"
            style={{ fontSize: 18, color: "var(--mini-text)" }}
          >
            Пока нет назначенных задач
          </div>
          <p
            className="mt-2 text-[14px] leading-relaxed"
            style={{ color: "var(--mini-text-muted)" }}
          >
            Руководитель ещё не дал доступ к журналам. Напишите ему — он
            подключит вас к нужным задачам в один клик.
          </p>
        </section>
      ) : null}

      {home.mode === "manager" ? (
        <section className="mini-card px-4 py-4">
          <div className="flex items-baseline justify-between">
            <h2 className="mini-eyebrow">Сводка смены</h2>
            <span
              className="mini-mono"
              style={{ fontSize: 11, color: "var(--mini-text-faint)" }}
            >
              {formatDateRu()}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <ManagerStat
              value={home.summary.pending}
              label="открыто"
              tone={home.summary.pending > 0 ? "amber" : "sage"}
            />
            <ManagerStat
              value={home.summary.done}
              label="выполнено"
              tone="lime"
            />
            <ManagerStat
              value={home.summary.employeesWithPending}
              label="с задачами"
              tone="ice"
            />
          </div>
          <div className="mini-dotted-sep mt-4 pt-3 flex flex-wrap gap-2">
            {perms.has("staff.view") ? (
              <Link href="/mini/staff" className="mini-btn-ghost">
                → Сотрудники
              </Link>
            ) : null}
            {perms.has("equipment.view") ? (
              <Link href="/mini/equipment" className="mini-btn-ghost">
                → Оборудование
              </Link>
            ) : null}
            {perms.has("reports.view") ? (
              <Link href="/mini/reports" className="mini-btn-ghost">
                → Отчёты
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {!isReadonly ? (
        <Link
          href="/mini/today"
          className="mini-reveal flex items-center gap-3 rounded-3xl border px-4 py-3.5"
          style={{
            background: "var(--mini-surface-1)",
            borderColor: "var(--mini-divider)",
          }}
        >
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "var(--mini-lime)",
              color: "var(--mini-primary-contrast)",
            }}
          >
            <Zap className="size-5 fill-current" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold" style={{ color: "var(--mini-text)" }}>
              Сегодня — все задачи
            </div>
            <div className="text-[12px]" style={{ color: "var(--mini-text-muted)" }}>
              Кто первый нажал — тот и делает
            </div>
          </div>
          <span style={{ color: "var(--mini-text-faint)" }}>→</span>
        </Link>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="mini-eyebrow">
            {isReadonly ? "Доступно" : "Все мои задачи"}
          </h2>
          <span
            className="mini-mono"
            style={{
              fontSize: 11,
              color: "var(--mini-text-faint)",
              letterSpacing: "0.08em",
            }}
          >
            всего {home.all.length}
          </span>
        </div>
        {home.all.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-7 text-center text-[14px] leading-5"
            style={{
              background: "rgba(250,247,242,0.02)",
              border: "1px dashed var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            Руководитель ещё не дал доступ ни к одной задаче.
          </div>
        ) : (
          home.all.map((journal, idx) => (
            <div
              key={journal.code}
              className="mini-reveal"
              style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
            >
              <MiniCard
                href={`/mini/journals/${journal.code}`}
                // Удержание — быстрые действия прямо с главной: «как вчера»
                // делается каждую смену, а стоит трёх касаний и двух переходов.
                onLongPress={() =>
                  setJournalActions({ code: journal.code, name: journal.name })
                }
                title={journal.name}
                subtitle={journal.description}
                status={
                  journal.filled
                    ? { kind: "done", label: "заполнено" }
                    : { kind: "idle", label: "—" }
                }
                index={idx + 1}
                // Top 5 cards в полном списке prefetch'нем eager —
                // дальше viewport-based hover prefetch (default Link
                // behavior). На cellular грузить 30+ targets eager
                // = лишние ~150KB.
                prefetch={idx < 5}
              />
            </div>
          ))
        )}
      </section>

      <JournalActionsSheet
        journal={journalActions}
        onClose={() => setJournalActions(null)}
      />
    </div>
  );
}

function ManagerStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "lime" | "amber" | "ice" | "sage";
}) {
  const color =
    tone === "lime"
      ? "var(--mini-lime)"
      : tone === "amber"
        ? "var(--mini-amber)"
        : tone === "ice"
          ? "var(--mini-ice)"
          : "var(--mini-sage)";
  return (
    <div>
      <div
        className="mini-mono tabular-nums"
        style={{
          fontSize: 28,
          fontWeight: 500,
          color,
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--mini-text-muted)",
          marginTop: 4,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: "var(--mini-font-mono)",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* ---------------- helpers / hero sub-components ------------------ */

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 18) return "Добрый день";
  if (h >= 18 && h < 23) return "Добрый вечер";
  return "Ночная смена";
}

function formatDateRu(): string {
  return new Date()
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
    .toUpperCase();
}

function firstName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return parts[1];
  if (parts.length >= 2) return parts[1];
  // Мгновенная регистрация кладёт в имя почту. Приветствие «ivan@mail.ru,»
  // в заголовке не помещается и выглядит ошибкой — берём часть до «@».
  const single = parts[0] ?? "Смена";
  return single.includes("@") ? single.split("@")[0] || "Смена" : single;
}

function pluralRu(
  n: number,
  one: string,
  few: string,
  many: string
): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return few;
  return many;
}

function HeroStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "lime" | "amber" | "ice" | "crimson" | "sage" | "neutral";
}) {
  const color =
    tone === "lime"
      ? "var(--mini-lime)"
      : tone === "amber"
        ? "var(--mini-amber)"
        : tone === "ice"
          ? "var(--mini-ice)"
          : tone === "crimson"
            ? "var(--mini-crimson)"
            : tone === "sage"
              ? "var(--mini-sage)"
              : "var(--mini-text)";
  return (
    <div className="flex items-baseline gap-3">
      <span
        className="mini-mono tabular-nums"
        style={{
          fontSize: 26,
          fontWeight: 500,
          color,
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--mini-text-muted)",
          lineHeight: 1.3,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const size = 76;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, percent)) / 100);
  const color =
    percent >= 90
      ? "var(--mini-lime)"
      : percent >= 50
        ? "var(--mini-amber)"
        : "var(--mini-crimson)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="mini-ring-track"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={color}
          strokeDasharray={circ}
          strokeDashoffset={off}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.2,0.8,0.2,1)" }}
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ color: "var(--mini-text)" }}
      >
        <span
          className="mini-mono tabular-nums"
          style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}
        >
          {percent}
        </span>
        <span
          style={{
            fontSize: 9,
            color: "var(--mini-text-muted)",
            letterSpacing: "0.14em",
          }}
        >
          %
        </span>
      </div>
    </div>
  );
}
