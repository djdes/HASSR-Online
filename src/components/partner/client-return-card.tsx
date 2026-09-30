"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { ConversionBlockers, ConversionConsequences } from "@/components/partner/conversion-consequences";
import { Card, btnOutline, btnPrimary, readError } from "@/components/partner/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Blocker, Consequences } from "@/lib/partners/org-conversion-core";
import { switchOrganizationAndOpen } from "@/lib/switch-organization";

/**
 * «Сделать моей организацией» — на карточке клиента, которого человек сам
 * перевёл из своего аккаунта. Обратный путь есть только здесь, в
 * партнёрском кабинете: организация возвращается в личный аккаунт,
 * сопровождение завершается, вознаграждение с неё больше не начисляется.
 */

export type ClientReturnView = {
  organizationId: string;
  organizationName: string;
  blockers: Blocker[];
  consequences: Consequences | null;
};

export function ClientReturnCard({ view }: { view: ClientReturnView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [opening, setOpening] = useState(false);
  const canReturn = view.blockers.length === 0 && view.consequences !== null;

  async function submit() {
    const response = await fetch(`/api/partner/clients/${view.organizationId}/return`, { method: "POST" });
    if (!response.ok) {
      toast.error(await readError(response, "Не удалось вернуть организацию"));
      setOpen(false);
      router.refresh();
      return;
    }
    toast.success(`«${view.organizationName}» снова ваша организация`);
    setOpen(false);
    setDone(true);
  }

  async function openOrganization() {
    setOpening(true);
    try {
      await switchOrganizationAndOpen(view.organizationId, "/dashboard");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось открыть организацию");
      setOpening(false);
    }
  }

  if (done) {
    return (
      <Card title="Организация снова ваша" eyebrow="Личный аккаунт">
        <div className="flex items-start gap-2 text-[13.5px] leading-[1.55] text-[#3c4053]" data-testid="client-return-done">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#116b2a]" aria-hidden />
          <span>
            «{view.organizationName}» вернулась в ваш аккаунт, сопровождение завершено. Она уже есть в вашем списке
            организаций.
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={openOrganization} disabled={opening}>
            {opening ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Building2 className="size-4" aria-hidden />}
            Открыть организацию
          </button>
          <button type="button" className={btnOutline} onClick={() => router.refresh()}>
            Остаться в кабинете
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Сделать моей организацией" eyebrow="Вернуть в личный аккаунт">
      <div data-testid="client-return-card">
        <p className="text-[13px] leading-[1.55] text-[#3c4053]">
          Вы перевели эту организацию из своего аккаунта. Её можно вернуть: вы снова владелец, подписку оплачиваете вы,
          вознаграждение с неё больше не начисляется.
        </p>
        {canReturn ? (
          <div className="mt-4">
            <button type="button" className={btnOutline} onClick={() => setOpen(true)} data-testid="client-return-open">
              <Undo2 className="size-4 text-[#5566f6]" aria-hidden />
              Сделать моей организацией
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <ConversionBlockers blockers={view.blockers} title="Сейчас вернуть нельзя" />
          </div>
        )}
      </div>

      {view.consequences ? (
        <ConfirmDialog
          open={open}
          onClose={() => setOpen(false)}
          onConfirm={submit}
          variant="warn"
          icon={Undo2}
          title={`Сделать «${view.organizationName}» вашей организацией?`}
          description="Организация вернётся в ваш личный аккаунт, сопровождение завершится."
          confirmLabel="Сделать моей"
        >
          <ConversionConsequences consequences={view.consequences} />
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
