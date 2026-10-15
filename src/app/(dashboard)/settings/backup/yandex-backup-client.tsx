"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FORMAT_LOCALES, isLocale } from "@/i18n/locales";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CloudUpload,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type BackupState = {
  connected: boolean;
  folder: string;
  lastBackupAt: string | null;
};

type LogEntry = {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

type Props = {
  initialState: BackupState;
  recentLogs: LogEntry[];
};

export function YandexBackupClient({ initialState, recentLogs }: Props) {
  const t = useTranslations("yandexBackup");
  const selectedLocale = useLocale();
  const locale = isLocale(selectedLocale) ? selectedLocale : "ru";
  const feedback = useRef(t);
  useEffect(() => { feedback.current = t; }, [t]);
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [token, setToken] = useState("");
  const [folder, setFolder] = useState(initialState.folder);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  function errorMessage(code: unknown, fallback: "connectError" | "disconnectError" | "backupError") {
    const copy = feedback.current;
    switch (code) {
      case "YANDEX_BACKUP_FORBIDDEN": return copy("forbidden");
      case "YANDEX_BACKUP_INVALID_INPUT": return copy("invalidInput");
      case "YANDEX_BACKUP_NOT_CONNECTED": return copy("notConnected");
      default: return copy(fallback);
    }
  }

  function historyError(value: string) {
    if (value === "Yandex.Disk не вернул upload URL") return t("missingUploadUrl");
    if (value === "Неизвестная ошибка") return t("unknownError");
    return value;
  }

  async function connect() {
    if (token.trim().length < 10) {
      toast.error(t("tokenRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/yandex-backup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), folder: folder.trim() }),
      });
      const data = (await res.json()) as { errorCode?: string; userLogin?: string };
      if (!res.ok) {
        toast.error(errorMessage(data.errorCode, "connectError"));
        return;
      }
      toast.success(
        data.userLogin
          ? feedback.current("connectedUser", { login: data.userLogin })
          : feedback.current("connected")
      );
      setState({ ...state, connected: true, folder: folder.trim() });
      setToken("");
      router.refresh();
    } catch {
      toast.error(feedback.current("connectError"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/yandex-backup", {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { errorCode?: string } | null;
        toast.error(errorMessage(data?.errorCode, "disconnectError"));
        return;
      }
      toast.success(feedback.current("disconnected"));
      setState({ ...state, connected: false });
      router.refresh();
    } catch {
      toast.error(feedback.current("disconnectError"));
    } finally {
      setBusy(false);
    }
  }

  async function runBackup() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/yandex-backup/run", {
        method: "POST",
      });
      const data = (await res.json()) as {
        errorCode?: string;
        path?: string;
        sizeBytes?: number;
      };
      if (!res.ok) {
        toast.error(errorMessage(data.errorCode, "backupError"));
        return;
      }
      toast.success(
        feedback.current("uploadedFile", { path: data.path ?? "", size: Math.round((data.sizeBytes ?? 0) / 1024) })
      );
      setState({ ...state, lastBackupAt: new Date().toISOString() });
      router.refresh();
    } catch {
      toast.error(feedback.current("backupError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {state.connected ? (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#ecfdf5] text-[#116b2a]">
              <CheckCircle2 className="size-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-[#0b1024]">
                {t("connected")}
              </div>
              <p className="mt-1 text-[13px] text-[#6f7282]">
                {t.rich("folderValue", { folder: state.folder, path: chunks => <span className="font-mono text-[#3848c7]">{chunks}</span> })}
              </p>
              <p className="mt-0.5 text-[13px] text-[#6f7282]">
                {t("lastBackup", { date: state.lastBackupAt
                  ? new Date(state.lastBackupAt).toLocaleString(FORMAT_LOCALES[locale])
                  : t("never") })}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={runBackup}
              disabled={busy}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CloudUpload className="size-4" />
              )}
              {t("run")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisconnectOpen(true)}
              disabled={busy}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#a13a32] hover:bg-[#fff4f2] disabled:opacity-50"
            >
              <Trash2 className="size-4" />
              {t("disconnect")}
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="text-[15px] font-semibold text-[#0b1024]">
            {t("connectTitle")}
          </div>
          <ol className="mt-3 space-y-2 text-[13px] leading-relaxed text-[#3c4053]">
            <li>
              <span className="font-medium">1.</span>{" "}{t.rich("stepApp", { link: chunks => <a
                href="https://oauth.yandex.ru/authorize?response_type=token&client_id=YOUR_APP_ID&scope=cloud_api%3Adisk.read%20cloud_api%3Adisk.write"
                target="_blank"
                rel="noreferrer"
                className="text-[#3848c7] underline"
              >
                {chunks}
              </a> })}
            </li>
            <li>
              <span className="font-medium">2.</span>{" "}{t("stepToken")}
            </li>
            <li>
              <span className="font-medium">3.</span>{" "}{t.rich("stepPaste", { path: chunks => <span className="font-mono text-[#3848c7]">{chunks}</span> })}
            </li>
          </ol>

          <div className="mt-5 space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-[#6f7282]">
                {t("token")}
              </label>
              <input
                type="password"
                aria-label={t("token")}
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="y0_AgAA…"
                className="mt-1 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 font-mono text-[13px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#6f7282]">
                {t("folder")}
              </label>
              <input
                type="text"
                aria-label={t("folder")}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="/WeSetup"
                className="mt-1 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <button
              type="button"
              onClick={connect}
              disabled={busy || token.trim().length < 10}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("connect")}
            </button>
          </div>
        </section>
      )}

      {recentLogs.length > 0 ? (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="text-[15px] font-semibold text-[#0b1024]">
            {t("history")}
          </div>
          <ul className="mt-3 divide-y divide-[#ececf4]">
            {recentLogs.map((log) => {
              const ok = log.action === "yandex_backup.success" ||
                log.action === "yandex_backup.manual";
              const Icon = ok ? CheckCircle2 : XCircle;
              const fg = ok ? "#116b2a" : "#a13a32";
              const path = log.details?.path as string | undefined;
              const size = log.details?.sizeBytes as number | undefined;
              const error = log.details?.error as string | undefined;
              return (
                <li
                  key={log.id}
                  className="flex items-start gap-3 py-3 text-[13px]"
                >
                  <Icon
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: fg }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-[#0b1024]">
                        {ok ? t("uploaded") : t("error")}
                        {log.action === "yandex_backup.manual" ? (
                          <span className="ml-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] text-[#3848c7]">
                            {t("manual")}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[12px] text-[#9b9fb3]">
                        {new Date(log.createdAt).toLocaleString(FORMAT_LOCALES[locale])}
                      </div>
                    </div>
                    {path ? (
                      <div className="mt-0.5 font-mono text-[12px] text-[#6f7282]">
                        {path}
                        {size
                          ? ` · ${t("size", { size: Math.round(size / 1024) })}`
                          : ""}
                      </div>
                    ) : null}
                    {error ? (
                      <div className="mt-0.5 text-[12px] text-[#a13a32]">
                        {historyError(error)}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Нативный confirm() в приложении Telegram может не показаться —
          кнопка тогда молча не срабатывает (CLAUDE.md §6). */}
      <ConfirmDialog
        open={confirmDisconnectOpen}
        onClose={() => setConfirmDisconnectOpen(false)}
        onConfirm={async () => {
          setConfirmDisconnectOpen(false);
          await disconnect();
        }}
        title={t("confirmTitle")}
        description={t("confirmDescription")}
        bullets={[
          { label: t("confirmStop"), tone: "warn" },
          {
            label: t("confirmKeep"),
            tone: "default",
          },
          { label: t("confirmReconnect"), tone: "info" },
        ]}
        confirmLabel={t("disconnect")}
        cancelLabel={t("cancel")}
        variant="danger"
      />
    </div>
  );
}
