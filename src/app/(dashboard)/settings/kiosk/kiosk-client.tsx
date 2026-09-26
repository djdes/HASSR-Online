"use client";

import { useState } from "react";
import Image from "next/image";
import { brandQrHeightFor } from "@/lib/brand-qr-shared";
import { Eye, KeyRound, Loader2, Plus, RefreshCw, Trash2, TabletSmartphone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageGuide } from "@/components/ui/page-guide";
import { KIOSK_PIN_EXPLAINER } from "@/lib/kiosk-copy";

export type KioskDeviceRow = { id: string; label: string; lastSeenAt: string | null };
export type KioskEmployeeRow = { id: string; name: string; positionTitle: string | null; hasPin: boolean };

type IssuedPin = { name: string; pin: string };

export function KioskClient({
  idleLockSeconds,
  photoRequired,
  devices,
  employees,
}: {
  idleLockSeconds: number;
  photoRequired: boolean;
  devices: KioskDeviceRow[];
  employees: KioskEmployeeRow[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [idle, setIdle] = useState(idleLockSeconds);
  const [photo, setPhoto] = useState(photoRequired);

  async function togglePhoto(next: boolean) {
    setBusy("photo");
    try {
      const res = await fetch("/api/settings/kiosk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoRequired: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Ошибка");
      setPhoto(next);
      toast.success(next ? "Фото при входе включено" : "Фото при входе выключено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }
  const [newLabel, setNewLabel] = useState("");
  const [enrollQr, setEnrollQr] = useState<{ label: string; qr: string; url: string } | null>(null);
  const [revoke, setRevoke] = useState<KioskDeviceRow | null>(null);
  const [issued, setIssued] = useState<IssuedPin[] | null>(null);

  async function createDevice() {
    if (!newLabel.trim()) return;
    setBusy("create");
    try {
      const res = await fetch("/api/kiosk/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось создать");
      setEnrollQr({ label: newLabel.trim(), qr: data.qrPngDataUrl, url: data.claimUrl });
      setNewLabel("");
      toast.success("Планшет добавлен — откройте QR на нём");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function saveIdle() {
    setBusy("idle");
    try {
      const res = await fetch("/api/settings/kiosk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idleLockSeconds: idle }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Ошибка");
      toast.success("Сохранено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function doRevoke() {
    if (!revoke) return;
    setBusy("revoke");
    try {
      const res = await fetch("/api/settings/kiosk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeDeviceId: revoke.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Ошибка");
      toast.success("Планшет отвязан");
      setRevoke(null);
      location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function issueOne(emp: KioskEmployeeRow) {
    setBusy(`pin:${emp.id}`);
    try {
      const res = await fetch(`/api/staff/${emp.id}/qr-pin`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setIssued([{ name: data.name, pin: data.pin }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function revealOne(emp: KioskEmployeeRow) {
    setBusy(`show:${emp.id}`);
    try {
      const res = await fetch(`/api/staff/${emp.id}/qr-pin`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      if (!data.pin) {
        toast.info("Этот ПИН задан раньше и не сохранён для показа — выдайте новый.");
        return;
      }
      setIssued([{ name: data.name, pin: data.pin }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function issueAll() {
    setBusy("bulk");
    try {
      const res = await fetch("/api/kiosk/pins-bulk", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      if (!data.issued.length) {
        toast.info("У всех уже есть ПИН");
      } else {
        setIssued(data.issued.map((i: { name: string; pin: string }) => ({ name: i.name, pin: i.pin })));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageGuide
        title="Как работает общий планшет"
        storageKey="kiosk-settings"
        bullets={[
          "Добавьте планшет и откройте на нём QR — планшет запомнится как киоск.",
          "Выдайте сотрудникам ПИН — по кнопке рядом или «Выдать всем без кода».",
          KIOSK_PIN_EXPLAINER,
          "На планшете сотрудник выбирает себя, вводит ПИН и заполняет журналы. После простоя планшет сам возвращается к списку.",
        ]}
      />

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Планшеты</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="mb-1 block text-[13px] text-[#6f7282]">Название планшета</label>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Кухня, Склад №2…" maxLength={120} />
          </div>
          <Button onClick={createDevice} disabled={busy === "create" || !newLabel.trim()} className="gap-2">
            {busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Добавить планшет
          </Button>
        </div>

        {devices.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-2xl border border-[#ececf4] px-4 py-3">
                <TabletSmartphone className="size-5 text-[#5566f6]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-[#0b1024]">{d.label}</div>
                  <div className="text-[12px] text-[#9b9fb3]">{d.lastSeenAt ? `Активность: ${new Date(d.lastSeenAt).toLocaleString("ru-RU")}` : "Ещё не открывался"}</div>
                </div>
                <button onClick={() => setRevoke(d)} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[13px] text-[#a13a32] transition-colors hover:bg-[#fff4f2]">
                  <Trash2 className="size-4" /> Отвязать
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-[13px] text-[#6f7282]">Планшетов пока нет. Добавьте первый.</p>
        )}
      </section>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Автолок</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[13px] text-[#6f7282]">Возврат к списку через (секунд бездействия)</label>
            <Input type="number" min={30} max={1800} value={idle} onChange={(e) => setIdle(Number(e.target.value) || 90)} className="w-[160px]" />
          </div>
          <Button variant="outline" onClick={saveIdle} disabled={busy === "idle"} className="gap-2">
            {busy === "idle" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Сохранить
          </Button>
        </div>
      </section>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Фото при входе</div>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={photo}
            disabled={busy === "photo"}
            onChange={(e) => togglePhoto(e.target.checked)}
            className="mt-1 size-4 accent-[#5566f6]"
          />
          <span className="text-[14px] leading-relaxed text-[#0b1024]">
            Снимать кадр с фронтальной камеры при входе по ПИН и прикладывать к подписи.
            <span className="block text-[13px] text-[#6f7282]">
              Это доказательство «вошёл именно он» для проверки, не распознавание лиц. Кадр снимается только после согласия сотрудника — планшет спросит его при первом входе. Без согласия сотрудник работает как обычно, фото не делается.
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">ПИН сотрудников</div>
          <Button variant="outline" size="sm" onClick={issueAll} disabled={busy === "bulk"} className="gap-2">
            {busy === "bulk" ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Выдать всем без кода
          </Button>
        </div>
        <p className="mb-4 text-[13px] leading-relaxed text-[#6f7282]">{KIOSK_PIN_EXPLAINER}</p>
        <ul className="space-y-2">
          {employees.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-2xl border border-[#ececf4] px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-[#0b1024]">{e.name}</div>
                {e.positionTitle ? <div className="text-[12px] text-[#9b9fb3]">{e.positionTitle}</div> : null}
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[12px] ${e.hasPin ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#fff8eb] text-[#b25f00]"}`}>
                {e.hasPin ? "ПИН задан" : "нет ПИН"}
              </span>
              {e.hasPin ? (
                <button onClick={() => revealOne(e)} disabled={busy === `show:${e.id}`} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[13px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff]">
                  {busy === `show:${e.id}` ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />} Показать
                </button>
              ) : null}
              <button onClick={() => issueOne(e)} disabled={busy === `pin:${e.id}`} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[13px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff]">
                {busy === `pin:${e.id}` ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} {e.hasPin ? "Сменить" : "Выдать"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {enrollQr ? (
        <ConfirmDialog
          open
          onClose={() => setEnrollQr(null)}
          onConfirm={() => setEnrollQr(null)}
          title={`Планшет «${enrollQr.label}»`}
          description="Откройте этот QR на планшете (камерой или браузером). Планшет запомнится, ссылка одноразовая."
          confirmLabel="Готово"
          variant="info"
        >
          <div className="flex flex-col items-center gap-3">
            <Image src={enrollQr.qr} alt="QR" width={220} height={brandQrHeightFor(220)} unoptimized className="h-auto rounded-2xl border border-[#ececf4]" />
            <code className="break-all rounded-xl bg-[#f5f6ff] px-3 py-2 text-[12px] text-[#3848c7]">{enrollQr.url}</code>
          </div>
        </ConfirmDialog>
      ) : null}

      {issued ? (
        <ConfirmDialog
          open
          onClose={() => setIssued(null)}
          onConfirm={() => setIssued(null)}
          title="Коды выданы"
          description="Покажите их сотрудникам — ПИН больше нигде не отображается."
          confirmLabel="Готово"
          variant="info"
        >
          <ul className="space-y-1.5">
            {issued.map((i, index) => (
              <li key={`${i.name}-${index}`} className="flex items-center justify-between rounded-xl bg-[#f5f6ff] px-3 py-2">
                <span className="text-[14px] text-[#0b1024]">{i.name}</span>
                <span className="font-mono text-[18px] font-semibold tracking-[0.3em] text-[#3848c7]">{i.pin}</span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      ) : null}

      {revoke ? (
        <ConfirmDialog
          open
          onClose={() => setRevoke(null)}
          onConfirm={doRevoke}
          title={`Отвязать «${revoke.label}»?`}
          description="Планшет перестанет быть киоском. Уже сделанные записи останутся."
          confirmLabel="Отвязать"
          variant="danger"
          confirmDisabled={busy === "revoke"}
        />
      ) : null}
    </div>
  );
}
