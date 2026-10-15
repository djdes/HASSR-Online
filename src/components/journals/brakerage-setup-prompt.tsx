"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { hasCapability } from "@/lib/permission-presets";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CommissionDialog } from "@/components/journals/commission-dialog";
import { useJournalControls, saveJournalControls } from "@/components/journals/journal-controls-provider";

export function BrakerageSetupPrompt() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { controls, loaded, refresh } = useJournalControls();
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [responsible, setResponsible] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [commissionOpen, setCommissionOpen] = useState(false);
  const open = loaded && !!session && hasCapability(session.user, "admin.full") && pathname.includes("/journals/finished_product") && !controls.brakerageSetup.finished_product;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError("");
    void fetch("/api/settings/brakerage-setup", { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить сотрудников");
      if (alive) { setUsers(body.users); setResponsible((previous) => body.users.some((user: { id: string }) => user.id === previous) ? previous : body.responsibleUserId); setMembers(body.members.map((member: { employeeId: string }) => member.employeeId)); }
    }).catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [open, commissionOpen]);
  async function decide(declined: boolean) {
    setBusy(true);
    try {
      if (declined) await saveJournalControls({ setup: { code: "finished_product", decision: "declined" } });
      else {
        const response = await fetch("/api/settings/brakerage-setup", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ responsibleUserId: responsible, memberIds: members }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Не удалось сохранить");
        window.dispatchEvent(new Event("journal-controls-changed"));
      }
      await refresh(); router.refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Не удалось сохранить"); }
    finally { setBusy(false); }
  }
  if (!open && !commissionOpen) return null;
  return <>
    <Dialog open={open && !commissionOpen}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} className="flex max-h-[90dvh] flex-col overflow-hidden rounded-3xl sm:max-w-[560px]">
        <DialogHeader><DialogTitle>Кто ведёт бракеражный журнал</DialogTitle><DialogDescription>Укажите комиссию и ответственного за ведение журнала или откажитесь от настройки. Назначение не проставляет подписи в записях.</DialogDescription></DialogHeader>
        <div className="space-y-4 overflow-y-auto">
          {error ? <p role="alert" className="text-[#a13a32]">{error}</p> : null}
          <label className="block text-[14px] font-medium">Ответственный за ведение журнала
            <select aria-label="Ответственный за ведение журнала" value={responsible} onChange={(e) => setResponsible(e.target.value)} className="mt-2 h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3">
              <option value="">Не выбран</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <fieldset><legend className="mb-2 text-[14px] font-medium">Бракеражная комиссия</legend>
            <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-2xl border border-[#ececf4] p-3">
              {users.map((user) => <label key={user.id} className="flex items-center gap-2 text-[14px]"><Checkbox checked={members.includes(user.id)} onCheckedChange={(checked) => setMembers((prev) => checked ? [...new Set([...prev, user.id])] : prev.filter((id) => id !== user.id))} />{user.name}</label>)}
              {!users.length ? <p className="text-[13px] text-[#6f7282]">Добавьте сотрудников или членов комиссии.</p> : null}
            </div>
            <Button variant="outline" className="mt-2 rounded-2xl" onClick={() => setCommissionOpen(true)}>Добавить стороннюю комиссию</Button>
          </fieldset>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#ececf4] pt-4">
          <Button variant="outline" disabled={busy} onClick={() => void decide(true)}>Отказаться от настройки</Button>
          <Button disabled={busy || !responsible || !members.length} onClick={() => void decide(false)}>{busy ? "Сохранение…" : "Сохранить"}</Button>
        </div>
      </DialogContent>
    </Dialog>
    <CommissionDialog code="finished_product" open={commissionOpen} onClose={() => setCommissionOpen(false)} onSaved={(next) => setMembers(next.map((member) => member.employeeId))} />
  </>;
}
