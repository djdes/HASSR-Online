"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PinRequestListItem } from "@/lib/qr-pin-requests";

/**
 * «Запросы PIN» на странице сотрудников: сотрудник на QR-странице сам
 * придумал PIN («Запросить доступ» / «Запросить смену PIN»), руководитель
 * одобряет — и PIN сразу начинает работать. Панели нет, пока запросов нет.
 */
export function PinRequestsPanel({ initial }: { initial: PinRequestListItem[] }) {
  const t = useTranslations("staffManagement.pinRequests");
  const locale = useLocale();
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
    if (!response.ok) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(
      pending.approve
        ? t("approvedToast", { name: pending.request.userName })
        : t("rejectedToast", { name: pending.request.userName })
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
            {t("title", { count: requests.length })}
          </h2>
          <p className="text-[13px] text-[#6f7282]">
            {t("description")}
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
                {[request.positionTitle, t(request.kind === "issue" ? "kind.issue" : "kind.change"), formatWhen(request.createdAt, locale)].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPending({ request, approve: false })}
                className="h-10 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                {t("reject")}
              </button>
              <button
                type="button"
                onClick={() => setPending({ request, approve: true })}
                className="h-10 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                {t("approve")}
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
        title={pending?.approve ? t("approveTitle", { name: pending.request.userName }) : t("rejectTitle", { name: pending?.request.userName ?? "" })}
        confirmLabel={pending?.approve ? t("approve") : t("reject")}
        bullets={
          pending
            ? pending.approve
              ? [
                  { label: t("approvedKind", { kind: t(pending.request.kind === "issue" ? "kind.issue" : "kind.change") }), tone: "info" },
                  { label: t("approvedEffect") },
                  ...(pending.request.kind === "change" ? [{ label: t("oldPinInvalidated"), tone: "warn" as const }] : []),
                  { label: t("requestSent", { date: formatWhen(pending.request.createdAt, locale), ip: pending.request.ip ? ` · IP ${pending.request.ip}` : "" }) },
                ]
              : [
                  { label: t("rejectedEffect"), tone: "info" },
                  { label: t("rejectedNextStep") },
                ]
            : []
        }
      >
        {pending && !pending.approve ? (
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-[#6f7282]">{t("reasonLabel")}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
              placeholder={t("reasonPlaceholder")}
              className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}

function formatWhen(iso: string, locale: string): string {
  const date = new Date(iso);
  return date.toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
