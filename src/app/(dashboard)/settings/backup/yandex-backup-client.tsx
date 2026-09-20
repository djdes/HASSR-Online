"use client";

import { useState } from "react";
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
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [token, setToken] = useState("");
  const [folder, setFolder] = useState(initialState.folder);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  async function connect() {
    if (token.trim().length < 10) {
      toast.error("Введите OAuth-токен Яндекса");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/yandex-backup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), folder: folder.trim() }),
      });
      const data = (await res.json()) as { error?: string; userLogin?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Ошибка");
      }
      toast.success(
        data.userLogin
          ? `Подключено: ${data.userLogin}`
          : "Я.Диск подключён"
      );
      setState({ ...state, connected: true, folder: folder.trim() });
      setToken("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
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
        throw new Error("Ошибка");
      }
      toast.success("Я.Диск отключён");
      setState({ ...state, connected: false });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
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
        error?: string;
        path?: string;
        sizeBytes?: number;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Ошибка");
      }
      toast.success(
        `Бэкап загружен: ${data.path} (${Math.round(
          (data.sizeBytes ?? 0) / 1024
        )} КБ)`
      );
      setState({ ...state, lastBackupAt: new Date().toISOString() });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
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
                Я.Диск подключён
              </div>
              <p className="mt-1 text-[13px] text-[#6f7282]">
                Папка:{" "}
                <span className="font-mono text-[#3848c7]">
                  {state.folder}
                </span>
              </p>
              <p className="mt-0.5 text-[13px] text-[#6f7282]">
                Последний бэкап:{" "}
                {state.lastBackupAt
                  ? new Date(state.lastBackupAt).toLocaleString("ru-RU")
                  : "ещё не создавался"}
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
              Сделать бэкап сейчас
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisconnectOpen(true)}
              disabled={busy}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#a13a32] hover:bg-[#fff4f2] disabled:opacity-50"
            >
              <Trash2 className="size-4" />
              Отключить
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="text-[15px] font-semibold text-[#0b1024]">
            Подключить Yandex.Disk
          </div>
          <ol className="mt-3 space-y-2 text-[13px] leading-relaxed text-[#3c4053]">
            <li>
              <span className="font-medium">1.</span> Зайдите в{" "}
              <a
                href="https://oauth.yandex.ru/authorize?response_type=token&client_id=YOUR_APP_ID&scope=cloud_api%3Adisk.read%20cloud_api%3Adisk.write"
                target="_blank"
                rel="noreferrer"
                className="text-[#3848c7] underline"
              >
                Яндекс.OAuth
              </a>{" "}
              и создайте приложение с правами «Доступ к папке приложения
              на Диске» + «Запись на Диск».
            </li>
            <li>
              <span className="font-medium">2.</span> Скопируйте полученный
              OAuth-токен (длинная строка, начинается с букв и цифр).
            </li>
            <li>
              <span className="font-medium">3.</span> Вставьте токен ниже —
              мы проверим его и сохраним. Сами файлы пишутся в папку{" "}
              <span className="font-mono text-[#3848c7]">/WeSetup</span> на
              вашем Диске (можно изменить).
            </li>
          </ol>

          <div className="mt-5 space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-[#6f7282]">
                OAuth-токен
              </label>
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="y0_AgAA…"
                className="mt-1 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 font-mono text-[13px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#6f7282]">
                Папка на Диске
              </label>
              <input
                type="text"
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
              Подключить
            </button>
          </div>
        </section>
      )}

      {recentLogs.length > 0 ? (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="text-[15px] font-semibold text-[#0b1024]">
            История последних бэкапов
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
                        {ok ? "Загружено" : "Ошибка"}
                        {log.action === "yandex_backup.manual" ? (
                          <span className="ml-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] text-[#3848c7]">
                            вручную
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[12px] text-[#9b9fb3]">
                        {new Date(log.createdAt).toLocaleString("ru-RU")}
                      </div>
                    </div>
                    {path ? (
                      <div className="mt-0.5 font-mono text-[12px] text-[#6f7282]">
                        {path}
                        {size
                          ? ` · ${Math.round(size / 1024)} КБ`
                          : ""}
                      </div>
                    ) : null}
                    {error ? (
                      <div className="mt-0.5 text-[12px] text-[#a13a32]">
                        {error}
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
        title="Отключить Яндекс.Диск?"
        description="Связь с диском разорвётся, и новые копии базы перестанут создаваться."
        bullets={[
          { label: "Автоматические копии больше не создаются", tone: "warn" },
          {
            label: "Уже загруженные копии на диске останутся — их не удаляем",
            tone: "default",
          },
          { label: "Подключить обратно можно в любой момент", tone: "info" },
        ]}
        confirmLabel="Отключить"
        cancelLabel="Отмена"
        variant="danger"
      />
    </div>
  );
}
