"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { organizationError } from "./organization-presentation";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Props = { organizationId: string; organizationName: string };

/**
 * ROOT-only удаление организации со всеми зависимостями.
 *
 * Подтверждение — `ConfirmDialog`, а не `window.prompt`: нативная
 * промптилка выглядит чужеродно и на телефоне обрезает текст, из-за чего
 * человек не дочитывает, что именно удаляется.
 */
export function DeleteOrgButton({ organizationId, organizationName }: Props) {
  const t = useTranslations("rootOrganizationManagement");
  const currentCopy = useRef(t);
  currentCopy.current = t;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/root/organizations/${organizationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(organizationError(body, currentCopy.current, "delete.failed"));
        return;
      }
      toast.success(currentCopy.current("delete.success", { name: organizationName }));
      setConfirmOpen(false);
      router.push("/root");
      router.refresh();
    } catch {
      toast.error(currentCopy.current("delete.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Button
      type="button"
      onClick={() => setConfirmOpen(true)}
      disabled={busy}
      variant="outline"
      className="h-11 rounded-2xl border-[#fecaca] bg-white px-4 text-[14px] text-[#dc2626] hover:bg-[#fef2f2] hover:text-[#b91c1c]"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      {t("delete.action")}</Button>

    <ConfirmDialog
      open={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      onConfirm={remove}
      variant="danger"
      title={t("delete.title", { name: organizationName })}
      description={t("delete.description")}
      bullets={[
        { label: t("delete.related"), tone: "warn" },
        { label: t("delete.irreversible") },
      ]}
      cancelLabel={t("common.cancel")}
        confirmLabel={t("delete.confirm")}
    />
    </>
  );
}
