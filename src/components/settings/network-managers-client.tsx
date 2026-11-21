"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { confirmAsync } from "@/components/ui/confirm-async";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API = "/api/settings/network/managers";
const PILL = "inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap";

export type NetworkManagerView = {
  userId: string;
  name: string;
  email: string;
  organizations: string;
  active: boolean;
  since: string;
};

export type NetworkManagerCandidateView = { userId: string; name: string; label: string };

type Labels = {
  title: string;
  description: string;
  empty: string;
  inactive: string;
  choose: string;
  add: string;
  noCandidates: string;
  remove: string;
  /** Шаблоны с «{name}». */
  removeTitle: string;
  removeDescription: string;
  added: string;
  removed: string;
  failed: string;
};

const withName = (template: string, name: string) => template.replaceAll("{name}", name);

/**
 * «Управляющие сетью» (серия E, Р5): список, «Назначить» из руководителей
 * организаций аккаунта и «Снять». Только владельцу аккаунта — блок рисует
 * сервер (`NetworkManagersSection`); после изменения страница перечитывается.
 */
export function NetworkManagersClient({
  managers,
  candidates,
  labels,
}: {
  managers: NetworkManagerView[];
  candidates: NetworkManagerCandidateView[];
  labels: Labels;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", userId: string): Promise<boolean> {
    try {
      const response = await fetch(API, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(json?.error || labels.failed);
        return false;
      }
      return true;
    } catch {
      toast.error(labels.failed);
      return false;
    }
  }

  async function add() {
    if (!picked || busy) return;
    const candidate = candidates.find((item) => item.userId === picked);
    setBusy("add");
    const ok = await send("POST", picked);
    setBusy(null);
    if (!ok) return;
    toast.success(withName(labels.added, candidate?.name ?? ""));
    setPicked("");
    router.refresh();
  }

  async function remove(manager: NetworkManagerView) {
    if (busy) return;
    const confirmed = await confirmAsync({
      title: withName(labels.removeTitle, manager.name),
      description: labels.removeDescription,
      confirmLabel: labels.remove,
      variant: "danger",
    });
    if (!confirmed) return;
    setBusy(manager.userId);
    const ok = await send("DELETE", manager.userId);
    setBusy(null);
    if (!ok) return;
    toast.success(withName(labels.removed, manager.name));
    router.refresh();
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5" data-network-managers>
      <h2 className="text-[16px] font-semibold text-[#0b1024]">{labels.title}</h2>
      <p className="mt-1 max-w-[720px] text-[13.5px] leading-[1.5] text-[#6f7282]">{labels.description}</p>

      {managers.length === 0 ? (
        <p className="mt-4 text-[13.5px] text-[#9b9fb3]">{labels.empty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-[#f2f3f8] rounded-2xl border border-[#ececf4]">
          {managers.map((manager) => (
            <li key={manager.userId} className="flex flex-wrap items-center gap-3 px-4 py-3" data-network-manager={manager.userId}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words text-[14px] font-medium text-[#0b1024]">{manager.name}</span>
                  {manager.active ? null : <span className={`${PILL} bg-[#fff8eb] text-[#b25f00]`}>{labels.inactive}</span>}
                </div>
                <div className="mt-0.5 break-words text-[12.5px] text-[#6f7282]">
                  {[manager.email, manager.organizations, manager.since].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void remove(manager)}
                disabled={busy !== null}
                data-network-manager-remove={manager.userId}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#a13a32] transition-colors hover:border-[#a13a32]/40 hover:bg-[#fff4f2] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === manager.userId ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
                {labels.remove}
              </button>
            </li>
          ))}
        </ul>
      )}

      {candidates.length === 0 ? (
        <p className="mt-4 text-[13px] text-[#6f7282]">{labels.noCandidates}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={picked} onValueChange={setPicked} disabled={busy !== null}>
            <SelectTrigger className="h-11 w-full rounded-2xl sm:w-[360px]" aria-label={labels.choose} data-network-manager-pick>
              <SelectValue placeholder={labels.choose} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.userId} value={candidate.userId}>
                  {candidate.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => void add()}
            disabled={!picked || busy !== null}
            data-network-manager-add
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "add" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
            {labels.add}
          </button>
        </div>
      )}
    </section>
  );
}
