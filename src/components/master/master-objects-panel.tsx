"use client";

import { useState } from "react";
import { Building2, Link2, Loader2, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Объект кабинета: точка («Организация · Точка») или организация целиком. */
type Organization = { id: string; name: string };
export function MasterObjectsPanel({ organizations, onChange }: { organizations: Organization[]; onChange: (items: Organization[]) => void }) {
  const t = useTranslations("masterUi.masterObjectsPanel");
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<{ organizationName: string; connected: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Organization | null>(null);
  async function connect(confirm: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/master/objects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, confirm }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("connectFailed"));
      if (confirm) { onChange(body.organizations); setPreview(null); setCode(""); toast.success(t("connected")); }
      else setPreview(body.preview);
    } catch (error) { setError(error instanceof Error ? error.message : t("connectFailed")); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!removing) return;
    const response = await fetch("/api/master/objects", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectId: removing.id }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { toast.error(body.error || t("disconnectFailed")); return; }
    onChange(body.organizations);
    toast.success(t("disconnected", { name: removing.name }));
    setRemoving(null);
  }
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
      <p className="mt-2 text-[14px] text-[#6f7282]">{t("description")}</p>
      {organizations.length ? <ul className="mt-4 divide-y divide-[#ececf4] rounded-2xl border border-[#ececf4]" data-testid="master-objects-list">{organizations.map(org => <li key={org.id} className="flex items-center gap-3 p-4 text-[14px] text-[#0b1024]"><Building2 className="size-4 shrink-0 text-[#5566f6]" /><span className="min-w-0 flex-1 break-words">{org.name}</span><button type="button" onClick={() => setRemoving(org)} aria-label={t("disconnectAria", { name: org.name })} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] text-[#6f7282] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"><Unlink className="size-4" /><span className="hidden sm:inline">{t("disconnect")}</span></button></li>)}</ul> : <p className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-6 text-[#6f7282]">{t("empty")}</p>}
    </section>
    <section className="space-y-4 rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
      <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("connectTitle")}</h2>
      <p className="text-[13px] leading-relaxed text-[#6f7282]">{t("connectHint")}</p>
      <label className="block text-[13px] text-[#3c4053]">{t("codeLabel")}<input aria-label={t("codeLabel")} value={code} disabled={busy} onChange={event => { setCode(event.target.value); setPreview(null); setError(""); }} placeholder="ABCDE-FGH23" maxLength={40} className="mt-2 h-11 w-full rounded-2xl border border-[#dcdfed] px-3 font-mono uppercase text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15" /></label>
      <button type="button" disabled={busy || code.trim().length < 10} onClick={() => void connect(false)} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] text-white disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}{t("find")}</button>
      {error ? <p role="alert" className="text-[13px] text-[#a13a32]">{error}</p> : null}
      {preview ? <div className="space-y-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4"><p className="break-words text-[14px] font-medium text-[#0b1024]">{preview.organizationName}</p><p className="text-[13px] text-[#6f7282]">{preview.connected ? t("alreadyConnected") : t("confirmConnect")}</p><button type="button" disabled={busy} onClick={() => void connect(true)} className="h-10 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#3848c7] disabled:opacity-50">{preview.connected ? t("refreshList") : t("connect")}</button></div> : null}
    </section>
    <ConfirmDialog
      open={removing !== null}
      onClose={() => setRemoving(null)}
      onConfirm={disconnect}
      variant="warn"
      icon={Unlink}
      title={t("disconnectTitle", { name: removing?.name ?? "" })}
      bullets={[
        { label: t("disconnectNoMore") },
        { label: t("disconnectKeep"), tone: "info" },
        { label: t("disconnectAgain") },
      ]}
      confirmLabel={t("disconnect")}
    />
  </div>;
}
