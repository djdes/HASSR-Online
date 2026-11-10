"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, CheckCircle2, ChevronRight, ClipboardList, CloudOff, QrCode, RefreshCw, Thermometer, Wifi, X } from "lucide-react";

import { getNativeBridge } from "@/lib/native-bridge";
import {
  journalTodayMark,
  objectTodayMark,
  offlineDocumentSignerIds,
  offlinePoint,
  offlinePointDocuments,
  offlineEditableDays,
  offlineRowKey,
  offlineRowState,
  offlineTodaySummary,
  queuedRowEdit,
  rangeText,
  resolveOfflineQr,
  scopeOfflinePack,
  summarizeValues,
  type OfflineTodayState,
} from "@/lib/offline/offline-logic";
import type { OfflineValues } from "@/lib/offline/merge";
import { checkOfflinePin } from "@/lib/offline/pin-verifier";
import { parseOfflineQr } from "@/lib/offline/qr-url";
import { OFFLINE_TASKS_KEY, refreshOfflineData } from "@/lib/offline/refresh";
import {
  getOfflineValue,
  listOfflineQueue,
  newOfflineId,
  putOfflineQueueItem,
  readStoredPack,
  removeOfflineQueueItem,
  subscribeOfflineStore,
  type StoredPack,
} from "@/lib/offline/store";
import { flushOfflineQueue, forceOfflineItem, retryOfflineItem } from "@/lib/offline/sync";
import { canDeliverOfflineItem, needsPinReentry } from "@/lib/offline/sync-policy";
import type {
  OfflinePack,
  OfflinePackJournal,
  OfflinePackObject,
  OfflineQueueItem,
  OfflineTasksSnapshot,
} from "@/lib/offline/types";

import { JournalRowForm, ObjectForm, SignerPicker, ui, type ObjectSubmit, type OfflineSigner } from "./offline-forms";

type View =
  | { name: "home" }
  | { name: "queue" }
  /** `pointId` and `documentId` come from the scanned QR (or the point shown on the home screen). */
  | { name: "journal"; code: string; pointId?: string | null; documentId?: string | null }
  | { name: "object"; kind: "equipment" | "room"; id: string }
  | { name: "notice"; title: string; text: string }
  | { name: "done"; title: string; text: string; sent: boolean };

type T = ReturnType<typeof useTranslations<"offlineApp">>;

/** Same key as the cabinet bridge: the launch link is consumed once per app start. */
const LAUNCH_URL_DONE_KEY = "wesetup.app.launch-url-done";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Point the home screen shows on this device; "" — every point. */
const HOME_POINT_KEY = "wesetup.offline.home-point";

function readHomePoint(): string | null | undefined {
  try {
    const value = window.localStorage.getItem(HOME_POINT_KEY);
    return value === null ? undefined : value || null;
  } catch {
    return undefined;
  }
}

function useStamp(): (at: number | string) => string {
  const locale = useLocale();
  return useCallback(
    (at: number | string) => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(at)),
    [locale]
  );
}

const shortDay = (day: string) => {
  const [, month, date] = day.split("-");
  return `${date}.${month}`;
};

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Text of a refusal: translated for the codes this app knows, the server's own text otherwise. */
function rejectText(t: T, item: Pick<OfflineQueueItem, "lastCode" | "lastError">): string {
  const key = `reject.${item.lastCode ?? ""}`;
  if (item.lastCode?.startsWith("offline-") && t.has(key as never)) return t(key as never);
  return item.lastError ?? t("queue.rejectedUnknown");
}

