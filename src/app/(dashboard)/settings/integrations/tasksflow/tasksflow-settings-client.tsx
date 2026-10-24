"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Trash2,
  Users as UsersIcon,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";

type Integration = {
  id: string;
  baseUrl: string;
  apiKeyPrefix: string;
  tasksflowCompanyId: number | null;
  enabled: boolean;
  lastSyncAt: string | null;
  label: string | null;
  linkedUserCount: number;
  taskLinkCount: number;
};

type LinkRow = {
  wesetupUserId: string;
  name: string;
  phone: string | null;
  role: string;
  positionTitle: string | null;
  link: {
    tasksflowUserId: number | null;
    source: string;
    updatedAt: string;
  } | null;
  status: "linked" | "no_phone" | "no_match" | "pending";
};

type SyncFailure = {
  wesetupUserId: string;
  name: string | null;
  phone: string;
  reason: string;
  message: string;
  httpStatus?: number;
};

type SyncResponse = {
  totals: {
    linked: number;
    wesetupUsers: number;
    createdRemote: number;
    withoutPhone: number;
    withoutMatch: number;
  };
  failures?: SyncFailure[];
};

type HealthState = {
  status: "green" | "yellow" | "red";
  reason?: string;
  message?: string;
  latencyMs?: number;
  httpStatus?: number;
  remote?: {
    buildSha?: string;
    dbLatencyMs?: number;
    uptimeSec?: number;
  };
};

type ApiMessages = {
  sessionExpired: string;
  forbidden: string;
  redirectedHtml: string;
  notJson: (fallback: string, status: number) => string;
  badJson: (fallback: string, status: number) => string;
};

async function readApiJson<T>(
  response: Response,
  fallbackMessage: string,
  msgs: ApiMessages
): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const isJson = contentType.toLowerCase().includes("application/json");

  if (!isJson) {
    if (response.status === 401) {
      throw new Error(msgs.sessionExpired);
    }
    if (response.status === 403) {
      throw new Error(msgs.forbidden);
    }
    const suffix = response.redirected ? ` ${msgs.redirectedHtml}` : "";
    throw new Error(`${msgs.notJson(fallbackMessage, response.status)}${suffix}`);
  }

  let data: unknown;
  try {
    data = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    throw new Error(msgs.badJson(fallbackMessage, response.status));
  }

  if (!response.ok) {
    throw new Error(extractApiError(data) ?? fallbackMessage);
  }

  return data as T;
}

function extractApiError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.length > 0) {
    return record.error;
  }
  if (typeof record.message === "string" && record.message.length > 0) {
    return record.message;
  }
  return null;
}

