"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ArrowLeft, CheckCircle2, ChevronRight, CloudOff, QrCode, RefreshCw, Thermometer, Wifi, X } from "lucide-react";

import { getNativeBridge } from "@/lib/native-bridge";
import {
  offlineEditableDays,
  offlineRowState,
  offlineRowKey,
  queuedRowEdit,
  rangeText,
  resolveOfflineQr,
  summarizeValues,
} from "@/lib/offline/offline-logic";
import type { OfflineValues } from "@/lib/offline/merge";
import { checkOfflinePin } from "@/lib/offline/pin-verifier";
import { parseOfflineQr } from "@/lib/offline/qr-url";
import {
  listOfflineQueue,
  newOfflineId,
  putOfflineQueueItem,
  readStoredPack,
  removeOfflineQueueItem,
  saveOfflinePack,
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
} from "@/lib/offline/types";

import { JournalRowForm, ObjectForm, SignerPicker, ui, type ObjectSubmit, type OfflineSigner } from "./offline-forms";

type View =
  | { name: "home" }
  | { name: "queue" }
  | { name: "journal"; code: string }
  | { name: "object"; kind: "equipment" | "room"; id: string }
  | { name: "notice"; title: string; text: string }
  | { name: "done"; title: string; text: string; sent: boolean };

/** Same key as the cabinet bridge: the launch link is consumed once per app start. */
const LAUNCH_URL_DONE_KEY = "wesetup.app.launch-url-done";

function formatStamp(at: number | string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}

function dayLabel(day: string, todayKey: string): string {
  const [, month, date] = day.split("-");
  return day === todayKey ? `Сегодня, ${date}.${month}` : `${date}.${month}`;
}

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

