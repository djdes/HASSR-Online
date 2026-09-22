"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { pinRequestKindLabel } from "@/lib/qr-pin-requests-core";
import type { PinRequestListItem } from "@/lib/qr-pin-requests";

/**
 * «Запросы PIN» на странице сотрудников: сотрудник на QR-странице сам
 * придумал PIN («Запросить доступ» / «Запросить смену PIN»), руководитель
 * одобряет — и PIN сразу начинает работать. Панели нет, пока запросов нет.
 */
export function PinRequestsPanel({ initial }: { initial: PinRequestListItem[] }) {
  const router = useRouter();
  const [requests, setRequests] = useState(initial);
  const [pending, setPending] = useState<{ request: PinRequestListItem; approve: boolean } | null>(null);
  const [note, setNote] = useState("");

  if (requests.length === 0) return null;

  async function decide() {
    if (!pending) return;
    const response = await fetch(`/api/staff/pin-requests/${pending.request.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: pending.approve ? "approve" : "reject", note: pending.approve ? null : note.trim() || null }),
    });
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      toast.error(result?.error ?? "Не удалось сохранить решение");
      return;
    }
    toast.success(
      pending.approve
        ? `PIN для «${pending.request.userName}» включён`
        : `Запрос «${pending.request.userName}» отклонён`
    );
    setRequests((current) => current.filter((item) => item.id !== pending.request.id));
    setPending(null);
    setNote("");
    router.refresh();
  }

  return (
    <section
      id="pin-requests"
      className="mb-6 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <KeyRound className="size-5" />
        </span>
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            Запросы PIN · <span className="tabular-nums">{requests.length}</span>
          </h2>
          <p className="text-[13px] text-[#6f7282]">
            Сотрудник сам придумал PIN на QR-странице. После одобрения он сразу подтверждает им записи.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {requests.map((request) => (
          <li
            key={request.id}
            className="flex flex-col gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-[#0b1024]">{request.userName}</div>
              <div className="text-[13px] text-[#6f7282]">
                {[request.positionTitle, pinRequestKindLabel(request.kind), formatWhen(request.createdAt)].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPending({ request, approve: false })}
                className="h-10 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                Отклонить
              </button>
              <button
                type="button"
                onClick={() => setPending({ request, approve: true })}
                className="h-10 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                Одобрить
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
          setNote("");
        }}
        onConfirm={decide}
        variant={pending?.approve ? "info" : "warn"}
        title={pending?.approve ? `Включить PIN для «${pending.request.userName}»?` : `Отклонить запрос «${pending?.request.userName ?? ""}»?`}
        confirmLabel={pending?.approve ? "Одобрить" : "Отклонить"}
        bullets={
          pending
            ? pending.approve
              ? [
                  { label: `${pinRequestKindLabel(pending.request.kind)}: сотрудник придумал его сам`, tone: "info" },
                  { label: "PIN начнёт работать сразу — им подтверждаются записи в QR-журналах" },
                  ...(pending.request.kind === "change" ? [{ label: "Старый PIN перестанет действовать", tone: "warn" as const }] : []),
                  { label: `Запрос отправлен ${formatWhen(pending.request.createdAt)}${pending.request.ip ? ` · IP ${pending.request.ip}` : ""}` },
                ]
              : [
                  { label: "PIN не изменится", tone: "info" },
                  { label: "Сотрудник увидит, что запрос отклонён, и сможет отправить новый" },
                ]
            : []
        }
      >
        {pending && !pending.approve ? (
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-[#6f7282]">Причина (увидит сотрудник)</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
              placeholder="Например: подойдите, выдам лично"
              className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
