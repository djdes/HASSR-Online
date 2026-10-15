"use client";

import { useState } from "react";
import { Building2, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Organization = { id: string; name: string };
export function MasterObjectsPanel({ organizations, onChange }: { organizations: Organization[]; onChange: (items: Organization[]) => void }) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<{ organizationName: string; connected: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect(confirm: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/master/objects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, confirm }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Не удалось подключить объект");
      if (confirm) { onChange(body.organizations); setPreview(null); setCode(""); toast.success("Объект подключён. Теперь ему можно выгрузить справочник на выбранную дату."); }
      else setPreview(body.preview);
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось подключить объект"); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">Подключённые объекты</h1>
      <p className="mt-2 text-[14px] text-[#6f7282]">В эти пищеблоки можно выгружать справочник блюд и отправлять исправления.</p>
      {organizations.length ? <ul className="mt-4 divide-y divide-[#ececf4] rounded-2xl border border-[#ececf4]" data-testid="master-objects-list">{organizations.map(org => <li key={org.id} className="flex items-center gap-3 p-4 text-[14px] text-[#0b1024]"><Building2 className="size-4 shrink-0 text-[#5566f6]" /><span className="min-w-0 break-words">{org.name}</span></li>)}</ul> : <p className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-6 text-[#6f7282]">Подключённых объектов пока нет.</p>}
    </section>
    <section className="space-y-4 rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
      <h2 className="text-[16px] font-semibold text-[#0b1024]">Подключить журнал объекта</h2>
      <p className="text-[13px] leading-relaxed text-[#6f7282]">Откройте настройки бракеражного журнала пищеблока и скопируйте «Код журнала объекта». Введите его здесь. Существующие записи журнала сохранятся; выгрузка блюд выполняется отдельно, с выбором даты.</p>
      <label className="block text-[13px] text-[#3c4053]">Код журнала объекта<input aria-label="Код журнала объекта" value={code} disabled={busy} onChange={event => { setCode(event.target.value); setPreview(null); setError(""); }} placeholder="ABCDE-FGH23" maxLength={40} className="mt-2 h-11 w-full rounded-2xl border border-[#dcdfed] px-3 font-mono uppercase text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15" /></label>
      <button type="button" disabled={busy || code.trim().length < 10} onClick={() => void connect(false)} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] text-white disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}Найти объект</button>
      {error ? <p role="alert" className="text-[13px] text-[#a13a32]">{error}</p> : null}
      {preview ? <div className="space-y-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4"><p className="break-words text-[14px] font-medium text-[#0b1024]">{preview.organizationName}</p><p className="text-[13px] text-[#6f7282]">{preview.connected ? "Объект уже подключён к этому мастер-кабинету." : "Подключить этот объект к справочникам мастер-кабинета?"}</p><button type="button" disabled={busy} onClick={() => void connect(true)} className="h-10 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#3848c7] disabled:opacity-50">{preview.connected ? "Обновить список" : "Подключить объект"}</button></div> : null}
    </section>
  </div>;
}
