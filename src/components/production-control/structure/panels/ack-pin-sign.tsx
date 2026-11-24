"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PPK_BUTTON_OUTLINE_CLASS, PPK_BUTTON_PRIMARY_CLASS, PPK_FIELD_CLASS } from "@/components/production-control/ppk-ui";

/**
 * Подпись листа ознакомления PIN-кодом сотрудника на устройстве руководителя
 * (общий планшет на производстве): сотрудник выбирает себя, вводит свой PIN и
 * подтверждает «Ознакомлен и согласен».
 */
export function AckPinSign({ pending }: { pending: { userId: string; name: string }[] }) {
  const t = useTranslations("productionControl.structure.acquaintance");
  const router = useRouter();
  const [person, setPerson] = useState<{ userId: string; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (pending.length === 0) return <p className="text-[13.5px] text-[#1f7a46]">{t("allSigned")}</p>;

  async function sign() {
    if (!person || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/production-control/acknowledgements/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.userId, pin }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error || t("pinFailed"));
        return;
      }
      toast.success(t("signed", { name: person.name }));
      setPerson(null);
      setPin("");
      window.dispatchEvent(new Event("ppk:changed"));
      router.refresh();
    } catch {
      setError(t("pinFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-ppk-ack-pin>
      <h4 className="text-[14px] font-semibold text-[#0b1024]">{t("pendingTitle", { count: String(pending.length) })}</h4>
      <ul className="grid gap-2 sm:grid-cols-2">
        {pending.map((row) => (
          <li key={row.userId} className="flex items-center gap-2 rounded-2xl bg-[var(--app-veil)] py-1.5 pr-1.5 pl-4">
            <span className="min-w-0 flex-1 truncate text-[14px] text-[#0b1024]">{row.name}</span>
            <button
              type="button"
              onClick={() => {
                setPerson(row);
                setPin("");
                setError(null);
              }}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <KeyRound className="size-4" aria-hidden />
              {t("signWithPin")}
            </button>
          </li>
        ))}
      </ul>

      {person ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setPerson(null))}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader className="text-left">
              <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{person.name}</DialogTitle>
              <DialogDescription className="text-[13.5px] text-[#6f7282]">{t("pinHint")}</DialogDescription>
            </DialogHeader>
            {/* `method="post"`: PIN не должен уйти в адрес, если форму отправят до загрузки скриптов. */}
            <form
              method="post"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void sign();
              }}
            >
              <input
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="off"
                type="password"
                autoFocus
                aria-label={t("pinLabel")}
                placeholder={t("pinLabel")}
                aria-invalid={error ? true : undefined}
                className={`${PPK_FIELD_CLASS} text-center text-[20px] tracking-[0.4em]`}
              />
              {error ? (
                <p role="alert" className="text-[13px] text-[#a13a32]">
                  {error}
                </p>
              ) : null}
              <DialogFooter className="gap-2">
                <button type="button" onClick={() => setPerson(null)} className={PPK_BUTTON_OUTLINE_CLASS}>
                  {t("cancel")}
                </button>
                <button type="submit" disabled={busy || pin.length < 4} className={PPK_BUTTON_PRIMARY_CLASS}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  {t("agreeButton")}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