export function OfflineApp() {
  const [stored, setStored] = useState<StoredPack | null | undefined>(undefined);
  const [queue, setQueue] = useState<OfflineQueueItem[]>([]);
  const [stack, setStack] = useState<View[]>([{ name: "home" }]);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /** Address that failed to open (a scanned sticker, a cabinet page) — where to return when the network is back. */
  const entryUrl = useRef<string | null>(null);
  const online = useOnline();

  const pack = stored?.pack ?? null;
  const view = stack[stack.length - 1];
  const push = useCallback((next: View) => setStack((prev) => [...prev, next]), []);
  const back = useCallback(() => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev)), []);
  const home = useCallback(() => setStack([{ name: "home" }]), []);

  const reload = useCallback(async () => {
    const [nextPack, nextQueue] = await Promise.all([readStoredPack(), listOfflineQueue()]);
    setStored(nextPack);
    setQueue(nextQueue);
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
        if (!options.silent) push({ name: "notice", title: "Это не QR-код WeSetup", text: "Наведите камеру на наклейку объекта или плакат журнала." });
        return false;
      }
      const resolved = resolveOfflineQr(pack, parsed.target);
      if (resolved.kind === "object") setStack([{ name: "home" }, { name: "object", kind: resolved.object.kind, id: resolved.object.id }]);
      else if (resolved.kind === "journal") setStack([{ name: "home" }, { name: "journal", code: resolved.journal.code }]);
      else if (resolved.kind === "hub") home();
      else if (resolved.kind === "foreign-org") setStack([{ name: "home" }, { name: "notice", title: "QR-код другой организации", text: "На этом устройстве сохранены данные другой организации — этот код здесь не откроется." }]);
      else
        setStack([
          { name: "home" },
          {
            name: "notice",
            title: resolved.what === "object" ? "Этого объекта нет в сохранённых данных" : "Этого журнала нет в сохранённых данных",
            text: "Он появится после того, как приложение откроют с интернетом. Сейчас можно выбрать журнал или объект из списка.",
          },
        ]);
      return true;
    },
    [pack, push, home]
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
          title: sent ? "Записано в журнал" : "Сохранено на устройстве",
          text: sent ? `${item.label} · ${item.employeeName}` : `${item.label} · ${item.employeeName}. Запись отправится сама, когда появится интернет, — со временем ${formatStamp(item.recordedAt)}.`,
        },
      ]);
    },
    [reload]
  );

  if (stored === undefined) {
    return <Shell><p className={ui.hint}>Открываем…</p></Shell>;
  }

  if (!pack) {
    return (
      <Shell>
        <div className={`${ui.card} text-center`} data-testid="offline-no-pack">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <CloudOff className="size-7" aria-hidden />
          </div>
          <h1 className={ui.title}>Нет связи с интернетом</h1>
          <p className={`${ui.hint} mt-2`}>На этом устройстве ещё нет данных для работы без связи. Откройте приложение один раз с интернетом и войдите — после этого журналы будут открываться и без сети.</p>
          <button type="button" className={`${ui.primary} mt-6`} onClick={() => window.location.assign("/mini")}>
            Повторить
          </button>
        </div>
      </Shell>
    );
  }

  const journal = view.name === "journal" ? pack.journals.find((item) => item.code === view.code) ?? null : null;
  const object = view.name === "object" ? pack.objects.find((item) => item.kind === view.kind && item.id === view.id) ?? null : null;

  return (
    <Shell>
      <header className="mb-4 flex items-center gap-3">
        {stack.length > 1 ? (
          <button type="button" aria-label="Назад" className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#0b1024]" onClick={back} data-testid="offline-back">
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-[#6f7282]">{pack.organization.name}</p>
          <p className="truncate text-[15px] font-semibold text-[#0b1024]" data-testid="offline-user">{pack.user.name}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ${online ? "bg-[#e8f7ee] text-[#136b3a]" : "bg-[#fff8eb] text-[#7a4a00]"}`} data-testid="offline-network">
          {online ? <Wifi className="size-4" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
          {online ? "Сеть есть" : "Без связи"}
        </span>
      </header>

      {online && view.name === "home" ? (
        <div className={`${ui.info} mb-4 flex items-center justify-between gap-3`}>
          <span>{syncing ? "Отправляем записи…" : pendingCount > 0 ? `Интернет появился. Ждёт отправки: ${pendingCount}` : "Интернет появился — можно вернуться в кабинет."}</span>
          <button type="button" className="shrink-0 font-semibold underline" onClick={() => window.location.assign(entryUrl.current ?? "/mini")}>
            Открыть кабинет
          </button>
        </div>
      ) : null}

      {view.name === "home" ? (
        <Home pack={pack} savedAt={stored!.savedAt} queue={myQueue} foreignCount={foreignCount} onScan={() => setScanning(true)} onOpen={push} />
      ) : null}

      {view.name === "journal" ? (
        journal ? (
          <JournalFlow key={journal.code} pack={pack} journal={journal} queue={myQueue} onSave={saveRecord} />
        ) : (
          <Notice title="Этого журнала нет в сохранённых данных" text="Он появится после того, как приложение откроют с интернетом." onHome={home} />
        )
      ) : null}

      {view.name === "object" ? (
        object ? (
          <ObjectFlow key={object.id} pack={pack} object={object} onSave={saveRecord} />
        ) : (
          <Notice title="Этого объекта нет в сохранённых данных" text="Он появится после того, как приложение откроют с интернетом." onHome={home} />
        )
      ) : null}

      {view.name === "notice" ? <Notice title={view.title} text={view.text} onHome={home} /> : null}

      {view.name === "done" ? (
        <div className={`${ui.card} text-center`} data-testid="offline-done">
          <CheckCircle2 className={`mx-auto mb-3 size-14 ${view.sent ? "text-[#1f9d55]" : "text-[#5566f6]"}`} aria-hidden />
          <h1 className={ui.title}>{view.title}</h1>
          <p className={`${ui.hint} mt-2`}>{view.text}</p>
          <div className="mt-6 space-y-2">
            <button type="button" className={ui.primary} onClick={() => setScanning(true)}>
              Сканировать следующий QR
            </button>
            <button type="button" className={ui.ghost} onClick={home}>
              К списку журналов
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
  return (
    <div className={`${ui.card} text-center`} data-testid="offline-notice">
      <h1 className={ui.title}>{title}</h1>
      <p className={`${ui.hint} mt-2`}>{text}</p>
      <button type="button" className={`${ui.primary} mt-6`} onClick={onHome}>
        К списку журналов
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Home({
  pack,
  savedAt,
  queue,
  foreignCount,
  onScan,
  onOpen,
}: {
  pack: OfflinePack;
  savedAt: number;
  queue: OfflineQueueItem[];
  foreignCount: number;
  onScan: () => void;
  onOpen: (view: View) => void;
}) {
  const stuck = queue.filter((item) => item.status !== "pending").length;
  // The moment the screen was opened is enough: «старше недели» does not need a ticking clock.
  const [openedAt] = useState(() => Date.now());
  const stale = openedAt - savedAt > 7 * 24 * 60 * 60 * 1000;
  return (
    <div className="space-y-5">
      <div className={ui.card}>
        <h1 className={ui.title}>Работаем без связи</h1>
        <p className={`${ui.hint} mt-1.5`} data-testid="offline-data-stamp">
          Данные от {formatStamp(savedAt)}. Записи сохраняются на устройстве и уходят в журнал, когда появится интернет, — со временем, когда сделаны.
        </p>
        {stale ? <p className={`${ui.warn} mt-3`}>Данные старше недели: новые объекты и сотрудники появятся после захода с интернетом.</p> : null}
        <button type="button" className={`${ui.primary} mt-4 flex items-center justify-center gap-2`} onClick={onScan} data-testid="offline-scan">
          <QrCode className="size-6" aria-hidden />
          Сканировать QR
        </button>
        {queue.length > 0 || foreignCount > 0 ? (
          <button type="button" className={`${ui.item} mt-3 ${stuck > 0 ? "border-[#ffd2cd] bg-[#fff4f2]" : ""}`} onClick={() => onOpen({ name: "queue" })} data-testid="offline-queue-link">
            <RefreshCw className="size-5 shrink-0 text-[#6f7282]" aria-hidden />
            <span className="min-w-0 flex-1 text-[15px] text-[#0b1024]">
              Ждёт отправки: {queue.filter((item) => item.status === "pending").length}
              {stuck > 0 ? ` · не ушло: ${stuck}` : ""}
              {foreignCount > 0 ? ` · другого аккаунта: ${foreignCount}` : ""}
            </span>
            <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
          </button>
        ) : null}
      </div>

      {pack.objects.length > 0 ? (
        <section>
          <h2 className="mb-2 px-1 text-[15px] font-semibold text-[#0b1024]">Оборудование и помещения</h2>
          <div className="space-y-2" data-testid="offline-objects">
            {pack.objects.map((object) => (
              <button key={`${object.kind}:${object.id}`} type="button" className={ui.item} onClick={() => onOpen({ name: "object", kind: object.kind, id: object.id })}>
                <Thermometer className="size-5 shrink-0 text-[#5566f6]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium text-[#0b1024]">{object.name}</span>
                  <span className="block truncate text-[13px] text-[#6f7282]">{objectHint(object)}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 px-1 text-[15px] font-semibold text-[#0b1024]">Журналы</h2>
        {pack.journals.length === 0 ? (
          <p className={ui.hint}>В сохранённых данных нет журналов с активным документом на сегодня.</p>
        ) : (
          <div className="space-y-2" data-testid="offline-journals">
            {pack.journals.map((journal) => (
              <button key={journal.code} type="button" className={ui.item} onClick={() => onOpen({ name: "journal", code: journal.code })} data-journal={journal.code}>
                <span className="min-w-0 flex-1 text-[16px] font-medium leading-snug text-[#0b1024]">{journal.name}</span>
                <ChevronRight className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function objectHint(object: OfflinePackObject): string {
  const what =
    object.fill === "uv"
      ? "УФ-лампа: включил / выключил"
      : object.fill === "unsupported"
        ? "только с интернетом"
        : [rangeText(object.temperature, "°C"), rangeText(object.humidity, "%")].filter(Boolean).join(", ") || "температура";
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

function ObjectFlow({ pack, object, onSave }: { pack: OfflinePack; object: OfflinePackObject; onSave: SaveRecord }) {
  const [signer, setSigner] = useState<OfflineSigner | null>(null);

  async function submit(result: ObjectSubmit) {
    if (!signer) return;
    const id = encodeURIComponent(object.id);
    const url = object.kind === "room" ? `/api/room-fill/${id}` : result.action.startsWith("uv") ? `/api/equipment-fill/${id}/uv` : `/api/equipment-fill/${id}`;
    await onSave(
      {
        ...baseItem(pack, signer),
        target: { kind: object.kind, objectId: object.id, action: result.action },
        url,
        body: { token: object.token, employeeId: signer.employee.id, ...result.body },
        label: `${object.name}: ${result.summary}`,
        sublabel: object.place ?? "",
      },
      null
    );
  }

  return (
    <div className={ui.card} data-testid="offline-object">
      <h1 className={ui.title} data-testid="offline-object-title">{object.name}</h1>
      <p className={`${ui.hint} mb-5 mt-1`}>{objectHint(object)}</p>
      {object.fill === "unsupported" ? (
        <ObjectForm object={object} onSubmit={submit} />
      ) : signer ? (
        <>
          <SignerLine signer={signer} onChange={() => setSigner(null)} />
          <ObjectForm object={object} onSubmit={submit} />
        </>
      ) : (
        <SignerPicker pack={pack} allowedIds={object.employeeIds} onReady={setSigner} />
      )}
    </div>
  );
}

function SignerLine({ signer, onChange }: { signer: OfflineSigner; onChange: () => void }) {
  return (
    <p className={`${ui.info} mb-4 flex items-center justify-between gap-3`} data-testid="offline-signer-line">
      <span className="min-w-0 truncate">Записывает: {signer.employee.name}</span>
      <button type="button" className="shrink-0 font-semibold underline" onClick={onChange}>
        Это не я
      </button>
    </p>
  );
}

function JournalFlow({ pack, journal, queue, onSave }: { pack: OfflinePack; journal: OfflinePackJournal; queue: OfflineQueueItem[]; onSave: SaveRecord }) {
  const [documentId, setDocumentId] = useState<string | null>(journal.documents.length === 1 ? journal.documents[0].id : null);
  const [rowKey, setRowKey] = useState<string | null>(null);
  const [signer, setSigner] = useState<OfflineSigner | null>(null);
  const [day, setDay] = useState<string | null>(null);

  const document = journal.documents.find((item) => item.id === documentId) ?? null;
  const heading = (
    <>
      <h1 className={ui.title} data-testid="offline-journal-title">{journal.name}</h1>
      {document ? <p className={`${ui.hint} mb-5 mt-1`}>{[document.title, document.building].filter(Boolean).join(" · ")}</p> : <p className={`${ui.hint} mb-5 mt-1`}>Выберите документ</p>}
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
        <h2 className="mb-3 text-[18px] font-semibold text-[#0b1024]">Что заполняем?</h2>
        <div className="space-y-2" data-testid="offline-rows">
          {document.rows.map((row) => {
            const filled = Boolean(document.history[row.rowKey]?.[pack.todayKey]) || Boolean(queuedRowEdit(queue, document.id, row.rowKey, null));
            return (
              <button key={row.rowKey} type="button" className={ui.item} onClick={() => setRowKey(row.rowKey)}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-medium leading-snug text-[#0b1024]">{row.label}</span>
                  {row.sublabel ? <span className="block text-[13px] text-[#6f7282]">{row.sublabel}</span> : null}
                </span>
                {!journal.append && filled ? <span className="shrink-0 rounded-full bg-[#e8f7ee] px-2.5 py-1 text-[12px] font-medium text-[#136b3a]">сегодня заполнено</span> : null}
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
        <SignerPicker pack={pack} allowedIds={document.employeeIds} onReady={setSigner} />
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
        <p className={ui.error}>Формы этой строки нет в сохранённых данных. Она появится после захода с интернетом.</p>
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
            День записи
          </label>
          <select id="offline-day" data-testid="offline-day" className={ui.input} value={day ?? pack.todayKey} onChange={(event) => setDay(event.target.value === pack.todayKey ? null : event.target.value)}>
            {days.map((item) => {
              const has = Boolean(document.history[effectiveRowKey]?.[item]) || Boolean(queuedRowEdit(queue, document.id, effectiveRowKey, item === pack.todayKey ? null : item));
              return (
                <option key={item} value={item}>
                  {dayLabel(item, pack.todayKey)}
                  {has ? " — заполнено" : ""}
                </option>
              );
            })}
          </select>
          {state.filled ? <p className={`${ui.info} mt-2`} data-testid="offline-row-state">{state.unsent ? "Показана ваша запись, которая ещё не отправлена. Её можно поправить." : "За этот день запись уже есть — её можно посмотреть и поправить."}</p> : null}
        </div>
      ) : null}
      <JournalRowForm
        // A new day or signer is a new form: values must not leak between them.
        key={`${effectiveRowKey}|${day ?? ""}`}
        schema={schema}
        initial={initial}
        submitLabel={state.filled ? "Сохранить изменения" : "Сохранить"}
        onSubmit={async (values, correction) => {
          const replaces = journal.append ? null : queuedRowEdit(queue, document.id, effectiveRowKey, day);
          const summary = summarizeValues(schema, values);
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
              label: [journal.name, row?.label, day ? `за ${dayLabel(day, pack.todayKey)}` : null].filter(Boolean).join(" · "),
              sublabel: summary,
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
    let current = pack;
    try {
      const response = await fetch("/api/offline/pack", { credentials: "same-origin", cache: "no-store" });
      if (response.ok) {
        current = (await response.json()) as OfflinePack;
        if (current.user.id === pack.user.id) await saveOfflinePack(current);
      }
    } catch {
      // No network — check against what is on the device.
    }
    const employee = current.employees.find((candidate) => candidate.id === item.employeeId);
    if (!employee?.pin || !employee.pinFp) return setPinError("У сотрудника сейчас нет ПИН, который можно проверить. Обратитесь к руководителю.");
    if (!(await checkOfflinePin(pin, employee.pin))) return setPinError("Неверный ПИН");
    setPinFor(null);
    setPin("");
    await act(() => retryOfflineItem(item, { auth: "pin", pinFp: employee.pinFp }));
  }

  return (
    <div className="space-y-4" data-testid="offline-queue">
      <div className={ui.card}>
        <h1 className={ui.title}>Записи без связи</h1>
        <p className={`${ui.hint} mt-1.5`}>
          {queue.length === 0 ? "Все записи отправлены." : online ? "Интернет есть — записи отправляются." : "Записи уйдут сами, когда появится интернет."}
          {foreignCount > 0 ? ` Ещё ${foreignCount} сделаны под другим аккаунтом — они уйдут после его входа на этом устройстве.` : ""}
        </p>
        {queue.some((item) => item.status === "pending") ? (
          <button type="button" className={`${ui.ghost} mt-4`} disabled={syncing || !online} onClick={onSync} data-testid="offline-sync-now">
            {syncing ? "Отправляем…" : "Отправить сейчас"}
          </button>
        ) : null}
      </div>

      {queue.map((item) => (
        <div key={item.id} className={`${ui.card} ${item.status !== "pending" ? "border-[#ffd2cd]" : ""}`} data-testid="offline-queue-item" data-status={item.status}>
          <p className="text-[16px] font-semibold leading-snug text-[#0b1024]">{item.label}</p>
          {item.sublabel ? <p className="mt-0.5 text-[14px] text-[#6f7282]">{item.sublabel}</p> : null}
          <p className="mt-1 text-[13px] text-[#6f7282]">
            {item.employeeName} · {formatStamp(item.recordedAt)}
          </p>

          {item.status === "pending" ? (
            <p className="mt-2 text-[14px] text-[#3848c7]">{item.lastError ? item.lastError : "Ждёт отправки"}</p>
          ) : null}

          {item.status === "rejected" ? (
            <>
              <p className={`${ui.error} mt-3`}>Не ушло: {item.lastError ?? "сервер не принял запись"}</p>
              {needsPinReentry(item) ? (
                pinFor === item.id ? (
                  <div className="mt-3 space-y-2">
                    <input className={ui.input} inputMode="numeric" autoComplete="off" placeholder="ПИН сотрудника" aria-label="ПИН сотрудника" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                    {pinError ? <p className={ui.error}>{pinError}</p> : null}
                    <button type="button" className={ui.primary} disabled={pin.length < 4} onClick={() => void reenterPin(item)}>
                      Проверить и отправить
                    </button>
                  </div>
                ) : (
                  <button type="button" className={`${ui.primary} mt-3`} onClick={() => { setPinFor(item.id); setPin(""); setPinError(null); }}>
                    Ввести действующий ПИН
                  </button>
                )
              ) : (
                <button type="button" className={`${ui.ghost} mt-3`} onClick={() => void act(() => retryOfflineItem(item))}>
                  Повторить
                </button>
              )}
              <DeleteButton onDelete={() => act(() => removeOfflineQueueItem(item.id))} />
            </>
          ) : null}

          {item.status === "conflict" ? (
            <>
              <p className={`${ui.warn} mt-3`}>Запись принята, но эти поля в журнале уже изменены по-другому — там осталось значение из журнала:</p>
              <ul className="mt-2 space-y-1.5 text-[14px] text-[#0b1024]">
                {(item.conflicts ?? []).map((conflict) => (
                  <li key={conflict.key} className="rounded-xl bg-[#fafbff] px-3 py-2">
                    <span className="font-medium">{conflict.label}</span>: в журнале «{showValue(conflict.theirs)}», у вас «{showValue(conflict.mine)}»
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button type="button" className={ui.ghost} onClick={() => void act(() => removeOfflineQueueItem(item.id))} data-testid="offline-keep-theirs">
                  Оставить как в журнале
                </button>
                <button type="button" className={ui.ghost} onClick={() => void act(() => forceOfflineItem(item))} data-testid="offline-take-mine">
                  Записать моё
                </button>
              </div>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "пусто";
  if (value === true) return "да";
  if (value === false) return "нет";
  return String(value);
}

function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="mt-2 w-full py-2 text-[14px] font-medium text-[#a13a32] underline" onClick={() => setConfirming(true)}>
        Удалить запись
      </button>
    );
  }
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <button type="button" className={ui.ghost} onClick={() => setConfirming(false)}>
        Оставить
      </button>
      <button type="button" className={`${ui.ghost} text-[#a13a32]`} onClick={() => void onDelete()}>
        Удалить навсегда
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Scanner({ onClose, onResult }: { onClose: () => void; onResult: (text: string) => void }) {
  const [error, setError] = useState<string | null>(null);
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
        if (!stopped) setError("Не удалось включить камеру. Разрешите приложению доступ к камере в настройках устройства или выберите объект из списка.");
      });
    return () => {
      stopped = true;
      if (started) void instance.stop().catch(() => undefined);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b1024] text-white" role="dialog" aria-label="Сканер QR" data-testid="offline-scanner">
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <p className="text-[17px] font-semibold">Наведите на QR-код</p>
        <button type="button" aria-label="Закрыть сканер" className="flex size-11 items-center justify-center rounded-2xl bg-white/10" onClick={onClose}>
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-4">
        <div id="offline-qr-reader" className="w-full max-w-md overflow-hidden rounded-3xl" />
      </div>
      <p className="px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 text-center text-[14px] text-white/70">{error ?? "Наклейка на холодильнике, помещении, лампе или плакат журнала."}</p>
    </div>
  );
}