export function TasksFlowSettingsClient({
  organizationName,
  initialIntegration,
}: {
  organizationName: string;
  initialIntegration: Integration | null;
}) {
  const t = useTranslations("settingsUi.tasksflowSettingsClient");
  const apiMsgs: ApiMessages = {
    sessionExpired: t("sessionExpired"),
    forbidden: t("forbidden"),
    redirectedHtml: t("redirectedHtml"),
    notJson: (fallback, status) => t("notJson", { fallback, status }),
    badJson: (fallback, status) => t("badJson", { fallback, status }),
  };
  const router = useRouter();
  const [integration, setIntegration] = useState<Integration | null>(
    initialIntegration
  );
  const [baseUrl, setBaseUrl] = useState(
    initialIntegration?.baseUrl ?? "https://tasksflow.ru"
  );
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState(initialIntegration?.label ?? "");
  const [pendingConnect, startConnect] = useTransition();
  const [pendingSync, startSync] = useTransition();
  const [pendingDisconnect, startDisconnect] = useTransition();
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [lastFailures, setLastFailures] = useState<SyncFailure[]>([]);
  const integrationId = integration?.id ?? null;
  const integrationLastSyncAt = integration?.lastSyncAt ?? null;

  // Load the user-link table whenever an integration exists. Re-fetches
  // after a successful sync — the server bumps `updatedAt`, so the UI
  // reflects "auto / manual" + current TasksFlow id without refresh.
  useEffect(() => {
    if (!integrationId) {
      return;
    }
    let cancelled = false;
    fetch("/api/integrations/tasksflow/links", { cache: "no-store" })
      .then(async (r) => {
        const data = await readApiJson<{ links?: LinkRow[] }>(
          r,
          t("loadLinksFailed"),
          apiMsgs
        );
        if (!cancelled) setLinks(data.links ?? []);
      })
      .catch(() => {
        if (!cancelled) setLinks([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrationId, integrationLastSyncAt]);

  // Health-check polling: пингуем TasksFlow `/api/health` через
  // `/api/integrations/tasksflow/health` каждые 60 секунд, чтобы UI
  // показал «зелёный/жёлтый/красный» индикатор и заголовок видимый
  // сразу. Без интеграции — пропускаем (нет смысла пинговать).
  // См. P1#5 в docs/THREAD_TASKSFLOW.md.
  const [health, setHealth] = useState<HealthState | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  useEffect(() => {
    if (!integrationId) {
      setHealth(null);
      return;
    }
    let cancelled = false;
    async function pingHealth() {
      if (cancelled) return;
      setHealthLoading(true);
      try {
        const response = await fetch(
          "/api/integrations/tasksflow/health",
          { cache: "no-store" },
        );
        const data = (await response.json()) as HealthState;
        if (!cancelled) setHealth(data);
      } catch {
        if (!cancelled) {
          setHealth({
            status: "red",
            reason: "client_error",
            message: t("healthCheckFailed"),
          });
        }
      } finally {
        if (!cancelled) setHealthLoading(false);
      }
    }
    pingHealth();
    const intervalId = window.setInterval(pingHealth, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrationId]);

  function handleConnect() {
    startConnect(async () => {
      try {
        const response = await fetch("/api/integrations/tasksflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim(),
            label: label.trim() || null,
          }),
        });
        const data = await readApiJson<{
          integration: Integration;
          probedUserCount?: number;
          userSync?: SyncResponse;
        }>(response, t("connectFailed"), apiMsgs);
        const sync = data.userSync;
        if (sync) {
          const totals = sync.totals;
          const failures = Array.isArray(sync.failures) ? sync.failures : [];
          setLastFailures(failures);
          const summary = t("connectedSummary", {
            linked: totals.linked,
            total: totals.wesetupUsers,
            created: totals.createdRemote,
            noPhone: totals.withoutPhone,
            noMatch: totals.withoutMatch,
          });
          if (failures.length > 0) {
            toast.warning(
              `${summary} ${t("createFailedSuffix", { count: failures.length })}`
            );
          } else {
            toast.success(summary);
          }
        } else {
          toast.success(
            t("connectedFound", { count: data.probedUserCount ?? 0 })
          );
        }
        // Re-fetch the full integration via status endpoint so the UI
        // gets all the derived fields (companyId, lastSyncAt, counts).
        const status = await fetch("/api/integrations/tasksflow", {
          cache: "no-store",
        }).then((r) =>
          readApiJson<{ integration: Integration | null }>(
            r,
            t("statusRefreshFailed"),
            apiMsgs
          )
        );
        setIntegration(status.integration);
        setApiKey("");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("connectError")
        );
      }
    });
  }

  function handleSync() {
    startSync(async () => {
      try {
        const response = await fetch(
          "/api/integrations/tasksflow/sync-users",
          { method: "POST" }
        );
        const data = await readApiJson<SyncResponse>(
          response,
          t("syncFailed"),
          apiMsgs
        );
        const totals = data.totals;
        const failures = Array.isArray(data.failures) ? data.failures : [];
        setLastFailures(failures);
        const summary = t("syncSummary", {
          linked: totals.linked,
          total: totals.wesetupUsers,
          created: totals.createdRemote,
          noPhone: totals.withoutPhone,
          noMatch: totals.withoutMatch,
        });
        if (failures.length > 0) {
          toast.warning(`${summary} ${t("createFailedSuffix", { count: failures.length })}`);
        } else {
          toast.success(summary);
        }
        const status = await fetch("/api/integrations/tasksflow", {
          cache: "no-store",
        }).then((r) =>
          readApiJson<{ integration: Integration | null }>(
            r,
            t("statusRefreshFailed"),
            apiMsgs
          )
        );
        setIntegration(status.integration);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("syncError")
        );
      }
    });
  }

  async function handleDisconnect() {
    const ok = await confirmAsync({
      title: t("disconnectTitle"),
      description: t("disconnectDescription"),
      bullets: [
        {
          label: t("disconnectBullet1"),
          tone: "info",
        },
        {
          label: t("disconnectBullet2"),
          tone: "warn",
        },
      ],
      confirmLabel: t("disconnect"),
      variant: "danger",
    });
    if (!ok) return;
    startDisconnect(async () => {
      try {
        const response = await fetch("/api/integrations/tasksflow", {
          method: "DELETE",
        });
        await readApiJson<{ ok: true }>(response, t("disconnectFailed"), apiMsgs);
        toast.success(t("disconnected"));
        setIntegration(null);
        setLinks(null);
        setApiKey("");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("disconnectError")
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="TasksFlow"
        description={
          <>
            {t.rich("pageDescription", {
              link: (chunks) => (
                <a
                  href="https://tasksflow.ru"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#5566f6] underline decoration-[#5566f6]/30 underline-offset-2 transition-colors hover:decoration-[#5566f6]"
                >
                  {chunks}
                  <ExternalLink className="ml-1 inline size-3" />
                </a>
              ),
            })}
          </>
        }
        actions={
          <HealthBadge
            integration={integration}
            health={health}
            loading={healthLoading}
          />
        }
      />

      {/* Диагностика вынесена из шапки в отдельную полосу: это тревожное
          состояние, его нельзя прятать в мелкой пилюле. */}
      {integration && health && health.status !== "green" ? (
        <div
          className={`rounded-2xl border px-4 py-2.5 text-[12.5px] leading-relaxed ${
            health.status === "yellow"
              ? "border-[#f3d9a8] bg-[#fffaf0] text-[#8a5a12]"
              : "border-[#f6cfc8] bg-[#fff4f2] text-[#a13a32]"
          }`}
        >
          {health.message || t("unavailable")}
          {health.remote?.buildSha ? (
            <span className="ml-2 font-mono text-[11px] opacity-70">
              build {health.remote.buildSha}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Connect / status card */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        {integration ? (
          <ConnectedView
            integration={integration}
            organizationName={organizationName}
            onSync={handleSync}
            onDisconnect={handleDisconnect}
            pendingSync={pendingSync}
            pendingDisconnect={pendingDisconnect}
          />
        ) : (
          <ConnectForm
            baseUrl={baseUrl}
            setBaseUrl={setBaseUrl}
            apiKey={apiKey}
            setApiKey={setApiKey}
            label={label}
            setLabel={setLabel}
            onSubmit={handleConnect}
            pending={pendingConnect}
          />
        )}
      </section>

      {/* Linked users table */}
      {integration ? (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
          <div className="mb-4 flex items-center gap-2">
            <UsersIcon className="size-4 text-[#5566f6]" />
            <h2 className="text-[15px] font-semibold text-[#0b1024]">
              {t("linksTitle")}
            </h2>
          </div>
          <p className="mb-4 max-w-[640px] text-[13px] text-[#6f7282]">
            {t.rich("linksHint", {
              code: (chunks) => (
                <code className="mx-1 rounded bg-[#f5f6ff] px-1.5 py-0.5 font-mono text-[12px] text-[#3848c7]">
                  {chunks}
                </code>
              ),
            })}
          </p>
          {links === null ? (
            <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[13px] text-[#6f7282]">
              {t("loading")}
            </div>
          ) : links.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
              <div className="text-[14px] font-medium text-[#0b1024]">
                {t("noEmployees")}
              </div>
              <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
                {t("noEmployeesHint")}
              </p>
            </div>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[640px] border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-[#ececf4] bg-[#fafbff] text-left text-[12px] uppercase tracking-wider text-[#6f7282]">
                    <th className="px-4 py-3 font-medium">{t("colEmployee")}</th>
                    <th className="px-4 py-3 font-medium">{t("colPhone")}</th>
                    <th className="px-4 py-3 font-medium">TasksFlow</th>
                    <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((row) => (
                    <tr
                      key={row.wesetupUserId}
                      className="border-b border-[#ececf4] last:border-b-0"
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-[#0b1024]">
                          {row.name}
                        </div>
                        {row.positionTitle ? (
                          <div className="text-[12px] text-[#6f7282]">
                            {row.positionTitle}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top text-[13px] text-[#3c4053]">
                        {row.phone ? (
                          <span className="font-mono">{row.phone}</span>
                        ) : (
                          <span className="text-[#9b9fb3]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-[13px]">
                        {row.link?.tasksflowUserId ? (
                          <span className="font-mono text-[#3848c7]">
                            #{row.link.tasksflowUserId}
                          </span>
                        ) : (
                          <span className="text-[#9b9fb3]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* Sync-failures diagnostic panel. Shown only after a sync that
          came back with problems. Without it the manager saw 0/N and
          had zero clue why; now we expose the TasksFlow response verbatim. */}
      {lastFailures.length > 0 ? (
        <section className="rounded-3xl border border-[#ffd2cd] bg-[#fff4f2] p-6 shadow-[0_0_0_1px_rgba(255,195,185,0.35)]">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#a13a32]" />
            <div className="flex-1">
              <h2 className="text-[15px] font-semibold text-[#0b1024]">
                {t("failuresTitle", { count: lastFailures.length })}
              </h2>
              {hasForbiddenFailure(lastFailures) ? (
                <div className="mt-1 space-y-3 text-[13px] leading-relaxed text-[#3c4053]">
                  <p>{t("forbiddenIntro")}</p>
                  <ol className="list-decimal space-y-2 pl-5">
                    <li>
                      <strong>{t("option1Title")}</strong> — {t("option1Body")}
                    </li>
                    <li>
                      <strong>{t("option2Title")}</strong> — {t("option2Body")}
                    </li>
                  </ol>
                  {integration?.baseUrl ? (
                    <a
                      href={integration.baseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[14px] font-semibold text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
                    >
                      {t("openTasksflow")}
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-[13px] leading-relaxed text-[#3c4053]">
                  {t("failuresHint")}
                </p>
              )}
              <ul className="mt-4 space-y-2">
                {lastFailures.map((f) => (
                  <li
                    key={f.wesetupUserId}
                    className="rounded-2xl border border-[#ffb0a6] bg-white px-4 py-3 text-[13px]"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-medium text-[#0b1024]">
                        {f.name ?? t("unnamed")}
                      </span>
                      <span className="font-mono text-[12px] text-[#6f7282]">
                        {f.phone}
                      </span>
                      {typeof f.httpStatus === "number" && f.httpStatus > 0 ? (
                        <span className="ml-auto rounded-full bg-[#fff4f2] px-2 py-0.5 text-[11px] font-semibold text-[#a13a32]">
                          HTTP {f.httpStatus}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[12px] leading-relaxed text-[#6f7282]">
                      {friendlyReason(f.reason, t)}: {f.message}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <CopyChip
                        label={t("copyPhone")}
                        value={f.phone}
                      />
                      {f.name ? (
                        <CopyChip label={t("copyName")} value={f.name} />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function HealthBadge({
  integration,
  health,
  loading,
}: {
  integration: Integration | null;
  health: HealthState | null;
  loading: boolean;
}) {
  const t = useTranslations("settingsUi.tasksflowSettingsClient");
  // Бейдж переехал в светлый PageHeader, поэтому вся палитра —
  // светлые токены дизайн-системы вместо полупрозрачно-белых.
  const neutral =
    "inline-flex items-center gap-2 self-start rounded-full border border-[#dcdfed] bg-white px-3 py-1.5 text-[12px] uppercase tracking-[0.18em] text-[#6f7282]";
  // Без интеграции — старый «Не подключено» в нейтральном цвете.
  if (!integration) {
    return (
      <div className={neutral}>
        <CheckCircle2 className="size-3.5" />
        {t("notConnected")}
      </div>
    );
  }
  // С интеграцией — пока не дождались первый health, показываем спиннер
  // вместо «Подключено», чтобы юзер видел что мы реально проверяем.
  if (loading && !health) {
    return (
      <div className={neutral}>
        <Loader2 className="size-3.5 animate-spin" />
        {t("checking")}
      </div>
    );
  }
  const palette = {
    green: {
      icon: <CheckCircle2 className="size-3.5" />,
      label: t("healthGreen"),
      classes: "border-[#bfe8cd] bg-[#ecfdf5] text-[#116b2a]",
    },
    yellow: {
      icon: <AlertTriangle className="size-3.5" />,
      label: t("healthYellow"),
      classes: "border-[#f3d9a8] bg-[#fffaf0] text-[#8a5a12]",
    },
    red: {
      icon: <XCircle className="size-3.5" />,
      label: t("healthRed"),
      classes: "border-[#f6cfc8] bg-[#fff4f2] text-[#a13a32]",
    },
  } as const;
  const status = health?.status ?? "red";
  const { icon, label, classes } = palette[status];
  return (
    <div
      className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-[12px] uppercase tracking-[0.18em] ${classes}`}
      title={health?.message || ""}
    >
      {icon}
      {label}
    </div>
  );
}

function CopyChip({ label, value }: { label: string; value: string }) {
  const t = useTranslations("settingsUi.tasksflowSettingsClient");
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error(t("copyFailed"));
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#dcdfed] bg-white px-3 py-1 text-[11px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
    >
      {done ? (
        <CheckCircle2 className="size-3 text-[#136b2a]" />
      ) : (
        <ClipboardCopy className="size-3 text-[#6f7282]" />
      )}
      {done ? t("copied") : label}
    </button>
  );
}

function friendlyReason(
  reason: string,
  t: ReturnType<typeof useTranslations<"settingsUi.tasksflowSettingsClient">>
): string {
  switch (reason) {
    case "remote_create_forbidden":
      return t("reasonForbidden");
    case "remote_create_failed":
      return t("reasonCreateFailed");
    case "phone_invalid":
      return t("reasonBadPhone");
    default:
      return t("reasonDefault");
  }
}

function hasForbiddenFailure(
  list: Array<{ reason: string }>
): boolean {
  return list.some((f) => f.reason === "remote_create_forbidden");
}

function ConnectForm({
  baseUrl,
  setBaseUrl,
  apiKey,
  setApiKey,
  label,
  setLabel,
  onSubmit,
  pending,
}: {
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  label: string;
  setLabel: (v: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const t = useTranslations("settingsUi.tasksflowSettingsClient");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-5"
    >
      <div>
        <h2 className="text-[16px] font-semibold text-[#0b1024]">
          {t("connectTitle")}
        </h2>
        <p className="mt-1 text-[13px] text-[#6f7282]">
          {t.rich("connectHint", {
            path: (chunks) => (
              <span className="font-mono text-[12px] text-[#3848c7]">{chunks}</span>
            ),
            code: (chunks) => <code className="font-mono">{chunks}</code>,
          })}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-[13px] font-medium text-[#3c4053]">
            {t("urlLabel")}
          </Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://tasksflow.ru"
            required
            className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px]"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[13px] font-medium text-[#3c4053]">
            {t("labelLabel")}
          </Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Production"
            className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px]"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-[#3c4053]">
          {t("apiKeyLabel")}
        </Label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="tfk_…"
            required
            autoComplete="off"
            spellCheck={false}
            className="h-11 rounded-2xl border-[#dcdfed] pl-11 pr-4 font-mono text-[14px]"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="submit"
          disabled={pending || !apiKey.trim() || !baseUrl.trim()}
          className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white hover:bg-[#4a5bf0]"
        >
          <Plug className="size-4" />
          {pending ? t("checkingProgress") : t("connect")}
        </Button>
      </div>
    </form>
  );
}

function ConnectedView({
  integration,
  organizationName,
  onSync,
  onDisconnect,
  pendingSync,
  pendingDisconnect,
}: {
  integration: Integration;
  organizationName: string;
  onSync: () => void;
  onDisconnect: () => void;
  pendingSync: boolean;
  pendingDisconnect: boolean;
}) {
  const t = useTranslations("settingsUi.tasksflowSettingsClient");
  const locale = useLocale();
  const dateLocale = locale === "en" ? "en-GB" : locale === "uz" ? "uz-UZ" : "ru-RU";
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="URL"
          value={
            <a
              href={integration.baseUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[#3848c7] hover:underline"
            >
              {integration.baseUrl}
              <ExternalLink className="ml-1 inline size-3" />
            </a>
          }
        />
        <Field
          label={t("fieldKey")}
          value={
            <span className="font-mono text-[13px]">
              {integration.apiKeyPrefix}…
            </span>
          }
        />
        <Field
          label={t("fieldCompany")}
          value={
            integration.tasksflowCompanyId !== null ? (
              <span className="font-mono">#{integration.tasksflowCompanyId}</span>
            ) : (
              <span className="text-[#9b9fb3]">{t("companyUnknown")}</span>
            )
          }
        />
        <Field
          label={t("fieldLabel")}
          value={
            integration.label || (
              <span className="text-[#9b9fb3]">—</span>
            )
          }
        />
        <Field
          label={t("fieldLinkedUsers")}
          value={`${integration.linkedUserCount}`}
        />
        <Field
          label={t("fieldActiveTasks")}
          value={`${integration.taskLinkCount}`}
        />
        <Field
          label={t("fieldLastSync")}
          value={
            integration.lastSyncAt
              ? new Date(integration.lastSyncAt).toLocaleString(dateLocale)
              : t("neverSynced")
          }
        />
        <Field label={t("fieldOrganization")} value={organizationName} />
      </div>
      <div className="flex flex-col gap-2 border-t border-[#ececf4] pt-5 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onSync}
          disabled={pendingSync}
          className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[14px]"
        >
          <RefreshCw
            className={`size-4 ${pendingSync ? "animate-spin" : ""}`}
          />
          {pendingSync ? t("syncing") : t("syncEmployees")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDisconnect}
          disabled={pendingDisconnect}
          className="h-11 rounded-2xl border-[#ffd2cd] px-4 text-[14px] text-[#a13a32] hover:bg-[#fff4f2]"
        >
          <Trash2 className="size-4" />
          {t("disconnect")}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-[#9b9fb3]">
        {label}
      </div>
      <div className="mt-1 text-[14px] text-[#0b1024]">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: LinkRow["status"] }) {
  const t = useTranslations("settingsUi.tasksflowSettingsClient");
  const map: Record<
    LinkRow["status"],
    { label: string; className: string }
  > = {
    linked: {
      label: t("statusLinked"),
      className: "bg-[#ecfdf5] text-[#116b2a]",
    },
    no_phone: {
      label: t("statusNoPhone"),
      className: "bg-[#fff4f2] text-[#a13a32]",
    },
    no_match: {
      label: t("statusNoMatch"),
      className: "bg-[#fff8eb] text-[#92400e]",
    },
    pending: {
      label: t("statusPending"),
      className: "bg-[#f5f6ff] text-[#3848c7]",
    },
  };
  const cfg = map[status];
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}
