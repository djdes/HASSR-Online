"use client";

import { useRef, useState } from "react";
import type { RootMetricsCopy } from "../metrics-presentation";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Удаление организации с подтверждением.
 *
 * Общий компонент для списка организаций и таблицы метрик: подтверждение
 * необратимого действия не должно существовать в двух вариантах — второй
 * рано или поздно отстанет и начнёт врать о последствиях.
 */
export function OrgDeleteButton({
  organizationId,
  organizationName,
  usersCount,
  documentsCount,
  disabled = false,
  copy,
}: {
  organizationId: string;
  organizationName: string;
  /** Показываем в подтверждении, если вызывающий знает цифры. */
  usersCount?: number;
  documentsCount?: number;
  disabled?: boolean;
  /** Preserve the legacy presentation unless the metrics caller opts in. */
  copy?: RootMetricsCopy;
}) {
  const currentCopy = useRef(copy);
  currentCopy.current = copy;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/root/organizations/${organizationId}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось удалить организацию");
      }
      toast.success(currentCopy.current ? currentCopy.current("actions.deleted", { name: organizationName }) : `Организация «${organizationName}» удалена`);
      setConfirmOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(currentCopy.current ? currentCopy.current("actions.deleteFailed") : error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const bullets = [
    typeof usersCount === "number"
      ? { label: copy ? copy("actions.usersCount", { count: usersCount }) : `Сотрудников: ${usersCount}`, tone: "warn" as const }
      : null,
    typeof documentsCount === "number"
      ? { label: copy ? copy("actions.documentsCount", { count: documentsCount }) : `Документов журналов: ${documentsCount}`, tone: "warn" as const }
      : null,
    {
      label: copy ? copy("actions.deleteConsequences") : "Записи, логи и настройки удалятся вместе с организацией",
      tone: "default" as const,
    },
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={disabled || busy}
        aria-label={copy ? copy("actions.deleteLabel", { name: organizationName }) : `Удалить ${organizationName}`}
        title={copy ? copy("actions.deleteHint") : "Удалить организацию"}
        className="inline-flex size-9 items-center justify-center rounded-xl text-[#9b9fb3] transition-colors hover:bg-[#fff4f2] hover:text-[#a13a32] disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
        variant="danger"
        title={copy ? copy("actions.deleteTitle", { name: organizationName }) : `Удалить «${organizationName}»?`}
        description={copy ? copy("actions.deleteDescription") : "Организация и все её данные будут удалены безвозвратно."}
        bullets={bullets}
        confirmLabel={copy ? copy("actions.deleteConfirm") : "Удалить"}
        cancelLabel={copy ? copy("actions.cancel") : undefined}
      />
    </>
  );
}
