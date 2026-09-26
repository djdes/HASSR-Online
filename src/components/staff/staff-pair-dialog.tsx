"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { brandQrHeightFor } from "@/lib/brand-qr-shared";

type PairPayload = {
  pairUrl: string;
  qrPngDataUrl: string;
  expiresAt: string;
  userName: string | null;
  phone: string | null;
};

/**
 * «Вход без Telegram» — руководитель показывает сотруднику QR, тот
 * сканирует своей камерой, задаёт пароль и оказывается в кабинете.
 *
 * Почему именно так, а не SMS-код: помимо цены и недель на регистрацию
 * альфа-имени у оператора, SMS просто не доходит в подвал кухни с одной
 * палкой сети. А QR, показанный человеку лично в первую смену, — ещё и
 * более сильное подтверждение личности, чем код на чужой номер.
 */
export function StaffPairDialog({
  employeeId,
  employeeName,
  open,
  onClose,
}: {
  employeeId: string | null;
  employeeName: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<PairPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open || !employeeId) {
      setPayload(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setPending(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/staff/${employeeId}/pair-token`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Не удалось создать ссылку");
          return;
        }
        setPayload(data as PairPayload);
      } catch {
        if (!cancelled) setError("Нет связи с сервером");
      } finally {
        if (!cancelled) setPending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, employeeId]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-[460px] overflow-y-auto rounded-[24px]">
        <DialogHeader>
          <DialogTitle>Вход без Telegram</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] leading-[1.6] text-[#6f7282]">
          Покажите этот код сотруднику — {employeeName ?? "он"} отсканирует его
          камерой телефона, придумает пароль и сразу войдёт. Дальше вход по
          номеру телефона и паролю, Telegram не нужен.
        </p>

        {pending ? (
          <div className="flex h-[280px] items-center justify-center">
            <Loader2 className="size-7 animate-spin text-[#5566f6]" />
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] leading-[1.55] text-[#a13a32]">
            {error}
          </div>
        ) : payload ? (
          <div className="space-y-4">
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={payload.qrPngDataUrl}
                alt="QR-код для входа"
                width={280}
                height={brandQrHeightFor(280)}
                className="h-auto rounded-2xl border border-[#ececf4] bg-white p-2"
              />
            </div>

            <div className="rounded-2xl bg-[#fafbff] px-4 py-3 text-[13px] leading-[1.6] text-[#3c4053]">
              Логином будет номер{" "}
              <span className="font-medium text-[#0b1024]">
                {payload.phone ?? "—"}
              </span>
              . Ссылка одноразовая и действует до{" "}
              {new Date(payload.expiresAt).toLocaleString("ru-RU")}.
            </div>

            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(payload.pairUrl)
                  .then(() => toast.success("Ссылка скопирована"))
                  .catch(() => toast.error("Не удалось скопировать"));
              }}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <Copy className="size-4 text-[#5566f6]" />
              Скопировать ссылку
            </button>

            <p className="flex items-start gap-2 text-[12px] leading-[1.5] text-[#9b9fb3]">
              <QrCode className="mt-0.5 size-4 shrink-0" />
              Новый код гасит предыдущий: если сотрудник потеряет ссылку,
              просто откройте это окно ещё раз.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
