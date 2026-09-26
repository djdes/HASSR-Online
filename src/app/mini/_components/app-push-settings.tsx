"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import {
  getNativeBridge,
  openAppSettings,
  pushPermission,
  readStoredPushToken,
  registerPushDevice,
  requestPushPermission,
} from "@/lib/native-bridge";

type State =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "ready"; enabled: boolean; token: string | null };

async function readPreference(token: string): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/mobile/devices/preferences?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { pushEnabled?: unknown };
    return typeof body.pushEnabled === "boolean" ? body.pushEnabled : null;
  } catch {
    return null;
  }
}

async function writePreference(token: string, pushEnabled: boolean): Promise<boolean> {
  try {
    const res = await fetch("/api/mobile/devices/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, pushEnabled }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * «Уведомления на этом телефоне» — в профиле, только в приложении WeSetup.
 *
 * Выключатель — настройка этого телефона на сервере (`pushEnabled`): у
 * человека может быть рабочий и личный телефон. Если уведомления
 * запрещены в настройках телефона, сайт их не включит — показываем, что
 * случилось, и кнопку в настройки.
 */
export function AppPushSettings() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const bridge = getNativeBridge();
    if (!bridge) {
      setState({ kind: "hidden" });
      return;
    }
    const permission = await pushPermission(bridge);
    if (permission === null) {
      setState({ kind: "hidden" });
      return;
    }
    if (permission === "denied") {
      setState({ kind: "denied" });
      return;
    }
    if (permission !== "granted") {
      setState({ kind: "ready", enabled: false, token: null });
      return;
    }
    let token = readStoredPushToken();
    let enabled = token ? await readPreference(token) : null;
    if (enabled === null) {
      // Токена нет или сервер телефон не знает — регистрируем заново.
      token = await registerPushDevice(bridge);
      enabled = token ? await readPreference(token) : null;
    }
    if (!token || enabled === null) {
      setState({ kind: "unavailable" });
      return;
    }
    setState({ kind: "ready", enabled, token });
  }, []);

  useEffect(() => {
    void load();
    // Вернулись из настроек телефона — разрешение могло поменяться.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  async function toggle(next: boolean) {
    if (state.kind !== "ready" || busy) return;
    setBusy(true);
    try {
      let token = state.token;
      if (!token) {
        const bridge = getNativeBridge();
        const permission = await requestPushPermission(bridge);
        if (permission === "denied") {
          setState({ kind: "denied" });
          return;
        }
        if (permission !== "granted") return;
        token = await registerPushDevice(bridge);
        if (!token) {
          toast.error("Не удалось включить уведомления. Попробуйте позже");
          return;
        }
      }
      setState({ kind: "ready", enabled: next, token });
      if (!(await writePreference(token, next))) {
        setState({ kind: "ready", enabled: !next, token });
        toast.error("Не удалось сохранить. Проверьте интернет и попробуйте ещё раз");
      }
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "hidden" || state.kind === "loading") return null;

  return (
    <section className="mini-card p-4" data-testid="app-push-settings">
      <div className="flex items-start gap-3">
        <span className="mini-tile">
          <BellRing className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold" style={{ color: "var(--mini-text)" }}>
            Уведомления на этом телефоне
          </div>
          <div className="mt-0.5 text-[14.5px]" style={{ color: "var(--mini-text-muted)" }}>
            Задачи смены, напоминания и ответы руководителя
          </div>
        </div>
        {state.kind === "ready" ? (
          <Switch
            checked={state.enabled}
            disabled={busy}
            onCheckedChange={(next) => void toggle(next)}
            aria-label="Уведомления на этом телефоне"
            data-testid="app-push-toggle"
            className="mt-1"
          />
        ) : null}
      </div>
      {state.kind === "denied" ? (
        <div className="mt-3 space-y-3" data-testid="app-push-denied">
          <p className="text-[15px] leading-[1.5]" style={{ color: "var(--mini-danger)" }}>
            Уведомления запрещены в настройках телефона
          </p>
          <button
            type="button"
            onClick={() => void openAppSettings().catch(() => undefined)}
            className="mini-btn-primary mini-press w-full"
            data-testid="app-push-open-settings"
          >
            <Settings2 className="size-5" />
            Открыть настройки
          </button>
        </div>
      ) : null}
      {state.kind === "unavailable" ? (
        <p className="mt-3 text-[15px] leading-[1.5]" style={{ color: "var(--mini-text-muted)" }}>
          Уведомления пока не подключились. Проверьте интернет и откройте профиль ещё раз.
        </p>
      ) : null}
    </section>
  );
}