export function OfflineApp() {
  const t = useTranslations("offlineApp");
  const stamp = useStamp();
  const [stored, setStored] = useState<StoredPack | null | undefined>(undefined);
  const [queue, setQueue] = useState<OfflineQueueItem[]>([]);
  const [tasks, setTasks] = useState<OfflineTasksSnapshot | null>(null);
  const [stack, setStack] = useState<View[]>([{ name: "home" }]);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /** Address that failed to open (a scanned sticker, a cabinet page) — where to return when the network is back. */
  const entryUrl = useRef<string | null>(null);
  const online = useOnline();

  const pack = stored?.pack ?? null;
  const view = stack[stack.length - 1];
  // Point of the home screen: chosen on this device, else the one chosen in the cabinet when the data was saved.
  const [chosenPoint, setChosenPoint] = useState<string | null | undefined>(() => (typeof window === "undefined" ? undefined : readHomePoint()));
  const homePointId = pack ? (offlinePoint(pack, chosenPoint === undefined ? pack.point?.id : chosenPoint)?.id ?? null) : null;
  const homePack = useMemo(() => (pack ? scopeOfflinePack(pack, homePointId) : null), [pack, homePointId]);
  const chooseHomePoint = useCallback((pointId: string | null) => {
    setChosenPoint(pointId);
    try {
      window.localStorage.setItem(HOME_POINT_KEY, pointId ?? "");
    } catch {
      // The choice then lives until the screen is closed.
    }
  }, []);
  const push = useCallback((next: View) => setStack((prev) => [...prev, next]), []);
  const back = useCallback(() => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev)), []);
  const home = useCallback(() => setStack([{ name: "home" }]), []);

  const reload = useCallback(async () => {
    const [nextPack, nextQueue, nextTasks] = await Promise.all([readStoredPack(), listOfflineQueue(), getOfflineValue<OfflineTasksSnapshot>(OFFLINE_TASKS_KEY)]);
    setStored(nextPack);
    setQueue(nextQueue);
    setTasks(nextTasks);
  }, []);

  useEffect(() => {
    void reload();
    return subscribeOfflineStore(() => void reload());
  }, [reload]);

  const myQueue = useMemo(() => queue.filter((item) => canDeliverOfflineItem(item.ownerUserId, pack?.user.id)), [queue, pack]);
  const foreignCount = queue.length - myQueue.length;

  /** Opens whatever the address means: a sticker, a journal poster, the hub. */
  const openAddress = useCallback(
    (raw: string | null | undefined, options: { silent?: boolean } = {}): boolean => {
      if (!pack || !raw) return false;
      const parsed = parseOfflineQr(raw, [window.location.host]);
      if (!parsed.ok) {
        if (!options.silent) push({ name: "notice", title: t("notice.notOurQrTitle"), text: t("notice.notOurQrText") });
        return false;
      }
      const resolved = resolveOfflineQr(pack, parsed.target);
      if (resolved.kind === "object") setStack([{ name: "home" }, { name: "object", kind: resolved.object.kind, id: resolved.object.id }]);
      else if (resolved.kind === "journal") {
        if (parsed.target.kind !== "journal") return false;
        // The poster decides the point and the document — not the point chosen in the cabinet.
        // A short QR of a printed journal (`/qj/<point>/...`) names the point in the address itself.
        const pointId = parsed.target.buildingId ?? (parsed.target.shortSig ? (offlinePoint(pack, parsed.target.orgId)?.id ?? null) : null);
        setStack([{ name: "home" }, { name: "journal", code: resolved.journal.code, pointId, documentId: parsed.target.documentId }]);
      } else if (resolved.kind === "hub") {
        // «Все журналы» of a point: the home screen of that point.
        if (parsed.target.kind === "journal" && offlinePoint(pack, parsed.target.buildingId)) chooseHomePoint(parsed.target.buildingId);
        home();
      }
      else if (resolved.kind === "foreign-org") setStack([{ name: "home" }, { name: "notice", title: t("notice.foreignOrgTitle"), text: t("notice.foreignOrgText") }]);
      else setStack([{ name: "home" }, { name: "notice", title: resolved.what === "object" ? t("notice.noObjectTitle") : t("notice.noJournalTitle"), text: t("notice.missingText") }]);
      return true;
    },
    [pack, push, home, t, chooseHomePoint]
  );

  // Entry: `#u=<address that failed to open>` from the service worker or the app bridge,
  // `#queue` from the cabinet toast. Also on a hash change: a link scanned while this
  // screen is already open changes only the anchor, without a new page load.
  useEffect(() => {
    if (!pack) return;
    const consume = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      if (hash === "queue") {
        setStack([{ name: "home" }, { name: "queue" }]);
      } else if (hash.startsWith("u=")) {
        let address: string | null = null;
        try {
          address = decodeURIComponent(hash.slice(2));
        } catch {
          address = null;
        }
        if (address && address.startsWith("/") && !address.startsWith("//")) {
          entryUrl.current = address;
          openAddress(address, { silent: true });
        }
      }
      // Drop the anchor so a reload does not reopen the same sticker. The method is taken
      // from the prototype on purpose: Next patches `history.replaceState` on the instance
      // and treats the call as a navigation — with no network it then fails to refetch the
      // page and reloads it, which throws the person back to the list.
      try {
        History.prototype.replaceState.call(window.history, window.history.state, "", window.location.pathname);
      } catch {
        // History is unavailable — the anchor simply stays.
      }
    };
    consume();
    window.addEventListener("hashchange", consume);
    return () => window.removeEventListener("hashchange", consume);
  }, [pack, openAddress]);

  // WeSetup app: links from the system camera arrive as events, not as navigations.
  useEffect(() => {
    if (!pack) return;
    const bridge = getNativeBridge();
    if (!bridge) return;
    const handles = [
      bridge.on("App", "appUrlOpen", (payload) => {
        openAddress((payload as { url?: string } | null)?.url, { silent: true });
      }),
      bridge.on("App", "backButton", () => {
        if (scanning) setScanning(false);
        else if (stack.length > 1) back();
        else void bridge.call("App", "minimizeApp").catch(() => undefined);
      }),
    ];
    let done = false;
    try {
      done = Boolean(window.sessionStorage.getItem(LAUNCH_URL_DONE_KEY));
      if (!done) window.sessionStorage.setItem(LAUNCH_URL_DONE_KEY, "1");
    } catch {
      done = false;
    }
    if (!done) {
      void bridge
        .call<{ url?: string } | undefined>("App", "getLaunchUrl")
        .then((result) => openAddress(result?.url, { silent: true }))
        .catch(() => undefined);
    }
    return () => {
      for (const handle of handles) void handle.then((item) => item?.remove()).catch(() => undefined);
    };
  }, [pack, openAddress, back, scanning, stack.length]);

  const sync = useCallback(async () => {
    if (!pack || syncing) return null;
    setSyncing(true);
    try {
      return await flushOfflineQueue(pack.user.id);
    } finally {
      setSyncing(false);
      await reload();
    }
  }, [pack, syncing, reload]);

  // The network is back: deliver what is waiting.
  const pendingCount = myQueue.filter((item) => item.status === "pending").length;
  useEffect(() => {
    if (online && pendingCount > 0) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  /** Saves a record on the device and, if the network is there, sends it right away. */
  const saveRecord = useCallback(
    async (item: OfflineQueueItem, replaces: OfflineQueueItem | null) => {
      if (replaces) await removeOfflineQueueItem(replaces.id);
      await putOfflineQueueItem(item);
      let sent = false;
      if (navigator.onLine !== false) {
        await flushOfflineQueue(item.ownerUserId).catch(() => null);
        sent = !(await listOfflineQueue()).some((queued) => queued.id === item.id);
      }
      await reload();
      setStack([
        { name: "home" },
        {
          name: "done",
          sent,
          title: sent ? t("done.sentTitle") : t("done.savedTitle"),
          text: sent ? t("done.sentText", { label: item.label, name: item.employeeName }) : t("done.savedText", { label: item.label, name: item.employeeName, time: stamp(item.recordedAt) }),
        },
      ]);
    },
    [reload, t, stamp]
  );

  if (stored === undefined) {
    return <Shell><p className={ui.hint}>{t("shell.opening")}</p></Shell>;
  }

  if (!pack) {
    return (
      <Shell>
        <div className={`${ui.card} text-center`} data-testid="offline-no-pack">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <CloudOff className="size-7" aria-hidden />
          </div>
          <h1 className={ui.title}>{t("noPack.title")}</h1>
          <p className={`${ui.hint} mt-2`}>{t("noPack.text")}</p>
          <button type="button" className={`${ui.primary} mt-6`} onClick={() => window.location.assign("/mini")}>
            {t("noPack.retry")}
          </button>
        </div>
      </Shell>
    );
  }

  const fullJournal = view.name === "journal" ? pack.journals.find((item) => item.code === view.code) ?? null : null;
  const journalDocuments = view.name === "journal" && fullJournal ? offlinePointDocuments(pack, fullJournal, view.pointId, view.documentId) : [];
  const journal = fullJournal && journalDocuments.length > 0 ? { ...fullJournal, documents: journalDocuments } : null;
  const object = view.name === "object" ? pack.objects.find((item) => item.kind === view.kind && item.id === view.id) ?? null : null;
  const notice = (title: string) => (
    <Notice title={title} text={t("notice.missingText")} onHome={home} />
  );

  return (
    <Shell>
      <header className="mb-4 flex items-center gap-3">
        {stack.length > 1 ? (
          <button type="button" aria-label={t("shell.back")} className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#0b1024]" onClick={back} data-testid="offline-back">
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-[#6f7282]">{pack.organization.name}</p>
          <p className="truncate text-[15px] font-semibold text-[#0b1024]" data-testid="offline-user">{pack.user.name}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ${online ? "bg-[#e8f7ee] text-[#136b3a]" : "bg-[#fff8eb] text-[#7a4a00]"}`} data-testid="offline-network" data-online={online}>
          {online ? <Wifi className="size-4" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
          {online ? t("shell.online") : t("shell.offline")}
        </span>
      </header>

      {online && view.name === "home" ? (
        <div className={`${ui.info} mb-4 flex items-center justify-between gap-3`}>
          <span>{syncing ? t("shell.bannerSending") : pendingCount > 0 ? t("shell.bannerPending", { count: String(pendingCount) }) : t("shell.bannerBack")}</span>
          <button type="button" className="shrink-0 font-semibold underline" onClick={() => window.location.assign(entryUrl.current ?? "/mini")}>
            {t("shell.openCabinet")}
          </button>
        </div>
      ) : null}

      {view.name === "home" ? (
        <Home pack={homePack ?? pack} points={pack.points ?? []} pointId={homePointId} onPoint={chooseHomePoint} savedAt={stored!.savedAt} queue={myQueue} foreignCount={foreignCount} tasks={tasks} online={online} onScan={() => setScanning(true)} onOpen={(next) => push(next.name === "journal" ? { ...next, pointId: homePointId } : next)} onRefreshed={reload} />
      ) : null}

      {view.name === "journal" ? journal ? <JournalFlow key={`${journal.code}:${view.pointId ?? ""}:${view.documentId ?? ""}`} pack={pack} journal={journal} pointId={view.pointId ?? null} queue={myQueue} onSave={saveRecord} /> : notice(t("notice.noJournalTitle")) : null}

      {view.name === "object" ? object ? <ObjectFlow key={object.id} pack={pack} object={object} queue={myQueue} onSave={saveRecord} /> : notice(t("notice.noObjectTitle")) : null}

      {view.name === "notice" ? <Notice title={view.title} text={view.text} onHome={home} /> : null}

      {view.name === "done" ? (
        <div className={`${ui.card} text-center`} data-testid="offline-done" data-sent={view.sent}>
          <CheckCircle2 className={`mx-auto mb-3 size-14 ${view.sent ? "text-[#1f9d55]" : "text-[#5566f6]"}`} aria-hidden />
          <h1 className={ui.title}>{view.title}</h1>
          <p className={`${ui.hint} mt-2`}>{view.text}</p>
          <div className="mt-6 space-y-2">
            <button type="button" className={ui.primary} onClick={() => setScanning(true)}>
              {t("done.scanNext")}
            </button>
            <button type="button" className={ui.ghost} onClick={home} data-testid="offline-to-list">
              {t("shell.toList")}
            </button>
          </div>
        </div>
      ) : null}

      {view.name === "queue" ? <QueueView pack={pack} queue={myQueue} foreignCount={foreignCount} online={online} syncing={syncing} onSync={() => void sync()} onChanged={reload} /> : null}

      {scanning ? (
        <Scanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            openAddress(text);
          }}
        />
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[#fafbff] px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)] text-[#0b1024]" data-testid="offline-app">
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </main>
  );
}

function Notice({ title, text, onHome }: { title: string; text: string; onHome: () => void }) {
  const t = useTranslations("offlineApp");
  return (
    <div className={`${ui.card} text-center`} data-testid="offline-notice">
      <h1 className={ui.title}>{title}</h1>
      <p className={`${ui.hint} mt-2`}>{text}</p>
      <button type="button" className={`${ui.primary} mt-6`} onClick={onHome}>
        {t("shell.toList")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const MARK_STYLE: Record<Exclude<OfflineTodayState, "todo">, string> = {
  done: "bg-[#e8f7ee] text-[#136b3a]",
  queued: "bg-[#eef1ff] text-[#3848c7]",
};

function TodayBadge({ state }: { state: OfflineTodayState }) {
  const t = useTranslations("offlineApp.mark");
  if (state === "todo") return null;
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ${MARK_STYLE[state]}`} data-mark={state}>
      {state === "done" ? t("done") : t("queued")}
    </span>
  );
}

function Home({
  pack,
  points,
  pointId,
  onPoint,
  savedAt,
  queue,
  foreignCount,
  tasks,
  online,
  onScan,
  onOpen,
  onRefreshed,
}: {
  /** Already narrowed to the point shown. */
  pack: OfflinePack;
  points: OfflinePack["points"];
  pointId: string | null;
  onPoint: (pointId: string | null) => void;
  savedAt: number;
  queue: OfflineQueueItem[];
  foreignCount: number;
  tasks: OfflineTasksSnapshot | null;
  online: boolean;
  onScan: () => void;
  onOpen: (view: View) => void;
  onRefreshed: () => Promise<void>;
}) {
  const t = useTranslations("offlineApp");
  const stamp = useStamp();
  const pending = queue.filter((item) => item.status === "pending").length;
  const stuck = queue.length - pending;
  // The moment the screen was opened is enough: «старше суток» does not need a ticking clock.
  const [openedAt] = useState(() => Date.now());
  const stale = openedAt - savedAt > DAY_MS;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const summary = offlineTodaySummary(pack, queue);
  const myTasks = tasks && tasks.userId === pack.user.id && tasks.dateKey === pack.todayKey ? tasks : null;

  async function refresh() {
    setRefreshing(true);
    setRefreshError(false);
    const result = await refreshOfflineData(pack.user.id, { force: true }).catch(() => "failed" as const);
    setRefreshing(false);
    setRefreshError(result === "failed" || result === "other-account");
    await onRefreshed();
  }

  return (
    <div className="space-y-5">
      <div className={ui.card}>
        <h1 className={ui.title}>{t("home.title")}</h1>
        <p className={`${ui.hint} mt-1.5`} data-testid="offline-data-stamp">
          {t("home.stamp", { time: stamp(savedAt) })}
        </p>
        {stale ? <p className={`${ui.warn} mt-3`} data-testid="offline-stale">{t("home.staleDay")}</p> : null}
        {points.length > 1 ? (
          <label className="mt-4 block text-[13px] text-[#6f7282]">
            {t("home.point")}
            <select
              className="mt-1 block h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[16px] text-[#0b1024]"
              value={pointId ?? ""}
              onChange={(event) => onPoint(event.target.value || null)}
              data-testid="offline-point"
            >
              <option value="">{t("home.allPoints")}</option>
              {points.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="mt-3 text-[15px] font-medium text-[#0b1024]" data-testid="offline-summary">
          {t("home.summary", { done: String(summary.done), total: String(summary.total) })}
        </p>
        <button type="button" className={`${ui.primary} mt-4 flex items-center justify-center gap-2`} onClick={onScan} data-testid="offline-scan">
          <QrCode className="size-6" aria-hidden />
          {t("home.scan")}
        </button>
        {online ? (
          <button type="button" className={`${ui.ghost} mt-3 flex items-center justify-center gap-2`} disabled={refreshing} onClick={() => void refresh()} data-testid="offline-refresh-now">
            <RefreshCw className={`size-5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            {refreshing ? t("home.refreshing") : t("home.refresh")}
          </button>
        ) : null}
        {refreshError ? <p className={`${ui.error} mt-3`} role="alert">{t("home.refreshFailed")}</p> : null}
        {queue.length > 0 || foreignCount > 0 ? (
          <button type="button" className={`${ui.item} mt-3 ${stuck > 0 ? "border-[#ffd2cd] bg-[#fff4f2]" : ""}`} onClick={() => onOpen({ name: "queue" })} data-testid="offline-queue-link">
            <RefreshCw className="size-5 shrink-0 text-[#6f7282]" aria-hidden />
            <span className="min-w-0 flex-1 text-[15px] text-[#0b1024]">
              {[t("home.queuePending", { count: String(pending) }), stuck > 0 ? t("home.queueStuck", { count: String(stuck) }) : null, foreignCount > 0 ? t("home.queueForeign", { count: String(foreignCount) }) : null].filter(Boolean).join(" · ")}
            </span>
            <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
          </button>
        ) : null}
      </div>

      {pack.objects.length > 0 ? (
        <section>
          <h2 className="mb-2 px-1 text-[15px] font-semibold text-[#0b1024]">{t("home.objects")}</h2>
          <div className="space-y-2" data-testid="offline-objects">
            {pack.objects.map((object) => {
              const mark = objectTodayMark(object, queue);
              return (
                <button key={`${object.kind}:${object.id}`} type="button" className={ui.item} onClick={() => onOpen({ name: "object", kind: object.kind, id: object.id })} data-object={object.id}>
                  <Thermometer className="size-5 shrink-0 text-[#5566f6]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-medium text-[#0b1024]">{object.name}</span>
                    <span className="block truncate text-[13px] text-[#6f7282]">{[objectHint(t, object), mark.summary].filter(Boolean).join(" · ")}</span>
                  </span>
                  <TodayBadge state={mark.state} />
                  <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 px-1 text-[15px] font-semibold text-[#0b1024]">{t("home.journals")}</h2>
        {pack.journals.length === 0 ? (
          <p className={ui.hint}>{t("home.noJournals")}</p>
        ) : (
          <div className="space-y-2" data-testid="offline-journals">
            {pack.journals.map((journal) => {
              const mark = journalTodayMark(journal, queue, pack.todayKey);
              const detail = mark.rows ? t("mark.rows", { done: String(mark.rows.done), total: String(mark.rows.total) }) : mark.count > 0 ? t("mark.count", { count: String(mark.count) }) : null;
              return (
                <button key={journal.code} type="button" className={ui.item} onClick={() => onOpen({ name: "journal", code: journal.code })} data-journal={journal.code}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-medium leading-snug text-[#0b1024]">{journal.name}</span>
                    {detail ? <span className="block text-[13px] text-[#6f7282]">{detail}</span> : null}
                  </span>
                  <TodayBadge state={mark.state} />
                  <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
                </button>
              );
            })}
          </div>
        )}
      </section>

      {myTasks && myTasks.groups.length > 0 ? (
        // Collapsed and last: the list can be long, and it is for looking, not for filling.
        <details className="rounded-3xl border border-[#ececf4] bg-white px-4 py-3" data-testid="offline-tasks">
          <summary className="cursor-pointer list-none text-[15px] font-semibold text-[#0b1024]">
            {t("home.tasks")} · {myTasks.groups.reduce((sum, group) => sum + group.tasks.length, 0)}
          </summary>
          <p className="mb-2 mt-2 text-[13px] text-[#6f7282]">
            {t("home.tasksStamp", { time: stamp(myTasks.savedAt) })}. {t("home.tasksNote")}
          </p>
          <div className="space-y-2">
            {myTasks.groups.map((group) => {
              const openable = pack.journals.some((journal) => journal.code === group.code);
              return (
                <div key={group.code} className="rounded-2xl border border-[#ececf4] bg-white px-4 py-3">
                  <button type="button" className="flex w-full items-center gap-3 text-left disabled:cursor-default" disabled={!openable} onClick={() => onOpen({ name: "journal", code: group.code })} data-task-group={group.code}>
                    <ClipboardList className="size-5 shrink-0 text-[#5566f6]" aria-hidden />
                    <span className="min-w-0 flex-1 text-[16px] font-medium leading-snug text-[#0b1024]">{group.label}</span>
                    {openable ? <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden /> : null}
                  </button>
                  <ul className="mt-2 space-y-1">
                    {group.tasks.map((task) => (
                      <li key={task.key} className="flex items-baseline justify-between gap-3 text-[14px]">
                        <span className="min-w-0 text-[#0b1024]">
                          {task.label}
                          {task.sublabel ? <span className="text-[#6f7282]"> · {task.sublabel}</span> : null}
                        </span>
                        <span className="shrink-0 text-[13px] text-[#6f7282]">
                          {task.state === "taken" ? (task.by ? t("task.taken", { name: task.by }) : t("task.takenNoName")) : t(`task.${task.state}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function objectHint(t: T, object: OfflinePackObject): string {
  const what =
    object.fill === "uv"
      ? t("object.uv")
      : object.fill === "fryer"
        ? t("object.fryer")
        : object.fill === "unsupported"
          ? t("object.onlineOnly")
          : [rangeText(object.temperature, "°C"), rangeText(object.humidity, "%")].filter(Boolean).join(", ") || t("object.temperature");
  return [object.place, what].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ */

type SaveRecord = (item: OfflineQueueItem, replaces: OfflineQueueItem | null) => Promise<void>;

function baseItem(pack: OfflinePack, signer: OfflineSigner): Pick<OfflineQueueItem, "id" | "ownerUserId" | "organizationId" | "employeeId" | "employeeName" | "auth" | "pinFp" | "recordedAt" | "status" | "attempts" | "nextAttemptAt" | "lastError" | "lastCode"> {
  return {
    id: newOfflineId(),
    ownerUserId: pack.user.id,
    organizationId: pack.organization.id,
    employeeId: signer.employee.id,
    employeeName: signer.employee.name,
    auth: signer.auth,
    pinFp: signer.pinFp,
    recordedAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
    lastCode: null,
  };
}

function ObjectFlow({ pack, object, queue, onSave }: { pack: OfflinePack; object: OfflinePackObject; queue: OfflineQueueItem[]; onSave: SaveRecord }) {
  const t = useTranslations("offlineApp");
  const [signer, setSigner] = useState<OfflineSigner | null>(null);
  const fryerStarted = queue.some((item) => item.target.kind === "equipment" && item.target.objectId === object.id && item.target.action === "fryer-start" && item.status !== "rejected");

  async function submit(result: ObjectSubmit) {
    if (!signer) return;
    const id = encodeURIComponent(object.id);
    const url =
      object.kind === "room"
        ? `/api/room-fill/${id}`
        : result.action.startsWith("uv")
          ? `/api/equipment-fill/${id}/uv`
          : result.action.startsWith("fryer")
            ? `/api/equipment-fill/${id}/fryer`
            : `/api/equipment-fill/${id}`;
    await onSave(
      {
        ...baseItem(pack, signer),
        target: { kind: object.kind, objectId: object.id, action: result.action },
        url,
        body: { token: object.token, employeeId: signer.employee.id, ...result.body },
        label: `${object.name}: ${result.summary}`,
        sublabel: object.place ?? "",
        ...(result.photos ? { photos: result.photos } : {}),
      },
      null
    );
  }

  return (
    <div className={ui.card} data-testid="offline-object">
      <h1 className={ui.title} data-testid="offline-object-title">{object.name}</h1>
      <p className={`${ui.hint} mb-5 mt-1`}>{objectHint(t, object)}</p>
      {object.fill === "unsupported" ? (
        <ObjectForm object={object} onSubmit={submit} />
      ) : signer ? (
        <>
          <SignerLine signer={signer} onChange={() => setSigner(null)} />
          <ObjectForm object={object} fryerStarted={fryerStarted} onSubmit={submit} />
        </>
      ) : (
        <SignerPicker pack={pack} allowedIds={object.employeeIds} onReady={setSigner} />
      )}
    </div>
  );
}

function SignerLine({ signer, onChange }: { signer: OfflineSigner; onChange: () => void }) {
  const t = useTranslations("offlineApp.signer");
  return (
    <p className={`${ui.info} mb-4 flex items-center justify-between gap-3`} data-testid="offline-signer-line">
      <span className="min-w-0 truncate">{t("line", { name: signer.employee.name })}</span>
      <button type="button" className="shrink-0 font-semibold underline" onClick={onChange}>
        {t("notMe")}
      </button>
    </p>
  );
}

function JournalFlow({ pack, journal, pointId, queue, onSave }: { pack: OfflinePack; journal: OfflinePackJournal; pointId: string | null; queue: OfflineQueueItem[]; onSave: SaveRecord }) {
  const t = useTranslations("offlineApp");
  const [documentId, setDocumentId] = useState<string | null>(journal.documents.length === 1 ? journal.documents[0].id : null);
  const [rowKey, setRowKey] = useState<string | null>(null);
  const [signer, setSigner] = useState<OfflineSigner | null>(null);
  const [day, setDay] = useState<string | null>(null);

  const document = journal.documents.find((item) => item.id === documentId) ?? null;
  const dayLabel = (value: string) => (value === pack.todayKey ? t("journal.today", { date: shortDay(value) }) : shortDay(value));
  const heading = (
    <>
      <h1 className={ui.title} data-testid="offline-journal-title">{journal.name}</h1>
      <p className={`${ui.hint} mb-5 mt-1`}>{document ? [document.title, document.building].filter(Boolean).join(" · ") : t("journal.pickDocument")}</p>
    </>
  );

  if (!document) {
    return (
      <div className={ui.card}>
        {heading}
        <div className="space-y-2">
          {journal.documents.map((item) => (
            <button key={item.id} type="button" className={ui.item} onClick={() => setDocumentId(item.id)}>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-medium text-[#0b1024]">{item.title}</span>
                {item.building ? <span className="block text-[13px] text-[#6f7282]">{item.building}</span> : null}
              </span>
              <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Row journals: the row first («Зал», «Кухня»), then who fills it.
  if (!document.perEmployee && !rowKey) {
    return (
      <div className={ui.card}>
        {heading}
        <h2 className="mb-3 text-[18px] font-semibold text-[#0b1024]">{t("journal.what")}</h2>
        <div className="space-y-2" data-testid="offline-rows">
          {document.rows.map((row) => {
            const filled = Boolean(document.history[row.rowKey]?.[pack.todayKey]) || Boolean(queuedRowEdit(queue, document.id, row.rowKey, null));
            return (
              <button key={row.rowKey} type="button" className={ui.item} onClick={() => setRowKey(row.rowKey)}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-medium leading-snug text-[#0b1024]">{row.label}</span>
                  {row.sublabel ? <span className="block text-[13px] text-[#6f7282]">{row.sublabel}</span> : null}
                </span>
                {!journal.append && filled ? <span className="shrink-0 rounded-full bg-[#e8f7ee] px-2.5 py-1 text-[12px] font-medium text-[#136b3a]">{t("journal.filledToday")}</span> : null}
                <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (!signer) {
    return (
      <div className={ui.card}>
        {heading}
        <SignerPicker pack={pack} allowedIds={offlineDocumentSignerIds(pack, document, pointId)} onReady={setSigner} />
      </div>
    );
  }

  const effectiveRowKey = offlineRowKey(document, rowKey, signer.employee.id);
  const schema = document.forms[effectiveRowKey] ?? null;
  const row = document.rows.find((item) => item.rowKey === effectiveRowKey) ?? null;
  if (!schema) {
    return (
      <div className={ui.card}>
        {heading}
        <SignerLine signer={signer} onChange={() => setSigner(null)} />
        <p className={ui.error}>{t("journal.noForm")}</p>
      </div>
    );
  }

  const days = journal.append ? [] : offlineEditableDays(document, pack.todayKey);
  const state = journal.append
    ? { values: {} as OfflineValues, base: {} as OfflineValues, filled: false, unsent: false }
    : offlineRowState({ document, schema, rowKey: effectiveRowKey, day, todayKey: pack.todayKey, queue });
  const initial: OfflineValues = journal.append ? Object.fromEntries(schema.fields.map((field) => [field.key, (field as { defaultValue?: OfflineValues[string] }).defaultValue ?? null])) : state.values;

  return (
    <div className={ui.card} data-testid="offline-journal">
      {heading}
      <SignerLine signer={signer} onChange={() => setSigner(null)} />
      {row ? <p className="mb-4 text-[16px] font-semibold text-[#0b1024]">{row.label}</p> : null}
      {days.length > 1 ? (
        <div className="mb-4">
          <label className={ui.label} htmlFor="offline-day">
            {t("journal.day")}
          </label>
          <select id="offline-day" data-testid="offline-day" className={ui.input} value={day ?? pack.todayKey} onChange={(event) => setDay(event.target.value === pack.todayKey ? null : event.target.value)}>
            {days.map((item) => {
              const has = Boolean(document.history[effectiveRowKey]?.[item]) || Boolean(queuedRowEdit(queue, document.id, effectiveRowKey, item === pack.todayKey ? null : item));
              return (
                <option key={item} value={item}>
                  {has ? t("journal.dayFilled", { day: dayLabel(item) }) : dayLabel(item)}
                </option>
              );
            })}
          </select>
          {state.filled ? <p className={`${ui.info} mt-2`} data-testid="offline-row-state" data-unsent={state.unsent}>{state.unsent ? t("journal.rowUnsent") : t("journal.rowSaved")}</p> : null}
        </div>
      ) : null}
      <JournalRowForm
        // A new day or signer is a new form: values must not leak between them.
        key={`${effectiveRowKey}|${day ?? ""}`}
        schema={schema}
        initial={initial}
        filled={state.filled}
        onSubmit={async ({ values, correction, photos }) => {
          const replaces = journal.append ? null : queuedRowEdit(queue, document.id, effectiveRowKey, day);
          await onSave(
            {
              ...baseItem(pack, signer),
              target: { kind: "journal", code: journal.code, documentId: document.id, rowKey: effectiveRowKey, day },
              url: `/api/journal-fill/${encodeURIComponent(pack.organization.id)}/${encodeURIComponent(journal.code)}`,
              body: {
                token: journal.token,
                documentId: document.id,
                employeeId: signer.employee.id,
                rowKey: effectiveRowKey,
                values,
                ...(correction ? { correction } : {}),
                ...(journal.append ? {} : { base: state.base }),
              },
              label: [journal.name, row?.label, day ? t("journal.forDay", { date: shortDay(day) }) : null].filter(Boolean).join(" · "),
              sublabel: summarizeValues(schema, values),
              ...(Object.keys(photos).length > 0 ? { photos } : {}),
            },
            replaces
          );
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function QueueView({
  pack,
  queue,
  foreignCount,
  online,
  syncing,
  onSync,
  onChanged,
}: {
  pack: OfflinePack;
  queue: OfflineQueueItem[];
  foreignCount: number;
  online: boolean;
  syncing: boolean;
  onSync: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("offlineApp");
  const stamp = useStamp();
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  async function act(run: () => Promise<void>) {
    await run();
    await onChanged();
    if (navigator.onLine !== false) onSync();
  }

  async function reenterPin(item: OfflineQueueItem) {
    setPinError(null);
    // The current PIN can only be checked against fresh data — refresh the pack first.
    await refreshOfflineData(pack.user.id, { force: true }).catch(() => "failed");
    const current = (await readStoredPack())?.pack ?? pack;
    const employee = current.employees.find((candidate) => candidate.id === item.employeeId);
    if (!employee?.pin || !employee.pinFp) return setPinError(t("queue.noPin"));
    if (!(await checkOfflinePin(pin, employee.pin))) return setPinError(t("queue.wrongPin"));
    setPinFor(null);
    setPin("");
    await act(() => retryOfflineItem(item, { auth: "pin", pinFp: employee.pinFp }));
  }

  const showValue = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return t("queue.valueEmpty");
    if (value === true) return t("queue.valueYes");
    if (value === false) return t("queue.valueNo");
    return String(value);
  };

  return (
    <div className="space-y-4" data-testid="offline-queue">
      <div className={ui.card}>
        <h1 className={ui.title}>{t("queue.title")}</h1>
        <p className={`${ui.hint} mt-1.5`}>
          {queue.length === 0 ? t("queue.empty") : online ? t("queue.online") : t("queue.offline")}
          {foreignCount > 0 ? ` ${t("queue.foreign", { count: String(foreignCount) })}` : ""}
        </p>
        {queue.some((item) => item.status === "pending") ? (
          <button type="button" className={`${ui.ghost} mt-4`} disabled={syncing || !online} onClick={onSync} data-testid="offline-sync-now">
            {syncing ? t("queue.sending") : t("queue.sendNow")}
          </button>
        ) : null}
      </div>

      {queue.map((item) => (
        <div key={item.id} className={`${ui.card} ${item.status !== "pending" ? "border-[#ffd2cd]" : ""}`} data-testid="offline-queue-item" data-status={item.status}>
          <p className="text-[16px] font-semibold leading-snug text-[#0b1024]">{item.label}</p>
          {item.sublabel ? <p className="mt-0.5 text-[14px] text-[#6f7282]">{item.sublabel}</p> : null}
          <p className="mt-1 text-[13px] text-[#6f7282]">
            {item.employeeName} · {stamp(item.recordedAt)}
            {item.photos && Object.keys(item.photos).length > 0 ? ` · ${t("photo.attached", { count: String(Object.keys(item.photos).length) })}` : ""}
          </p>

          {item.status === "pending" ? <p className="mt-2 text-[14px] text-[#3848c7]">{item.lastCode || item.lastError ? rejectText(t, item) : t("queue.waiting")}</p> : null}

          {item.status === "rejected" ? (
            <>
              <p className={`${ui.error} mt-3`}>{t("queue.rejected", { reason: rejectText(t, item) })}</p>
              {needsPinReentry(item) ? (
                pinFor === item.id ? (
                  <div className="mt-3 space-y-2">
                    <input className={ui.input} inputMode="numeric" autoComplete="off" placeholder={t("queue.pinPlaceholder")} aria-label={t("queue.pinPlaceholder")} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                    {pinError ? <p className={ui.error}>{pinError}</p> : null}
                    <button type="button" className={ui.primary} disabled={pin.length < 4} onClick={() => void reenterPin(item)}>
                      {t("queue.checkAndSend")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${ui.primary} mt-3`}
                    onClick={() => {
                      setPinFor(item.id);
                      setPin("");
                      setPinError(null);
                    }}
                  >
                    {t("queue.enterPin")}
                  </button>
                )
              ) : (
                <button type="button" className={`${ui.ghost} mt-3`} onClick={() => void act(() => retryOfflineItem(item))}>
                  {t("queue.retry")}
                </button>
              )}
              <DeleteButton onDelete={() => act(() => removeOfflineQueueItem(item.id))} />
            </>
          ) : null}

          {item.status === "conflict" ? (
            <>
              <p className={`${ui.warn} mt-3`}>{t("queue.conflictIntro")}</p>
              <ul className="mt-2 space-y-1.5 text-[14px] text-[#0b1024]">
                {(item.conflicts ?? []).map((conflict) => (
                  <li key={conflict.key} className="rounded-xl bg-[#fafbff] px-3 py-2">
                    {t("queue.conflictLine", { label: conflict.label, theirs: showValue(conflict.theirs), mine: showValue(conflict.mine) })}
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button type="button" className={ui.ghost} onClick={() => void act(() => removeOfflineQueueItem(item.id))} data-testid="offline-keep-theirs">
                  {t("queue.keepTheirs")}
                </button>
                <button type="button" className={ui.ghost} onClick={() => void act(() => forceOfflineItem(item))} data-testid="offline-take-mine">
                  {t("queue.takeMine")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const t = useTranslations("offlineApp.queue");
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="mt-2 w-full py-2 text-[14px] font-medium text-[#a13a32] underline" onClick={() => setConfirming(true)}>
        {t("delete")}
      </button>
    );
  }
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <button type="button" className={ui.ghost} onClick={() => setConfirming(false)}>
        {t("keep")}
      </button>
      <button type="button" className={`${ui.ghost} text-[#a13a32]`} onClick={() => void onDelete()}>
        {t("deleteForever")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Scanner({ onClose, onResult }: { onClose: () => void; onResult: (text: string) => void }) {
  const t = useTranslations("offlineApp.scanner");
  const [error, setError] = useState(false);
  const resultRef = useRef(onResult);
  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stopped = false;
    let started = false;
    const instance = new Html5Qrcode("offline-qr-reader", { verbose: false });
    instance
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (width, height) => {
            const side = Math.floor(Math.min(width, height) * 0.7);
            return { width: side, height: side };
          },
        },
        (text) => {
          // The callback fires many times a second while the code is in view — take the first WeSetup code.
          if (stopped || !parseOfflineQr(text, [window.location.host]).ok) return;
          stopped = true;
          resultRef.current(text);
        },
        () => undefined
      )
      .then(() => {
        started = true;
        if (stopped) void instance.stop().catch(() => undefined);
      })
      .catch(() => {
        if (!stopped) setError(true);
      });
    return () => {
      stopped = true;
      if (started) void instance.stop().catch(() => undefined);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b1024] text-white" role="dialog" aria-label={t("dialog")} data-testid="offline-scanner">
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <p className="text-[17px] font-semibold">{t("title")}</p>
        <button type="button" aria-label={t("close")} className="flex size-11 items-center justify-center rounded-2xl bg-white/10" onClick={onClose}>
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-4">
        <div id="offline-qr-reader" className="w-full max-w-md overflow-hidden rounded-3xl" />
      </div>
      <p className="px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 text-center text-[14px] text-white/70">{error ? t("cameraError") : t("hint")}</p>
    </div>
  );
}
