"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, readError } from "@/components/partner/ui";
import { cn } from "@/lib/utils";

/**
 * «Не показывать клиентам информацию о консультанте». Один переключатель на
 * всех клиентов партнёра; перед включением — что именно пропадёт у клиента.
 */
export function PartnerVisibilityCard({ initialHidden, canEdit }: { initialHidden: boolean; canEdit: boolean }) {
  const [hidden, setHidden] = useState(initialHidden);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/partner/visibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hideFromClients: next }),
      });
      if (!res.ok) throw new Error(await readError(res, "Не удалось сохранить"));
      setHidden(next);
      setConfirmOpen(false);
      toast.success(next ? "Клиенты больше не видят информацию о консультанте" : "Клиенты снова видят ваш брендинг и контакты");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card eyebrow="Видимость для клиентов" title="Не показывать клиентам информацию о консультанте">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-[620px] space-y-2 text-[14px] leading-[1.55] text-[#3c4053]">
          <p>
            {hidden
              ? "Включено: клиенты видят обычный WeSetup. Ваш доступ к их кабинетам остаётся — у клиента он называется «Служба сопровождения WeSetup»."
              : "Выключено: клиенты видят ваш логотип, контакты и строку «Ваш консультант»."}
          </p>
          <p className="text-[13px] text-[#6f7282]">
            Действует на всех ваших клиентов сразу, изменения доходят в течение 5 минут.
            {canEdit ? "" : " Переключает владелец кабинета."}
          </p>
        </div>
        <label
          className={cn(
            "inline-flex shrink-0 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors duration-150",
            hidden ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40",
            (!canEdit || busy) && "cursor-not-allowed opacity-60"
          )}
        >
          <input
            type="checkbox"
            className="size-5 accent-[#5566f6]"
            checked={hidden}
            disabled={!canEdit || busy}
            onChange={(event) => (event.target.checked ? setConfirmOpen(true) : void save(false))}
            data-testid="partner-hide-from-clients"
          />
          <span className="flex items-center gap-2 text-[14px] font-medium text-[#0b1024]">
            {busy ? <Loader2 className="size-4 animate-spin text-[#5566f6]" /> : hidden ? <EyeOff className="size-4 text-[#5566f6]" /> : <Eye className="size-4 text-[#5566f6]" />}
            Не отображать
          </span>
        </label>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => save(true)}
        variant="warn"
        title="Скрыть информацию о консультанте у всех клиентов?"
        description="Клиенты будут видеть обычный WeSetup."
        bullets={[
          { label: "Пропадут ваш логотип, цвет, контакты и «Ваш консультант» — в кабинете, письмах, PDF и Telegram" },
          { label: "Чат поддержки клиентов перейдёт в поддержку WeSetup — в разделе «Чаты» их не будет", tone: "warn" },
          { label: "Ваши действия в журнале клиента подпишутся «служба сопровождения WeSetup»" },
          { label: "Доступ к кабинетам клиентов и начисления сохраняются", tone: "info" },
          { label: "Выключить можно в любой момент" },
        ]}
        confirmLabel="Скрыть"
      />
    </Card>
  );
}
