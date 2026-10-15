"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { parseJournalControls, type JournalControls } from "@/lib/journal-controls";

const initial = { ...parseJournalControls(null), specialMode: true };
const Context = createContext({ controls: initial, loaded: false, refresh: async () => {}, apply: (_controls: JournalControls) => {} });

export function JournalControlsProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const organizationId = session?.user.actingAsOrganizationId || session?.user.activeOrganizationId || session?.user.organizationId;
  const orgKind = session?.user.orgKind;
  const [state, setState] = useState<{ controls: JournalControls; organizationId: string | undefined } | null>(null);
  const requestSequence = useRef(0);
  const apply = useCallback((controls: JournalControls) => {
    ++requestSequence.current;
    setState({ controls, organizationId });
  }, [organizationId]);
  const refresh = useCallback(async () => {
    if (orgKind === "directory") return;
    const sequence = ++requestSequence.current;
    const response = await fetch("/api/settings/journal-controls", { cache: "no-store" }).catch(() => null);
    if (response?.ok) {
      const controls = parseJournalControls(await response.json());
      if (sequence === requestSequence.current) setState({ controls, organizationId });
    }
  }, [organizationId, orgKind]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const update = () => { void refresh(); };
    window.addEventListener("journal-controls-changed", update);
    window.addEventListener("focus", update);
    return () => { window.removeEventListener("journal-controls-changed", update); window.removeEventListener("focus", update); };
  }, [refresh]);
  const loaded = orgKind === "directory" || (state !== null && state.organizationId === organizationId);
  return <Context.Provider value={{ controls: orgKind === "directory" ? parseJournalControls(null) : loaded && state ? state.controls : initial, loaded, refresh, apply }}>{children}</Context.Provider>;
}

export function useJournalControls() { return useContext(Context); }

export async function saveJournalControls(patch: unknown) {
  const response = await fetch("/api/settings/journal-controls", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Не удалось сохранить настройки");
  window.dispatchEvent(new Event("journal-controls-changed"));
  return parseJournalControls(body);
}
